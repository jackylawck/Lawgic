// web-frontend/public/sw.js
const VERSION = 'lawgic-v7-apex';
const CORE_CACHE = `${VERSION}-core`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

// 取得當前 Service Worker scope 基礎絕對 URL（相容 GitHub Pages /Lawgic/ 子目錄）
const BASE_SCOPE = new URL(self.registration.scope);

// 核心必備預快取清單（離線最小可用骨架）
const PRECACHE_ASSETS = [
  new URL('./', BASE_SCOPE).toString(),
  new URL('./index.html', BASE_SCOPE).toString(),
  new URL('./manifest.json', BASE_SCOPE).toString(),
  new URL('./Lawgic192icon.png', BASE_SCOPE).toString(),
  new URL('./Lawgic512icon.png', BASE_SCOPE).toString(),
];

// 1. 安裝階段：原子化預快取（支援容錯）
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE).then((cache) => {
      return Promise.allSettled(
        PRECACHE_ASSETS.map((url) =>
          fetch(url, { cache: 'reload' }).then((res) => {
            if (res.ok) return cache.put(url, res);
            console.warn(`[SW] Precache missed: ${url}`);
          })
        )
      );
    })
  );
  // 讓新 SW 立即進入等待啟用，等待前端發送信號或立即接管
  self.skipWaiting();
});

// 2. 啟用階段：精準清理舊版本快取
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

// 🌟 輔助函式：超時競速（避免 Network-first 在弱網卡住數十秒）
function fetchWithTimeout(request, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('[SW] Network timeout exceeded'));
    }, timeoutMs);

    fetch(request)
      .then((response) => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// 3. 攔截請求
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 僅攔截 HTTP/HTTPS GET 請求
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  const url = new URL(request.url);

  // 策略 A：HTML 導航請求（帶 1.8 秒超時熔斷的 Network-First，弱網/離線秒開）
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
          // 網路超時或斷網，立即無縫降級回退至離線快取
          const matched = await caches.match(request);
          if (matched) return matched;
          return caches.match(new URL('./index.html', BASE_SCOPE).toString());
        })
    );
    return;
  }

  // 🌟 策略 B：WebAssembly 與 Vite 靜態 Hash 資產（嚴格 Cache-First）
  // 修正重點：涵蓋 .wasm 副檔名與空 destination 的 WebAssembly 二進制載入
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

  // 策略 C：圖片、音效與動態 JSON 題庫（Stale-While-Revalidate 存於 RUNTIME_CACHE）
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
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(() => {
          // 離線時靜默失敗，由 cachedResponse 提供保障
        });

      return cachedResponse || fetchPromise;
    })
  );
});

// 4. 前端雙向通訊協議（支援手動觸發立即更新）
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
