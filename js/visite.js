// Module Visite : l'état de Ma visite et de la préparation. Logique pure ; le
// stockage et l'horloge sont injectés. Chaque opération renvoie un nouvel état.
import { publicInclut, minutesEnHeure } from './donnees.js';

export const SCHEMA = 2;
const DUREE_PAR_DEFAUT = 45; // minutes, quand un Événement n'a pas de fin
const RAPPEL_MINUTES = 10;

export function etatInitial() {
  // `bandeauFerme` retient le message que le Visiteur a refermé, pour que le même
  // ne revienne pas et qu'un message DIFFÉRENT revienne (schéma 2 ; l'ancien
  // `bandeauVu` du schéma 1 disait « déjà notifié », ce qui n'a plus cours).
  return { schema: SCHEMA, entrees: [], interets: [], niveau: null, questionsCochees: [], bandeauFerme: '' };
}

// ---------------------------------------------------------------- entrées

export function genreDe(objet) {
  return objet && Object.prototype.hasOwnProperty.call(objet, 'debut') ? 'evenement' : 'exposant';
}

export function contient(etat, cle) {
  return etat.entrees.some((e) => e.cle === cle);
}

export function ajouter(etat, objet, maintenant = 0) {
  if (!objet || !objet.cle || contient(etat, objet.cle)) return etat;
  const entree = {
    cle: objet.cle, genre: genreDe(objet), ajouteLe: maintenant, fait: false,
    salle: objet.salle || '', debut: objet.debut ?? null, fin: objet.fin ?? null, alerte: null,
  };
  return { ...etat, entrees: [...etat.entrees, entree] };
}

export function retirer(etat, cle) {
  if (!contient(etat, cle)) return etat;
  return { ...etat, entrees: etat.entrees.filter((e) => e.cle !== cle) };
}

export function basculer(etat, objet, maintenant = 0) {
  return contient(etat, objet.cle) ? retirer(etat, objet.cle) : ajouter(etat, objet, maintenant);
}

export function basculerFait(etat, cle) {
  return { ...etat, entrees: etat.entrees.map((e) => (e.cle === cle ? { ...e, fait: !e.fait } : e)) };
}

export function compte(etat) {
  return etat.entrees.length;
}

// ---------------------------------------------------------------- matinée

function objetsParCle(modele) {
  const m = new Map();
  for (const e of modele.evenements) m.set(e.cle, e);
  for (const x of modele.exposants) m.set(x.cle, x);
  return m;
}

export function finDe(ev) {
  return ev.fin ?? (ev.debut === null ? null : ev.debut + DUREE_PAR_DEFAUT);
}

// Paires d'Événements de la visite qui se chevauchent.
// Le ou les chevauchements que l'ajout d'UNE entrée vient de créer. C'est ce qui
// permet d'avertir au moment du geste, quand le Visiteur peut encore choisir, au
// lieu d'attendre qu'il pense à ouvrir Ma visite (ADR-0010).
export function chevauchementsDe(etat, modele, cle) {
  return chevauchements(etat, modele).filter((p) => p.a === cle || p.b === cle);
}

export function chevauchements(etat, modele) {
  const parCle = objetsParCle(modele);
  const evs = etat.entrees.map((e) => parCle.get(e.cle)).filter((o) => o && genreDe(o) === 'evenement' && o.debut !== null);
  const paires = [];
  for (let i = 0; i < evs.length; i++) {
    for (let j = i + 1; j < evs.length; j++) {
      const a = evs[i], b = evs[j];
      if (a.debut < finDe(b) && b.debut < finDe(a)) paires.push({ a: a.cle, b: b.cle, debut: Math.max(a.debut, b.debut) });
    }
  }
  return paires;
}

// La matinée ordonnée : Événements par heure de début ; chaque Stand après le
// dernier Événement ajouté avant lui ; Stands sans Événement précédent en fin.
// Une entrée dont l'objet n'existe plus dans les données est renvoyée avec
// objet null (« n'est plus au programme »), jamais perdue en silence.
export function matinee(etat, modele) {
  const parCle = objetsParCle(modele);
  const lignes = etat.entrees.map((entree) => ({ entree, objet: parCle.get(entree.cle) || null, genre: entree.genre, chevauche: false }));
  const evenements = lignes.filter((l) => l.genre === 'evenement').sort((x, y) => (x.objet?.debut ?? x.entree.debut ?? 9999) - (y.objet?.debut ?? y.entree.debut ?? 9999));
  const stands = lignes.filter((l) => l.genre !== 'evenement');
  const apres = new Map(); // cle événement → stands à placer après
  const sansEvenement = [];
  for (const s of stands) {
    let dernier = null;
    for (const e of etat.entrees) {
      if (e === s.entree) break;
      if (e.genre === 'evenement') dernier = e.cle;
    }
    if (dernier === null) sansEvenement.push(s);
    else { if (!apres.has(dernier)) apres.set(dernier, []); apres.get(dernier).push(s); }
  }
  const chev = new Set();
  for (const p of chevauchements(etat, modele)) { chev.add(p.a); chev.add(p.b); }
  const sortie = [];
  for (const ev of evenements) {
    ev.chevauche = chev.has(ev.entree.cle);
    sortie.push(ev, ...(apres.get(ev.entree.cle) || []));
  }
  sortie.push(...sansEvenement);
  return sortie;
}

