// web-frontend/src/utils/itemBankCalibrator.ts

export interface EmpiricalItem {
  puzzleId: string;
  engineType: string;
  theoreticalB: number;     // 初始理論先驗難度
  empiricalB: number;       // 動態校準後的難度位置參數 (Location b)
  discriminationA: number;  // 區分度參數 a (動態邊界 0.8 ~ 2.2)
  stepThresholds: number[]; // 各類別轉換步階閾值 (Thresholds d_k)
  sampleN: number;          // 累積施測樣本數
  lastCalibratedAt: string;
}

const STORAGE_KEY = 'LOGICORE_CALIBRATED_ITEM_BANK';
const MAX_STORED_ITEMS = 200; // 防止 localStorage 爆滿

export class ItemBankCalibrator {
  private static itemCache: Map<string, EmpiricalItem> = new Map();
  private static isInitialized = false;
  private static persistTimer: any = null;

  private static ensureInitialized() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          Object.entries(parsed).forEach(([id, item]) => {
            this.itemCache.set(id, item as EmpiricalItem);
          });
        }
      }
    } catch (e) {
      console.warn('[ItemBankCalibrator] Failed to hydrate cache from storage', e);
    }
  }

  /**
   * 防抖持久化，避免频繁同步阻塞主執行緒
   */
  private static schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          // LRU 淘汰：若超過容量限制，保留最近更新的項目
          if (this.itemCache.size > MAX_STORED_ITEMS) {
            const sorted = Array.from(this.itemCache.entries())
              .sort((a, b) => new Date(b[1].lastCalibratedAt).getTime() - new Date(a[1].lastCalibratedAt).getTime())
              .slice(0, MAX_STORED_ITEMS);
            this.itemCache = new Map(sorted);
          }

          const serialized: Record<string, EmpiricalItem> = {};
          this.itemCache.forEach((item, id) => {
            serialized[id] = item;
          });
          localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
        }
      } catch {}
    }, 1000);
  }

  /**
   * 取得或初始化註冊題目
   */
  public static getCalibratedItem(puzzleId: string, engineType: string, theoryB: number): EmpiricalItem {
    this.ensureInitialized();
    const clampedTheory = Math.max(-3.5, Math.min(4.5, theoryB));

    if (this.itemCache.has(puzzleId)) {
      return this.itemCache.get(puzzleId)!;
    }

    const defaultItem: EmpiricalItem = {
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
      sampleN: 1,
      lastCalibratedAt: new Date().toISOString(),
    };

    this.itemCache.set(puzzleId, defaultItem);
    this.schedulePersist();
    return defaultItem;
  }

  /**
   * 線上經驗貝氏題目校準 (Online Empirical Bayes Item Calibration)
   * 加入「理論難度回拉力 (Prior Regularization)」，避免單一玩家實力將難度無底線拉偏
   */
  public static updateEmpiricalDifficulty(
    puzzleId: string,
    userTheta: number,
    partialCredit: number // 0.0 ~ 1.0 (答對率或階層分數)
  ) {
    this.ensureInitialized();
    const item = this.itemCache.get(puzzleId);
    if (!item) return;

    const clampedCredit = Math.max(0, Math.min(1, partialCredit));
    const clampedTheta = Math.max(-3.5, Math.min(4.5, userTheta));

    const a = item.discriminationA;
    const expectedScore = 1 / (1 + Math.exp(-a * (clampedTheta - item.empiricalB)));
    const residual = clampedCredit - expectedScore;

    // 自適應學習率
    const learningRate = Math.max(0.015, 0.35 / Math.sqrt(item.sampleN + 5));

    // 核心優化：貝氏先驗正則化，防止在單機環境下被刷崩難度
    // 偏離理論值越大，先驗拉回力越強
    const priorPull = 0.15 * (item.theoreticalB - item.empiricalB);
    const deltaB = learningRate * residual - learningRate * priorPull;

    // 限制單次校準最大步長，且難度相較於理論難度的偏離不可超過 ±0.75 Logit
    const boundedDelta = Math.max(-0.25, Math.min(0.25, deltaB));
    const rawNewB = item.empiricalB - boundedDelta;
    const finalNewB = Math.max(
      item.theoreticalB - 0.75,
      Math.min(item.theoreticalB + 0.75, rawNewB)
    );

    const shift = finalNewB - item.empiricalB;
    item.empiricalB = Number(finalNewB.toFixed(3));

    // 步階閾值同步平移
    item.stepThresholds = item.stepThresholds.map((th) => Number((th + shift).toFixed(3)));
    
    // 微幅動態調整區分度 a
    if (Math.abs(residual) < 0.2) {
      item.discriminationA = Math.min(2.0, Number((item.discriminationA * 1.02).toFixed(2)));
    } else if (Math.abs(residual) > 0.6) {
      item.discriminationA = Math.max(0.8, Number((item.discriminationA * 0.98).toFixed(2)));
    }

    item.sampleN += 1;
    item.lastCalibratedAt = new Date().toISOString();

    this.schedulePersist();
  }

  /**
   * 部分得分模型 (PCM) Fisher 資訊量計算
   */
  public static getItemInformation(theta: number, item: EmpiricalItem): number {
    const a = item.discriminationA;
    const thresholds = item.stepThresholds;
    const m = thresholds.length;

    const numerators: number[] = [1.0];
    let cumulativeSum = 0;

    for (let k = 1; k <= m; k++) {
      cumulativeSum += a * (theta - thresholds[k - 1]);
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
}
