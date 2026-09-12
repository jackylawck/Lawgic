// web-frontend/src/workers/masyu.worker.ts
import { MasyuCoreEngine, TierKey, PuzzleEntity, DynamicFlowTuning } from '../engines/masyuCore';

export interface WorkerRequest {
  requestId: string;
  action: 'produce_single' | 'produce_batch';
  tier: TierKey;
  batchSize?: number;
  seed?: number;
  flowTuning?: DynamicFlowTuning;
}

export type WorkerResponse =
  | {
      status: 'ok';
      type: 'single';
      requestId: string;
      puzzle: PuzzleEntity;
    }
  | {
      status: 'ok';
      type: 'batch';
      requestId: string;
      puzzles: PuzzleEntity[];
    }
  | {
      status: 'error';
      requestId?: string;
      error: string;
    };

export const MAX_BATCH_SIZE = 100;
export const MAX_REQUEST_ID_LENGTH = 128;

/**
 * 🔒 真正具備「編譯期窮舉校驗」的 Tier 白名單映射
 * 透過 Record<TierKey, true>，只要 masyuCore.ts 增刪任何 TierKey，
 * 這裡若未 100% 同步，tsc 將直接噴出 TS2741 (Property missing) 或 TS2322 (Excess property)！
 */
const TIER_EXHAUSTIVE_MAP: Readonly<Record<TierKey, true>> = {
  kids: true,
  intermediate: true,
  master: true,
  legendary: true,
  ultimate: true,
};

export const VALID_TIERS: ReadonlySet<TierKey> = new Set<TierKey>(
  Object.keys(TIER_EXHAUSTIVE_MAP) as TierKey[]
);

/**
 * 種子型別消毒與 32-bit 無符號整數化 (杜絕 NaN 與負整數溢位)
 * 無論輸入為何，均保證回傳介於 [0, 4294967295] 之有限非負整數
 */
export function resolveSeed(input?: unknown): number {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input >>> 0;
  }
  return Math.floor(Math.random() * 0x7fffffff) >>> 0;
}

/**
 * ⚠️ 架構契約與限制聲明 (Worker Contract & Architectural Constraints)：
 * 1. 窮舉型別對齊：使用 TIER_EXHAUSTIVE_MAP 達成編譯期與運行期雙重白名單約束。
 * 2. 數值與協定消毒：requestId 長度上限 (128)、batchSize 嚴格正整數化且超出 MAX_BATCH_SIZE (100) 時立即拒絕。
 * 3. 種子行為對稱：single 與 batch 統一採用 resolveSeed 進行確定性初始化與序列化演算法。
 */
self.addEventListener('message', (e: MessageEvent<WorkerRequest>) => {
  const data = e.data;

  // 1. 封包結構校驗
  if (!data || typeof data !== 'object') {
    self.postMessage({
      status: 'error',
      error: 'Invalid message payload received by worker.',
    } satisfies WorkerResponse);
    return;
  }

  const { requestId, action, tier, batchSize, seed, flowTuning } = data;

  // 2. requestId 型別與邊界長度校驗
  if (
    typeof requestId !== 'string' ||
    requestId.trim().length === 0 ||
    requestId.length > MAX_REQUEST_ID_LENGTH
  ) {
    self.postMessage({
      status: 'error',
      error: `Missing or invalid required field: requestId (must be non-empty string <= ${MAX_REQUEST_ID_LENGTH} chars).`,
    } satisfies WorkerResponse);
    return;
  }

  // 3. Tier 白名單嚴格防禦
  if (typeof tier !== 'string' || !VALID_TIERS.has(tier as TierKey)) {
    self.postMessage({
      status: 'error',
      requestId,
      error: `Invalid tier specified: ${String(tier)}.`,
    } satisfies WorkerResponse);
    return;
  }

  try {
    if (action === 'produce_single') {
      // 統一由 resolveSeed 提供保底數值，行為與 batch 對齊
      const currentSeed = resolveSeed(seed);
      const puzzle = MasyuCoreEngine.produceSinglePuzzle(tier as TierKey, currentSeed, flowTuning);

      self.postMessage({
        status: 'ok',
        type: 'single',
        requestId,
        puzzle,
      } satisfies WorkerResponse);
    } else if (action === 'produce_batch') {
      const parsedSize = typeof batchSize === 'number' && Number.isFinite(batchSize)
        ? Math.floor(batchSize)
        : 1;

      if (parsedSize <= 0) {
        self.postMessage({
          status: 'error',
          requestId,
          error: `batchSize must be greater than 0. Received: ${batchSize}`,
        } satisfies WorkerResponse);
        return;
      }

      if (parsedSize > MAX_BATCH_SIZE) {
        self.postMessage({
          status: 'error',
          requestId,
          error: `batchSize ${parsedSize} exceeds MAX_BATCH_SIZE of ${MAX_BATCH_SIZE}.`,
        } satisfies WorkerResponse);
        return;
      }

      const puzzles: PuzzleEntity[] = [];
      let currentSeed = resolveSeed(seed);

      for (let i = 0; i < parsedSize; i++) {
        const p = MasyuCoreEngine.produceSinglePuzzle(tier as TierKey, currentSeed, flowTuning);
        puzzles.push(p);

        // 使用質數 7919 遞增並做無符號 32 位元整數約束，避免序列相關性
        currentSeed = (currentSeed + 7919) >>> 0;
      }

      self.postMessage({
        status: 'ok',
        type: 'batch',
        requestId,
        puzzles,
      } satisfies WorkerResponse);
    } else {
      self.postMessage({
        status: 'error',
        requestId,
        error: `Unsupported action: ${(action as unknown) as string}`,
      } satisfies WorkerResponse);
    }
  } catch (err) {
    self.postMessage({
      status: 'error',
      requestId,
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
});
