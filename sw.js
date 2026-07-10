/* Service worker — stratégie "réseau d'abord" (toujours la dernière version),
 * avec repli sur le cache hors ligne. N'intercepte QUE les fichiers de l'app
 * (même origine) : Supabase et les CDN passent en direct. */

/* IMPORTANT : bumper cette version à CHAQUE déploiement d'un fichier applicatif
 * (index.html, css, js, sw). Sinon un appareil hors ligne peut servir une
 * ancienne version depuis le cache. Convention : date du déploiement. */
const CACHE = 'edd-jardin-sauvage-2026-07-10b';
const APP_SHELL = [
  './', 'index.html', 'offline.html', 'css/styles.css',
  'js/config.js', 'js/store.js', 'js/app.js',
  'assets/logo.png', 'assets/logo.svg',
  'assets/icon-192.png', 'assets/icon-512.png',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase / CDN : réseau direct

  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) =>
        r || (req.mode === 'navigate'
          ? caches.match('index.html').then((shell) => shell || caches.match('offline.html'))
          : undefined)))
  );
});
