// web-frontend/public/sw.js
const CACHE_NAME = 'logicore-app-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // 優先網路，失敗則返回快取
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
