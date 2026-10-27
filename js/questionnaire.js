// Module Questionnaire : le questionnaire de satisfaction de l'APEL (ADR-0026,
// .scratch/questionnaire). Logique pure, partagée comme defis.js : le téléphone s'en
// sert pour l'écran et le brouillon, le Worker pour vérifier ce qui arrive, la page
// des résultats pour compter. Les questions vivent ICI, pas dans le tableur : neuf
// questions fixées par l'APEL, des formes que le tableur n'exprime pas (une grille,
// un choix exclusif, une question qui dépend d'une autre). Les libellés sont les clés
// françaises de t() ; une réponse garde des numéros, jamais un libellé.
import { normaliser, heureEnMinutes, rejouerDemande } from './donnees.js';

// Monter VERSION à chaque changement de QUESTIONS : chaque réponse garde la sienne.
export const VERSION = 1;
export const HEURE_PAR_DEFAUT = 11 * 60;
export const JOURS_PAR_DEFAUT = 7;
// Le Worker accepte encore une réponse gardée hors ligne pendant ce délai après la fermeture.
export const GRACE_APRES_FERMETURE = 24 * 60 * 60_000;
export const LONGUEUR_COURTE = 80;
export const LONGUEUR_SUGGESTION = 600;
export const SANS_AVIS = 0;

export const QUESTIONS = [
  { cle: 'profil', type: 'un', titre: 'Vous êtes', aide: 'Un seul choix',
    choix: ['Élève de 3e', 'Élève de 2nde', 'Élève de 1re', 'Élève de Terminale', 'Parent', 'Autre'] },
  { cle: 'etablissement', type: 'un', titre: 'Quel est votre établissement ou celui de votre enfant ?', aide: 'Un seul choix',
    choix: ['Maurice Rondeau', 'Saint-Colomban', 'Autre établissement', 'Non concerné'] },
  { cle: 'connu', type: 'plusieurs', titre: 'Comment avez-vous connu le Festival ?', aide: 'Plusieurs réponses possibles',
    choix: ['Établissement scolaire', 'APEL', 'Affichage / flyer', 'Réseaux sociaux', 'Bouche-à-oreille', 'Autre'] },
  { cle: 'satisfaction', type: 'note', titre: 'Globalement, êtes-vous satisfait(e) du Festival de l’Orientation ?', aide: '1 = Pas du tout satisfait(e) ; 5 = Très satisfait(e)' },
  { cle: 'utile', type: 'plusieurs', max: 3, autre: 6, titre: 'Quels éléments vous ont été les plus utiles ?', aide: '3 réponses maximum',
    choix: ['Les écoles et établissements d’enseignement supérieur', 'Les lycées et les formations professionnelles, technologiques et BTS',
      'Les échanges avec les professionnels et les entreprises sur les métiers', 'Les informations sur l’alternance',
      'Les conférences / tables rondes', 'Les échanges avec les étudiants et anciens élèves', 'Autre'] },
  { cle: 'aspects', type: 'grille', titre: 'Comment évaluez-vous les aspects suivants du Festival ?', aide: '1 = Pas du tout satisfait(e) ; 5 = Très satisfait(e)',
    // « L’accueil » et non « Accueil » : ce mot-là est déjà la clé de l'écran d'accueil (Home).
    lignes: ['L’accueil', 'Signalétique et facilité à trouver les stands et les salles', 'Diversité des écoles et métiers représentés', 'Qualité des échanges', 'Application du Festival'] },
  { cle: 'manque', type: 'plusieurs', seul: 0, autre: 7, suite: [1, 2], titre: 'Qu’auriez-vous aimé trouver davantage lors du Festival ?', aide: 'Plusieurs réponses possibles',
    choix: ['Rien de particulier', 'Plus d’écoles / formations', 'Plus de professionnels / métiers', 'Plus d’informations sur Parcoursup',
      'Plus d’informations sur l’alternance', 'Plus de conférences', 'Plus de témoignages d’étudiants / anciens élèves', 'Autre'] },
  { cle: 'reflexion', type: 'un', titre: 'Votre visite vous a-t-elle aidé à avancer dans votre réflexion sur l’orientation ou celle de votre enfant ?', aide: 'Un seul choix',
    choix: ['Beaucoup', 'Assez', 'Un peu', 'Pas du tout', 'Non concerné'] },
  { cle: 'suggestion', type: 'texte', facultatif: true, titre: 'Une suggestion pour améliorer la prochaine édition ?', aide: 'Réponse libre et facultative. Sans nom, s’il vous plaît.' },
];

