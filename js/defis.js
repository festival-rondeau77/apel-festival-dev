// Module Défis : les règles du Grand Défi, lues du tableur (ADR-0015). Logique
// pure, partagée : le téléphone s'en sert pour PROPOSER un défi, le Worker
// (worker/src/index.js l'importe tel quel) pour le JUGER. Un Défi est une ligne de
// l'onglet `Défis` : un Type de preuve et ses paramètres. Un réglage invalide
// désactive son défi et dit pourquoi ; il ne casse jamais le reste.
import { tablesEnObjets, normaliser, slugType, typeExposantCanonique, TYPES_EXPOSANT } from './donnees.js';

export const OBJECTIF_PAR_DEFAUT = 100;
const ID = /^[a-z0-9-]{1,20}$/i;
const OUI = ['oui', 'vrai', 'true', 'x', '1'];
const NON = ['non', 'faux', 'false', '0'];

const texte = (v) => (v === null || v === undefined ? '' : String(v).trim());
const oui = (v) => v === true || OUI.includes(normaliser(v));
const non = (v) => v === false || NON.includes(normaliser(v));

// Un Type de preuve : lire ses paramètres dans la ligne (ou dire ce qui cloche),
// dire si le QR d'un exposant le concerne (`concerne`), et pourquoi il ne vaut
// pas ici (`motif`, '' s'il vaut). Le téléphone s'en sert pour estimer, le Worker
// pour juger : c'est le même code. Un mécanisme vraiment nouveau est un type de
// plus ici, sans toucher aux autres.
// Le contexte d'un jugement : { jeu, exposant, scans: [{ defi, exposant }] (les
// validations acceptées de ce Passeport), domainesDe(clé) → [Domaine] }.
export const TYPES_PREUVE = {
  // Le QR d'un exposant d'un type donné (défis 1 à 5).
  'scan-exposant': {
    lireParams(l) {
      const brut = texte(l.type_exposant);
      if (!brut) return { motif: 'type_exposant vide' };
      const canon = typeExposantCanonique(brut);
      if (!TYPES_EXPOSANT.includes(canon)) return { motif: `type_exposant inconnu : ${brut}` };
      return { params: { type_exposant: slugType(canon) } };
    },
    concerne: (defi, exposant) => exposant.startsWith(`${defi.params.type_exposant}:`),
    motif: () => '',
  },
  // Le QR d'un stand précis (défi 6, la réalité virtuelle) : le nom de son
  // exposant tel qu'il est écrit dans le tableur, ou sa clé (`entreprise:nom`).
  'scan-stand': {
    lireParams(l) {
      const brut = texte(l.stand);
      if (!brut) return { motif: 'stand vide' };
      const [type, ...reste] = brut.split(':');
      const stand = reste.length ? `${slugType(type)}:${normaliser(reste.join(':'))}` : normaliser(brut);
      if (!normaliser(brut)) return { motif: `stand illisible : ${brut}` };
      return { params: { stand, nom_stand: reste.length ? reste.join(':').trim() : brut } };
    },
    concerne: (defi, exposant) => standCorrespond(defi.params.stand, exposant),
    motif: () => '',
  },
  // Le QR d'un exposant dont aucun Domaine n'apparaît parmi ceux des scans déjà
  // validés (défi 9). Les centres d'intérêt du Visiteur ne partent jamais : seuls
  // ses scans comptent, ceux de CE stand compris. Sortir de sa zone de confort
  // suppose d'en avoir une : il faut au moins un scan avant (décidé avec
  // l'utilisateur le 2026-09-25) — le premier stand de la matinée ne le valide pas.
  'hors-domaines': {
    lireParams: () => ({ params: {} }),
    concerne: () => true,
    motif(defi, { exposant, scans, domainesDe }) {
      if (typeof domainesDe !== 'function') return 'domaines inconnus';
      const siens = domainesDe(exposant) || [];
      if (!siens.length) return 'exposant sans domaine';
      const precedents = scans.filter((s) => s.exposant);
      if (!precedents.length) return 'aucun scan avant';
      const croises = new Set(precedents.flatMap((s) => domainesDe(s.exposant) || []));
      return siens.some((d) => croises.has(d)) ? 'domaine déjà croisé' : '';
    },
  },
};

