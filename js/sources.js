// Module Sources : la chaîne de lecture des données (ADR-0004).
//   1. script Apps Script (`etat` : version + bandeau ; `donnees` : six tables)
//   2. classeur « Festival — Export public » via gviz, onglet par onglet
//   3. snapshot embarqué au déploiement
// À chaque succès, les tables sont mises en cache local avec version et heure.
// Le réseau (fetch), le stockage, l'horloge et la temporisation sont injectés.
import { tablesDepuisGviz, tablesDepuisSnapshot, versionDe } from './donnees.js';

export const CLE_CACHE = 'festival.donnees';
export const ONGLETS_GVIZ = { exposants: 'Exposants', evenements: 'Événements', salles: 'Salles', preparation: 'Préparation', infos: 'Infos', traductions: 'Traductions' };
// La table des traductions est facultative : un classeur public pas encore migré
// (onglet absent, IMPORTRANGE non autorisé) reste une source valable — en français.
const TABLES_FACULTATIVES = ['traductions'];
const DELAI_MAX = 8000; // ms avant de considérer une source comme trop lente
const SEUIL_CHUTE = 0.5; // une source qui perd plus de la moitié de son volume est refusée

function attendreParDefaut(ms) { return new Promise((r) => setTimeout(r, ms)); }

// La clé `bandeau` de la table Infos (première ligne = en-têtes).
export function bandeauDe(tables) {
  for (const ligne of (tables && tables.infos || []).slice(1)) if (String(ligne[0] ?? '').trim().toLowerCase() === 'bandeau') return String(ligne[1] ?? '').trim();
  return '';
}

// Les traductions du bandeau que le script joint à l'état ({ en, es, zh }), ou null.
// Le bandeau du jour J ne peut pas attendre le passage du traducteur : le script
// le traduit à la volée, et c'est ici qu'on le recueille (ADR-0012).
export function bandeauxDe(rep) {
  if (!rep || !rep.bandeaux || typeof rep.bandeaux !== 'object') return null;
  const b = {};
  for (const [l, v] of Object.entries(rep.bandeaux)) if (typeof v === 'string') b[l] = v;
  return b;
}

// Le nombre de lignes de DONNÉES de chaque table (la première ligne porte les en-têtes).
export function volumes(tables) {
  const v = {};
  for (const [nom, t] of Object.entries(tables || {})) v[nom] = Math.max(0, (Array.isArray(t) ? t.length : 0) - 1);
  return v;
}

// La barrière de complétude : un repli ne doit jamais rendre l'appli MOINS complète
// qu'elle ne l'était. Une panne du script fait basculer sur le classeur public ; si
// celui-ci répond « techniquement valide mais vide », l'ancien code l'acceptait, le
// mettait en cache, et tous les téléphones affichaient un programme vide (chaîne C de
// l'audit du 2026-09-08 — le seul scénario qui se déclenche sans adversaire).
// On compare donc le candidat à ce que l'appli tient déjà pour vrai.
// Renvoie null si le candidat est acceptable, sinon le motif du refus.
// Limite connue et assumée : la référence avance à chaque acceptation, donc une
// érosion lente (sous le seuil à chaque fois) passe. C'est la disparition BRUTALE
// qu'on bloque, parce que c'est celle qu'on a mesurée.
export function motifDeRefus(candidat, reference, { seuilChute = SEUIL_CHUTE } = {}) {
  if (!reference) return null; // premier démarrage : rien à protéger
  const vc = volumes(candidat);
  const vr = volumes(reference);
  for (const f of TABLES_FACULTATIVES) { delete vc[f]; delete vr[f]; }
  for (const [nom, n] of Object.entries(vr)) {
    if (n > 0 && !(vc[nom] > 0)) return `table « ${nom} » vidée (${n} → ${vc[nom] ?? 0})`;
  }
  const total = (v) => Object.values(v).reduce((a, b) => a + b, 0);
  const tc = total(vc);
  const tr = total(vr);
  if (tr > 0 && tc < tr * (1 - seuilChute)) return `volume en chute : ${tc} lignes contre ${tr}`;
  return null;
}

