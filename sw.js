/* Service worker — stratégie "réseau d'abord" (toujours la dernière version),
 * avec repli sur le cache hors ligne. N'intercepte QUE les fichiers de l'app
 * (même origine) : Firebase et les CDN passent en direct. */

/* IMPORTANT : bumper cette version à CHAQUE déploiement d'un fichier applicatif
 * (index.html, css, js, sw). Sinon un appareil hors ligne peut servir une
 * ancienne version depuis le cache.
 * ⚠️ Doit rester IDENTIQUE à APP_VERSION dans js/app.js (numéro affiché dans
 *    l'entête) : c'est ce qui permet de vérifier qu'un appareil est à jour. */
const CACHE = 'edd-jardin-sauvage-v2026.08.20-2';
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

  /* « Réseau d'abord » doit VRAIMENT aller au réseau : un simple fetch(req)
   * peut être servi par le cache HTTP du navigateur, qui renvoie alors
   * l'ancien fichier — l'appareil reste bloqué sur une version périmée même
   * après plusieurs rechargements. `cache: 'no-store'` force la relecture.
   * On repasse par le fetch normal si le navigateur refuse cette option. */
  const auReseau = () =>
    fetch(req.url, { cache: 'no-store', credentials: 'same-origin' }).catch(() => fetch(req));

  e.respondWith(
    auReseau()
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