// Les visages des notes : 1 à 5, du rouge au vert (l'écran et la page des résultats).
export const NOTES = [1, 2, 3, 4, 5];
export const PROFILS_ELEVES = [0, 1, 2, 3];
export const PROFIL_PARENT = 4;

// Les champs de texte d'une question : « Autre, précisez » quand la case Autre est cochée,
// « lesquels ? » quand une case de `suite` l'est, la suggestion. `quand(liste)` : visible ?
export function champsTexte(q) {
  const champs = [];
  if (q.type === 'texte') champs.push({ cle: q.cle, longueur: LONGUEUR_SUGGESTION, libelle: q.titre, quand: () => true });
  if (Number.isInteger(q.autre)) champs.push({ cle: `${q.cle}_autre`, longueur: LONGUEUR_COURTE, libelle: 'Autre, précisez :', quand: (l) => l.includes(q.autre) });
  if (q.suite) champs.push({ cle: `${q.cle}_lesquels`, longueur: LONGUEUR_COURTE, libelle: 'Si vous souhaitez davantage de formations ou de métiers, lesquels ? (Facultatif)', quand: (l) => q.suite.some((s) => l.includes(s)) });
  return champs;
}
const TOUS_LES_CHAMPS = QUESTIONS.flatMap((q) => [q.cle, ...champsTexte(q).map((c) => c.cle)]);

// ---------------------------------------------------------------- le brouillon (le téléphone)

const liste = (v) => (Array.isArray(v) ? v : []);

// Un choix touché : `un` et `note` le prennent ; `plusieurs` coche ou décoche, avec
// « Rien de particulier » seul (`seul`) et le plafond (`max` : au-delà, rien ne change).
// Décocher la case d'un champ de texte efface ce champ. Rend un nouveau brouillon.
export function choisir(brouillon, q, n) {
  const b = { ...brouillon };
  if (q.type === 'un' || q.type === 'note') { b[q.cle] = n; return b; }
  if (q.type !== 'plusieurs') return b;
  let l = liste(b[q.cle]).slice();
  if (l.includes(n)) l = l.filter((x) => x !== n);
  else if (n === q.seul) l = [n];
  else {
    l = l.filter((x) => x !== q.seul);
    if (!q.max || l.length < q.max) l.push(n);
  }
  b[q.cle] = l.sort((a, c) => a - c);
  for (const c of champsTexte(q)) if (!c.quand(b[q.cle])) delete b[c.cle];
  return b;
}

// Une ligne de la grille notée (1 à 5, ou SANS_AVIS).
export function noterLigne(brouillon, q, ligne, valeur) {
  const notes = q.lignes.map((_, i) => (Array.isArray(brouillon[q.cle]) ? brouillon[q.cle][i] : undefined) ?? null);
  notes[ligne] = valeur;
  return { ...brouillon, [q.cle]: notes };
}

export function ecrire(brouillon, champ, texte) {
  return TOUS_LES_CHAMPS.includes(champ) ? { ...brouillon, [champ]: String(texte ?? '') } : brouillon;
}

// La question peut-elle être quittée par « Suivant » ? Les questions 1 à 8 exigent une
// réponse ; la 9 et les champs de texte sont facultatifs.
// La réponse `v` à une question à choix, à note ou en grille est-elle complète ? Une
// seule règle pour le téléphone (Suivant) et le Worker (verifierReponses).
function complete(q, v) {
  if (q.type === 'un') return Number.isInteger(v) && v >= 0 && v < q.choix.length;
  if (q.type === 'note') return NOTES.includes(v);
  if (q.type === 'grille') return Array.isArray(v) && v.length === q.lignes.length && v.every((x) => x === SANS_AVIS || NOTES.includes(x));
  return true;
}
export function peutContinuer(brouillon, q) {
  const v = brouillon[q.cle];
  if (q.facultatif) return true;
  if (q.type === 'plusieurs') return liste(v).length > 0;
  return complete(q, v);
}

// Le numéro de la première question sans réponse (reprendre un brouillon), ou la dernière.
export function premiereARemplir(brouillon) {
  const i = QUESTIONS.findIndex((q) => !q.facultatif && !peutContinuer(brouillon, q));
  return i < 0 ? QUESTIONS.length - 1 : i;
}

