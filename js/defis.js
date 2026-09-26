// Module Défis : les règles du Grand Défi, lues du tableur (ADR-0015). Logique
// pure, partagée : le téléphone s'en sert pour PROPOSER un défi, le Worker
// (worker/src/index.js l'importe tel quel) pour le JUGER. Un Défi est une ligne de
// l'onglet `Défis` : un Type de preuve et ses paramètres. Un réglage invalide
// désactive son défi et dit pourquoi ; il ne casse jamais le reste.
import { tablesEnObjets, normaliser, slugType, typeExposantCanonique, TYPES_EXPOSANT, heureEnMinutes } from './donnees.js';

export const OBJECTIF_PAR_DEFAUT = 100;
export const CHANCES_BADGE_PAR_DEFAUT = 1;
export const ESSAIS_PAR_DEFAUT = 2;
export const TOLERANCE_AVANT_PAR_DEFAUT = 15;
export const TOLERANCE_APRES_PAR_DEFAUT = 10;
// Un instant gagnant dure cinq minutes, sauf `actif_a` rempli (grand-defi 08).
export const DUREE_INSTANT = 5;
export const LOTS_FLASH_MAX_PAR_DEFAUT = 1;
// Le tirage d'un instant, en minutes après sa fermeture (le Worker tire, le téléphone l'annonce).
export const DELAI_TIRAGE_INSTANT = 2;
export const HEURE_TIRAGE_PAR_DEFAUT = 13 * 60;
export const ID_DEFI = /^[a-z0-9-]{1,20}$/i;
const OUI = ['oui', 'vrai', 'true', 'x', '1'];
const NON = ['non', 'faux', 'false', '0'];

const texte = (v) => (v === null || v === undefined ? '' : String(v).trim());
const oui = (v) => v === true || OUI.includes(normaliser(v));
const non = (v) => v === false || NON.includes(normaliser(v));

// Un stand désigné dans le tableur : le nom de son exposant tel qu'il est écrit, ou
// sa clé (`entreprise:nom`) → { stand, nom }, ou null s'il est illisible.
function lireStand(brut) {
  if (!normaliser(brut)) return null;
  const [type, ...reste] = brut.split(':');
  return reste.length ? { stand: `${slugType(type)}:${normaliser(reste.join(':'))}`, nom: reste.join(':').trim() } : { stand: normaliser(brut), nom: brut };
}

