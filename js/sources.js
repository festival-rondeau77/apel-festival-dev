// Module Sources : la chaîne de lecture des données (ADR-0004).
//   1. script Apps Script (`etat` : version + bandeau ; `donnees` : cinq tables)
//   2. classeur « Festival — Export public » via gviz, onglet par onglet
//   3. snapshot embarqué au déploiement
// À chaque succès, les tables sont mises en cache local avec version et heure.
// Le réseau (fetch), le stockage, l'horloge et la temporisation sont injectés.
import { tablesDepuisGviz, tablesDepuisSnapshot, versionDe } from './donnees.js';

export const CLE_CACHE = 'festival.donnees';
export const ONGLETS_GVIZ = { exposants: 'Exposants', evenements: 'Événements', salles: 'Salles', preparation: 'Préparation', infos: 'Infos' };
const DELAI_MAX = 8000; // ms avant de considérer une source comme trop lente

function attendreParDefaut(ms) { return new Promise((r) => setTimeout(r, ms)); }

// La clé `bandeau` de la table Infos (première ligne = en-têtes).
export function bandeauDe(tables) {
  for (const ligne of (tables && tables.infos || []).slice(1)) if (String(ligne[0] ?? '').trim().toLowerCase() === 'bandeau') return String(ligne[1] ?? '').trim();
  return '';
}

// L'URL d'un point d'entrée du script (le scriptUrl peut déjà porter une requête).
export function urlAction(scriptUrl, action) {
  if (!scriptUrl) throw new Error('script Apps Script non configuré');
  return `${scriptUrl}${scriptUrl.includes('?') ? '&' : '?'}action=${action}`;
}