// L'URL d'un point d'entrée du script (le scriptUrl peut déjà porter une requête).
export function urlAction(scriptUrl, action) {
  if (!scriptUrl) throw new Error('script Apps Script non configuré');
  return `${scriptUrl}${scriptUrl.includes('?') ? '&' : '?'}action=${action}`;
}

export function urlGviz(sheetId, onglet) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(onglet)}`;
}

export function creerSources({ config = {}, fetch, stockage, horloge = () => Date.now(), snapshot = null, attendre = attendreParDefaut, delaiMax = DELAI_MAX, seuilChute = SEUIL_CHUTE, journal = () => {} } = {}) {
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
    return { version: rep.version, bandeau: typeof rep.bandeau === 'string' ? rep.bandeau : '', bandeaux: bandeauxDe(rep) };
  }

  async function donneesScript() {
    const rep = JSON.parse(await requete(urlScript('donnees'), { redirect: 'follow' }));
    if (!rep || !rep.tables) throw new Error('donnees : réponse invalide');
    return { tables: rep.tables, version: rep.version || versionDe(rep.tables), source: 'script', bandeau: typeof rep.bandeau === 'string' ? rep.bandeau : null, bandeaux: bandeauxDe(rep) };
  }

  async function donneesGviz() {
    if (!config.sheetId) throw new Error('classeur Export public non configuré');
    const tables = {};
    for (const [nom, onglet] of Object.entries(ONGLETS_GVIZ)) {
      try { tables[nom] = tablesDepuisGviz(await requete(urlGviz(config.sheetId, onglet))); }
      catch (e) { if (!TABLES_FACULTATIVES.includes(nom)) throw e; tables[nom] = []; journal('gviz : onglet facultatif absent', onglet, e.message); }
    }
    return { tables, version: versionDe(tables), source: 'gviz', bandeau: bandeauDe(tables), bandeaux: null };
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

  // Un rafraîchissement : renvoie { change, bandeau, source, tables?, version? },
  // ou { change: false, refus } si les sources joignables sont incomplètes,
  // ou jette si aucune source ne répond.
  async function rafraichir(versionActuelle) {
    const erreurs = [];
    const refus = [];
    const initial = chargerInitial();
    const reference = initial ? initial.tables : null;
    // Un candidat n'entre dans le cache que s'il ne fait pas reculer l'appli.
    const acceptable = (d) => {
      const motif = motifDeRefus(d.tables, reference, { seuilChute });
      if (!motif) return true;
      refus.push({ source: d.source, motif });
      journal('source refusée, données conservées', d.source, motif);
      return false;
    };
    try {
      const etat = await etatScript();
      if (etat.version === versionActuelle) return { change: false, bandeau: etat.bandeau, bandeaux: etat.bandeaux, source: 'script', version: etat.version };
      const d = await donneesScript();
      if (acceptable(d)) {
        memoriser(d);
        return { change: true, bandeau: d.bandeau ?? etat.bandeau, bandeaux: d.bandeaux || etat.bandeaux, source: 'script', tables: d.tables, version: d.version };
      }
    } catch (e) { erreurs.push(e); journal('script indisponible', e); }
    try {
      const d = await donneesGviz();
      if (d.version === versionActuelle) return { change: false, bandeau: d.bandeau, bandeaux: null, source: 'gviz', version: d.version };
      if (acceptable(d)) {
        memoriser(d);
        return { change: true, bandeau: d.bandeau, bandeaux: null, source: 'gviz', tables: d.tables, version: d.version };
      }
    } catch (e) { erreurs.push(e); journal('gviz indisponible', e); }
    // Refusée n'est pas muette : on garde la version courante et on le dit au pied de page.
    // On ne prend pas non plus le bandeau d'une source qu'on vient de juger douteuse.
    if (refus.length) return { change: false, source: refus[0].source, version: versionActuelle, refus };
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