// Un stand désigné par sa clé complète, ou par le seul nom (quel que soit le type).
export function standCorrespond(stand, exposant) {
  return exposant === stand || (!stand.includes(':') && exposant.slice(exposant.indexOf(':') + 1) === stand);
}

// « différent du défi X » (défi 2 : une autre école que celle du défi 1) : un même
// exposant ne sert pas aux deux, dans un sens comme dans l'autre.
function motifDifferentDe(defi, { jeu, exposant, scans }) {
  const lies = new Set(defi.params.different_de ? [defi.params.different_de] : []);
  for (const d of jeu.defis) if (d.params.different_de === defi.id) lies.add(d.id);
  const pris = scans.find((s) => lies.has(s.defi) && s.exposant === exposant);
  return pris ? `même exposant que le défi ${pris.defi}` : '';
}

// Les réglages publics communs à tous les Types : `different_de`, une `question` et
// ses `choix` (des émojis ou des mots courts, séparés par des points-virgules, ou
// par des espaces s'il n'y en a pas). Le choix part au Worker par son numéro,
// jamais comme un texte (ADR-0014).
const CHOIX_MAX = 6;
const LONGUEUR_CHOIX_MAX = 16;
function lireChoix(valeur) {
  const brut = texte(valeur);
  if (!brut) return { choix: [] };
  const choix = brut.split(brut.includes(';') ? ';' : /\s+/).map((c) => c.trim()).filter(Boolean);
  if (choix.length < 2 || choix.length > CHOIX_MAX) return { motif: `choix : de 2 à ${CHOIX_MAX}, et non ${choix.length}` };
  if (choix.some((c) => c.length > LONGUEUR_CHOIX_MAX)) return { motif: `choix trop longs (${LONGUEUR_CHOIX_MAX} caractères au plus)` };
  return { choix };
}

function lireObjectif(valeur) {
  const premier = Number(texte(valeur).split(/[;,\s]+/)[0]);
  return Number.isInteger(premier) && premier > 0 ? premier : OBJECTIF_PAR_DEFAUT;
}

// Les onglets `Défis` et `Infos` (tables brutes, première ligne = en-têtes) → le jeu.
// `defis` garde aussi les défis désactivés (leurs points comptent toujours) ;
// `invalides` liste ce qui a été écarté, avec le motif.
export function lireJeu(tableDefis, tableInfos, { exposants = null } = {}) {
  const infos = {};
  for (const l of tablesEnObjets(tableInfos)) infos[normaliser(l.cle).replace(/-/g, '_')] = l.valeur;
  const jeu = { actif: oui(infos.grand_defi), objectif: lireObjectif(infos.paliers), defis: [], invalides: [] };
  const entetes = Array.isArray(tableDefis) && Array.isArray(tableDefis[0]) ? tableDefis[0].map((e) => normaliser(e).replace(/-/g, '_')) : [];
  // gviz rend la PREMIÈRE feuille quand l'onglet demandé n'existe pas : sans ces
  // en-têtes, ce n'est pas l'onglet Défis, et il n'y a pas de jeu.
  if (!['id', 'titre', 'points', 'type_preuve'].every((c) => entetes.includes(c))) {
    jeu.invalides.push({ id: '', motif: 'onglet Défis absent ou sans ses en-têtes (id, titre, points, type_preuve)' });
    return jeu;
  }
  const vus = new Set();
  for (const l of tablesEnObjets(tableDefis)) {
    const id = texte(l.id);
    if (!id) continue;
    const ecarter = (motif) => jeu.invalides.push({ id, motif });
    if (!ID.test(id)) { ecarter('identifiant illisible (lettres, chiffres, tirets)'); continue; }
    if (vus.has(id)) { ecarter('identifiant en double'); continue; }
    vus.add(id);
    const points = texte(l.points) === '' ? NaN : Number(l.points);
    if (!Number.isInteger(points) || points < 0 || points > 1000) { ecarter(`points illisibles : « ${texte(l.points)} »`); continue; }
    const type = TYPES_PREUVE[normaliser(l.type_preuve)];
    if (!type) { ecarter(`type de preuve inconnu : « ${texte(l.type_preuve)} »`); continue; }
    const { params, motif } = type.lireParams(l);
    if (motif) { ecarter(motif); continue; }
    const different = texte(l.different_de);
    if (different) {
      if (different === id) { ecarter('different_de : le défi lui-même'); continue; }
      params.different_de = different;
    }
    const { choix, motif: motifChoix } = lireChoix(l.choix);
    if (motifChoix) { ecarter(motifChoix); continue; }
    jeu.defis.push({ id, titre: texte(l.titre), points, type_preuve: normaliser(l.type_preuve), actif: !non(l.actif), params, question: texte(l.question), choix });
  }
  // Ce qui se vérifie seulement une fois toutes les lignes lues : le défi désigné
  // par `different_de` existe ; le stand désigné est au programme (quand il est fourni).
  const ids = new Set(jeu.defis.map((d) => d.id));
  jeu.defis = jeu.defis.filter((d) => {
    let motif = '';
    if (d.params.different_de && !ids.has(d.params.different_de)) motif = `different_de : défi ${d.params.different_de} introuvable`;
    else if (d.type_preuve === 'scan-stand' && exposants && !exposants.some((e) => standCorrespond(d.params.stand, e.cle))) motif = `stand introuvable au programme : ${d.params.nom_stand}`;
    if (motif) jeu.invalides.push({ id: d.id, motif });
    return !motif;
  });
  return jeu;
}

