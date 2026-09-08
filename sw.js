// Service worker : l'appli entière en cache à l'installation (cache d'abord,
// réseau pour mettre à jour) ; les données (snapshot) réseau d'abord, cache en
// secours. La VERSION est réécrite par bin/deploy.sh à chaque publication.
const VERSION = '2026.09.08-6c3c5a6';
const CACHE_APPLI = `festival-appli-${VERSION}`;
const CACHE_DONNEES = 'festival-donnees';
const FICHIERS = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/app.js', './js/config.js', './js/donnees.js', './js/empreinte.js', './js/visite.js', './js/stats.js', './js/sources.js', './js/routes.js', './js/rendu.js', './js/plan.js',
  './icones/icone.svg', './icones/icone-192.png', './icones/icone-512.png', './icones/icone-maskable-512.png', './icones/icone-180.png',
  './polices/polices.css', './polices/bricolage-700.woff2', './polices/bricolage-800.woff2',
];
const DONNEES = ['./data/snapshot.json'];
// En développement (localhost), les fichiers de l'appli passent par le réseau
// d'abord et la nouvelle version prend la main tout de suite : une modification
// est visible au rechargement suivant, sans vider le cache à la main. Le secours
// par le cache reste actif, donc le hors-ligne se teste quand même.
// En production, cache d'abord, pour l'ouverture en deux secondes.
const DEV = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_APPLI);
    await cache.addAll(FICHIERS);
    const donnees = await caches.open(CACHE_DONNEES);
    await Promise.all(DONNEES.map((u) => donnees.add(u).catch(() => {})));
    if (DEV) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms.filter((n) => n.startsWith('festival-appli-') && n !== CACHE_APPLI).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'activer') self.skipWaiting();
  // Le pied de page demande quelle version SERT réellement les fichiers. Si elle
  // diffère de celle du code chargé, le téléphone tourne sur un cache périmé —
  // c'est la seule façon de le voir depuis l'appareil, sans câble ni console.
  if (e.data && e.data.type === 'version' && e.ports && e.ports[0]) e.ports[0].postMessage({ version: VERSION });
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== 'GET') return; // Google et le reste : jamais interceptés
  if (url.pathname.endsWith('/data/snapshot.json')) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_DONNEES);
      try {
        const rep = await fetch(e.request);
        if (rep.ok) cache.put(e.request, rep.clone());
        return rep;
      } catch {
        return (await cache.match(e.request)) || new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE_APPLI);
    const enCache = await cache.match(e.request, { ignoreSearch: true });
    const reseau = fetch(e.request).then((rep) => { if (rep.ok) cache.put(e.request, rep.clone()); return rep; }).catch(() => null);
    if (enCache && DEV) { const frais = await reseau; if (frais) return frais; return enCache; }
    if (enCache) { reseau.catch(() => {}); return enCache; }
    const rep = await reseau;
    if (rep) return rep;
    if (e.request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
    return Response.error();
  })());
});