export function urlGviz(sheetId, onglet) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(onglet)}`;
}

export function creerSources({ config = {}, fetch, stockage, horloge = () => Date.now(), snapshot = null, attendre = attendreParDefaut, delaiMax = DELAI_MAX, journal = () => {} } = {}) {
  const lire = () => { try { return stockage ? stockage.getItem(CLE_CACHE) : null; } catch { return null; } };
  const ecrire = (v) => { try { if (stockage) stockage.setItem(CLE_CACHE, v); } catch { /* quota ou navigation privée */ } };

  // Une requête avec délai maximal : la source lente est abandonnée pour cette itération.
  async function requete(url, options) {
    if (!fetch) throw new Error('pas de réseau injecté');
    const garde = attendre(delaiMax).then(() => { throw new Error(`délai dépassé : ${url}`); });
    const rep = await Promise.race([fetch(url, options), garde]);
    if (!rep || !rep.ok) throw new Error(`HTTP ${rep ? rep.status : '?'} : ${url}`);
    return rep.text();
  }

  const urlScript = (action) => urlAction(config.scriptUrl, action);

  async function etatScript() {
    const rep = JSON.parse(await requete(urlScript('etat'), { redirect: 'follow' }));
    if (!rep || typeof rep.version !== 'string') throw new Error('etat : réponse invalide');
    return { version: rep.version, bandeau: typeof rep.bandeau === 'string' ? rep.bandeau : '' };
  }

  async function donneesScript() {
    const rep = JSON.parse(await requete(urlScript('donnees'), { redirect: 'follow' }));
    if (!rep || !rep.tables) throw new Error('donnees : réponse invalide');
    return { tables: rep.tables, version: rep.version || versionDe(rep.tables), source: 'script', bandeau: typeof rep.bandeau === 'string' ? rep.bandeau : null };
  }

  async function donneesGviz() {
    if (!config.sheetId) throw new Error('classeur Export public non configuré');
    const tables = {};
    for (const [nom, onglet] of Object.entries(ONGLETS_GVIZ)) tables[nom] = tablesDepuisGviz(await requete(urlGviz(config.sheetId, onglet)));
    return { tables, version: versionDe(tables), source: 'gviz', bandeau: bandeauDe(tables) };
  }

  function depuisSnapshot() {
    if (!snapshot) return null;
    try {
      const s = tablesDepuisSnapshot(snapshot);
      return { tables: s.tables, version: s.version, source: 'snapshot', heure: s.genere_le ? Date.parse(s.genere_le) || 0 : 0 };
    } catch (e) { journal('snapshot illisible', e); return null; }
  }

  function depuisCache() {
    try {
      const c = JSON.parse(lire() || 'null');
      if (!c || !c.tables || typeof c.version !== 'string') return null;
      return { tables: c.tables, version: c.version, source: 'cache', heure: Number(c.heure) || 0, sourceOrigine: c.source || 'cache' };
    } catch { return null; }
  }

  // Ce que l'appli affiche avant tout réseau : le cache local s'il existe et n'est
  // pas plus ancien que le snapshot embarqué, sinon le snapshot.
  function chargerInitial() {
    const cache = depuisCache();
    const snap = depuisSnapshot();
    if (cache && snap && cache.version !== snap.version && snap.heure > cache.heure) return snap;
    return cache || snap || null;
  }

  function memoriser({ tables, version, source }) {
    const heure = horloge();
    ecrire(JSON.stringify({ tables, version, source, heure }));
    return heure;
  }

  // Un rafraîchissement : renvoie { change, bandeau, source, tables?, version? } ou jette si aucune source ne répond.
  async function rafraichir(versionActuelle) {
    const erreurs = [];
    try {
      const etat = await etatScript();
      if (etat.version === versionActuelle) return { change: false, bandeau: etat.bandeau, source: 'script', version: etat.version };
      const d = await donneesScript();
      memoriser(d);
      return { change: true, bandeau: d.bandeau ?? etat.bandeau, source: 'script', tables: d.tables, version: d.version };
    } catch (e) { erreurs.push(e); journal('script indisponible', e); }
    try {
      const d = await donneesGviz();
      if (d.version === versionActuelle) return { change: false, bandeau: d.bandeau, source: 'gviz', version: d.version };
      memoriser(d);
      return { change: true, bandeau: d.bandeau, source: 'gviz', tables: d.tables, version: d.version };
    } catch (e) { erreurs.push(e); journal('gviz indisponible', e); }
    const err = new Error(`aucune source vivante : ${erreurs.map((x) => x.message).join(' ; ')}`);
    err.erreurs = erreurs;
    throw err;
  }

  return { chargerInitial, rafraichir, memoriser, etatScript, donneesScript, donneesGviz, depuisSnapshot, depuisCache };
}

// ---------------------------------------------------------------- rafraîchissement périodique

// Toutes les `intervalle` ms tant que la page est visible, et au retour au premier plan.
// Sur erreur, espacement exponentiel jusqu'à `maxRecul` ; retour à la normale au succès.
export function creerRafraichisseur({ intervalle = 60000, maxRecul = 300000, visible = () => true, planifier = setTimeout, annuler = clearTimeout, executer, journal = () => {} }) {
  let delai = intervalle;
  let minuteur = null;
  let actif = false;
  let enCours = false;

  function programmer(ms) {
    if (minuteur !== null) annuler(minuteur);
    minuteur = actif ? planifier(tick, ms) : null;
  }

  async function tick() {
    if (minuteur !== null) { annuler(minuteur); minuteur = null; } // un tick direct (retour au premier plan) annule le tick planifié
    if (!actif) return;
    if (!visible()) { programmer(intervalle); return; } // écran éteint ou arrière-plan : pas de réseau
    if (enCours) { programmer(delai); return; }
    enCours = true;
    try {
      await executer();
      delai = intervalle;
    } catch (e) {
      delai = Math.min(delai * 2, maxRecul);
      journal('rafraîchissement en échec, prochain essai dans', delai, e);
    } finally {
      enCours = false;
      programmer(delai);
    }
  }

  return {
    demarrer() { actif = true; delai = intervalle; return tick(); },
    arreter() { actif = false; if (minuteur !== null) annuler(minuteur); minuteur = null; },
    surVisibilite() { if (actif && visible()) { delai = intervalle; return tick(); } return Promise.resolve(); },
    delaiCourant: () => delai,
  };
}
