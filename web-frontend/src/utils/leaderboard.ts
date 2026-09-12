// web-frontend/src/utils/leaderboard.ts

export interface LeaderboardEntry {
  readonly id: string;
  readonly checksum: string;
  readonly nickname: string;
  readonly engine: string;
  readonly tier: string;
  readonly timeSpentSec: number;
  readonly points: number;
  readonly hintsUsed: number;
  readonly isPure: boolean;
  readonly signature: string;
  readonly isoDate: string; // ISO 8601 標準時間
  readonly rank?: number;   // 運算導出之官方名次 (1-based)
}

export interface LeaderboardQueryOptions {
  readonly pureOnly?: boolean;
  readonly uniquePlayerOnly?: boolean; // 僅保留每位玩家的最佳成績 (去重模式)
  readonly limit?: number;
}

export interface PlayerGlobalStats {
  readonly nickname: string;
  readonly totalPoints: number;
  readonly puzzlesCleared: number;   // 獨立通關題數 (Distinct Puzzles)
  readonly pureClearCount: number;  // 獨立純淨通關題數 (Distinct Pure Puzzles)
  readonly bestRankCount: number;   // 榮獲第一名的題目數
  readonly avgTimeSpentSec: number; // 獨立題目平均耗時 (秒)
}

export interface AddEntryResult {
  readonly success: boolean;
  readonly entry: LeaderboardEntry | null;
  readonly wasPersisted?: boolean; // P3-4: 標記紀錄是否真正進入前 MAX_ENTRIES_PER_PUZZLE 並落盤
  readonly error?: 'InvalidChecksum' | 'InvalidInput' | 'StorageQuotaExceeded';
}

export interface ClearEntriesResult {
  readonly success: boolean;
  readonly error?: 'InvalidChecksum' | 'ClearFailed';
}

export interface LeaderboardLogger {
  warn(message: string, context?: unknown): void;
  info?(message: string, context?: unknown): void;
}

const STORAGE_PREFIX = 'logicore_lb_puzzle_v3_';
const GLOBAL_INDEX_KEY = 'logicore_lb_index_v3';

// 儲存容量設計：200 題 × 25 筆 ≈ 2.7MB（UTF-16 編碼），保留約 2.3MB 餘裕
const MAX_ENTRIES_PER_PUZZLE = 25;
const MAX_PUZZLES_INDEXED = 200;

const PUZZLE_CACHE_TTL_MS = 1000;
const HALL_OF_FAME_CACHE_TTL_MS = 5000;
const LEADERBOARD_BROADCAST_CHANNEL = 'logicore:leaderboard-updated';
const ASYNC_CHUNK_SIZE = 6;
const DEFAULT_LOGGER: LeaderboardLogger = console;

/**
 * 本機排行榜管理器 (Leaderboard Manager - Production Grade)
 * 
 * ⚠️ 架構設計與邊界保證 (Known Boundaries & Design Contract)：
 * 1. 異步任務生命週期：In-Flight Promise 由呼叫外層 try/finally 做「物件層引用比對 (=== workerPromise)」釋放，杜絕死鎖與孤兒引用。
 * 2. 廣播初始化容錯：僅在 BroadcastChannel 建構成功後標記 isInitialized，建構異常允許下次呼叫重試。
 * 3. 雙簽章向前相容：新寫入以 NFC 正規化簽署，相容歷史未經 NFC 正規化之 NFD 暱稱資料。
 * 4. 三重維度對齊：寫入與讀取排序嚴格對齊 (points DESC -> time ASC -> isoDate DESC)，防止同分截斷不一致。
 */
export class LeaderboardManager {
  private static broadcastChannel: BroadcastChannel | null = null;
  private static isInitialized = false;
  private static logger: LeaderboardLogger = DEFAULT_LOGGER;
  private static idCounter = 0;

  private static puzzleCache: Map<string, {
    readonly result: readonly LeaderboardEntry[];
    readonly cachedAt: number;
  }> = new Map();

  private static hallOfFameCache: {
    readonly result: readonly PlayerGlobalStats[];
    readonly cachedAt: number;
  } | null = null;

  private static inFlightPromise: Promise<readonly PlayerGlobalStats[]> | null = null;
  private static inFlightToken = 0;

  public static setLogger(customLogger: LeaderboardLogger): void {
    this.logger = customLogger;
  }

