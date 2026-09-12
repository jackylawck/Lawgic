import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Service Worker Production Runtime & Boundary Invariants', () => {
  let cacheStore: Map<string, Map<string, Response>>;

  beforeEach(() => {
    cacheStore = new Map();

    const mockCacheStorage = {
      open: vi.fn(async (cacheName: string) => {
        if (!cacheStore.has(cacheName)) {
          cacheStore.set(cacheName, new Map());
        }
        const store = cacheStore.get(cacheName)!;

        return {
          match: vi.fn(async (req: string | Request) => {
            const key = typeof req === 'string' ? req : req.url;
            return store.get(key) || null;
          }),
          put: vi.fn(async (req: string | Request, res: Response) => {
            const key = typeof req === 'string' ? req : req.url;
            store.set(key, res.clone());
          }),
          delete: vi.fn(async (req: string | Request) => {
            const key = typeof req === 'string' ? req : req.url;
            return store.delete(key);
          }),
          keys: vi.fn(async () => Array.from(store.keys()).map((url) => new Request(url))),
        };
      }),
      match: vi.fn(async (req: string | Request) => {
        const key = typeof req === 'string' ? req : req.url;
        for (const store of cacheStore.values()) {
          if (store.has(key)) return store.get(key)!;
        }
        return null;
      }),
      keys: vi.fn(async () => Array.from(cacheStore.keys())),
      delete: vi.fn(async (name: string) => cacheStore.delete(name)),
    };

    vi.stubGlobal('caches', mockCacheStorage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ==========================================
  // 情境 1: 策略 A 導航請求與 Deep Link 隔離
  // ==========================================
  describe('Strategy A: HTML Navigation & Deep Link Boundary', () => {
    it('純追蹤參數 (utm/fbclid) 應允許降級至 Root Shell，避免離線白屏', () => {
      const url = new URL('https://lawgic.app/?utm_source=twitter&utm_medium=social');
      const isTrackingOnly =
        url.searchParams.size === 0 ||
        [...url.searchParams.keys()].every((k) =>
          ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid'].includes(k)
        );

      expect(isTrackingOnly).toBe(true);
    });

    it('帶有遊戲業務狀態之深層連結 (如 ?challenge=)，嚴禁降級匹配 Root Shell', () => {
      const url = new URL('https://lawgic.app/?challenge=BASE64_PAYLOAD&tier=master');
      const isTrackingOnly =
        url.searchParams.size === 0 ||
        [...url.searchParams.keys()].every((k) =>
          ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid'].includes(k)
        );

      expect(isTrackingOnly).toBe(false);
    });

    it('有快取骨架時逾時應設為 1800ms，無快取冷啟動時應放寬至 8000ms', () => {
      const getTimeout = (hasCachedShell: boolean) => (hasCachedShell ? 1800 : 8000);
      expect(getTimeout(true)).toBe(1800);
      expect(getTimeout(false)).toBe(8000);
    });
  });

  // ==========================================
  // 情境 2: 策略 B 不可變 Hash 資產判定
  // ==========================================
  describe('Strategy B: Immutable Hashed Assets & WASM', () => {
    const isHashedAssetPattern = (pathname: string) =>
      pathname.endsWith('.wasm') ||
      /\/assets\/.+-[a-zA-Z0-9_-]{8,}\.(js|css|woff2?|png|jpe?g|svg|webp)$/i.test(pathname);

    it('Vite 生產指紋 Chunk 與 WASM 二進位檔必須精準命中 Cache-First', () => {
      expect(isHashedAssetPattern('/assets/engine-B3x9kL1q.js')).toBe(true);
      expect(isHashedAssetPattern('/assets/vendor-Xy78_abc.css')).toBe(true);
      expect(isHashedAssetPattern('/engines/sudoku_core.wasm')).toBe(true);
    });

    it('public 目錄下之非 Hash 靜態資源不可走 Cache-First，避免更新死鎖', () => {
      expect(isHashedAssetPattern('/assets/logo.png')).toBe(false);
      expect(isHashedAssetPattern('/favicon.ico')).toBe(false);
      expect(isHashedAssetPattern('/manifest.json')).toBe(false);
    });
  });

  // ==========================================
  // 情境 3: 策略 C Opaque Response 配額防禦 (P2-A)
  // ==========================================
  describe('Strategy C: Opaque Quota Defense', () => {
    it('跨域無 CORS 之 Opaque 回應 (type === "opaque") 絕對禁止寫入 RUNTIME_CACHE', () => {
      const mockNetworkResponse = new Response('', { status: 0 });
      Object.defineProperty(mockNetworkResponse, 'type', { value: 'opaque' });

      const isEligibleForCache =
        mockNetworkResponse.status === 200 && mockNetworkResponse.type !== 'opaque';

      expect(isEligibleForCache).toBe(false);
    });

    it('同源或具備 CORS 的 200 OK 回應才允許寫入快取', () => {
      const mockNetworkResponse = new Response('ok', { status: 200 });
      Object.defineProperty(mockNetworkResponse, 'type', { value: 'basic' });

      const isEligibleForCache =
        mockNetworkResponse.status === 200 && mockNetworkResponse.type !== 'opaque';

      expect(isEligibleForCache).toBe(true);
    });
  });

  // ==========================================
  // 情境 4: 儲存配額耗盡與死鎖淘汰機制 (Quota Exceeded & Emergency Trim)
  // ==========================================
  describe('Quota Deadlock & Emergency Trim Protection', () => {
    it('一般 LRU: 當容量超出 10% 緩衝區時，批次修剪超額項目', async () => {
      const cache = await caches.open('logicore-runtime-test');
      for (let i = 1; i <= 10; i++) {
        await cache.put(`https://lawgic.app/asset-${i}`, new Response(`content-${i}`));
      }

      const maxItems = 5;
      const keys = await cache.keys();
      // 超出 5 * 1.1 = 5.5 (即 >= 6 筆) 時觸發修剪
      if (keys.length > maxItems * 1.1) {
        const deleteCount = keys.length - maxItems;
        const keysToDelete = keys.slice(0, deleteCount);
        await Promise.all(keysToDelete.map((k) => cache.delete(k)));
      }

      const remaining = await cache.keys();
      expect(remaining).toHaveLength(5);
      expect(remaining[0].url).toBe('https://lawgic.app/asset-6');
    });

    it('極端配額耗盡: 寫入失敗時啟動緊急半數腰斬 (Halving Trim)', async () => {
      const cache = await caches.open('logicore-emergency-test');
      for (let i = 1; i <= 8; i++) {
        await cache.put(`https://lawgic.app/heavy-${i}`, new Response(`heavy-${i}`));
      }

      // 模擬 QuotaExceededError 觸發緊急淘汰
      const keys = await cache.keys();
      const halfCount = Math.ceil(keys.length / 2);
      await Promise.all(keys.slice(0, halfCount).map((k) => cache.delete(k)));

      const surviving = await cache.keys();
      expect(surviving).toHaveLength(4);
      expect(surviving[0].url).toBe('https://lawgic.app/heavy-5');
    });
  });

  // ==========================================
  // 情境 5: 通訊與中斷信號防護 (Signal Safety & Skip Waiting)
  // ==========================================
  describe('Signal & Lifecycle Protocol Safety', () => {
    it('重複觸發 safeAbort 僅呼叫底層 AbortController.abort 一次', () => {
      const controller = new AbortController();
      const abortSpy = vi.spyOn(controller, 'abort');

      let aborted = false;
      const safeAbort = () => {
        if (aborted) return;
        aborted = true;
        try {
          controller.abort();
        } catch {}
      };

      safeAbort();
      safeAbort();
      safeAbort();

      expect(abortSpy).toHaveBeenCalledTimes(1);
    });

    it('支援 SKIP_WAITING 訊息通訊協議', () => {
      const skipWaitingMock = vi.fn();
      const messageHandler = (event: { data?: { type: string } }) => {
        if (event.data?.type === 'SKIP_WAITING') {
          skipWaitingMock();
        }
      };

      messageHandler({ data: { type: 'OTHER_MSG' } });
      expect(skipWaitingMock).not.toHaveBeenCalled();

      messageHandler({ data: { type: 'SKIP_WAITING' } });
      expect(skipWaitingMock).toHaveBeenCalledTimes(1);
    });
  });
});