// Une heure du tableur, en minutes depuis minuit : « 12:45 », « 12 h 45 », ou la
// cellule heure telle que gviz la rend ([12, 45, 0, 0]). null si illisible.
function lireHeure(v) {
  if (Array.isArray(v)) return Number.isInteger(v[0]) && Number.isInteger(v[1]) && v[0] < 24 && v[1] < 60 ? v[0] * 60 + v[1] : null;
  // « 12:45:00 » : Sheets affiche parfois les secondes d'une cellule heure.
  const sec = /^(\d{1,2}:\d{2}):\d{2}$/.exec(String(v ?? '').trim());
  return heureEnMinutes(sec ? sec[1] : v);
}

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
      const s = lireStand(brut);
      if (!s) return { motif: `stand illisible : ${brut}` };
      return { params: { stand: s.stand, nom_stand: s.nom } };
    },
    concerne: (defi, exposant) => standCorrespond(defi.params.stand, exposant),
    motif: () => '',
  },
  // Le QR du stand attribué à ce téléphone (défi 10, le défi mystère) : une dizaine de
  // stands (colonne `stands`, séparés par des points-virgules), un par téléphone, fixe
  // (standAttribue : le téléphone et le Worker le calculent pareil depuis l'identifiant
  // de l'appareil, rien de plus n'est envoyé), pour qu'il n'y ait pas de ruée vers un
  // seul stand. Il vaut entre l'annonce (`actif_de`, une heure de Paris ; vide = pas
  // encore annoncé) et l'heure limite (`actif_a`), bornes comprises. Avant l'annonce, le
  // téléphone ne reçoit ni les stands ni les heures (jeuPublic) ; l'annonce est un
  // Type qui a `annonce` (les instants gagnants aussi, grand-defi 08).
  'scan-attribue': {
    annonce: true,
    lireParams(l) {
      const noms = texte(l.stands).split(/[;\n]/).map((n) => n.trim()).filter(Boolean);
      if (!noms.length) return { motif: 'stands vides : les stands du mystère, séparés par des points-virgules' };
      const stands = [];
      for (const n of noms) {
        const s = lireStand(n);
        if (!s) return { motif: `stand illisible : ${n}` };
        if (stands.some((x) => x.stand === s.stand)) return { motif: `stand en double : ${n}` };
        stands.push(s);
      }
      const actifA = lireHeure(l.actif_a);
      if (actifA === null) return { motif: `actif_a illisible : « ${texte(l.actif_a)} » (l’heure limite, 12:45)` };
      const sansAnnonce = !Array.isArray(l.actif_de) && texte(l.actif_de) === '';
      const actifDe = sansAnnonce ? null : lireHeure(l.actif_de);
      if (!sansAnnonce && actifDe === null) return { motif: `actif_de illisible : « ${texte(l.actif_de)} » (l’heure de l’annonce, 10:30 ; vide = pas encore annoncé)` };
      if (actifDe !== null && actifDe >= actifA) return { motif: `actif_de (${texte(l.actif_de)}) doit être avant actif_a (${texte(l.actif_a)})` };
      return { params: { stands, actif_de: actifDe, actif_a: actifA } };
    },
    concerne: (defi, exposant) => (defi.params.stands || []).some((s) => standCorrespond(s.stand, exposant)),
    motif(defi, { exposant, appareil, heure }) {
      const phase = phaseAnnonce(defi, heure);
      if (phase === 'a-venir') return 'pas encore annoncé';
      if (phase === 'close') return 'heure limite passée';
      const s = standAttribue(defi, appareil);
      return s && standCorrespond(s.stand, exposant) ? '' : 'pas votre stand';
    },
  },
  // Un instant gagnant (grand-defi 08) : une question à choix, posée par une annonce à
  // l'heure `actif_de` (vide = pas encore programmé), pendant cinq minutes (jusqu'à
  // `actif_a` si la colonne est remplie). Pas un Défi : aucun point, hors du badge
  // (`sansPoints`). La réponse est enregistrée, juste ou non, sans que le téléphone le
  // sache (motif `juste` | `faux`, gardé dans D1) ; le Worker tire un gagnant parmi les
  // bonnes réponses deux minutes après la fermeture (worker/src/instants.js). La bonne
  // réponse vit dans D1 comme celle d'une question (`reponses`, portée par le Push).
  instant: {
    annonce: true,
    sansPoints: true,
    bonneReponse: true,
    lireParams(l) {
      if (!texte(l.question)) return { motif: 'question vide' };
      if (!texte(l.choix)) return { motif: 'choix vides : la bonne réponse doit en être un' };
      const sansHeure = !Array.isArray(l.actif_de) && texte(l.actif_de) === '';
      if (sansHeure) return { params: { actif_de: null, actif_a: null } };
      const de = lireHeure(l.actif_de);
      if (de === null) return { motif: `actif_de illisible : « ${texte(l.actif_de)} » (l’heure de l’instant, 10:00 ; vide = pas encore programmé)` };
      const aVide = !Array.isArray(l.actif_a) && texte(l.actif_a) === '';
      const a = aVide ? de + DUREE_INSTANT : lireHeure(l.actif_a);
      if (a === null) return { motif: `actif_a illisible : « ${texte(l.actif_a)} » (la fin de l’instant ; vide = ${DUREE_INSTANT} minutes)` };
      if (de >= a) return { motif: `actif_de (${texte(l.actif_de)}) doit être avant actif_a (${texte(l.actif_a)})` };
      return { params: { actif_de: de, actif_a: a } };
    },
    concerne: () => false,
    motif: () => '',
    // La réponse reçue à l'heure retenue `heure` : { motif } si elle ne compte pas, sinon
    // { juste }. `reponse` : la ligne D1 de l'instant.
    repondre(defi, preuve, { heure, reponse }) {
      if (!reponse) return { motif: 'bonne réponse non saisie' };
      const phase = phaseAnnonce(defi, heure);
      if (phase === 'a-venir') return { motif: 'pas encore ouvert' };
      if (phase === 'close') return { motif: 'instant fermé' };
      if (!Number.isInteger(preuve.choix) || !defi.choix[preuve.choix]) return { motif: 'réponse attendue' };
      return { juste: normaliser(defi.choix[preuve.choix]) === normaliser(reponse.bonne) };
    },
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
  // Une question à choix, souvent derrière un QR spécial (défi 7, Parcoursup). La
  // question et les choix sont publics (colonnes `question`, `choix`) ; la bonne
  // réponse et le jeton du QR vivent dans D1 (`bin/jeu.sh reponse`), jamais dans le
  // tableur (ADR-0016). `essais` (2 par défaut) : les mauvaises réponses permises ;
  // `qr_requis` (oui par défaut) : sans le jeton du QR, la réponse ne vaut rien.
  // Aucune fiche d'exposant ne la propose : elle a son propre écran (`#/question`).
  reponse: {
    bonneReponse: true,
    lireParams(l) {
      if (!texte(l.question)) return { motif: 'question vide' };
      if (!texte(l.choix)) return { motif: 'choix vides : la bonne réponse doit en être un' };
      const brut = texte(l.essais);
      const essais = brut ? Number(brut) : ESSAIS_PAR_DEFAUT;
      if (!Number.isInteger(essais) || essais < 1 || essais > 5) return { motif: `essais illisibles : « ${brut} » (de 1 à 5)` };
      return { params: { essais, qr: !non(l.qr_requis) } };
    },
    concerne: () => false,
    motif: () => '',
    // Pourquoi cette réponse ne vaut pas ('' si elle vaut). `reponse` : la ligne D1
    // du défi ; `ratees` : les mauvaises réponses déjà reçues de ce Passeport. Ni le
    // mauvais QR ni une réponse absente ne coûtent d'essai.
    verifier(defi, preuve, { reponse, ratees }) {
      if (!reponse) return 'bonne réponse non saisie';
      if (defi.params.qr && preuve.secret !== reponse.jeton) return 'pas le QR de la question';
      if (ratees >= defi.params.essais) return 'essais épuisés';
      if (!Number.isInteger(preuve.choix) || !defi.choix[preuve.choix]) return 'réponse attendue';
      return normaliser(defi.choix[preuve.choix]) === normaliser(reponse.bonne) ? '' : MAUVAISE_REPONSE;
    },
  },
  // Deux votes autour d'un Événement du Programme (défi 8, la table ronde « Faut-il
  // avoir peur de l'IA ? »), sans scan : un « avant », jusqu'à `tolerance_avant`
  // minutes après le début prévu (15), un « après », dès `tolerance_apres` minutes
  // avant la fin prévue (10). L'Événement est désigné par son titre (colonne
  // `evenement`) ; ses heures viennent du Programme (lireJeu, option `evenements`),
  // pour qu'un retard corrigé dans le tableur déplace les fenêtres. La question et
  // les choix (obligatoires) sont publics ; chaque vote s'enregistre à part, sans
  // le téléphone (l'avis de la salle, avant et après).
  'votes-evenement': {
    lireParams(l) {
      const evenement = texte(l.evenement);
      if (!evenement) return { motif: 'evenement vide : le titre d’un Événement du programme' };
      if (!texte(l.question)) return { motif: 'question vide' };
      if (!texte(l.choix)) return { motif: 'choix vides : un vote se fait parmi des choix' };
      const params = { evenement };
      for (const [col, defaut] of [['tolerance_avant', TOLERANCE_AVANT_PAR_DEFAUT], ['tolerance_apres', TOLERANCE_APRES_PAR_DEFAUT]]) {
        const brut = texte(l[col]);
        const n = brut ? Number(brut) : defaut;
        if (!Number.isInteger(n) || n < 0 || n > 120) return { motif: `${col} illisible : « ${brut} » (minutes, de 0 à 120)` };
        params[col] = n;
      }
      return { params };
    },
    concerne: () => false,
    motif: () => '',
    // Le vote reçu à l'heure `heure` (l'heure retenue, ms) : { moment, complet } s'il
    // compte (`complet` : il fait la paire avec un vote déjà reçu), { motif } sinon.
    // `votes` : les moments déjà reçus de ce Passeport pour ce défi.
    voter(defi, preuve, { heure, votes }) {
      // Sans le programme, aucun jugement : une erreur (le Worker répond 5xx, le téléphone
      // renverra), jamais un refus définitif écrit dans D1.
      if (!Number.isInteger(defi.params.debut)) throw new Error('heures de l’événement inconnues : lireJeu sans le programme');
      if (!Number.isInteger(preuve.choix) || !defi.choix[preuve.choix]) return { motif: 'choix attendu' };
      const moment = momentDuVote(defi, heure);
      if (!moment) return { motif: 'entre les deux votes' };
      if (votes.has(moment)) return { motif: `déjà voté ${moment}` };
      return { moment, complet: votes.has(moment === 'avant' ? 'apres' : 'avant') };
    },
  },
};