  public static normalizeNickname(nickname: string): string {
    if (!nickname || typeof nickname !== 'string') return '';
    return nickname.normalize('NFC').trim().toLowerCase();
  }

  /**
   * P2 修復：初始化旗標只在成功或確認不支援時設定，防止構造拋錯後永久卡死
   */
  private static ensureBroadcastInitialized(): void {
    if (this.isInitialized) return;

    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
      this.isInitialized = true;
      return;
    }

    try {
      this.broadcastChannel = new BroadcastChannel('logicore:leaderboard');
      this.broadcastChannel.addEventListener('message', (e) => {
        if (!e.data) return;
        if (e.data.type === 'update' || e.data.type === 'clear') {
          this.invalidateCache();
          window.dispatchEvent(
            new CustomEvent(LEADERBOARD_BROADCAST_CHANNEL, { detail: e.data.detail })
          );
        }
      });
      this.isInitialized = true; // 僅在成功掛載時設為 true
    } catch (e) {
      this.broadcastChannel = null;
      this.logger.warn('[LeaderboardManager] BroadcastChannel initialization failed, will retry next call', e);
      // isInitialized 保持 false，允許後續呼叫重試
    }
  }

  private static invalidateCache(): void {
    this.puzzleCache.clear();
    this.hallOfFameCache = null;
    this.inFlightPromise = null;
    this.inFlightToken++;
  }

  public static calculateScore(
    irtDifficulty: number,
    timeSpentSec: number,
    timeLimitSec: number,
    hintsUsed: number,
    isPure: boolean = false
  ): number {
    const safeIrt = Number.isFinite(irtDifficulty) ? Math.max(-3.0, Math.min(4.5, irtDifficulty)) : 0;
    const basePoints = Math.max(50, Math.round(120 + safeIrt * 45));

    const effectiveTimeLimit = Math.max(15, Number.isFinite(timeLimitSec) ? timeLimitSec : 60);
    const safeTimeSpent = Number.isFinite(timeSpentSec) ? Math.max(0, timeSpentSec) : effectiveTimeLimit;
    const timeRatio = Math.max(0, Math.min(1, (effectiveTimeLimit - safeTimeSpent) / effectiveTimeLimit));
    const speedBonus = Math.round(Math.pow(timeRatio, 1.25) * 80);

    const safeHints = Number.isFinite(hintsUsed) ? Math.max(0, Math.floor(hintsUsed)) : 0;
    const hintPenalty = safeHints === 0
      ? 0
      : safeHints === 1
      ? 20
      : 20 + (safeHints - 1) * 35;

    const pureBonus = isPure && safeHints === 0 ? 30 : 0;
    return Math.max(25, basePoints + speedBonus + pureBonus - hintPenalty);
  }

  private static hashCanonical(canonical: string): string {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;

    for (let i = 0; i < canonical.length; i++) {
      const ch = canonical.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
    const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
    return `SIG_V3_${part1}${part2}`.toUpperCase();
  }

  public static generateSignature(
    checksum: string,
    nickname: string,
    engine: string,
    tier: string,
    points: number,
    time: number,
    hintsUsed: number,
    isPure: boolean,
    isoDate: string
  ): string {
    const salt = 'LOGICORE_ENTERPRISE_LEADERBOARD_INTEGRITY_V3';
    const canonical = [
      checksum,
      this.normalizeNickname(nickname),
      typeof engine === 'string' ? engine.toLowerCase() : '',
      typeof tier === 'string' ? tier.toLowerCase() : '',
      points,
      time,
      hintsUsed,
      isPure ? 'PURE_TRUE' : 'PURE_FALSE',
      isoDate,
      salt,
    ].join('::');

    return this.hashCanonical(canonical);
  }

  /**
   * @deprecated 僅供相容驗證歷史未經 NFC 正規化之 NFD 暱稱資料。
   * 新程式碼請使用 generateSignature()。
   */
  public static generateLegacySignature(
    checksum: string,
    nickname: string,
    engine: string,
    tier: string,
    points: number,
    time: number,
    hintsUsed: number,
    isPure: boolean,
    isoDate: string
  ): string {
    const salt = 'LOGICORE_ENTERPRISE_LEADERBOARD_INTEGRITY_V3';
    const canonical = [
      checksum,
      typeof nickname === 'string' ? nickname.trim().toLowerCase() : '',
      typeof engine === 'string' ? engine.toLowerCase() : '',
      typeof tier === 'string' ? tier.toLowerCase() : '',
      points,
      time,
      hintsUsed,
      isPure ? 'PURE_TRUE' : 'PURE_FALSE',
      isoDate,
      salt,
    ].join('::');

    return this.hashCanonical(canonical);
  }

  public static isEntryValid(entry: unknown, expectedChecksumPrefix?: string): entry is LeaderboardEntry {
    if (!entry || typeof entry !== 'object') return false;
    const it = entry as LeaderboardEntry;

    if (typeof it.id !== 'string' || it.id.length === 0 || it.id.length > 64) {
      return false;
    }
    if (typeof it.checksum !== 'string' || it.checksum.length === 0) {
      return false;
    }
    if (expectedChecksumPrefix && !it.checksum.startsWith(expectedChecksumPrefix)) {
      return false;
    }
    if (typeof it.nickname !== 'string' || typeof it.engine !== 'string' || typeof it.tier !== 'string') {
      return false;
    }
    if (!Number.isFinite(it.points) || !Number.isFinite(it.timeSpentSec)) {
      return false;
    }
    if (typeof it.isoDate !== 'string' || isNaN(new Date(it.isoDate).getTime())) {
      return false;
    }

    const safeHints = Number.isFinite(it.hintsUsed) ? Math.max(0, Math.floor(it.hintsUsed)) : 0;

    const expectedSig = this.generateSignature(
      it.checksum,
      it.nickname,
      it.engine,
      it.tier,
      it.points,
      it.timeSpentSec,
      safeHints,
      Boolean(it.isPure),
      it.isoDate
    );

    if (it.signature === expectedSig) {
      return true;
    }

    const legacySig = this.generateLegacySignature(
      it.checksum,
      it.nickname,
      it.engine,
      it.tier,
      it.points,
      it.timeSpentSec,
      safeHints,
      Boolean(it.isPure),
      it.isoDate
    );

    return it.signature === legacySig;
  }

  /**
   * P3-5: 下沉防禦，確保 checksum 非法時安全返回 null
   */
  private static getStorageKey(checksum: string): string | null {
    if (!checksum || typeof checksum !== 'string' || checksum.length === 0) return null;
    return `${STORAGE_PREFIX}${checksum.slice(0, 24)}`;
  }

  public static getEntriesForPuzzle(
    checksum: string,
    options: LeaderboardQueryOptions = {}
  ): readonly LeaderboardEntry[] {
    this.ensureBroadcastInitialized();
    const key = this.getStorageKey(checksum);
    if (!key) return Object.freeze([]);

    const now = Date.now();
    let validEntries: readonly LeaderboardEntry[];

    const cached = this.puzzleCache.get(checksum);
    if (cached && now - cached.cachedAt < PUZZLE_CACHE_TTL_MS) {
      validEntries = cached.result;
    } else {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) {
          this.puzzleCache.set(checksum, { result: Object.freeze([]), cachedAt: now });
          return Object.freeze([]);
        }

        const list: unknown[] = JSON.parse(raw);
        if (!Array.isArray(list)) {
          this.puzzleCache.set(checksum, { result: Object.freeze([]), cachedAt: now });
          return Object.freeze([]);
        }

        const checksumPrefix = checksum.slice(0, 24);
        const parsedEntries: LeaderboardEntry[] = [];
        for (const item of list) {
          if (this.isEntryValid(item, checksumPrefix)) {
            parsedEntries.push(item);
          }
        }

        parsedEntries.sort((a, b) => {
          return (
            b.points - a.points ||
            a.timeSpentSec - b.timeSpentSec ||
            new Date(b.isoDate).getTime() - new Date(a.isoDate).getTime()
          );
        });

        validEntries = Object.freeze(parsedEntries);
        this.puzzleCache.set(checksum, {
          result: validEntries,
          cachedAt: now,
        });
      } catch (e) {
        this.logger.warn('[LeaderboardManager] Failed to read or parse puzzle entries', { checksum, error: e });
        this.puzzleCache.set(checksum, { result: Object.freeze([]), cachedAt: now });
        return Object.freeze([]);
      }
    }

    let result = validEntries;
    if (options.pureOnly) {
      result = result.filter((item) => item.isPure);
    }

    if (options.uniquePlayerOnly) {
      const seenPlayers = new Set<string>();
      result = result.filter((entry) => {
        const normName = this.normalizeNickname(entry.nickname);
        if (seenPlayers.has(normName)) return false;
        seenPlayers.add(normName);
        return true;
      });
    }

    if (options.limit && options.limit > 0) {
      result = result.slice(0, options.limit);
    }

    return Object.freeze(
      result.map((entry, index) => ({
        ...entry,
        rank: index + 1,
      }))
    );
  }

  public static addEntry(
    checksum: string,
    entry: Omit<LeaderboardEntry, 'id' | 'checksum' | 'signature' | 'isoDate' | 'rank'>
  ): AddEntryResult {
    this.ensureBroadcastInitialized();

    const key = this.getStorageKey(checksum);
    if (!key) {
      this.logger.warn('[LeaderboardManager] Invalid checksum provided in addEntry', { checksum });
      return { success: false, entry: null, error: 'InvalidChecksum' };
    }

    if (!entry.nickname || typeof entry.nickname !== 'string' || entry.nickname.trim().length === 0) {
      this.logger.warn('[LeaderboardManager] Invalid empty nickname provided in addEntry');
      return { success: false, entry: null, error: 'InvalidInput' };
    }

    if (
      typeof entry.engine !== 'string' || entry.engine.trim().length === 0 ||
      typeof entry.tier !== 'string' || entry.tier.trim().length === 0
    ) {
      this.logger.warn('[LeaderboardManager] Invalid engine or tier in addEntry', {
        engine: entry.engine,
        tier: entry.tier,
      });
      return { success: false, entry: null, error: 'InvalidInput' };
    }

    if (!Number.isFinite(entry.points) || !Number.isFinite(entry.timeSpentSec)) {
      this.logger.warn('[LeaderboardManager] Invalid non-finite input in addEntry', {
        points: entry.points,
        timeSpentSec: entry.timeSpentSec,
      });
      return { success: false, entry: null, error: 'InvalidInput' };
    }

    const checksumPrefix = checksum.slice(0, 24);
    let list: LeaderboardEntry[] = [];

    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          list = parsed.filter((item): item is LeaderboardEntry => this.isEntryValid(item, checksumPrefix));
        }
      }
    } catch (e) {
      // P3-1 修復：記錄異常警告，告別靜默覆蓋
      this.logger.warn('[LeaderboardManager] Failed to read existing entries before add, starting fresh', { checksum, error: e });
    }

    const nowIso = new Date().toISOString();
    const safeHints = Number.isFinite(entry.hintsUsed) ? Math.max(0, Math.floor(entry.hintsUsed)) : 0;
    const signature = this.generateSignature(
      checksum,
      entry.nickname,
      entry.engine,
      entry.tier,
      entry.points,
      entry.timeSpentSec,
      safeHints,
      Boolean(entry.isPure),
      nowIso
    );

    this.idCounter++;
    const randomSuffix = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : `${Math.random().toString(36).slice(2, 6)}_${this.idCounter.toString(36)}`;

    const newRecord: LeaderboardEntry = {
      ...entry,
      checksum,
      hintsUsed: safeHints,
      id: `rec_${Date.now().toString(36)}_${this.idCounter.toString(36)}_${randomSuffix}`,
      signature,
      isoDate: nowIso,
    };

    // P3-3 修復：寫入路徑全面對齊三重排序（points DESC -> time ASC -> isoDate DESC）
    const updated = [...list, newRecord]
      .sort((a, b) => (
        b.points - a.points ||
        a.timeSpentSec - b.timeSpentSec ||
        new Date(b.isoDate).getTime() - new Date(a.isoDate).getTime()
      ))
      .slice(0, MAX_ENTRIES_PER_PUZZLE);

    // P3-4 修復：核算是否真正被落盤（未遭榜單容量截斷）
    const wasPersisted = updated.some((item) => item.id === newRecord.id);

    try {
      localStorage.setItem(key, JSON.stringify(updated));

      const indexRaw = localStorage.getItem(GLOBAL_INDEX_KEY);
      const indexList: string[] = indexRaw ? JSON.parse(indexRaw) : [];
      const indexSet = new Set<string>(indexList);
      indexSet.delete(key);
      indexSet.add(key);

      const updatedKeys = Array.from(indexSet);
      if (updatedKeys.length > MAX_PUZZLES_INDEXED) {
        const evictedKeys = updatedKeys.slice(0, updatedKeys.length - MAX_PUZZLES_INDEXED);
        for (const evictedKey of evictedKeys) {
          localStorage.removeItem(evictedKey);
        }
        localStorage.setItem(
          GLOBAL_INDEX_KEY,
          JSON.stringify(updatedKeys.slice(updatedKeys.length - MAX_PUZZLES_INDEXED))
        );
      } else {
        localStorage.setItem(GLOBAL_INDEX_KEY, JSON.stringify(updatedKeys));
      }

      this.invalidateCache();

      const broadcastPayload = { checksum, entry: newRecord };
      this.broadcastChannel?.postMessage({ type: 'update', detail: broadcastPayload });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(LEADERBOARD_BROADCAST_CHANNEL, { detail: broadcastPayload })
        );
      }

      return { success: true, entry: newRecord, wasPersisted };
    } catch (e) {
      this.logger.warn('[LeaderboardManager] Write storage quota exceeded or restricted', e);
      return { success: false, entry: newRecord, wasPersisted: false, error: 'StorageQuotaExceeded' };
    }
  }

  private static processKeyIntoPlayerMap(
    key: string,
    playerMap: Map<
      string,
      {
        nickname: string;
        totalPoints: number;
        clearedPuzzles: Set<string>;
        pureClearedPuzzles: Set<string>;
        bestRankCount: number;
        distinctTimes: Map<string, number>;
      }
    >
  ): void {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    const expectedChecksumPrefix = key.startsWith(STORAGE_PREFIX)
      ? key.slice(STORAGE_PREFIX.length)
      : undefined;

    const validEntries: LeaderboardEntry[] = [];
    for (const item of parsed) {
      if (this.isEntryValid(item, expectedChecksumPrefix)) {
        validEntries.push(item);
      }
    }
    if (validEntries.length === 0) return;

    validEntries.sort((a, b) => {
      return (
        b.points - a.points ||
        a.timeSpentSec - b.timeSpentSec ||
        new Date(b.isoDate).getTime() - new Date(a.isoDate).getTime()
      );
    });

    const topOne = validEntries[0];
    const topNormName = this.normalizeNickname(topOne.nickname);
    const puzzleChecksum = topOne.checksum;

    for (const e of validEntries) {
      const normName = this.normalizeNickname(e.nickname);
      let current = playerMap.get(normName);
      if (!current) {
        current = {
          nickname: e.nickname,
          totalPoints: 0,
          clearedPuzzles: new Set<string>(),
          pureClearedPuzzles: new Set<string>(),
          bestRankCount: 0,
          distinctTimes: new Map<string, number>(),
        };
        playerMap.set(normName, current);
      }

      current.totalPoints += e.points;
      current.clearedPuzzles.add(puzzleChecksum);
      if (e.isPure) {
        current.pureClearedPuzzles.add(puzzleChecksum);
      }

      const existingTime = current.distinctTimes.get(puzzleChecksum);
      if (existingTime === undefined || e.timeSpentSec < existingTime) {
        current.distinctTimes.set(puzzleChecksum, e.timeSpentSec);
      }
    }

    const topPlayer = playerMap.get(topNormName);
    if (topPlayer) {
      topPlayer.bestRankCount += 1;
    }
  }

  private static buildHallOfFameResult(
    playerMap: Map<
      string,
      {
        nickname: string;
        totalPoints: number;
        clearedPuzzles: Set<string>;
        pureClearedPuzzles: Set<string>;
        bestRankCount: number;
        distinctTimes: Map<string, number>;
      }
    >
  ): readonly PlayerGlobalStats[] {
    const computed: readonly PlayerGlobalStats[] = Array.from(playerMap.values())
      .map((p) => {
        let sumTime = 0;
        p.distinctTimes.forEach((t) => {
          sumTime += t;
        });
        const distinctCount = Math.max(1, p.clearedPuzzles.size);

        return Object.freeze({
          nickname: p.nickname,
          totalPoints: p.totalPoints,
          puzzlesCleared: p.clearedPuzzles.size,
          pureClearCount: p.pureClearedPuzzles.size,
          bestRankCount: p.bestRankCount,
          avgTimeSpentSec: Math.round(sumTime / distinctCount),
        });
      })
      .sort((a, b) => b.totalPoints - a.totalPoints || b.bestRankCount - a.bestRankCount);

    return Object.freeze(computed);
  }

  public static async getGlobalHallOfFameAsync(
    limit: number = 20,
    signal?: AbortSignal
  ): Promise<readonly PlayerGlobalStats[]> {
    this.ensureBroadcastInitialized();

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const now = Date.now();
    if (this.hallOfFameCache && now - this.hallOfFameCache.cachedAt < HALL_OF_FAME_CACHE_TTL_MS) {
      return Object.freeze(this.hallOfFameCache.result.slice(0, limit));
    }

    if (this.inFlightPromise) {
      const sharedResult = await this.inFlightPromise;
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      return Object.freeze(sharedResult.slice(0, limit));
    }

    const currentToken = ++this.inFlightToken;

    const workerPromise = (async () => {
      const indexRaw = localStorage.getItem(GLOBAL_INDEX_KEY);
      if (!indexRaw) return Object.freeze([]);
      const keys: string[] = JSON.parse(indexRaw);
      if (!Array.isArray(keys) || keys.length === 0) return Object.freeze([]);

      const playerMap = new Map<
        string,
        {
          nickname: string;
          totalPoints: number;
          clearedPuzzles: Set<string>;
          pureClearedPuzzles: Set<string>;
          bestRankCount: number;
          distinctTimes: Map<string, number>;
        }
      >();

      const yieldToMain = (): Promise<void> => {
        const globalScheduler = (typeof window !== 'undefined'
          ? (window as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler
          : undefined);

        if (typeof globalScheduler?.yield === 'function') {
          return globalScheduler.yield();
        }
        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
          return new Promise<void>((resolve) => window.requestIdleCallback(() => resolve(), { timeout: 300 }));
        }
        return new Promise<void>((resolve) => setTimeout(resolve, 0));
      };

      for (let i = 0; i < keys.length; i += ASYNC_CHUNK_SIZE) {
        const chunk = keys.slice(i, i + ASYNC_CHUNK_SIZE);
        for (const key of chunk) {
          try {
            this.processKeyIntoPlayerMap(key, playerMap);
          } catch {}
        }

        if (i + ASYNC_CHUNK_SIZE < keys.length) {
          await yieldToMain();
        }
      }

      return this.buildHallOfFameResult(playerMap);
    })();

    this.inFlightPromise = workerPromise;

    try {
      const computed = await workerPromise;

      if (currentToken === this.inFlightToken) {
        this.hallOfFameCache = {
          result: computed,
          cachedAt: Date.now(),
        };
      }

      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      return Object.freeze(computed.slice(0, limit));
    } finally {
      if (this.inFlightPromise === workerPromise) {
        this.inFlightPromise = null;
      }
    }
  }

  /**
   * P3-2 修復：增加前置 checksum 驗證，對齊 ClearEntriesResult 錯誤碼契約
   */
  public static clearEntriesForPuzzle(checksum: string): ClearEntriesResult {
    this.ensureBroadcastInitialized();
    const key = this.getStorageKey(checksum);
    if (!key) {
      this.logger.warn('[LeaderboardManager] Invalid checksum provided in clearEntriesForPuzzle', { checksum });
      return { success: false, error: 'InvalidChecksum' };
    }

    try {
      localStorage.removeItem(key);

      const indexRaw = localStorage.getItem(GLOBAL_INDEX_KEY);
      if (indexRaw) {
        const indexList: string[] = JSON.parse(indexRaw);
        const indexSet = new Set<string>(indexList);
        indexSet.delete(key);
        localStorage.setItem(GLOBAL_INDEX_KEY, JSON.stringify(Array.from(indexSet)));
      }

      this.puzzleCache.delete(checksum);
      this.hallOfFameCache = null;
      this.inFlightPromise = null;
      this.inFlightToken++;

      const broadcastPayload = { checksum };
      this.broadcastChannel?.postMessage({ type: 'clear', detail: broadcastPayload });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(LEADERBOARD_BROADCAST_CHANNEL, { detail: broadcastPayload })
        );
      }

      return { success: true };
    } catch (e) {
      this.logger.warn('[LeaderboardManager] Clear entries failed', e);
      return { success: false, error: 'ClearFailed' };
    }
  }

  public static dispose(): void {
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    this.isInitialized = false;
    this.invalidateCache();
  }

  public static resetForTesting(): void {
    this.dispose();
    this.invalidateCache();
    this.inFlightToken = 0;
    this.logger = DEFAULT_LOGGER;
    this.idCounter = 0;

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const toRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith(STORAGE_PREFIX) || k === GLOBAL_INDEX_KEY)) {
            toRemove.push(k);
          }
        }
        toRemove.forEach((k) => localStorage.removeItem(k));
      } catch {}
    }
  }
}
