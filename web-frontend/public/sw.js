// 佔位符，由 Vite 構建流程（inject-sw-version plugin）在發布時自動替換為當前 Git SHA
const VERSION = '__BUILD_HASH__';

// M3: 提取快取前綴常數，維持單一事實來源
const CACHE_PREFIX = 'logicore';
const CORE_CACHE = `${CACHE_PREFIX}-${VERSION}-core`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-${VERSION}-runtime`;
const MAX_RUNTIME_ITEMS = 60;
const MAX_CORE_ITEMS = 200;

// 取得當前 Service Worker scope 基礎絕對 URL（相容 GitHub Pages /Lawgic/ 子目錄）
const BASE_SCOPE = new URL(self.registration.scope);

// 核心必備預快取清單（離線最小可用骨架，D1: 移除重複的 ./index.html，由 ./ 自適應）
const PRECACHE_ASSETS = [
  new URL('./', BASE_SCOPE).toString(),
  new URL('./manifest.json', BASE_SCOPE).toString(),
  new URL('./Lawgic192icon.png', BASE_SCOPE).toString(),
  new URL('./Lawgic512icon.png', BASE_SCOPE).toString(),
];

// 高效能批次 LRU 快取淘汰，杜絕遞迴非同步 I/O 阻塞
async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      const deleteCount = keys.length - maxItems;
      const keysToDelete = keys.slice(0, deleteCount);
      await Promise.all(keysToDelete.map((key) => cache.delete(key)));
    }
  } catch (err) {
    console.warn('[SW] Cache trim error:', err);
  }
}

// 1. 安裝階段：原子化預快取（絕不在此呼叫 skipWaiting，將升級時機完全保留給前端用戶端控制）
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE).then(async (cache) => {
      const results = await Promise.allSettled(
        PRECACHE_ASSETS.map(async (url) => {
          const res = await fetch(url, { cache: 'reload' });
          if (res.ok) {
            await cache.put(url, res);
          } else {
            console.warn(`[SW] Precache skipped: ${url} (${res.status})`);
          }
        })
      );

      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.warn(`[SW] Precache failed: ${PRECACHE_ASSETS[i]}`, r.reason);
        }
      });
    })
  );
});

// 2. 啟用階段：精準清理舊版快取並立即接管控制權，同時保護 CORE_CACHE 配額
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CORE_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
      .then(() => trimCache(CORE_CACHE, MAX_CORE_ITEMS))
  );
});

// 輔助函式：支援外部 request 自身主動取消與實體超時熔斷的 fetch 封裝
function fetchWithTimeout(request, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // 保留 request 原生 signal，若外部導航取消則同步中斷
  if (request.signal) {
    request.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  return fetch(request, { signal: controller.signal }).finally(() => {
    clearTimeout(timer);
  });
}

// 3. 攔截請求
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 僅處理 HTTP(S) GET 請求
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  const url = new URL(request.url);

  // 策略 A：HTML 導航請求（帶 1.8 秒超時熔斷的 Network-First + SPA 乾淨路由相容）
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetchWithTimeout(request, 1800)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            // P0-2: 使用 event.waitUntil 保證 SW 存活至寫入完成
            event.waitUntil(
              caches.open(CORE_CACHE).then((cache) => cache.put(request, copy))
            );
          }
          return response;
        })
        .catch(async () => {
          const matched =
            (await caches.match(request)) ||
            (await caches.match(request, { ignoreSearch: true })) ||
            (await caches.match(new URL('./', BASE_SCOPE).toString()));
          if (matched) return matched;
          return new Response('Offline - LogiCore Arena Initializing...', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        })
    );
    return;
  }

  // 策略 B：WebAssembly 與 Vite 靜態 Hash 資產（嚴格 Cache-First，秒級加載）
  const isWasmBinary = url.pathname.endsWith('.wasm');
  const isHashedAsset =
    isWasmBinary ||
    url.pathname.includes('/assets/') ||
    /[.-][a-f0-9]{8,}\.(js|css)$/i.test(url.pathname);

  if (isHashedAsset) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request).then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            (networkResponse.type === 'basic' || networkResponse.type === 'cors')
          ) {
            const copy = networkResponse.clone();
            // P0-2: 使用 event.waitUntil 保證 SW 存活至寫入完成
            event.waitUntil(
              caches.open(CORE_CACHE).then((cache) => cache.put(request, copy))
            );
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 策略 C：圖片、動態資料與非指紋資源（Stale-While-Revalidate + LRU 配額守護）
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            (networkResponse.status === 200 || networkResponse.type === 'opaque')
          ) {
            const copy = networkResponse.clone();
            // P1-1: 使用 event.waitUntil 保證非同步寫入與 LRU 淘汰執行完畢
            event.waitUntil(
              (async () => {
                const cache = await caches.open(RUNTIME_CACHE);
                await cache.put(request, copy);
                await trimCache(RUNTIME_CACHE, MAX_RUNTIME_ITEMS);
              })()
            );
          }
          return networkResponse;
        })
        .catch(() => {
          if (!cachedResponse) {
            return new Response('Resource Unavailable Offline', {
              status: 504,
              statusText: 'Gateway Timeout',
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
          }
          return cachedResponse;
        });

      return cachedResponse || fetchPromise;
    })
  );
});

// 4. 前端雙向通訊協議（僅保留受控更新協議，徹底消滅死代碼）
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