// Les deux moments d'un vote : le Worker les écrit dans `validations.motif` d'un vote
// compté et les renvoie au téléphone. Ne pas les renommer pendant le jeu.
export const MOMENTS_VOTE = ['avant', 'apres'];

// Le stand attribué à un appareil pour un défi `scan-attribue` : { stand, nom }, ou
// null (pas de stands connus, pas d'appareil). Une empreinte de « défi:appareil »
// (FNV-1a, puis un mélange final pour répartir les derniers bits) modulo le nombre de
// stands. Ne pas la changer pendant le jeu, ni réordonner la liste : chacun
// changerait de stand. Répartition vérifiée sur 300 identifiants (tests/defis.test.mjs).
export function standAttribue(defi, appareil) {
  const stands = defi && defi.params && defi.params.stands;
  if (!Array.isArray(stands) || !stands.length || typeof appareil !== 'string' || !appareil) return null;
  return stands[empreinte32(`${defi.id}:${appareil}`) % stands.length];
}

function empreinte32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

// Où en est l'annonce d'un défi (Type à `annonce`) à l'instant `ms` : 'a-venir' (pas
// d'heure d'annonce, ou pas encore), 'ouverte' (jusqu'à `actif_a` compris, à la
// seconde), 'close'. À l'heure de Paris, sans la date (ADR-0020).
export function phaseAnnonce(defi, ms) {
  const { actif_de: de, actif_a: a } = (defi && defi.params) || {};
  if (!Number.isInteger(de) || !Number.isInteger(a) || !Number.isFinite(ms)) return 'a-venir';
  const m = Math.floor(minutesAParis(ms) * 60) / 60;
  if (m < de) return 'a-venir';
  return m <= a ? 'ouverte' : 'close';
}

