// Module Passeport : le Grand Défi vu du téléphone (ADR-0014). Logique pure ; le
// réseau, l'horloge et les minuteurs sont injectés. Le téléphone ESTIME, le
// Worker CONFIRME : une validation reste « en attente » jusqu'à ce que la réponse
// du Worker la montre traitée, et la file la renvoie jusque-là.
// L'état vit dans Ma visite (clé `jeu`, schéma 3 de visite.js) :
//   { validations: [{ id, defi, exposant, t, preuve: { secret, choix? }, statut, essai? }], passeport: { points, defis } | null }
// `essai` : une mauvaise réponse à une question, dite par le Worker (grand-defi 04).
// statut : attente | ok | deja | refus.
import { proposable, motifIci, chancesDe, OBJECTIF_PAR_DEFAUT, CHANCES_BADGE_PAR_DEFAUT } from './defis.js';

const STATUTS = ['attente', 'ok', 'deja', 'refus'];
const texte = (v) => typeof v === 'string';

export function etatJeuInitial() {
  return { validations: [], passeport: null };
}

// La preuve qui part au Worker : le secret du QR, et le numéro d'un choix. Rien
// d'autre, même relu d'un stockage abîmé : le Worker refuserait la salve (400).
function preuve(secret, choix) {
  return { ...(texte(secret) && secret ? { secret } : {}), ...(Number.isInteger(choix) && choix >= 0 ? { choix } : {}) };
}

// Lecture tolérante de ce qui dort dans le téléphone : on garde ce qui se lit.
export function migrerJeu(brut) {
  const e = etatJeuInitial();
  if (!brut || typeof brut !== 'object') return e;
  e.validations = (Array.isArray(brut.validations) ? brut.validations : [])
    .filter((v) => v && texte(v.id) && texte(v.defi) && v.preuve && typeof v.preuve === 'object')
    .map((v) => ({ id: v.id, defi: v.defi, exposant: texte(v.exposant) ? v.exposant : '', t: Number(v.t) || 0, preuve: preuve(v.preuve.secret, v.preuve.choix), statut: STATUTS.includes(v.statut) ? v.statut : 'attente', ...(v.essai === true ? { essai: true } : {}) }));
  const p = brut.passeport;
  if (p && typeof p === 'object') e.passeport = { points: Number(p.points) || 0, defis: (Array.isArray(p.defis) ? p.defis : []).filter(texte) };
  return e;
}

// Le jeu public reçu du Worker (ou du cache local), vérifié avant d'être cru.
export function lireJeuPublic(rep) {
  if (!rep || typeof rep !== 'object' || !Array.isArray(rep.defis)) return null;
  const defis = rep.defis.filter((d) => d && texte(d.id) && texte(d.titre) && Number.isFinite(d.points) && texte(d.type_preuve) && d.params && typeof d.params === 'object')
    .map((d) => ({ ...d, question: texte(d.question) ? d.question : '', choix: Array.isArray(d.choix) && d.choix.every(texte) ? d.choix : [], explication: texte(d.explication) ? d.explication : '' }));
  const objectif = Number(rep.objectif) > 0 ? Number(rep.objectif) : OBJECTIF_PAR_DEFAUT;
  // Un Worker d'avant les Paliers (grand-defi 03), ou des Paliers abîmés : l'objectif seul.
  const paliersLisibles = Array.isArray(rep.paliers) && rep.paliers.length && rep.paliers.every((p, i) => Number.isInteger(p) && p > 0 && (i === 0 || p > rep.paliers[i - 1]));
  const chancesBadge = Number.isInteger(rep.chances_badge) && rep.chances_badge >= 0 ? rep.chances_badge : CHANCES_BADGE_PAR_DEFAUT;
  return { actif: rep.actif === true, objectif, paliers: paliersLisibles ? rep.paliers : [objectif], chances_badge: chancesBadge, defis };
}

