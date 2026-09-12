// web-frontend/src/utils/itemBankCalibrator.ts

export interface EmpiricalItem {
  readonly puzzleId: string;
  readonly engineType: string;
  readonly theoreticalB: number;     // 初始理論先驗難度
  empiricalB: number;                // 動態校準後的難度位置參數 (Location b)
  discriminationA: number;           // 區分度參數 a (動態邊界 0.8 ~ 2.0)
  stepThresholds: number[];          // 各類別轉換步階閾值 (Thresholds d_k)
  sampleN: number;                   // 累積施測樣本數 (初始為 0)
  lastCalibratedAt: string;
}

interface PersistedPayload {
  readonly version: number;
  readonly items: Record<string, EmpiricalItem>;
}

export interface CalibratorLogger {
  warn(message: string, context?: unknown): void;
  info?(message: string, context?: unknown): void;
  error?(message: string, context?: unknown): void;
}

const STORAGE_KEY = 'LOGICORE_CALIBRATED_ITEM_BANK_V2';
const CURRENT_SCHEMA_VERSION = 2;
const MAX_STORED_ITEMS = 500;
const DEBOUNCE_WAIT_MS = 1000;
const MAX_DEBOUNCE_WAIT_MS = 5000;
const MAX_BACKOFF_MS = 60_000;
const DEFAULT_LOGGER: CalibratorLogger = console;

export class ItemBankCalibrator {
  private static itemCache: Map<string, EmpiricalItem> = new Map();
  private static isInitialized = false;
  private static isStorageWritable = true;
  private static isDirty = false;
  private static persistTimer: ReturnType<typeof setTimeout> | null = null;
  private static firstPendingPersistAt: number | null = null;
  private static abortController: AbortController | null = null;
  private static logger: CalibratorLogger = DEFAULT_LOGGER;

  private static writeBackoffMs = 0;
  private static consecutiveWriteFailures = 0;
  private static lastWriteAttemptAt = 0;

  public static setLogger(customLogger: CalibratorLogger): void {
    this.logger = customLogger;
  }

  private static ensureInitialized() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    if (typeof window === 'undefined') return;

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      if (window.localStorage) {
        const testKey = '__logicore_probe__';
        window.localStorage.setItem(testKey, '1');
        window.localStorage.removeItem(testKey);

        // 探針成功，重置熔斷與退避
        this.isStorageWritable = true;
        this.consecutiveWriteFailures = 0;
        this.writeBackoffMs = 0;

        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          this.hydrateFromStorage(raw);
        }