// Ce défi vient-il par une annonce (le mystère, les instants gagnants) ?
export const parAnnonce = (defi) => Boolean(defi && TYPES_PREUVE[defi.type_preuve] && TYPES_PREUVE[defi.type_preuve].annonce);

// Les défis annoncés en ce moment (leurs id ; le mystère et les instants gagnants) : ce que le Worker joint à `?action=etat`,
// que les téléphones ouverts interrogent chaque minute.
export function annoncesDe(jeu, ms) {
  if (!jeu || !jeu.actif) return [];
  return jeu.defis.filter((d) => d.actif !== false && parAnnonce(d) && phaseAnnonce(d, ms) === 'ouverte').map((d) => d.id);
}

// Les minutes depuis minuit à Paris (fraction comprise) d'un instant en ms : les
// heures du Programme sont celles de Paris, quel que soit le fuseau du téléphone ou
// du Worker (UTC). Seule l'heure compte, pas le jour : le jeu est remis à zéro avant
// le festival et coupé après, et la recette se joue n'importe quel jour (ADR-0020).
const HEURE_PARIS = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export function minutesAParis(ms) {
  const p = Object.fromEntries(HEURE_PARIS.formatToParts(new Date(ms)).map(({ type, value }) => [type, Number(value)]));
  return p.hour * 60 + p.minute + p.second / 60; // à la seconde : 11:15:00,400 est encore 11:15:00
}

// Les fenêtres d'un défi `votes-evenement`, en minutes : « avant » jusqu'à
// `avantJusqua`, « après » dès `apresDes`, bornes comprises.
export function fenetresDe(defi) {
  const { debut, fin, tolerance_avant: ta, tolerance_apres: tp } = defi.params;
  return { avantJusqua: debut + ta, apresDes: fin - tp };
}

// Le moment d'un vote reçu à l'instant `ms` : 'avant', 'apres', ou null entre les deux.
export function momentDuVote(defi, ms) {
  const m = minutesAParis(ms);
  const { avantJusqua, apresDes } = fenetresDe(defi);
  // À la seconde près : 11:15:00 est encore « avant », 11:15:01 ne l'est plus.
  if (m <= avantJusqua) return 'avant';
  if (m >= apresDes) return 'apres';
  return null;
}

// Le motif qui compte un essai de question : le Worker compte ses refus ainsi motivés,
// dans D1. Ne pas le reformuler pendant le jeu : les essais déjà joués seraient oubliés.
export const MAUVAISE_REPONSE = 'mauvaise réponse';

// Les motifs d'une réponse à un instant gagnant (grand-defi 08), écrits dans
// `validations.motif` : le tirage ne prend que les `juste`. Jamais envoyés au téléphone.
// Ne pas les renommer pendant le jeu.
export const REPONSE_INSTANT = { juste: 'juste', faux: 'faux' };

// Ce défi rapporte-t-il des points et compte-t-il pour le badge ? Non pour un instant
// gagnant. Un défi sans Type connu (le barème du Tirage n'en porte pas) : oui.
// Ce défi a-t-il une bonne réponse dans D1 (`reponses`, portée par le Push) ? Une question,
// un instant gagnant.
export const aBonneReponse = (defi) => Boolean(TYPES_PREUVE[defi && defi.type_preuve] && TYPES_PREUVE[defi.type_preuve].bonneReponse);
export const avecPoints = (defi) => !(TYPES_PREUVE[defi && defi.type_preuve] && TYPES_PREUVE[defi.type_preuve].sansPoints);

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
// par des espaces s'il n'y en a pas ; les mots se traduisent un par un), et une
// `explication` montrée après le verdict d'une question (grand-defi 04). Le choix part au Worker par son numéro,
// jamais comme un texte (ADR-0014).
const CHOIX_MAX = 6;
export const LONGUEUR_CHOIX_MAX = 16;
// Découper la cellule `choix` : points-virgules s'il y en a, espaces sinon. Partagé
// avec le contrôle des traductions (bin/lib/publication.mjs) ; le traducteur Apps
// Script (script/Code.js, decouperChoix) fait de même.
export function decouperChoix(valeur) {
  const brut = texte(valeur);
  return brut ? brut.split(brut.includes(';') ? ';' : /\s+/).map((c) => c.trim()).filter(Boolean) : [];
}

