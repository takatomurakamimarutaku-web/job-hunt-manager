// Service Worker：アプリ本体を事前にキャッシュし、オフラインで起動できるようにする
//
// ★ アプリのファイルを変更したら、必ず CACHE_VERSION を上げること（js/app.js の APP_VERSION も同じ値にする）。
//    上げないと、利用者の端末では古いファイルが使われ続ける。手順は README の「キャッシュの更新」を参照。

const CACHE_VERSION = 'v3';
const CACHE_PREFIX = 'job-hunt-';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

// パスはすべて相対パス（GitHub Pages のサブパスで動かすため）
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/backup.js',
  'js/crypto.js',
  'js/db.js',
  'js/router.js',
  'js/search.js',
  'js/stages.js',
  'js/status.js',
  'js/ui.js',
  'js/validate.js',
  'js/views/add.js',
  'js/views/application-detail.js',
  'js/views/backup.js',
  'js/views/application-form.js',
  'js/views/board.js',
  'js/views/companies.js',
  'js/views/company-detail.js',
  'js/views/company-form.js',
  'js/views/home.js',
  'js/views/more.js',
  'js/views/placeholder.js',
  'js/views/settings.js',
  'js/views/status-form.js',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/icon-maskable.svg',
  'icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // HTTP キャッシュを経由せず最新を取得する
    await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
  })());
  // 自動では切り替えない（入力中の画面が突然切り替わらないよう、利用者の「更新」操作を待つ）
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))
    );
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 外部への通信には関与しない

  if (request.mode === 'navigate') {
    // ハッシュルーティングなので、画面遷移は常に index.html を返す
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match('index.html')) || fetch(request);
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    return cached || fetch(request);
  })());
});