// ---------------------------------------------------------------- préparation

export function basculerInteret(etat, domaine) {
  const interets = etat.interets.includes(domaine) ? etat.interets.filter((s) => s !== domaine) : [...etat.interets, domaine];
  return { ...etat, interets };
}

export function definirNiveau(etat, niveau) {
  return { ...etat, niveau: etat.niveau === niveau ? null : niveau };
}

export function basculerQuestion(etat, cleQuestion) {
  const q = etat.questionsCochees.includes(cleQuestion) ? etat.questionsCochees.filter((c) => c !== cleQuestion) : [...etat.questionsCochees, cleQuestion];
  return { ...etat, questionsCochees: q };
}

// Exposants et Événements dont AU MOINS UN Domaine est dans les centres
// d'intérêt, et dont le public inclut le niveau. Sans centre d'intérêt : tout.
// Un exposant multi-domaines (une université, un lycée polyvalent) remonte donc
// pour chacun de ses domaines — c'est tout l'intérêt d'en porter plusieurs.
export function suggestions(etat, modele) {
  const parDomaine = (o) => etat.interets.length === 0 || (o.domaines || []).some((d) => etat.interets.includes(d));
  return {
    exposants: modele.exposants.filter(parDomaine),
    evenements: modele.evenements.filter((e) => !e.moment && parDomaine(e) && publicInclut(e.public, etat.niveau)),
  };
}

// ---------------------------------------------------------------- alertes

// Applique le diff des données aux entrées concernées : l'entrée mémorise la
// nouvelle valeur et porte une alerte jusqu'à consultation. Renvoie aussi la
// liste des alertes produites, pour le message éphémère.
export function appliquerDiff(etat, changements, maintenant = 0) {
  const alertes = [];
  const entrees = etat.entrees.map((e) => {
    const siens = changements.filter((c) => c.cle === e.cle && ['salle', 'debut', 'fin'].includes(c.champ));
    if (!siens.length) return e;
    let n = { ...e };
    for (const c of siens) {
      n[c.champ] = c.apres;
      n.alerte = { champ: c.champ, avant: c.avant, apres: c.apres, vue: false, le: maintenant };
      alertes.push({ cle: e.cle, genre: e.genre, ...n.alerte });
    }
    return n;
  });
  return { etat: { ...etat, entrees }, alertes };
}

export function marquerAlerteVue(etat, cle) {
  return { ...etat, entrees: etat.entrees.map((e) => (e.cle === cle && e.alerte ? { ...e, alerte: { ...e.alerte, vue: true } } : e)) };
}

export function alertesNonVues(etat) {
  return etat.entrees.filter((e) => e.alerte && !e.alerte.vue);
}

export function texteAlerte(alerte) {
  if (!alerte) return '';
  if (alerte.champ === 'salle') return `${alerte.apres || 'salle à venir'} au lieu de ${alerte.avant || '(sans salle)'}`;
  if (alerte.champ === 'debut') return `commence à ${minutesEnHeure(alerte.apres)} au lieu de ${minutesEnHeure(alerte.avant)}`;
  if (alerte.champ === 'fin') return `finit à ${minutesEnHeure(alerte.apres)} au lieu de ${minutesEnHeure(alerte.avant)}`;
  return '';
}

// ---------------------------------------------------------------- rappels

// Événements de la visite qui commencent dans les dix prochaines minutes.
export function rappelsAFaire(etat, modele, minutesMaintenant) {
  const parCle = objetsParCle(modele);
  return etat.entrees
    .map((e) => parCle.get(e.cle))
    .filter((o) => o && genreDe(o) === 'evenement' && o.debut !== null)
    .filter((o) => o.debut - minutesMaintenant > 0 && o.debut - minutesMaintenant <= RAPPEL_MINUTES);
}

// ---------------------------------------------------------------- persistance

export function serialiser(etat) {
  return JSON.stringify({ ...etat, schema: SCHEMA });
}

// Lecture tolérante : une entrée illisible ou d'un schéma inconnu est ignorée.
export function deserialiser(texte) {
  const vide = etatInitial();
  if (!texte) return vide;
  let brut;
  try { brut = JSON.parse(texte); } catch { return vide; }
  if (!brut || typeof brut !== 'object') return vide;
  return migrer(brut);
}

