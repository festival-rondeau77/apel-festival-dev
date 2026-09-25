// Module Passeport : le Grand Défi vu du téléphone (ADR-0014). Logique pure ; le
// réseau, l'horloge et les minuteurs sont injectés. Le téléphone ESTIME, le
// Worker CONFIRME : une validation reste « en attente » jusqu'à ce que la réponse
// du Worker la montre traitée, et la file la renvoie jusque-là.
// L'état vit dans Ma visite (clé `jeu`, schéma 3 de visite.js) :
//   { validations: [{ id, defi, exposant, t, preuve: { secret, choix? }, statut, essai?, moment? }], passeport: { points, defis } | null }
// `essai` : une mauvaise réponse à une question, dite par le Worker (grand-defi 04).
// `moment` : avant | apres, la fenêtre où le Worker a compté un vote (grand-defi 05).
// statut : attente | ok | deja | refus | vote (un vote compté, sans point encore).
import { proposable, motifIci, chancesDe, momentDuVote, fenetresDe, minutesAParis, phaseAnnonce, standAttribue, parAnnonce, MOMENTS_VOTE, OBJECTIF_PAR_DEFAUT, CHANCES_BADGE_PAR_DEFAUT } from './defis.js';

const STATUTS = ['attente', 'ok', 'deja', 'refus', 'vote'];
// Ce que le Worker ajoute à une validation traitée (son 3e élément).
const marqueDe = (m) => (m === 'essai' ? { essai: true } : MOMENTS_VOTE.includes(m) ? { moment: m } : {});
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
    .map((v) => ({ id: v.id, defi: v.defi, exposant: texte(v.exposant) ? v.exposant : '', t: Number(v.t) || 0, preuve: preuve(v.preuve.secret, v.preuve.choix), statut: STATUTS.includes(v.statut) ? v.statut : 'attente', ...(v.essai === true ? { essai: true } : {}), ...marqueDe(v.moment) }));
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
  const traitees = new Map(passeport.traitees.filter((x) => Array.isArray(x) && STATUTS.includes(x[1])).map(([id, statut, marque]) => [id, { statut, ...marqueDe(marque) }]));
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

// L'état d'un défi dans Mes défis et la jauge, selon son Type. `maintenant` (ms) :
// sans lui, un vote n'est jamais dit perdu, ni un mystère fermé.
function statutDuDefi(defi, etat, maintenant = null) {
  if (parAnnonce(defi)) {
    // Le mystère (grand-defi 06) : un scan sur le mauvais stand ne le ferme pas ;
    // seule l'heure limite le fait. `a-venir` : pas encore annoncé.
    const s = statutDefi(etat, defi.id);
    if (s === 'valide' || s === 'attente') return s;
    if (defi.params.a_venir) return 'a-venir';
    return maintenant !== null && phaseAnnonce(defi, maintenant) === 'close' ? 'refuse' : 'a-faire';
  }
  if (defi.type_preuve !== 'votes-evenement') return statutDefi(etat, defi.id, essaisDe(defi));
  const { statut } = etatDesVotes(defi, etat, maintenant);
  return { valide: 'valide', attente: 'attente', ferme: 'refuse' }[statut] || 'a-faire';
}

// Les deux votes d'un défi `votes-evenement` vus du téléphone. Un vote compté a le
// moment que dit le Worker (l'heure retenue peut l'avoir déplacé) ; un vote envoyé,
// celui qu'estime son heure. Une fenêtre : fait | attente | ouverte | fermee |
// pas-encore (ces trois-là, seulement avec `maintenant`).
function etatDesVotes(defi, etat, maintenant) {
  const miennes = etat.validations.filter((v) => v.defi === defi.id);
  const valide = (etat.passeport && etat.passeport.defis.includes(defi.id)) || miennes.some((v) => v.statut === 'ok' || v.statut === 'deja');
  const { avantJusqua, apresDes } = Number.isInteger(defi.params.debut) ? fenetresDe(defi) : { avantJusqua: null, apresDes: null };
  const m = maintenant === null || avantJusqua === null ? null : minutesAParis(maintenant);
  const fenetre = (moment) => {
    const compte = miennes.find((v) => (v.statut === 'vote' || v.statut === 'ok') && v.moment === moment);
    const envoye = !compte && avantJusqua !== null && miennes.find((v) => v.statut === 'attente' && momentDuVote(defi, v.t) === moment);
    const vu = compte || envoye;
    let e = compte ? 'fait' : envoye ? 'attente' : null;
    if (!e && m !== null) e = moment === 'avant' ? (m <= avantJusqua ? 'ouverte' : 'fermee') : (m >= apresDes ? 'ouverte' : 'pas-encore');
    return { etat: e, choix: vu ? vu.preuve.choix : null };
  };
  const avant = fenetre('avant');
  const apres = fenetre('apres');
  const couvert = (f) => f.etat === 'fait' || f.etat === 'attente';
  let statut = 'ouvert';
  if (valide) statut = 'valide';
  else if (couvert(avant) && couvert(apres)) statut = 'attente';
  else if (avant.etat === 'fermee') statut = 'ferme';
  return { statut, avant: { ...avant, jusqua: avantJusqua }, apres: { ...apres, des: apresDes } };
}