// Ce que garde le téléphone (localStorage `festival.questionnaire`) : le brouillon,
// l'écran où il en est (-1 : l'accueil du questionnaire), `fait` (il a répondu), `jour`
// (la date de Paris de la réponse) et `envoi`, la réponse qui attend la confirmation du
// Worker (null une fois confirmée).
export const CLE_STOCKAGE = 'festival.questionnaire';
export function etatTelephone(brut) {
  const b = brut && typeof brut === 'object' ? brut : {};
  const brouillon = b.brouillon && typeof b.brouillon === 'object' && !Array.isArray(b.brouillon) ? b.brouillon : {};
  const etape = Number.isInteger(b.etape) && b.etape >= -1 && b.etape < QUESTIONS.length ? b.etape : -1;
  const envoi = b.envoi && verifierReponses(b.envoi) === null ? b.envoi : null;
  const jour = typeof b.jour === 'string' && DATE.test(b.jour) ? b.jour : null;
  return { brouillon, etape, fait: b.fait === true, jour, envoi };
}

// « Envoyer » : le brouillon devient la réponse qui part ; il n'est plus gardé.
export function terminer(tel, ms = Date.now()) {
  return { brouillon: {}, etape: -1, fait: true, jour: jourAParis(ms), envoi: reponsesPropres(tel.brouillon) };
}

// Un testeur qui a répondu avant le festival répond de nouveau le jour venu : sa réponse
// était d'essai, et la remise à zéro (jeu.sh reinitialiser) a effacé ses points et son
// téléphone de la liste du Worker. Sinon `tel` tel quel.
export function recommencerApresEssai(tel, infos, ms) {
  const { date } = reglages(infos);
  if (!tel.fait || !date || jourAParis(ms) < date || (tel.jour && tel.jour >= date)) return tel;
  return etatTelephone(null);
}

// ---------------------------------------------------------------- ce qui part (téléphone → Worker)

const objet = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const numero = (v, n) => Number.isInteger(v) && v >= 0 && v < n;

// Un texte reçu, nettoyé : ni caractère de contrôle (la suggestion garde ses retours à la
// ligne), ni espaces en série, ni espaces au bord.
const CONTROLES = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'g');
const CONTROLES_SAUF_LIGNE = new RegExp('[\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'g');
export function nettoyerTexte(s, { lignes = false } = {}) {
  const sans = String(s ?? '').replace(lignes ? CONTROLES_SAUF_LIGNE : CONTROLES, ' ');
  return (lignes ? sans.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : sans.replace(/\s+/g, ' ')).trim();
}

// null si les réponses sont recevables, sinon le motif. Tout champ inconnu est refusé,
// comme dans la salve du jeu (ADR-0014) ; un texte n'est accepté que si sa case est cochée.
export function verifierReponses(r) {
  if (!objet(r)) return 'réponses attendues';
  const inconnu = Object.keys(r).find((k) => !TOUS_LES_CHAMPS.includes(k));
  if (inconnu) return `champ inconnu : ${inconnu}`;
  for (const q of QUESTIONS) {
    const v = r[q.cle];
    if (!complete(q, v)) return { un: `${q.cle} : un choix attendu`, note: `${q.cle} : une note de 1 à 5 attendue`, grille: `${q.cle} : une note par ligne attendue` }[q.type];
    if (q.type === 'plusieurs') {
      if (!Array.isArray(v) || !v.length || !v.every((x) => numero(x, q.choix.length))) return `${q.cle} : des choix attendus`;
      if (new Set(v).size !== v.length) return `${q.cle} : choix en double`;
      if (q.max && v.length > q.max) return `${q.cle} : ${q.max} choix au plus`;
      if (Number.isInteger(q.seul) && v.includes(q.seul) && v.length > 1) return `${q.cle} : « ${q.choix[q.seul]} » se coche seul`;
    }
    for (const c of champsTexte(q)) {
      const texte = r[c.cle];
      if (texte === undefined) continue;
      if (typeof texte !== 'string') return `${c.cle} : un texte attendu`;
      if (texte.length > c.longueur) return `${c.cle} : ${c.longueur} caractères au plus`;
      if (q.type !== 'texte' && !c.quand(liste(v))) return `${c.cle} : sa case n’est pas cochée`;
    }
  }
  return null;
}

// Les réponses telles qu'on les garde : les numéros, les textes nettoyés, sans les vides.
// À n'appeler que sur des réponses vérifiées (ou sur le brouillon, côté téléphone).
export function reponsesPropres(r) {
  const propre = {};
  for (const q of QUESTIONS) {
    if (r[q.cle] !== undefined && q.type !== 'texte') propre[q.cle] = Array.isArray(r[q.cle]) ? r[q.cle].slice() : r[q.cle];
    for (const c of champsTexte(q)) {
      if (q.type !== 'texte' && !c.quand(liste(r[q.cle]))) continue;
      const texte = nettoyerTexte(r[c.cle], { lignes: q.type === 'texte' }).slice(0, c.longueur);
      if (texte) propre[c.cle] = texte;
    }
  }
  return propre;
}

// ---------------------------------------------------------------- quand c'est ouvert

// L'onglet Infos, en objet { clé: valeur } (le Worker reçoit la table brute).
export function infosEnObjet(infos) {
  if (!Array.isArray(infos)) return infos && typeof infos === 'object' ? infos : {};
  const o = {};
  for (const l of infos.slice(1)) if (Array.isArray(l)) o[normaliser(l[0]).replace(/[\s-]+/g, '_')] = l[1];
  return o;
}

const PARIS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function aParis(ms) {
  const p = Object.fromEntries(PARIS.formatToParts(new Date(ms)).map(({ type, value }) => [type, value]));
  return { jour: `${p.year}-${p.month}-${p.day}`, mur: Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) };
}
// La date de Paris d'un instant : « 2026-11-14 ».
export const jourAParis = (ms) => aParis(ms).jour;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// L'instant (ms) d'une date de Paris et d'une heure en minutes, décalage d'été compris.
export function msAParis(iso, minutes = 0) {
  const [, a, m, j] = DATE.exec(iso).map(Number);
  const naif = Date.UTC(a, m - 1, j, 0, minutes);
  let ms = naif - (aParis(naif).mur - naif);
  const recale = naif - (aParis(ms).mur - ms);
  if (recale !== ms) ms = recale;
  return ms;
}
function plusJours(iso, n) {
  const [, a, m, j] = DATE.exec(iso).map(Number);
  return new Date(Date.UTC(a, m - 1, j + n)).toISOString().slice(0, 10);
}
const dateLisible = (v) => { const s = String(v ?? '').trim(); return DATE.test(s) && !Number.isNaN(Date.parse(s)) ? s : null; };