function migrer(brut) {
  const etat = etatInitial();
  const entrees = Array.isArray(brut.entrees) ? brut.entrees : [];
  etat.entrees = entrees
    .filter((e) => e && typeof e.cle === 'string' && e.cle)
    .map((e) => ({
      cle: e.cle, genre: e.genre === 'evenement' ? 'evenement' : 'exposant', ajouteLe: Number(e.ajouteLe) || 0,
      fait: Boolean(e.fait), salle: typeof e.salle === 'string' ? e.salle : '', debut: typeof e.debut === 'number' ? e.debut : null,
      fin: typeof e.fin === 'number' ? e.fin : null, alerte: e.alerte && typeof e.alerte === 'object' ? { vue: false, ...e.alerte } : null,
    }));
  etat.interets = Array.isArray(brut.interets) ? brut.interets.filter((s) => typeof s === 'string') : [];
  etat.niveau = typeof brut.niveau === 'string' ? brut.niveau : null;
  etat.questionsCochees = Array.isArray(brut.questionsCochees) ? brut.questionsCochees.filter((s) => typeof s === 'string') : [];
  etat.bandeauFerme = typeof brut.bandeauFerme === 'string' ? brut.bandeauFerme : '';
  return etat;
}

export const CLE_STOCKAGE = 'festival.visite';

// stockage : { getItem(cle), setItem(cle, valeur) } ; localStorage en production, mémoire en test.
export function creerStockageVisite(stockage, cle = CLE_STOCKAGE) {
  return {
    charger() {
      try { return deserialiser(stockage.getItem(cle)); } catch { return etatInitial(); }
    },
    sauver(etat) {
      try { stockage.setItem(cle, serialiser(etat)); return true; } catch { return false; }
    },
  };
}

export function stockageMemoire() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}

// ---------------------------------------------------------------- iCalendar

function dateICal(dateISO, minutes) {
  const [a, m, j] = String(dateISO || '').split('-').map(Number);
  const h = Math.floor(minutes / 60), mn = minutes % 60;
  const p = (n) => String(n).padStart(2, '0');
  return `${a}${p(m)}${p(j)}T${p(h)}${p(mn)}00`;
}

function echapperICal(texte) {
  return String(texte || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Un fichier iCalendar pour un Événement : titre, début, fin, lieu, description, alarme dix minutes avant.
export function icalendar(evenement, infos = {}) {
  if (!evenement || evenement.debut === null || !/^\d{4}-\d{2}-\d{2}$/.test(infos.date || '')) return null;
  const fin = finDe(evenement);
  const lieu = [evenement.salle, infos.lieu, infos.adresse].filter(Boolean).join(', ');
  const lignes = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//APEL Maurice Rondeau//Festival de l\'Orientation//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${evenement.cle}@festival-orientation`,
    `DTSTAMP:${dateICal(infos.date, 0)}Z`,
    `DTSTART:${dateICal(infos.date, evenement.debut)}`,
    `DTEND:${dateICal(infos.date, fin)}`,
    `SUMMARY:${echapperICal(evenement.titre)}`,
    `LOCATION:${echapperICal(lieu)}`,
    `DESCRIPTION:${echapperICal([evenement.format, evenement.intervenantsTexte, evenement.description].filter(Boolean).join(' · '))}`,
    'BEGIN:VALARM', 'TRIGGER:-PT10M', 'ACTION:DISPLAY', `DESCRIPTION:${echapperICal(evenement.titre)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lignes.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- questions

// Les questions à poser pour un type d'Exposant (ou tous), avec l'état coché.
// Les questions à poser. `selonMaVisite` les restreint aux types d'Exposants que
// le Visiteur a ENREGISTRÉS : lire des questions destinées à quelqu'un d'autre
// allonge la page sans l'aider. Sans rien d'enregistré, on retombe sur tous les
// types présents au festival — un carnet vide vaut mieux qu'un écran vide.
export function questionsPour(etat, modele, typeExposant = null, { selonMaVisite = false } = {}) {
  const typesPresents = new Set(modele.exposants.map((e) => e.type));
  const parCle = objetsParCle(modele);
  const miens = new Set(etat.entrees.map((e) => parCle.get(e.cle)).filter(Boolean).map((o) => o.type).filter(Boolean));
  const retenus = selonMaVisite && miens.size ? miens : typesPresents;
  return modele.questions
    .filter((q) => retenus.has(q.typeExposant))
    .filter((q) => !typeExposant || q.typeExposant === typeExposant)
    .map((q) => ({ ...q, cochee: etat.questionsCochees.includes(q.cle) }));
}
