/* Service worker — stratégie "réseau d'abord" (toujours la dernière version),
 * avec repli sur le cache hors ligne. N'intercepte QUE les fichiers de l'app
 * (même origine) : Firebase et les CDN passent en direct. */

/* IMPORTANT : bumper cette version à CHAQUE déploiement d'un fichier applicatif
 * (index.html, css, js, sw). Sinon un appareil hors ligne peut servir une
 * ancienne version depuis le cache.
 * ⚠️ Doit rester IDENTIQUE à APP_VERSION dans js/app.js (numéro affiché dans
 *    l'entête) : c'est ce qui permet de vérifier qu'un appareil est à jour. */
const CACHE = 'edd-jardin-sauvage-v2026.08.21-3';
const APP_SHELL = [
  './', 'index.html', 'offline.html', 'css/styles.css',
  'js/config.js', 'js/store.js', 'js/app.js',
  'assets/logo.png', 'assets/logo.svg',
  'assets/icon-192.png', 'assets/icon-512.png',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  /* Fichier par fichier, et non `addAll` : `addAll` est tout-ou-rien, un seul
   * fichier indisponible laissait le cache COMPLÈTEMENT vide — et comme
   * `activate` supprime l'ancien cache, l'appareil se retrouvait sans style ni
   * logique au premier passage hors réseau. */
  e.waitUntil(caches.open(CACHE).then((c) =>
    Promise.all(APP_SHELL.map((u) => c.add(u).catch(() => {})))
  ));
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
  if (url.origin !== self.location.origin) return; // Firebase / CDN : réseau direct

  /* « Réseau d'abord » doit VRAIMENT aller au réseau : un simple fetch(req)
   * peut être servi par le cache HTTP du navigateur, qui renvoie alors
   * l'ancien fichier — l'appareil reste bloqué sur une version périmée même
   * après plusieurs rechargements. `cache: 'no-store'` force la relecture.
   * On repasse par le fetch normal si le navigateur refuse cette option. */
  const auReseau = () =>
    fetch(req.url, { cache: 'no-store', credentials: 'same-origin' }).catch(() => fetch(req));

  /* CACHE D'ABORD pour tout sauf la page elle-même.
   * Mesuré : en « réseau d'abord », une fois le cache HTTP du navigateur expiré
   * (10 min sur GitHub Pages), CHAQUE ouverture retéléchargeait 91 Ko de
   * fichiers strictement identiques — environ 68 Mo de données mobiles par an
   * et par appareil. Ici : 1 Ko.
   *
   * Aucun risque de servir une version périmée : chaque fichier porte un `?v=`
   * unique par version, et la correspondance est EXACTE (surtout pas
   * `ignoreSearch`, qui ferait justement correspondre l'ancienne entrée à la
   * nouvelle URL et figerait l'application sur du code périmé). Une nouvelle
   * version est donc forcément absente du cache, donc téléchargée.
   *
   * La navigation, elle, reste en « réseau d'abord » : c'est index.html qui
   * annonce les nouveaux `?v=`, il doit être frais. Vérifié : après un
   * déploiement, la nouvelle version arrive dès la première ouverture. */
  if (req.mode !== 'navigate') {
    return e.respondWith(
      caches.match(req).then((r) => r || auReseau().then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true })))
    );
  }

  e.respondWith(
    auReseau()
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      /* `ignoreSearch` est indispensable : l'application demande ses fichiers
       * AVEC un numéro de version (« css/styles.css?v=… ») alors que le
       * pré-cache les enregistre sans. Sans cette option, aucune entrée
       * pré-cachée n'était jamais retrouvée — le repli hors ligne ne servait à
       * rien — et un fichier mis en cache sous l'ancien numéro devenait
       * inutilisable dès le déploiement suivant. */
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) =>
        r || (req.mode === 'navigate'
          ? caches.match('index.html', { ignoreSearch: true })
              .then((shell) => shell || caches.match('offline.html', { ignoreSearch: true }))
          : undefined)))
  );
});
