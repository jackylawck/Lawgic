// web-frontend/public/sw.js
const VERSION = 'logicore-v8-apex';
const CORE_CACHE = `${VERSION}-core`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const MAX_RUNTIME_ITEMS = 60; // LRU 快取配額防護

// 取得當前 Service Worker scope 基礎絕對 URL（完美相容 GitHub Pages /Lawgic/ 子目錄）
const BASE_SCOPE = new URL(self.registration.scope);

// 核心必備預快取清單（離線最小可用骨架）
const PRECACHE_ASSETS = [
  new URL('./', BASE_SCOPE).toString(),
  new URL('./index.html', BASE_SCOPE).toString(),
  new URL('./manifest.json', BASE_SCOPE).toString(),
  new URL('./Lawgic192icon.png', BASE_SCOPE).toString(),
  new URL('./Lawgic512icon.png', BASE_SCOPE).toString(),
];

// LRU 快取清理輔助函式
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    await trimCache(cacheName, maxItems);
  }
}

// 1. 安裝階段：原子化預快取（容錯且保證核心離線可用）
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE).then(async (cache) => {
      const fetchPromises = PRECACHE_ASSETS.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'reload' });
          if (res.ok) {
            await cache.put(url, res);
          } else {
            console.warn(`[SW] Precache asset skipped: ${url} (${res.status})`);
          }
        } catch (err) {
          console.warn(`[SW] Precache fetch error: ${url}`, err);
        }
      });
      await Promise.allSettled(fetchPromises);
    })
  );
  self.skipWaiting();
});

// 2. 啟用階段：精準清理舊版快取並立即接管控制權
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CORE_CACHE && key !== RUNTIME_CACHE) {
              return caches.delete(key);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

// 輔助函式：帶 AbortSignal 的真實實體超時中斷
function fetchWithTimeout(request, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(request, { signal: controller.signal }).finally(() => {
    clearTimeout(timer);
  });
}

// 3. 攔截請求
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 僅處理 HTTP(S) GET 請求，排除 chrome-extension 等協定
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
            caches.open(CORE_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          // 先精確匹配，若因帶有 query/hash 失敗，則 fallback 到無參數的 index.html
          const matched =
            (await caches.match(request)) ||
            (await caches.match(request, { ignoreSearch: true })) ||
            (await caches.match(new URL('./index.html', BASE_SCOPE).toString()));
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

  // 策略 B：WebAssembly 與 Vite 靜態 Hash 資產（嚴格 Cache-First，無痛秒開）
  const isWasmBinary = url.pathname.endsWith('.wasm');
  const isHashedAsset =
    isWasmBinary ||
    url.pathname.includes('/assets/') ||
    ['script', 'style', 'font'].includes(request.destination);

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
            caches.open(CORE_CACHE).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 策略 C：圖片、動態 JSON 與外部字型（Stale-While-Revalidate + LRU 配額守護）
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then(async (networkResponse) => {
          if (
            networkResponse &&
            (networkResponse.status === 200 || networkResponse.type === 'opaque')
          ) {
            const copy = networkResponse.clone();
            const cache = await caches.open(RUNTIME_CACHE);
            await cache.put(request, copy);
            trimCache(RUNTIME_CACHE, MAX_RUNTIME_ITEMS);
          }
          return networkResponse;
        })
        .catch(() => {
          // 離線靜默降級
        });

      if (cachedResponse) {
        event.waitUntil(fetchPromise);
        return cachedResponse;
      }
      return fetchPromise;
    })
  );
});

// 4. 前端雙向通訊協議（支援手動觸發立即接管與狀態檢查）
self.addEventListener('message', (event) => {
  if (!event.data) return;

  switch (event.data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'GET_VERSION':
      event.ports[0]?.postMessage({ version: VERSION });
      break;
    case 'CLEAR_RUNTIME':
      caches.delete(RUNTIME_CACHE).then(() => {
        event.ports[0]?.postMessage({ cleared: true });
      });
      break;
  }
});