// Les réglages lus dans Infos : `questionnaire` (non = coupé), `questionnaire_heure`
// (11:00), `questionnaire_jours` (7), et la `date` du festival.
export function reglages(infos) {
  const i = infosEnObjet(infos);
  const coupe = ['non', 'no', 'faux', 'false', '0'].includes(normaliser(i.questionnaire));
  const heure = heureEnMinutes(i.questionnaire_heure) ?? HEURE_PAR_DEFAUT;
  const n = Number(String(i.questionnaire_jours ?? '').trim());
  const jours = String(i.questionnaire_jours ?? '').trim() && Number.isInteger(n) && n >= 0 && n <= 60 ? n : JOURS_PAR_DEFAUT;
  const date = dateLisible(i.date);
  return { coupe, heure, jours, date, ouverture: date ? msAParis(date, heure) : null, fermeture: date ? msAParis(plusJours(date, jours + 1), 0) : null, essaiDuJeu: rejouerDemande(i.rejouer) };
}

// L'état vu du téléphone : 'coupe' | 'avant' | 'ouvert' | 'ferme'. Un testeur le voit
// ouvert à toute heure (sauf coupé).
export function etatQuestionnaire(infos, ms, { testeur = false } = {}) {
  const r = reglages(infos);
  if (r.coupe) return 'coupe';
  if (testeur) return 'ouvert';
  if (r.ouverture === null) return 'avant';
  if (ms < r.ouverture) return 'avant';
  return ms < r.fermeture ? 'ouvert' : 'ferme';
}

// Ce que décide le Worker à l'arrivée `ms` : { motif } (refus) ou { essai, points }.
// `essai` : arrivée avant l'ouverture (les testeurs) ; `points` : les 10 points peuvent
// s'écrire (le jour du festival, ou pendant l'essai du jeu ; ADR-0026).
export function accueilAuWorker(infos, ms) {
  const r = reglages(infos);
  if (r.coupe) return { motif: 'questionnaire coupé' };
  if (r.fermeture !== null && ms >= r.fermeture + GRACE_APRES_FERMETURE) return { motif: 'questionnaire fermé' };
  return { essai: r.ouverture === null || ms < r.ouverture, points: pointsPossibles(infos, ms) };
}

// Les 10 points s'écrivent-ils à l'instant `ms` ? Le jour du festival, ou pendant l'essai
// du jeu (`rejouer`). Le téléphone ne les promet qu'alors.
export function pointsPossibles(infos, ms) {
  const r = reglages(infos);
  return r.essaiDuJeu || (r.date !== null && jourAParis(ms) === r.date);
}

// ---------------------------------------------------------------- les résultats (la page de l'APEL)

const moyenne = (l) => (l.length ? l.reduce((s, x) => s + x, 0) / l.length : null);
const part = (n, sur) => (sur ? n / sur : null);

