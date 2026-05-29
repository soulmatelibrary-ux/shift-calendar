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

// Web Push: 서버(Supabase Edge Function)가 보낸 푸시 수신 → 알림 표시
// iOS 16.4+ Safari 홈화면 PWA에서만 동작
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || '교대일정 변경';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '일정이 변경되었습니다',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: data.tag || 'shiftcal',       // 같은 tag면 알림 1개로 합쳐짐(폭주 완화)
      renotify: !!data.renotify,         // 새 묶음 도착 시 다시 알림(소리/진동)
      data: { url: data.url || './shiftcal.html' }
    })
  );
});

// 알림 탭 → 이미 열린 창 포커스, 없으면 새로 열기
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './shiftcal.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      for (const c of cs) {
        if ('focus' in c) return c.focus();
      }
      return clients.openWindow(target);
    })
  );
});
