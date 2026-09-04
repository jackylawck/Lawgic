// web-frontend/public/sw.js
const CACHE_NAME = 'lawgic-v6';

// 取得當前 Service Worker scope 基礎絕對 URL（相容 GitHub Pages /Lawgic/ 子目錄）
const BASE_SCOPE = new URL(self.registration.scope);

const PRECACHE_ASSETS = [
  new URL('./', BASE_SCOPE).toString(),
  new URL('./index.html', BASE_SCOPE).toString(),
  new URL('./manifest.json', BASE_SCOPE).toString(),
  new URL('./Lawgic192icon.png', BASE_SCOPE).toString(),
  new URL('./Lawgic512icon.png', BASE_SCOPE).toString(),
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // 容錯式逐一快取，避免單一資產 404 造成整個 Service Worker 無法安裝
      return Promise.allSettled(
        PRECACHE_ASSETS.map((assetUrl) =>
          fetch(assetUrl, { cache: 'no-cache' }).then((res) => {
            if (res.ok) return cache.put(assetUrl, res);
            return Promise.reject(`Precache failed: ${assetUrl}`);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        )
      )
      .then(() => clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  const url = new URL(request.url);

  // 1. HTML 導航請求：Network-first（聯網時抓取最新內容，離線回退至 index.html 外殼）
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const matched = await caches.match(request);
          if (matched) return matched;
          return caches.match(new URL('./index.html', BASE_SCOPE).toString());
        })
    );
    return;
  }

  // 2. Vite 靜態資產 (檔名帶 Hash 的 js/css/字型)：Cache-first
  const isHashedAsset =
    url.pathname.includes('/assets/') ||
    ['script', 'style', 'font'].includes(request.destination);

  if (isHashedAsset) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request).then((response) => {
          if (
            response &&
            response.status === 200 &&
            (response.type === 'basic' || response.type === 'cors')
          ) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  // 3. 圖片、圖標與外部 CDN：Stale-While-Revalidate（優先使用快取秒開，背景非同步抓取更新）
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            (networkResponse.type === 'basic' || networkResponse.type === 'cors')
          ) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(() => {
          // 網路中斷時靜默忽略背景同步失敗
        });

      return cachedResponse || fetchPromise;
    })
  );
});