// L'adresse du Worker. Devant `npm run servir` (la machine, ou un téléphone du
// même wifi), c'est le Worker local qu'il sert à côté de l'appli, sur sa base en
// mémoire : on ne joue jamais contre la vraie base depuis un poste de développement.
export function urlJeu(hote, configure) {
  const local = /^(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(String(hote || ''));
  return local ? './jeu' : (configure || '');
}

export function nouvelleValidation({ id, defi, exposant, secret, choix, t }) {
  return { id, defi, exposant, t, preuve: preuve(secret, choix), statut: 'attente' };
}

export function ajouterValidation(etat, v) {
  return { ...etat, validations: [...etat.validations, v] };
}

export function enAttente(etat) {
  return etat.validations.filter((v) => v.statut === 'attente');
}

// La réponse du Worker fait foi : les validations qu'elle montre traitées prennent
// leur statut, les autres restent en attente ; les points sont les siens.
export function appliquerReponse(etat, passeport) {
  if (!passeport || !Array.isArray(passeport.traitees)) return etat;
  const traitees = new Map(passeport.traitees.filter((x) => Array.isArray(x) && STATUTS.includes(x[1])).map(([id, statut, marque]) => [id, { statut, ...(marque === 'essai' ? { essai: true } : {}) }]));
  return {
    validations: etat.validations.map((v) => (traitees.has(v.id) ? { ...v, ...traitees.get(v.id) } : v)),
    passeport: { points: Number(passeport.points) || 0, defis: (passeport.defis || []).filter(texte) },
  };
}

// Une salve refusée pour de bon (réponse 400) : ses validations ne repartiront pas.
export function refuser(etat, ids) {
  const s = new Set(ids);
  return { ...etat, validations: etat.validations.map((v) => (s.has(v.id) && v.statut === 'attente' ? { ...v, statut: 'refus' } : v)) };
}

// valide | attente | refuse | a-faire. `essais` : une question (grand-defi 04) n'est
// « refusée » qu'une fois tous ses essais joués (les refus que le Worker dit `essai`) ;
// un scan refusé l'est tout de suite. Sans `essais`, un scan.
export function statutDefi(etat, defi, essais = null) {
  const miennes = etat.validations.filter((v) => v.defi === defi);
  if ((etat.passeport && etat.passeport.defis.includes(defi)) || miennes.some((v) => v.statut === 'ok' || v.statut === 'deja')) return 'valide';
  if (miennes.some((v) => v.statut === 'attente')) return 'attente';
  const refus = miennes.filter((v) => v.statut === 'refus' && (essais === null || v.essai));
  if (refus.length && refus.length >= (essais || 1)) return 'refuse';
  return 'a-faire';
}

const essaisDe = (defi) => (defi.type_preuve === 'reponse' && Number.isInteger(defi.params.essais) ? defi.params.essais : null);

// L'écran d'une question (grand-defi 04), ou null si ce défi n'en est pas une.
// statut : ouvert | attente (une réponse envoyée attend son verdict : pas d'autre
// essai d'ici là) | valide | ferme (tous les essais joués). `essai` : le numéro de
// l'essai en cours, « essai 1 sur 2 », compté sur les refus que le Worker a dits
// `essai` (un mauvais QR ne coûte rien). `peutRepondre` : ouvert, et le jeton du QR
// spécial en main s'il est requis (`jeton` : celui de la route).
export function questionIci(jeu, etat, id, { jeton = '' } = {}) {
  const defi = jeu && jeu.actif ? jeu.defis.find((d) => d.id === id && d.type_preuve === 'reponse') : null;
  if (!defi) return null;
  const essais = essaisDe(defi);
  const ratees = etat.validations.filter((v) => v.defi === id && v.statut === 'refus' && v.essai).length;
  const s = statutDefi(etat, id, essais);
  const statut = s === 'valide' ? 'valide' : s === 'attente' ? 'attente' : s === 'refuse' ? 'ferme' : 'ouvert';
  return { defi, statut, essais, essai: Math.min(ratees + 1, essais), peutRepondre: statut === 'ouvert' && Boolean(jeton || !defi.params.qr) };
}

// Sur une fiche ouverte par le QR d'une Carte : les défis que cet Exposant peut
// prouver. Un défi refusé sur ce stand-ci n'y est pas reproposé (le Worker
// refuserait encore) ; un autre stand peut le valider. `chez` : l'Exposant où un
// défi validé a été gagné (la fiche d'une 2e école le dit, au lieu de « Validé »).
// `raison` : pourquoi un défi à faire ne vaut pas ici, estimé avec les règles du
// Worker (defis.js) sur les scans de ce téléphone, validés ou en attente — l'école
// du défi 1 pour le défi 2, un domaine déjà croisé pour le défi 9.
export function defisIci(jeu, etat, exposant, { domainesDe = () => [] } = {}) {
  if (!jeu || !jeu.actif) return [];
  const scans = etat.validations.filter((v) => (v.statut === 'ok' || v.statut === 'attente') && v.exposant).map((v) => ({ defi: v.defi, exposant: v.exposant }));
  return jeu.defis.filter((d) => proposable(d, exposant)).map((defi) => {
    const statut = statutDefi(etat, defi.id);
    const refuseIci = etat.validations.some((v) => v.defi === defi.id && v.exposant === exposant && v.statut === 'refus');
    const gagnee = etat.validations.find((v) => v.defi === defi.id && v.statut === 'ok');
    const libre = statut === 'a-faire' || (statut === 'refuse' && !refuseIci);
    const raison = libre ? motifIci(defi, { jeu, exposant, scans, domainesDe }) : '';
    return { defi, statut, validable: libre && !raison, raison, chez: gagnee ? gagnee.exposant || null : null };
  });
}

// L'écran « Mes défis » : chaque défi actif, dans l'ordre du tableur, et son état.
export function mesDefis(jeu, etat) {
  if (!jeu || !jeu.actif) return [];
  return jeu.defis.map((defi) => ({ defi, statut: statutDefi(etat, defi.id, essaisDe(defi)) }));
}

// La jauge de l'accueil, ou null : pas de jeu, ou pas encore joué (un Visiteur
// qui ne joue pas voit l'appli ordinaire). `attente` = les points des défis
// envoyés et pas encore confirmés. Les Chances (chancesDe) se comptent sur ce que
// le Worker a confirmé, comme les points.
export function jauge(jeu, etat) {
  if (!jeu || !jeu.actif || !etat.validations.length) return null;
  const points = etat.passeport ? etat.passeport.points : 0;
  const attente = jeu.defis.filter((d) => statutDefi(etat, d.id, essaisDe(d)) === 'attente').reduce((s, d) => s + d.points, 0);
  return { points, attente, objectif: jeu.objectif, ...chancesDe(points, etat.passeport ? etat.passeport.defis : [], jeu) };
}

// La file d'envoi. `envoyer(lot)` → { ok, passeport } | { ok: false, definitif }.
// Un échec replanifie avec un délai qui double jusqu'à `delaiMax` ; un succès le
// remet à zéro ; `envoyer()` appelé de l'extérieur (retour du réseau, retour au
// premier plan, nouvelle validation) part tout de suite.
export function creerEnvoi({ envoyer, obtenir, modifier, planifier = setTimeout, annuler = clearTimeout, delaiInitial = 2000, delaiMax = 300000, taille = 20 }) {
  let delai = delaiInitial;
  let minuteur = null;
  let enCours = false;

  async function envoyerMaintenant() {
    if (minuteur !== null) { annuler(minuteur); minuteur = null; }
    if (enCours) return;
    const lot = enAttente(obtenir()).slice(0, taille);
    if (!lot.length) { delai = delaiInitial; return; }
    enCours = true;
    let r;
    try { r = await envoyer(lot.map(({ id, defi, t, preuve }) => ({ id, defi, t, preuve }))); } catch { r = null; }
    enCours = false;
    let attendre = 0;
    if (r && r.ok) { modifier(appliquerReponse(obtenir(), r.passeport)); delai = delaiInitial; }
    else if (r && r.definitif) { modifier(refuser(obtenir(), lot.map((v) => v.id))); delai = delaiInitial; }
    else { attendre = delai; delai = Math.min(delai * 2, delaiMax); }
    // Encore des validations en attente après un succès : le Worker ne les a pas
    // toutes rendues ; on réessaie, sans marteler.
    const reste = enAttente(obtenir());
    if (reste.length) {
      if (!attendre && reste.some((v) => lot.some((l) => l.id === v.id))) { attendre = delai; delai = Math.min(delai * 2, delaiMax); }
      minuteur = planifier(envoyerMaintenant, attendre);
    }
  }

  return { envoyer: envoyerMaintenant, delaiCourant: () => delai };
}

// Rejouer depuis le début (essai du Grand Défi, grand-defi 11) : seulement quand le
// classeur servi le permet (`Infos.rejouer` = oui). Posé dans le classeur d'essai,
// jamais dans Gestion : à la bascule, le bouton disparaît seul.
export function rejouerOuvert(infos) {
  return /^(oui|yes|1|vrai|true)$/i.test(String((infos && infos.rejouer) || '').trim());
}

