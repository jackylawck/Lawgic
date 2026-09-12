// web-frontend/public/sw.js
const VERSION = '__BUILD_HASH__';

if (VERSION === '__BUILD_HASH__') {
  console.warn('[SW] Build hash not injected — caching may conflict across deployments.');
}

const CACHE_PREFIX = 'logicore';
const CORE_CACHE = `${CACHE_PREFIX}-${VERSION}-core`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-${VERSION}-runtime`;

const MAX_RUNTIME_ITEMS = 60;
const MAX_CORE_ITEMS = 100;

const BASE_SCOPE = new URL(self.registration.scope);

const PRECACHE_ASSETS = [
  new URL('./', BASE_SCOPE).toString(),
  new URL('./manifest.json', BASE_SCOPE).toString(),
  new URL('./Lawgic192icon.png', BASE_SCOPE).toString(),
  new URL('./Lawgic512icon.png', BASE_SCOPE).toString(),
];

// 高效能批次快取淘汰（支援 QuotaExceededError 暴力腰斬保險）
async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems * 1.1) {
      const deleteCount = keys.length - maxItems;
      const keysToDelete = keys.slice(0, deleteCount);
      await Promise.all(keysToDelete.map((key) => cache.delete(key)));
    }
  } catch (err) {
    console.warn('[SW] Cache trim error:', err);
    // 配額耗盡防禦：直接抹除最舊的 50% 項目清出呼吸空間
    try {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      const half = Math.ceil(keys.length / 2);
      await Promise.all(keys.slice(0, half).map((k) => cache.delete(k)));
    } catch {}
  }
}

// 1. 安裝階段：原子化預快取
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE).then(async (cache) => {
      const results = await Promise.allSettled(
        PRECACHE_ASSETS.map(async (url) => {
          const res = await fetch(url, { cache: 'no-cache' });
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

// 2. 啟用階段：清除舊快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CORE_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
      .then(() => trimCache(CORE_CACHE, MAX_CORE_ITEMS))
  );
});

// 防重入、相容 Safari 的超時 fetch 封裝
function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  let aborted = false;
  const safeAbort = () => {
    if (aborted) return;
    aborted = true;
    try {
      controller.abort();
    } catch {}
  };

  const timer = setTimeout(safeAbort, timeoutMs);

  if (request.signal && typeof request.signal.addEventListener === 'function') {
    request.signal.addEventListener('abort', safeAbort, { once: true });
  }

  return fetch(request, { signal: controller.signal }).finally(() => {
    clearTimeout(timer);
  });
}

// 3. 請求攔截
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  const url = new URL(request.url);

  // 策略 A：導航請求 (HTML)
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      (async () => {
        const rootShellUrl = new URL('./', BASE_SCOPE).toString();
        const hasCachedShell = Boolean(await caches.match(rootShellUrl));
        const timeoutMs = hasCachedShell ? 1800 : 8000;

        let networkResponse;
        try {
          networkResponse = await fetchWithTimeout(request, timeoutMs);
        } catch {
          // 嚴格過濾：僅在純無參數或純追蹤標記時才允許使用 App Shell fallback，防止破壞深層連結
          const isTrackingOnly =
            url.searchParams.size === 0 ||
            [...url.searchParams.keys()].every((k) =>
              ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid'].includes(k)
            );

          const matched =
            (await caches.match(request)) ||
            (isTrackingOnly ? await caches.match(request, { ignoreSearch: true }) : null) ||
            (isTrackingOnly ? await caches.match(rootShellUrl) : null);

          if (matched) return matched;

          return new Response('Offline - LogiCore Arena Initializing...', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }

        // P0-1 修復：先 trim 清理出可用槽位，再執行 put，並有半數淘汰保險
        if (networkResponse && networkResponse.status === 200) {
          const copy = networkResponse.clone();
          event.waitUntil(
            (async () => {
              try {
                await trimCache(CORE_CACHE, MAX_CORE_ITEMS);
                const cache = await caches.open(CORE_CACHE);
                await cache.put(request, copy);
              } catch (err) {
                console.warn('[SW] Core cache write failed, emergency trim initiated:', err);
                try {
                  const cache = await caches.open(CORE_CACHE);
                  const keys = await cache.keys();
                  await Promise.all(keys.slice(0, Math.ceil(keys.length / 2)).map((k) => cache.delete(k)));
                } catch {}
              }
            })()
          );
        }

        return networkResponse;
      })()
    );
    return;
  }

  // 策略 B：WASM 與 Vite 靜態 Hash 資產 -> Cache-First（帶 10 秒網路防掛起超時）
  const isWasmBinary = url.pathname.endsWith('.wasm');
  const isHashedAsset =
    isWasmBinary ||
    /\/assets\/.+-[a-zA-Z0-9_-]{8,}\.(js|css|woff2?|png|jpe?g|svg|webp)$/i.test(url.pathname);

  if (isHashedAsset) {
    event.respondWith(
      (async () => {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }

        try {
          const networkResponse = await fetchWithTimeout(request, 10000);
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            (networkResponse.type === 'basic' || networkResponse.type === 'cors')
          ) {
            const copy = networkResponse.clone();
            event.waitUntil(
              (async () => {
                try {
                  await trimCache(CORE_CACHE, MAX_CORE_ITEMS);
                  const cache = await caches.open(CORE_CACHE);
                  await cache.put(request, copy);
                } catch (err) {
                  console.warn('[SW] Asset cache write error:', err);
                }
              })()
            );
          }
          return networkResponse;
        } catch {
          return new Response('Asset Unavailable Offline', { status: 504 });
        }
      })()
    );
    return;
  }

  // 策略 C：同源一般靜態/圖片資源 -> SWR + 10 秒超時熔斷
  if (url.origin === location.origin) {
    event.respondWith(
      (async () => {
        const cachedResponse = await caches.match(request);

        const fetchPromise = (async () => {
          try {
            const networkResponse = await fetchWithTimeout(request, 10000);
            if (
              networkResponse &&
              networkResponse.status === 200 &&
              networkResponse.type !== 'opaque'
            ) {
              const copy = networkResponse.clone();
              event.waitUntil(
                (async () => {
                  try {
                    await trimCache(RUNTIME_CACHE, MAX_RUNTIME_ITEMS);
                    const cache = await caches.open(RUNTIME_CACHE);
                    await cache.put(request, copy);
                  } catch (err) {
                    console.warn('[SW] Runtime cache write error:', err);
                  }
                })()
              );
            }
            return networkResponse;
          } catch {
            return cachedResponse || null;
          }
        })();

        const result = cachedResponse || (await fetchPromise);
        return result || new Response('Offline', { status: 504 });
      })()
    );
  }
});

// 4. 前端受控通訊協議
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