// L'écran de vote (grand-defi 05), ou null si ce défi n'est pas un vote. statut :
// ouvert | attente (le second vote attend son verdict) | valide | ferme (la fenêtre
// « avant » est passée sans vote : le défi ne peut plus être validé). `fenetres` :
// { avant: { etat, choix, jusqua }, apres: { etat, choix, des } } (heures en minutes
// depuis minuit, à Paris). `peutVoter` : le moment d'un vote possible maintenant, ou null.
// `refuse` : le dernier vote envoyé a été refusé (à l'heure du serveur, hors fenêtre).
export function voteIci(jeu, etat, id, maintenant) {
  const defi = jeu && jeu.actif ? jeu.defis.find((d) => d.id === id && d.type_preuve === 'votes-evenement') : null;
  if (!defi) return null;
  const { statut, avant, apres } = etatDesVotes(defi, etat, maintenant);
  const peutVoter = statut === 'ouvert' ? (avant.etat === 'ouverte' ? 'avant' : apres.etat === 'ouverte' ? 'apres' : null) : null;
  // Le dernier vote refusé par le Worker, s'il n'a pas été suivi d'un autre : l'horloge du
  // téléphone le plaçait dans une fenêtre, celle du serveur non (téléphone à l'heure fausse).
  const derniere = etat.validations.filter((v) => v.defi === id).at(-1);
  return { defi, statut, fenetres: { avant, apres }, peutVoter, refuse: Boolean(derniere && derniere.statut === 'refus') };
}

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
// du défi 1 pour le défi 2, un domaine déjà croisé pour le défi 9, un autre stand
// que le sien, ou l'heure limite, pour le mystère (`appareil` : ce Passeport ;
// `maintenant`, ms).
export function defisIci(jeu, etat, exposant, { domainesDe = () => [], appareil = '', maintenant = null } = {}) {
  if (!jeu || !jeu.actif) return [];
  const scans = etat.validations.filter((v) => (v.statut === 'ok' || v.statut === 'attente') && v.exposant).map((v) => ({ defi: v.defi, exposant: v.exposant }));
  return jeu.defis.filter((d) => proposable(d, exposant)).map((defi) => {
    const statut = statutDefi(etat, defi.id);
    const refuseIci = etat.validations.some((v) => v.defi === defi.id && v.exposant === exposant && v.statut === 'refus');
    const gagnee = etat.validations.find((v) => v.defi === defi.id && v.statut === 'ok');
    const libre = statut === 'a-faire' || (statut === 'refuse' && !refuseIci);
    const raison = libre ? motifIci(defi, { jeu, exposant, scans, domainesDe, appareil, heure: maintenant }) : '';
    return { defi, statut, validable: libre && !raison, raison, chez: gagnee ? gagnee.exposant || null : null };
  });
}

// L'écran « Mes défis » : chaque défi actif, dans l'ordre du tableur, et son état.
// `maintenant` (ms) : un vote dont la fenêtre « avant » est passée sans vote est refusé.
export function mesDefis(jeu, etat, { maintenant = null } = {}) {
  if (!jeu || !jeu.actif) return [];
  return jeu.defis.map((defi) => ({ defi, statut: statutDuDefi(defi, etat, maintenant) }));
}

// Le bandeau d'annonce (grand-defi 06) : chaque défi annoncé en ce moment (le
// mystère, révélé par le Worker), pas encore fait par ce téléphone :
// [{ defi, stand: { stand, nom } (le sien, standAttribue), jusqua (minutes, à Paris) }].
// Annoncé, c'est ce que dit l'horloge du téléphone OU la dernière liste du Worker
// (`annonces`, de ?action=etat) : un téléphone en retard de quelques minutes voit le
// bandeau quand le Worker annonce ; son heure limite, elle, reste celle de son horloge.
export function annoncesEnCours(jeu, etat, { appareil = '', maintenant = null, annonces = [] } = {}) {
  if (!jeu || !jeu.actif || maintenant === null) return [];
  const annonce = (d) => { const p = phaseAnnonce(d, maintenant); return p === 'ouverte' || (p === 'a-venir' && annonces.includes(d.id)); };
  return jeu.defis
    .filter((d) => parAnnonce(d) && annonce(d) && !['valide', 'attente'].includes(statutDefi(etat, d.id)))
    .map((defi) => ({ defi, stand: standAttribue(defi, appareil), jusqua: defi.params.actif_a }))
    .filter((a) => a.stand);
}

// Le Worker annonce un défi (`annonces` de ?action=etat) que le jeu gardé ne connaît
// pas, ou seulement « à venir » : ses stands sont au Worker, il faut recharger le jeu.
export function jeuARecharger(jeu, annonces) {
  return (annonces || []).some((id) => { const d = jeu && jeu.defis.find((x) => x.id === id); return !d || Boolean(d.params.a_venir); });
}

// La jauge de l'accueil, ou null : pas de jeu, ou pas encore joué (un Visiteur
// qui ne joue pas voit l'appli ordinaire). `attente` = les points des défis
// envoyés et pas encore confirmés. Les Chances (chancesDe) se comptent sur ce que
// le Worker a confirmé, comme les points.
export function jauge(jeu, etat) {
  if (!jeu || !jeu.actif || !etat.validations.length) return null;
  const points = etat.passeport ? etat.passeport.points : 0;
  const attente = jeu.defis.filter((d) => statutDuDefi(d, etat) === 'attente').reduce((s, d) => s + d.points, 0);
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