// Les filtres de la page : public 'tous' | 'eleves' | 'parents' ; etablissement 'tous'
// ou un numéro ; essais : compter aussi les réponses d'essai.
export function filtrer(lignes, { public: pub = 'tous', etablissement = 'tous', essais = false } = {}) {
  return lignes.filter((l) => {
    const r = l.reponses || {};
    if (l.essai && !essais) return false;
    if (pub === 'eleves' && !PROFILS_ELEVES.includes(r.profil)) return false;
    if (pub === 'parents' && r.profil !== PROFIL_PARENT) return false;
    if (etablissement !== 'tous' && r.etablissement !== Number(etablissement)) return false;
    return true;
  });
}

// Les chiffres d'un ensemble de réponses (déjà filtrées). `compte` : par choix, le nombre
// de réponses qui l'ont coché ; `aspects` : la moyenne sur 5 de chaque ligne, sans les
// « Sans avis » ; `aides` : « Beaucoup » ou « Assez », parmi ceux qui ne sont pas « Non concerné ».
export function synthese(lignes) {
  const rs = lignes.map((l) => l.reponses || {});
  const compter = (q) => q.choix.map((_, i) => rs.filter((r) => (Array.isArray(r[q.cle]) ? r[q.cle].includes(i) : r[q.cle] === i)).length);
  const q = Object.fromEntries(QUESTIONS.map((x) => [x.cle, x]));
  const notes = rs.map((r) => r.satisfaction).filter((x) => NOTES.includes(x));
  const aspects = q.aspects.lignes.map((_, i) => moyenne(rs.map((r) => (Array.isArray(r.aspects) ? r.aspects[i] : null)).filter((x) => NOTES.includes(x))));
  const concernes = rs.filter((r) => numero(r.reflexion, 4));
  const textes = [];
  for (const [l, r] of lignes.map((x, i) => [x, rs[i]])) {
    for (const question of QUESTIONS) for (const c of champsTexte(question)) {
      if (r[c.cle]) textes.push({ champ: c.cle, question: question.cle, texte: r[c.cle], profil: r.profil, etablissement: r.etablissement, jour: l.jour });
    }
  }
  return {
    n: rs.length,
    satisfaction: moyenne(notes),
    aides: part(concernes.filter((r) => r.reflexion <= 1).length, concernes.length),
    appli: aspects[4],
    notes: NOTES.map((n) => notes.filter((x) => x === n).length),
    compte: { profil: compter(q.profil), etablissement: compter(q.etablissement), connu: compter(q.connu), utile: compter(q.utile), manque: compter(q.manque), reflexion: compter(q.reflexion) },
    aspects,
    textes,
  };
}

// Toutes les réponses en un fichier que lit Excel : UTF-8 avec BOM, `;`, une ligne par
// réponse, les libellés en français. Un texte qui commencerait par = + - @ (une formule
// pour un tableur) prend une apostrophe devant.
export function enCsv(lignes) {
  const cellule = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const q = Object.fromEntries(QUESTIONS.map((x) => [x.cle, x]));
  const libelles = (question, v) => (Array.isArray(v) ? v : Number.isInteger(v) ? [v] : []).map((i) => question.choix[i]).filter(Boolean).join(', ');
  const entetes = ['Jour', 'Essai', 'Version', q.profil.titre, q.etablissement.titre, q.connu.titre, q.satisfaction.titre, q.utile.titre, `${q.utile.titre} (Autre)`,
    ...q.aspects.lignes, q.manque.titre, `${q.manque.titre} (Autre)`, `${q.manque.titre} (Lesquels)`, q.reflexion.titre, q.suggestion.titre];
  const rangs = lignes.map((l) => {
    const r = l.reponses || {};
    return [l.jour, l.essai ? 'oui' : '', l.version, libelles(q.profil, r.profil), libelles(q.etablissement, r.etablissement), libelles(q.connu, r.connu),
      r.satisfaction ?? '', libelles(q.utile, r.utile), r.utile_autre ?? '',
      ...q.aspects.lignes.map((_, i) => { const x = Array.isArray(r.aspects) ? r.aspects[i] : null; return x === SANS_AVIS ? 'Sans avis' : x ?? ''; }),
      libelles(q.manque, r.manque), r.manque_autre ?? '', r.manque_lesquels ?? '', libelles(q.reflexion, r.reflexion), r.suggestion ?? ''];
  });
  return `﻿${[entetes, ...rangs].map((rang) => rang.map(cellule).join(';')).join('\r\n')}\r\n`;
}
