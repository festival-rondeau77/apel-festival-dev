// Service worker : l'appli entière en cache à l'installation, une version = un cache
// figé (cache d'abord) ; les données (snapshot) réseau d'abord, cache en secours. La
// VERSION est réécrite par bin/deploy.sh à chaque publication ; une nouvelle VERSION
// installe un nouveau cache complet, que « Recharger » met en service d'un coup.
//
// Une version n'est jamais un mélange (2026-10-23 : les onglets du programme
// s'affichaient sans répondre au clic, rendu.js neuf et app.js ancien) :
// - l'installation contourne le cache HTTP du navigateur (`cache: 'reload'`) : GitHub
//   Pages le garde dix minutes, et `addAll` y aurait repris un ancien app.js ;
// - le cache d'une version n'est plus réécrit par le réseau en cours de route : seul un
//   fichier absent de la liste y entre.
const VERSION = '2026.10.25-284bfde';
const CACHE_APPLI = `festival-appli-${VERSION}`;
const CACHE_DONNEES = 'festival-donnees';
const FICHIERS = [
  './', './index.html', './reglement-jeu.html', './styles.css', './manifest.webmanifest',
  './js/rideau.js', './js/app.js', './js/erreurs.js', './js/config.js', './js/donnees.js', './js/empreinte.js', './js/visite.js', './js/stats.js', './js/sources.js', './js/routes.js', './js/rendu.js', './js/plan.js', './js/batiment.js', './js/icones.js', './js/defis.js', './js/passeport.js', './js/scan.js', './js/gains.js', './js/qr.js', './js/questionnaire.js', './js/vendor/jsqr.js',
  './js/i18n.js', './js/i18n/fr.js', './js/i18n/en.js', './js/i18n/es.js', './js/i18n/zh.js', './js/i18n/de.js',
  './icones/icone.svg', './icones/icone-192.png', './icones/icone-512.png', './icones/icone-maskable-512.png', './icones/icone-180.png',
  './logos/apel-fleur.webp', './logos/rondeau.webp', './logos/saint-colomban.webp',
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
    await cache.addAll(FICHIERS.map((u) => new Request(u, { cache: 'reload' })));
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
  if (url.pathname.endsWith('/jeu')) return; // le Worker local de npm run servir : jamais en cache
  // Le teaser et sa musique (ticket teaser 02) : jamais interceptés ni en cache. Safari demande
  // l'audio par requêtes partielles (206), que cache.put refuse ; et le teaser n'a pas besoin du hors-ligne.
  if (url.pathname.endsWith('/teaser.html') || url.pathname.endsWith('/teaser-musique.mp3')) return;
  // La page des résultats de l'APEL (questionnaire, ADR-0026) : toujours le réseau, jamais en cache.
  if (/\/(resultats\.html|resultats\.css|js\/resultats\.js)$/.test(url.pathname)) return;
  // Le lien court des questions flash (ADR-0027) : une redirection, toujours le réseau.
  if (/\/(animation|animation\.html|js\/animation-lien\.js)$/.test(url.pathname)) return;
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
    if (enCache && !DEV) return enCache;
    const rep = await fetch(e.request).then((r) => { if (r.ok && !enCache) cache.put(e.request, r.clone()); return r; }).catch(() => null);
    if (rep) return rep;
    if (enCache) return enCache;
    if (e.request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
    return Response.error();
  })());
});
