// Service Worker — 교대근무 일정표 PWA
// HTML: Network-First (항상 최신 코드), 아이콘/manifest: Cache-First

const CACHE_NAME = 'shiftcal-v4';

// Install: 즉시 활성화
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

// Activate: 이전 버전 캐시 전체 삭제
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch: 요청 전략
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Supabase API → Network-First
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // HTML 파일 → Network-First (항상 최신 코드 로드)
  if (url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 아이콘, manifest 등 정적 파일 → Cache-First
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