        window.addEventListener('storage', this.handleStorageSync, { signal });
      } else {
        this.isStorageWritable = false;
      }
    } catch (e) {
      this.isStorageWritable = false;
      this.logger.warn('[ItemBankCalibrator] LocalStorage probe failed, falling back to memory mode', e);
    }

    window.addEventListener('pagehide', this.flushSync, { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.flushSync();
      }
    }, { signal });
  }

  /**
   * 具備向後相容與遷移能力的水合處理（防禦版本不匹配導致的靜默銷毀）
   */
  private static hydrateFromStorage(raw: string): void {
    try {
      const parsed = JSON.parse(raw) as Partial<PersistedPayload>;
      if (!parsed || typeof parsed !== 'object') return;

      // 檢查版本；若為舊版資料或未帶版本，執行遷移而非靜默拋棄
      if (parsed.version !== CURRENT_SCHEMA_VERSION) {
        this.logger.warn?.(`[ItemBankCalibrator] Migrating storage schema from v${parsed.version} to v${CURRENT_SCHEMA_VERSION}`);
        // 遷移策略：提取所有符合結構的 item，保全舊有校準成果
        if (parsed.items && typeof parsed.items === 'object') {
          Object.entries(parsed.items).forEach(([id, item]) => {
            if (this.isValidItem(item)) {
              this.itemCache.set(id, item);
            }
          });
          // 標記髒值，排程以新版本覆寫回存
          this.isDirty = true;
          this.schedulePersist();
        }
        return;
      }

      if (parsed.items && typeof parsed.items === 'object') {
        Object.entries(parsed.items).forEach(([id, item]) => {
          if (this.isValidItem(item)) {
            this.itemCache.set(id, item);
          }
        });
      }
    } catch (err) {
      this.logger.warn('[ItemBankCalibrator] Failed to parse or migrate persisted storage payload', err);
    }
  }

  private static isValidItem(item: unknown): item is EmpiricalItem {
    if (!item || typeof item !== 'object') return false;
    const it = item as EmpiricalItem;
    return (
      typeof it.puzzleId === 'string' &&
      typeof it.engineType === 'string' &&
      typeof it.lastCalibratedAt === 'string' &&
      !isNaN(new Date(it.lastCalibratedAt).getTime()) &&
      Number.isFinite(it.theoreticalB) &&
      Number.isFinite(it.empiricalB) &&
      Number.isFinite(it.discriminationA) &&
      Array.isArray(it.stepThresholds) &&
      it.stepThresholds.every(Number.isFinite) &&
      Number.isFinite(it.sampleN)
    );
  }

  private static handleStorageSync = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      const payload = JSON.parse(e.newValue) as PersistedPayload;
      if (!payload || typeof payload.items !== 'object') return;

      let hasMergedChange = false;

      Object.entries(payload.items).forEach(([id, remoteItem]) => {
        if (!this.isValidItem(remoteItem)) return;

        const localItem = this.itemCache.get(id);
        if (!localItem) {
          this.itemCache.set(id, remoteItem);
          hasMergedChange = true;
          return;
        }

        const remoteTime = new Date(remoteItem.lastCalibratedAt).getTime();
        const localTime = new Date(localItem.lastCalibratedAt).getTime();

        if (
          remoteItem.sampleN > localItem.sampleN ||
          (remoteItem.sampleN === localItem.sampleN && remoteTime > localTime)
        ) {
          this.itemCache.set(id, remoteItem);
          hasMergedChange = true;
        }
      });

      if (hasMergedChange) {
        this.isDirty = true;
        this.schedulePersist();
      }
    } catch (err) {
      this.logger.warn('[ItemBankCalibrator] Storage sync merge failed', err);
    }
  };

  /**
   * 生命週期終端同步刷新（豁免退避與熔斷，作最後同步寫入嘗試）
   */
  public static flushSync = (): void => {
    if (!this.isDirty || typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.firstPendingPersistAt = null;

    try {
      this.pruneCacheIfNeeded();
      const payload: PersistedPayload = {
        version: CURRENT_SCHEMA_VERSION,
        items: Object.fromEntries(this.itemCache),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      this.isDirty = false;
      this.writeBackoffMs = 0;
      this.consecutiveWriteFailures = 0;
    } catch (e) {
      this.handleWriteFailure(e);
    }
  };

  private static pruneCacheIfNeeded(): void {
    if (this.itemCache.size > MAX_STORED_ITEMS) {
      const sorted = Array.from(this.itemCache.entries())
        .sort((a, b) => new Date(b[1].lastCalibratedAt).getTime() - new Date(a[1].lastCalibratedAt).getTime())
        .slice(0, MAX_STORED_ITEMS);
      this.itemCache = new Map(sorted);
    }
  }

  private static handleWriteFailure(error: unknown): void {
    this.consecutiveWriteFailures++;
    this.writeBackoffMs = Math.min(
      MAX_BACKOFF_MS,
      Math.max(1000, (this.writeBackoffMs || 500) * 2)
    );

    this.logger.warn(
      `[ItemBankCalibrator] Write failed (attempt ${this.consecutiveWriteFailures}), backoff ${this.writeBackoffMs}ms`,
      error
    );

    if (this.consecutiveWriteFailures >= 3) {
      this.isStorageWritable = false;
      this.logger.warn('[ItemBankCalibrator] LocalStorage persistent failures exceeded limit; circuit broken to memory mode');
    }
  }

  /**
   * 具備排程自驅動恢復的防抖管理（修復退避期間遺失自動落盤問題）
   */
  private static schedulePersist() {
    if (!this.isStorageWritable) return;

    this.isDirty = true;
    const now = Date.now();

    // 計算距離退避結束還需等待多久
    const timeSinceLastAttempt = now - this.lastWriteAttemptAt;
    const remainingBackoff = Math.max(0, this.writeBackoffMs - timeSinceLastAttempt);

    if (this.firstPendingPersistAt === null) {
      this.firstPendingPersistAt = now;
    }

    const elapsed = now - this.firstPendingPersistAt;
    const remainingToMax = Math.max(0, MAX_DEBOUNCE_WAIT_MS - elapsed);

    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
    }

    // delay 必須同時滿足：防抖等待、退避冷卻結束、以及不超過 maxWait
    const normalDelay = Math.max(DEBOUNCE_WAIT_MS, remainingBackoff);
    const delay = Math.min(normalDelay, Math.max(remainingBackoff, remainingToMax));

    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.firstPendingPersistAt = null;
      this.executePersist();
    }, delay);
  }

  private static executePersist() {
    const now = Date.now();
    if (
      !this.isDirty ||
      !this.isStorageWritable ||
      typeof window === 'undefined' ||
      !window.localStorage ||
      now - this.lastWriteAttemptAt < this.writeBackoffMs
    ) {
      // 若仍在退避中，重設 timer 至退避結束，防止 dirty 資料永遠卡死
      if (this.isDirty && this.isStorageWritable && now - this.lastWriteAttemptAt < this.writeBackoffMs) {
        const wait = this.writeBackoffMs - (now - this.lastWriteAttemptAt);
        this.persistTimer = setTimeout(() => this.executePersist(), wait);
      }
      return;
    }

    const performWrite = () => {
      if (!this.isDirty || Date.now() - this.lastWriteAttemptAt < this.writeBackoffMs) return;
      this.lastWriteAttemptAt = Date.now();

      try {
        this.pruneCacheIfNeeded();
        const payload: PersistedPayload = {
          version: CURRENT_SCHEMA_VERSION,
          items: Object.fromEntries(this.itemCache),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        this.isDirty = false;
        this.writeBackoffMs = 0;
        this.consecutiveWriteFailures = 0;
      } catch (e) {
        this.handleWriteFailure(e);
        // 寫入失敗後若仍可寫（未達熔斷），自動排程下一次重試
        if (this.isStorageWritable) {
          this.schedulePersist();
        }
      }
    };

    const win = window as unknown as { scheduler?: { postTask?: (cb: () => void, opts: { priority: string }) => void } };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => performWrite(), { timeout: 2000 });
    } else if (typeof win.scheduler?.postTask === 'function') {
      win.scheduler.postTask(performWrite, { priority: 'background' });
    } else {
      setTimeout(performWrite, 0);
    }
  }

  public static getCalibratedItem(puzzleId: string, engineType: string, theoryB: number): EmpiricalItem {
    this.ensureInitialized();

    const safeTheory = Number.isFinite(theoryB) ? theoryB : 0;
    const clampedTheory = Math.max(-3.5, Math.min(4.5, safeTheory));

    let item = this.itemCache.get(puzzleId);
    if (!item) {
      item = {
        puzzleId,
        engineType,
        theoreticalB: Number(clampedTheory.toFixed(2)),
        empiricalB: Number(clampedTheory.toFixed(2)),
        discriminationA: 1.35,
        stepThresholds: [
          Number((clampedTheory - 0.75).toFixed(2)),
          Number(clampedTheory.toFixed(2)),
          Number((clampedTheory + 0.65).toFixed(2)),
        ],
        sampleN: 0,
        lastCalibratedAt: new Date().toISOString(),
      };

      this.itemCache.set(puzzleId, item);
      this.schedulePersist();
    }

    return {
      ...item,
      stepThresholds: item.stepThresholds.slice(),
    };
  }

  public static updateEmpiricalDifficulty(
    puzzleId: string,
    userTheta: number,
    partialCredit: number
  ): void {
    this.ensureInitialized();

    if (!Number.isFinite(userTheta) || !Number.isFinite(partialCredit)) {
      this.logger.warn('[ItemBankCalibrator] Invalid non-finite input in updateEmpiricalDifficulty', {
        puzzleId,
        userTheta,
        partialCredit,
      });
      return;
    }

    const item = this.itemCache.get(puzzleId);
    if (!item) return;

    const clampedCredit = Math.max(0, Math.min(1, partialCredit));
    const clampedTheta = Math.max(-3.5, Math.min(4.5, userTheta));

    const a = item.discriminationA;
    const expectedScore = 1 / (1 + Math.exp(-a * (clampedTheta - item.empiricalB)));
    const residual = clampedCredit - expectedScore;

    const learningRate = Math.max(0.015, 0.35 / Math.sqrt(item.sampleN + 5));
    const priorPull = 0.15 * (item.theoreticalB - item.empiricalB);
    const deltaB = learningRate * residual - learningRate * priorPull;

    const boundedDelta = Math.max(-0.25, Math.min(0.25, deltaB));
    const rawNewB = item.empiricalB - boundedDelta;
    const finalNewB = Math.max(
      item.theoreticalB - 0.75,
      Math.min(item.theoreticalB + 0.75, rawNewB)
    );

    if (!Number.isFinite(finalNewB)) return;

    const shift = finalNewB - item.empiricalB;
    item.empiricalB = Number(finalNewB.toFixed(3));
    item.stepThresholds = item.stepThresholds.map((th) => Number((th + shift).toFixed(3)));

    if (Math.abs(residual) < 0.2) {
      item.discriminationA = Math.min(2.0, Number((item.discriminationA * 1.02).toFixed(2)));
    } else if (Math.abs(residual) > 0.6) {
      item.discriminationA = Math.max(0.8, Number((item.discriminationA * 0.98).toFixed(2)));
    }

    item.sampleN += 1;
    item.lastCalibratedAt = new Date().toISOString();

    this.schedulePersist();
  }

  public static getItemInformation(theta: number, item: EmpiricalItem): number {
    if (!this.isValidItem(item)) return 0;

    const safeTheta = Number.isFinite(theta) ? theta : 0;
    const a = item.discriminationA;
    const thresholds = item.stepThresholds;
    const m = thresholds.length;

    const numerators: number[] = [1.0];
    let cumulativeSum = 0;

    for (let k = 1; k <= m; k++) {
      cumulativeSum += a * (safeTheta - thresholds[k - 1]);
      numerators.push(Math.exp(Math.max(-25, Math.min(25, cumulativeSum))));
    }

    const denominator = numerators.reduce((acc, val) => acc + val, 0);
    const probs = numerators.map((v) => v / denominator);

    let expectedX = 0;
    let expectedX2 = 0;

    for (let k = 0; k <= m; k++) {
      expectedX += k * probs[k];
      expectedX2 += k * k * probs[k];
    }

    const variance = expectedX2 - expectedX * expectedX;
    const info = a * a * Math.max(0.001, variance);

    return Number(info.toFixed(3));
  }

  public static dispose(): void {
    if (this.isDirty) {
      this.flushSync();
    }
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.firstPendingPersistAt = null;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isInitialized = false;
  }

  public static resetForTesting(): void {
    this.dispose();
    this.itemCache.clear();
    this.isDirty = false;
    this.isStorageWritable = true;
    this.writeBackoffMs = 0;
    this.consecutiveWriteFailures = 0;
    this.lastWriteAttemptAt = 0;
    this.logger = DEFAULT_LOGGER;

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
    }
  }
}
