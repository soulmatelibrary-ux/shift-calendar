// Service Worker — 교대근무 일정표 PWA
// Cache-First for static assets, Network-First for Supabase API

const CACHE_NAME = 'shiftcal-v3';
const STATIC_ASSETS = [
  './shiftcal.html',
  './manifest.json'
];

// Install: 정적 파일 캐시
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: 이전 버전 캐시 삭제
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: 요청 전략
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Supabase API → Network-First (최신 데이터 우선)
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 정적 파일 → Cache-First
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // 성공적인 GET 응답만 캐시
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