function lireChoix(valeur) {
  const brut = texte(valeur);
  if (!brut) return { choix: [] };
  const choix = decouperChoix(brut);
  if (choix.length < 2 || choix.length > CHOIX_MAX) return { motif: `choix : de 2 à ${CHOIX_MAX}, et non ${choix.length}` };
  if (choix.some((c) => c.length > LONGUEUR_CHOIX_MAX)) return { motif: `choix trop longs (${LONGUEUR_CHOIX_MAX} caractères au plus)` };
  return { choix };
}

// `paliers` : « 100, 130, 160 » (virgules, points-virgules ou espaces), rangés dans
// l'ordre ; le premier est l'objectif de la jauge. Vide : 100. Illisible : 100 aussi,
// et le motif, pour l'onglet État.
function lirePaliers(valeur) {
  const brut = texte(valeur);
  if (!brut) return { paliers: [OBJECTIF_PAR_DEFAUT] };
  const nombres = brut.split(/[;,\s]+/).filter(Boolean).map(Number);
  if (!nombres.every((n) => Number.isInteger(n) && n > 0 && n <= 10000)) return { paliers: [OBJECTIF_PAR_DEFAUT], motif: `paliers illisibles : « ${brut} »` };
  return { paliers: [...new Set(nombres)].sort((a, b) => a - b) };
}

// `chances_badge` : les Chances qu'ajoute le badge « Explorateur 100 % ». Vide : 1.
function lireChancesBadge(valeur) {
  const brut = texte(valeur);
  if (!brut) return { chances: CHANCES_BADGE_PAR_DEFAUT };
  const n = Number(brut);
  if (!Number.isInteger(n) || n < 0 || n > 100) return { chances: CHANCES_BADGE_PAR_DEFAUT, motif: `chances_badge illisible : « ${brut} »` };
  return { chances: n };
}

// `grands_lots` : le nombre de Grands lots du Tirage final (grand-defi 07). Vide : 0,
// et bin/jeu.sh tirer refuse de tirer.
function lireGrandsLots(valeur) {
  const brut = texte(valeur);
  if (!brut) return { lots: 0 };
  const n = Number(brut);
  if (!Number.isInteger(n) || n < 0 || n > 100) return { lots: 0, motif: `grands_lots illisible : « ${brut} »` };
  return { lots: n };
}

// `delai_lot_flash` (grand-defi 08) : les minutes qu'a le gagnant d'un instant pour venir
// à l'accueil. Vide : jusqu'à l'heure du tirage (`heure_tirage`, 13 h).
function lireDelaiFlash(valeur) {
  const brut = texte(valeur);
  if (!brut) return { delai: null };
  const n = Number(brut);
  if (!Number.isInteger(n) || n < 1 || n > 240) return { delai: null, motif: `delai_lot_flash illisible : « ${brut} » (minutes, de 1 à 240 ; vide = jusqu’à l’heure du tirage)` };
  return { delai: n };
}

// `lots_flash_max` : les Lots flash qu'un même téléphone peut gagner. Vide : 1.
function lireLotsFlashMax(valeur) {
  const brut = texte(valeur);
  if (!brut) return { max: LOTS_FLASH_MAX_PAR_DEFAUT };
  const n = Number(brut);
  if (!Number.isInteger(n) || n < 1 || n > 20) return { max: LOTS_FLASH_MAX_PAR_DEFAUT, motif: `lots_flash_max illisible : « ${brut} » (de 1 à 20)` };
  return { max: n };
}

