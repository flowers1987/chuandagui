// 穿搭柜 Service Worker —— 离线缓存，使「添加到主屏幕」后具备原生般的启动速度与离线可用性
const CACHE = 'chuandagui-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/zip.js',
  './js/word.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
];

// 安装：预缓存核心资源
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

// 激活：清理旧缓存
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// 取数策略：缓存优先，回退网络并更新缓存（保证静态资源秒开，又能更新）
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
