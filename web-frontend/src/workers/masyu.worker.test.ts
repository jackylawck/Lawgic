// web-frontend/src/workers/masyu.worker.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasyuCoreEngine, TierKey, PuzzleEntity } from '../engines/masyuCore';
import {
  MAX_BATCH_SIZE,
  MAX_REQUEST_ID_LENGTH,
  VALID_TIERS,
  resolveSeed,
  WorkerResponse,
} from './masyu.worker';

describe('Masyu Worker Comprehensive Test Suite', () => {
  let postMessageSpy: ReturnType<typeof vi.fn>;
  let dispatchWorkerMessage: (data: unknown) => void;

  beforeEach(async () => {
    postMessageSpy = vi.fn();

    // 模擬 Worker 環境的 self API
    vi.stubGlobal('self', {
      postMessage: postMessageSpy,
      addEventListener: (_type: string, handler: (e: MessageEvent) => void) => {
        dispatchWorkerMessage = (data: unknown) => {
          handler({ data } as MessageEvent);
        };
      },
    });

    // 動態載入 worker 模組以註冊事件監聽
    await import('./masyu.worker');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ==========================================
  // 1. 純函式邊界測試 (Zero Mock / Pure Logic)
  // ==========================================
  describe('resolveSeed', () => {
    it('若傳入 NaN、非有限數或負數，應返回介於 [0, 4294967295] 的無符號 32-bit 整數', () => {
      const nanSeed = resolveSeed(NaN);
      expect(Number.isFinite(nanSeed)).toBe(true);
      expect(Number.isNaN(nanSeed)).toBe(false);
      expect(nanSeed).toBeGreaterThanOrEqual(0);

      // -1 >>> 0 必須正規化為 4294967295
      expect(resolveSeed(-1)).toBe(4294967295);

      // 超出 32 位元有符號整數上限 (0x7fffffff + 1) 應轉為 2147483648
      expect(resolveSeed(0x80000000)).toBe(2147483648);
    });

    it('若傳入合法正整數，應忠實返回該數值', () => {
      expect(resolveSeed(12345)).toBe(12345);
      expect(resolveSeed(0)).toBe(0);
    });

    it('若傳入 undefined，應隨機產生合法的非負整數', () => {
      const s1 = resolveSeed(undefined);
      expect(Number.isFinite(s1)).toBe(true);
      expect(s1).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================
  // 2. 白名單完備性驗證 (Contract Coverage)
  // ==========================================
  describe('VALID_TIERS', () => {
    it('必須包含所有 TierKey 合法階層', () => {
      const expectedTiers: TierKey[] = ['kids', 'intermediate', 'master', 'legendary', 'ultimate'];
      expect(VALID_TIERS.size).toBe(expectedTiers.length);
      expectedTiers.forEach((tier) => {
        expect(VALID_TIERS.has(tier)).toBe(true);
      });
    });
  });

  // ==========================================
  // 3. 通訊協議與狀態機邊界 (Worker Protocol)
  // ==========================================
  describe('Worker Protocol & Error Handling', () => {
    it('情境 1: 缺少或非法 requestId 應直接回報 error 且終止執行', () => {
      // 空白 requestId
      dispatchWorkerMessage({
        requestId: '   ',
        action: 'produce_single',
        tier: 'kids',
      });

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: expect.stringContaining('Missing or invalid required field: requestId'),
        })
      );

      // 超長 requestId (超過 MAX_REQUEST_ID_LENGTH)
      const longId = 'a'.repeat(MAX_REQUEST_ID_LENGTH + 1);
      dispatchWorkerMessage({
        requestId: longId,
        action: 'produce_single',
        tier: 'kids',
      });

      expect(postMessageSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: 'error',
          error: expect.stringContaining('Missing or invalid required field: requestId'),
        })
      );
    });

    it('情境 2: 傳入非法 tier 應被白名單攔截並保留 requestId', () => {
      dispatchWorkerMessage({
        requestId: 'req-invalid-tier',
        action: 'produce_single',
        tier: 'invalid_level' as any,
      });

      expect(postMessageSpy).toHaveBeenCalledWith({
        status: 'error',
        requestId: 'req-invalid-tier',
        error: 'Invalid tier specified: invalid_level.',
      });
    });

    it('情境 3: 未知 action 應走兜底分支並回報明確錯誤', () => {
      dispatchWorkerMessage({
        requestId: 'req-unknown-act',
        action: 'unknown_cmd' as any,
        tier: 'kids',
      });

      expect(postMessageSpy).toHaveBeenCalledWith({
        status: 'error',
        requestId: 'req-unknown-act',
        error: 'Unsupported action: unknown_cmd',
      });
    });

    it('情境 4: produce_single 成功時應正確對號 requestId 並回傳題目物件', () => {
      const mockPuzzle = { id: 'single-p-1', tier: 'kids' } as PuzzleEntity;
      const produceSpy = vi.spyOn(MasyuCoreEngine, 'produceSinglePuzzle').mockReturnValue(mockPuzzle);

      dispatchWorkerMessage({
        requestId: 'req-single-ok',
        action: 'produce_single',
        tier: 'kids',
        seed: 42,
      });

      expect(produceSpy).toHaveBeenCalledWith('kids', 42, undefined);
      expect(postMessageSpy).toHaveBeenCalledWith({
        status: 'ok',
        type: 'single',
        requestId: 'req-single-ok',
        puzzle: mockPuzzle,
      });
    });

    it('情境 5: produce_batch 應正確產出指定數量的題目陣列並遞增種子', () => {
      const generatedSeeds: number[] = [];
      vi.spyOn(MasyuCoreEngine, 'produceSinglePuzzle').mockImplementation((_tier, seed) => {
        generatedSeeds.push(seed!);
        return { id: `puzzle-${seed}` } as PuzzleEntity;
      });

      dispatchWorkerMessage({
        requestId: 'req-batch-ok',
        action: 'produce_batch',
        tier: 'master',
        batchSize: 3,
        seed: 1000,
      });

      const res = postMessageSpy.mock.calls[0][0] as Extract<WorkerResponse, { status: 'ok'; type: 'batch' }>;
      expect(res.status).toBe('ok');
      expect(res.type).toBe('batch');
      expect(res.requestId).toBe('req-batch-ok');
      expect(res.puzzles).toHaveLength(3);

      // 驗證質數 7919 遞增序列
      expect(generatedSeeds).toEqual([1000, 1000 + 7919, 1000 + 7919 * 2]);
    });

    it('情境 6: batchSize 邊界校驗 (<= 0 或 > MAX_BATCH_SIZE 應報錯)', () => {
      // 測試 <= 0
      dispatchWorkerMessage({
        requestId: 'req-batch-zero',
        action: 'produce_batch',
        tier: 'kids',
        batchSize: 0,
      });

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          requestId: 'req-batch-zero',
          error: expect.stringContaining('batchSize must be greater than 0'),
        })
      );

      // 測試超出上限 (MAX_BATCH_SIZE + 1)
      dispatchWorkerMessage({
        requestId: 'req-batch-over',
        action: 'produce_batch',
        tier: 'kids',
        batchSize: MAX_BATCH_SIZE + 1,
      });

      expect(postMessageSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: 'error',
          requestId: 'req-batch-over',
          error: expect.stringContaining(`exceeds MAX_BATCH_SIZE of ${MAX_BATCH_SIZE}`),
        })
      );
    });

    it('情境 7: 引擎內部崩潰 (throw Error) 應安全捕獲，不造成主執行緒死鎖', () => {
      vi.spyOn(MasyuCoreEngine, 'produceSinglePuzzle').mockImplementation(() => {
        throw new Error('Eulerian closure generation failure');
      });

      dispatchWorkerMessage({
        requestId: 'req-engine-crash',
        action: 'produce_single',
        tier: 'kids',
      });

      expect(postMessageSpy).toHaveBeenCalledWith({
        status: 'error',
        requestId: 'req-engine-crash',
        error: 'Eulerian closure generation failure',
      });
    });
  });
});