// Les onglets `Défis` et `Infos` (tables brutes, première ligne = en-têtes) → le jeu.
// `defis` garde aussi les défis désactivés (leurs points comptent toujours) ;
// `invalides` liste ce qui a été écarté, avec le motif.
export function lireJeu(tableDefis, tableInfos, { exposants = null, evenements = null } = {}) {
  const infos = {};
  for (const l of tablesEnObjets(tableInfos)) infos[normaliser(l.cle).replace(/-/g, '_')] = l.valeur;
  const { paliers, motif: motifPaliers } = lirePaliers(infos.paliers);
  const { chances: chancesBadge, motif: motifBadge } = lireChancesBadge(infos.chances_badge);
  const { lots: grandsLots, motif: motifLots } = lireGrandsLots(infos.grands_lots);
  const { delai: delaiFlash, motif: motifDelai } = lireDelaiFlash(infos.delai_lot_flash);
  const { max: lotsFlashMax, motif: motifMax } = lireLotsFlashMax(infos.lots_flash_max);
  // L'heure du grand tirage, texte libre pour la règle (« 13 h ») : illisible, 13 h.
  // Elle borne aussi l'attente d'un Lot flash sans délai : illisible, elle est signalée.
  const heureLue = lireHeure(infos.heure_tirage);
  const heureTirage = heureLue ?? HEURE_TIRAGE_PAR_DEFAUT;
  const jeu = { actif: oui(infos.grand_defi), objectif: paliers[0], paliers, chances_badge: chancesBadge, grands_lots: grandsLots, delai_lot_flash: delaiFlash, lots_flash_max: lotsFlashMax, heure_tirage: heureTirage, defis: [], invalides: [] };
  if (motifPaliers) jeu.invalides.push({ id: 'paliers', motif: motifPaliers });
  if (motifBadge) jeu.invalides.push({ id: 'chances_badge', motif: motifBadge });
  if (motifLots) jeu.invalides.push({ id: 'grands_lots', motif: motifLots });
  if (motifDelai) jeu.invalides.push({ id: 'delai_lot_flash', motif: motifDelai });
  if (motifMax) jeu.invalides.push({ id: 'lots_flash_max', motif: motifMax });
  if (heureLue === null && texte(infos.heure_tirage)) jeu.invalides.push({ id: 'heure_tirage', motif: `heure_tirage illisible : « ${texte(infos.heure_tirage)} » (13 h, 13:00)` });
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
    if (!ID_DEFI.test(id)) { ecarter('identifiant illisible (lettres, chiffres, tirets)'); continue; }
    if (vus.has(id)) { ecarter('identifiant en double'); continue; }
    vus.add(id);
    const type = TYPES_PREUVE[normaliser(l.type_preuve)];
    // Un instant gagnant ne rapporte rien : points vides ou 0.
    const points = texte(l.points) === '' ? (type && type.sansPoints ? 0 : NaN) : Number(l.points);
    if (!Number.isInteger(points) || points < 0 || points > 1000) { ecarter(`points illisibles : « ${texte(l.points)} »`); continue; }
    if (!type) { ecarter(`type de preuve inconnu : « ${texte(l.type_preuve)} »`); continue; }
    if (type.sansPoints && points !== 0) { ecarter(`un instant gagnant ne rapporte pas de points : 0 ou vide, et non ${points}`); continue; }
    const { params, motif } = type.lireParams(l);
    if (motif) { ecarter(motif); continue; }
    const different = texte(l.different_de);
    if (different) {
      if (different === id) { ecarter('different_de : le défi lui-même'); continue; }
      params.different_de = different;
    }
    const { choix, motif: motifChoix } = lireChoix(l.choix);
    if (motifChoix) { ecarter(motifChoix); continue; }
    jeu.defis.push({ id, titre: texte(l.titre), points, type_preuve: normaliser(l.type_preuve), actif: !non(l.actif), params, question: texte(l.question), choix, explication: texte(l.explication) });
  }
  // Ce qui se vérifie seulement une fois toutes les lignes lues : le défi désigné
  // par `different_de` existe ; le stand désigné est au programme, l'Événement d'un
  // vote aussi, avec ses heures (quand le programme est fourni).
  const ids = new Set(jeu.defis.map((d) => d.id));
  jeu.defis = jeu.defis.filter((d) => {
    let motif = '';
    if (d.params.different_de && !ids.has(d.params.different_de)) motif = `different_de : défi ${d.params.different_de} introuvable`;
    else if (d.type_preuve === 'scan-stand' && exposants) {
      const r = resoudreStand({ stand: d.params.stand, nom: d.params.nom_stand }, exposants);
      if (r.motif) motif = r.motif;
      else d.params.stand = r.cle;
    } else if (d.type_preuve === 'votes-evenement' && evenements) motif = placerVotes(d, evenements);
    else if (d.type_preuve === 'scan-attribue' && exposants) {
      const resolus = d.params.stands.map((s) => ({ s, r: resoudreStand(s, exposants) }));
      const absents = resolus.filter(({ r }) => r.motif);
      if (absents.length) motif = absents.map(({ r }) => r.motif).join(' ; ');
      else for (const { s, r } of resolus) s.stand = r.cle;
    }
    if (motif) jeu.invalides.push({ id: d.id, motif });
    return !motif;
  });
  return jeu;
}