// Ce que le téléphone reçoit : les défis actifs et leurs réglages publics. Sans
// défi actif, pas de jeu à l'écran.
export function jeuPublic(jeu) {
  const defis = jeu.defis.filter((d) => d.actif).map(({ actif, ...d }) => d);
  return { actif: jeu.actif && defis.length > 0, objectif: jeu.objectif, defis };
}

// Le QR de cet exposant concerne-t-il ce défi ? (Pour quels défis une fiche
// ouverte par QR les propose.)
export function proposable(defi, exposant) {
  const type = TYPES_PREUVE[defi && defi.type_preuve];
  return Boolean(type && typeof exposant === 'string' && exposant && type.concerne(defi, exposant));
}

// Pourquoi ce défi ne vaut pas ici ('' s'il vaut) : même exposant que le défi
// lié, domaine déjà croisé… Le téléphone l'estime, le Worker le juge.
export function motifIci(defi, contexte) {
  const ctx = { scans: [], ...contexte };
  return motifDifferentDe(defi, ctx) || TYPES_PREUVE[defi.type_preuve].motif(defi, ctx);
}

// Le verdict sur une validation : { statut: ok | deja | refus, motif, choix }.
// `exposant` est la clé de l'Exposant dont le secret a été présenté (null si
// inconnu) ; `scans`, les validations acceptées de ce Passeport ({ defi, exposant }) ;
// `faits`, les défis qu'il a déjà validés (déduits des scans par défaut).
// `choix` : le numéro du choix envoyé, gardé seulement s'il est dans la liste du
// défi (une liste raccourcie le jour J ne coûte pas le point).
export function juger(v, { jeu, exposant = null, scans = [], faits = new Set(scans.map((s) => s.defi)), domainesDe = null }) {
  const refus = (motif) => ({ statut: 'refus', motif, choix: null });
  if (!jeu.actif) return refus('jeu coupé');
  const defi = jeu.defis.find((d) => d.id === v.defi && d.actif);
  if (!defi) return refus('défi inconnu ou inactif');
  if (!v.preuve || !v.preuve.secret) return refus('preuve attendue');
  if (!exposant) return refus('secret inconnu');
  if (!proposable(defi, exposant)) return refus(defi.type_preuve === 'scan-stand' ? 'pas le stand du défi' : 'exposant d’un autre type');
  if (faits.has(defi.id)) return { statut: 'deja', motif: '', choix: null };
  const motif = motifIci(defi, { jeu, exposant, scans, domainesDe });
  if (motif) return refus(motif);
  const n = v.preuve.choix;
  const choix = Number.isInteger(n) && n >= 0 && n < defi.choix.length ? n : null;
  return { statut: 'ok', motif: '', choix, libelle: choix === null ? '' : defi.choix[choix] };
}

// Les points d'un Passeport, avec les points du tableur du moment (ADR-0015) :
// une correction le jour J profite à tous.
export function pointsDe(idsValides, jeu) {
  const parId = new Map(jeu.defis.map((d) => [d.id, d.points]));
  return [...new Set(idsValides)].reduce((s, id) => s + (parId.get(id) || 0), 0);
}