// Un stand désigné dans le tableur ({ stand, nom } de lireStand) cherché au programme
// ([{ cle, nom, typeSlug }]) : par son nom (quel que soit le type), ou par `type:nom`.
// La clé d'un Exposant est son id (ADR-0023) et ne dit plus rien de son nom : c'est ici,
// une fois, que le nom devient la clé, pour que le téléphone et le Worker comparent des
// clés. Rend { cle } ou { motif }. Une ancienne clé (`type:nom`, sans id) se reconnaît encore.
function resoudreStand(s, exposants) {
  const [type, ...reste] = s.stand.split(':');
  const parNom = reste.length
    ? (e) => e.typeSlug === type && normaliser(e.nom) === reste.join(':')
    : (e) => normaliser(e.nom) === s.stand;
  const cles = [...new Set(exposants.filter((e) => parNom(e) || standCorrespond(s.stand, e.cle)).map((e) => e.cle))];
  if (!cles.length) return { motif: `stand introuvable au programme : ${s.nom}` };
  if (cles.length > 1) return { motif: `stand ambigu : ${s.nom} désigne ${cles.length} exposants (écrire le type, « Entreprise:${s.nom} »)` };
  return { cle: cles[0] };
}

// L'Événement d'un défi `votes-evenement` cherché au programme par son titre (casse,
// accents et espaces ignorés) : ses heures entrent dans les paramètres du défi. Rend
// le motif qui l'écarte, '' s'il est placé.
function placerVotes(defi, evenements) {
  const memes = evenements.filter((e) => normaliser(e.titre) === normaliser(defi.params.evenement));
  if (!memes.length) return `événement introuvable au programme : ${defi.params.evenement}`;
  if (memes.length > 1) return `événement au programme ${memes.length} fois : ${defi.params.evenement} (un titre unique pour le vote)`;
  const [ev] = memes;
  if (!Number.isInteger(ev.debut) || !Number.isInteger(ev.fin)) return `événement sans heure de début ou de fin : ${ev.titre}`;
  Object.assign(defi.params, { evenement: ev.titre, debut: ev.debut, fin: ev.fin });
  const { avantJusqua, apresDes } = fenetresDe(defi);
  if (apresDes <= avantJusqua) return `fenêtres de vote qui se chevauchent : l’événement dure ${ev.fin - ev.debut} min, les tolérances ${defi.params.tolerance_avant} + ${defi.params.tolerance_apres}`;
  return '';
}

// Les bonnes réponses (D1 : défi → { bonne, jeton }) confrontées aux questions du
// tableur (et aux instants gagnants, grand-defi 08) : une question sans bonne réponse saisie, ou dont la bonne réponse n'est
// plus parmi ses choix (choix réécrits), est écartée et signalée, jamais proposée.
// La comparaison ignore casse, accents et espaces. Rend { jeu, reponses }.
export function avecReponses(jeu, reponses = new Map()) {
  const invalides = [];
  const defis = jeu.defis.filter((d) => {
    if (!aBonneReponse(d)) return true;
    const r = reponses.get(d.id);
    if (!r) invalides.push({ id: d.id, motif: 'bonne réponse non saisie (Gestion, Défis, colonne bonne_reponse, puis Push)' });
    // Sans citer la réponse : `invalides` est public (GET ?action=jeu).
    else if (!d.choix.some((c) => normaliser(c) === normaliser(r.bonne))) invalides.push({ id: d.id, motif: 'bonne réponse absente des choix (Gestion, colonne bonne_reponse, puis Push)' });
    else return true;
    return false;
  });
  return { jeu: { ...jeu, defis, invalides: [...jeu.invalides, ...invalides] }, reponses };
}

// Ce que le téléphone reçoit : les défis actifs et leurs réglages publics. Sans
// défi actif, pas de jeu à l'écran. Un défi à annonce (le mystère) pas encore annoncé
// à `maintenant` (ms) ne dit que son titre et ses points : ni stands, ni heures.
export function jeuPublic(jeu, { maintenant = null } = {}) {
  const cache = (d) => parAnnonce(d) && (maintenant === null || phaseAnnonce(d, maintenant) === 'a-venir');
  const defis = jeu.defis.filter((d) => d.actif).map(({ actif, ...d }) => (cache(d) ? { ...d, params: { a_venir: true }, question: '', choix: [], explication: '' } : d));
  return { actif: jeu.actif && defis.length > 0, objectif: jeu.objectif, paliers: jeu.paliers, chances_badge: jeu.chances_badge, defis };
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
// Un vote (`votes-evenement`) : `heure`, l'heure retenue de la validation (ms) ;
// `votes`, les moments déjà reçus de ce Passeport, par défi (Map défi → Set). Le
// premier vote reçu a le statut `vote` (compté, pas encore de point), celui qui fait
// la paire `ok` ; les deux portent leur `moment`.
// Le défi mystère (`scan-attribue`) : `appareil`, le Passeport qui envoie ; jugé à `heure`.
// Un instant gagnant (`instant`) : statut `ok` et motif `juste` | `faux`, jugé à `heure`.
export function juger(v, { jeu, exposant = null, scans = [], faits = new Set(scans.map((s) => s.defi)), domainesDe = null, reponses = new Map(), ratees = new Map(), heure = v.t, votes = new Map(), appareil = '' }) {
  const refus = (motif) => ({ statut: 'refus', motif, choix: null });
  if (!jeu.actif) return refus('jeu coupé');
  const defi = jeu.defis.find((d) => d.id === v.defi && d.actif);
  if (!defi) return refus('défi inconnu ou inactif');
  const { verifier, voter, repondre } = TYPES_PREUVE[defi.type_preuve];
  // Un instant gagnant : la réponse est enregistrée, juste ou non, le motif le dit au
  // tirage (jamais au téléphone).
  if (repondre) {
    if (faits.has(defi.id)) return { statut: 'deja', motif: '', choix: null };
    const r = repondre(defi, v.preuve || {}, { heure, reponse: reponses.get(defi.id) || null });
    if (r.motif) return refus(r.motif);
    return { statut: 'ok', motif: r.juste ? REPONSE_INSTANT.juste : REPONSE_INSTANT.faux, choix: null, libelle: '' };
  }
  if (voter) {
    if (faits.has(defi.id)) return { statut: 'deja', motif: '', choix: null };
    const preuve = v.preuve || {};
    const r = voter(defi, preuve, { heure, votes: votes.get(defi.id) || new Set() });
    if (r.motif) return refus(r.motif);
    return { statut: r.complet ? 'ok' : 'vote', motif: '', choix: preuve.choix, libelle: defi.choix[preuve.choix], moment: r.moment };
  }
  // Un Type qui se prouve sans Exposant (la question) vérifie sa preuve lui-même.
  if (verifier) {
    if (faits.has(defi.id)) return { statut: 'deja', motif: '', choix: null };
    const motif = verifier(defi, v.preuve || {}, { reponse: reponses.get(defi.id) || null, ratees: ratees.get(defi.id) || 0 });
    return motif ? refus(motif) : { statut: 'ok', motif: '', choix: null, libelle: '' };
  }
  if (!v.preuve || !v.preuve.secret) return refus('preuve attendue');
  if (!exposant) return refus('secret inconnu');
  if (!proposable(defi, exposant)) return refus({ 'scan-stand': 'pas le stand du défi', 'scan-attribue': 'pas un stand du défi' }[defi.type_preuve] || 'exposant d’un autre type');
  if (faits.has(defi.id)) return { statut: 'deja', motif: '', choix: null };
  const motif = motifIci(defi, { jeu, exposant, scans, domainesDe, appareil, heure });
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

// Les Paliers et les Chances du badge d'un jeu, ou leurs valeurs par défaut (un jeu
// d'avant grand-defi 03 n'a que son objectif).
export const paliersDe = (jeu) => (jeu.paliers && jeu.paliers.length ? jeu.paliers : [jeu.objectif || OBJECTIF_PAR_DEFAUT]);
export const chancesBadgeDe = (jeu) => (Number.isInteger(jeu.chances_badge) ? jeu.chances_badge : CHANCES_BADGE_PAR_DEFAUT);

// Les Chances d'un Passeport au Tirage (grand-defi 03) : une par Palier atteint, et
// celles du badge « Explorateur 100 % » quand tous les défis ACTIFS sont validés (un
// défi désactivé sort de la condition, un instant gagnant n'y entre pas). Rien avant le premier Palier : 100 points
// font entrer au Tirage, le badge seul non. `manque` : les points jusqu'au prochain
// Palier, null au-delà du dernier. `jeu` : le jeu lu ou le jeu public.
export function chancesDe(points, idsValides, jeu) {
  const paliers = paliersDe(jeu);
  const faits = new Set(idsValides);
  const actifs = jeu.defis.filter((d) => d.actif !== false && avecPoints(d));
  const badge = actifs.length > 0 && actifs.every((d) => faits.has(d.id));
  const auTirage = points >= paliers[0];
  const chances = auTirage ? paliers.filter((p) => p <= points).length + (badge ? chancesBadgeDe(jeu) : 0) : 0;
  const prochain = paliers.find((p) => p > points);
  return { auTirage, chances, badge, manque: prochain === undefined ? null : prochain - points };
}
