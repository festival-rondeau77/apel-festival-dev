// Module Données : des cinq tables brutes (Exposants, Événements, Salles,
// Préparation, Infos) vers le modèle du glossaire (CONTEXT.md). Logique pure :
// ni DOM, ni réseau, ni horloge. Importable tel quel par Node pour les tests.
import { empreinte } from './empreinte.js';

export const SECTEURS = [
  'Commerce & Management',
  'Ingénieurs, Sciences & Numérique',
  'Santé',
  'Communication & Médias',
  'Art, Design & Architecture',
  'Universités & prépas',
  'Métiers & alternance',
  'International',
];

export const TYPES_EXPOSANT = ['École', 'Pro', 'Entreprise', 'Ancien élève'];
export const FORMATS = ['Conférence', 'Table ronde', 'Atelier'];
export const PUBLICS = ['Tous', 'Collégiens', 'Lycéens', 'Étudiants', 'Parents'];
export const NIVEAUX = ['3e', '2nde', '1re', 'Terminale', 'étudiant', 'parent'];
export const ZONES_PAR_DEFAUT = [
  { numero: 1, nom: 'Accueil' },
  { numero: 2, nom: 'Écoles de commerce' },
  { numero: 3, nom: 'Universités' },
  { numero: 4, nom: "Écoles d'ingénieurs" },
  { numero: 5, nom: 'International' },
  { numero: 6, nom: 'Métiers' },
  { numero: 7, nom: 'Conférences' },
];

const NIVEAU_VERS_PUBLIC = {
  '3e': 'Collégiens', '2nde': 'Lycéens', '1re': 'Lycéens', 'Terminale': 'Lycéens',
  'étudiant': 'Étudiants', 'parent': 'Parents',
};

// ---------------------------------------------------------------- utilitaires

export function normaliser(texte) {
  if (texte === null || texte === undefined) return '';
  return String(texte)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Recherche « contient » insensible aux accents et à la casse.
export function contient(texte, requete) {
  const r = normaliser(requete);
  if (!r) return true;
  return normaliser(texte).includes(r);
}

// « 10:00 », « 9h30 », « 9 h 30 », « 10h » → minutes depuis minuit ; sinon null.
export function heureEnMinutes(valeur) {
  if (valeur === null || valeur === undefined) return null;
  if (valeur instanceof Date) return valeur.getHours() * 60 + valeur.getMinutes();
  if (typeof valeur === 'number') {
    // Fraction de jour (format natif d'une cellule heure).
    if (valeur >= 0 && valeur < 1) return Math.round(valeur * 24 * 60);
    return null;
  }
  const m = String(valeur).trim().match(/^(\d{1,2})\s*(?::|h|H)\s*(\d{0,2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mn = m[2] === '' ? 0 : Number(m[2]);
  if (h > 23 || mn > 59) return null;
  return h * 60 + mn;
}

export function minutesEnHeure(minutes) {
  if (minutes === null || minutes === undefined) return '';
  const h = Math.floor(minutes / 60);
  const mn = minutes % 60;
  return `${h} h ${String(mn).padStart(2, '0')}`;
}

function texte(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function nombre(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Une table (première ligne = en-têtes) devient une liste d'objets aux clés
// normalisées ; les lignes entièrement vides sont ignorées.
export function tablesEnObjets(table) {
  if (!Array.isArray(table) || table.length < 2) return [];
  const entetes = table[0].map((e) => normaliser(e).replace(/-/g, '_'));
  const objets = [];
  for (const ligne of table.slice(1)) {
    if (!Array.isArray(ligne)) continue;
    if (ligne.every((c) => texte(c) === '')) continue;
    const o = {};
    entetes.forEach((e, i) => { if (e) o[e] = ligne[i] === undefined ? '' : ligne[i]; });
    objets.push(o);
  }
  return objets;
}

// ---------------------------------------------------------------- clés stables

const SLUG_TYPE = { 'ecole': 'ecole', 'pro': 'pro', 'entreprise': 'entreprise', 'ancien-eleve': 'ancien-eleve' };

export function typeExposantCanonique(type) {
  const n = normaliser(type);
  for (const t of TYPES_EXPOSANT) if (normaliser(t) === n) return t;
  if (n.startsWith('ancien')) return 'Ancien élève';
  return texte(type) || 'École';
}

export function slugType(type) {
  return SLUG_TYPE[normaliser(typeExposantCanonique(type))] || normaliser(type);
}

export function cleExposant(type, nom) {
  return `${slugType(type)}:${normaliser(nom)}`;
}

export function cleEvenement(titre, debut) {
  return `${normaliser(titre)}@${debut === null || debut === undefined ? '' : debut}`;
}

// ---------------------------------------------------------------- secteurs, formats, publics

function secteurCanonique(valeur, avertissements, ou) {
  const v = texte(valeur);
  if (!v) return { secteur: '', connu: false };
  const n = normaliser(v);
  for (const s of SECTEURS) if (normaliser(s) === n) return { secteur: s, connu: true };
  avertissements.push({ type: 'secteur-inconnu', valeur: v, ou });
  return { secteur: v, connu: false };
}

function formatCanonique(valeur) {
  const n = normaliser(valeur);
  for (const f of FORMATS) if (normaliser(f) === n) return f;
  return texte(valeur) || 'Conférence';
}

function publicsDepuis(valeur) {
  return texte(valeur).split(/[,;/]|\bet\b/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const n = normaliser(p);
    for (const c of PUBLICS) if (normaliser(c) === n) return c;
    return p;
  });
}

// Le public d'un Événement inclut-il ce niveau ? Sans niveau ou sans public : oui.
export function publicInclut(publics, niveau) {
  if (!niveau) return true;
  if (!publics || publics.length === 0) return true;
  if (publics.includes('Tous')) return true;
  const cible = NIVEAU_VERS_PUBLIC[niveau] || niveau;
  return publics.some((p) => normaliser(p) === normaliser(cible));
}

// ---------------------------------------------------------------- zones et salles

function zoneDepuisLibelle(libelle) {
  const t = texte(libelle);
  if (!t) return null;
  const m = t.match(/^(\d+)\s*[·.\-–:]?\s*(.*)$/);
  if (m) return { numero: Number(m[1]), nom: m[2].trim() || `Zone ${m[1]}` };
  return { numero: null, nom: t };
}

function construireZones(sallesBrutes) {
  const zones = new Map();
  for (const z of ZONES_PAR_DEFAUT) zones.set(z.numero, { numero: z.numero, nom: z.nom, libelle: `${z.numero} · ${z.nom}`, salles: [] });
  for (const s of sallesBrutes) {
    const z = zoneDepuisLibelle(s.zone);
    if (!z) continue;
    const id = z.numero === null ? z.nom : z.numero;
    if (!zones.has(id)) zones.set(id, { numero: z.numero, nom: z.nom, libelle: z.numero === null ? z.nom : `${z.numero} · ${z.nom}`, salles: [] });
    else if (z.numero !== null && z.nom) zones.get(id).nom = z.nom; // le tableur fait foi sur le nom
  }
  return zones;
}

// ---------------------------------------------------------------- modèle

export function construireModele(tables) {
  tables = tables || {};
  const avertissements = [];
  const exposantsBruts = tablesEnObjets(tables.exposants);
  const evenementsBruts = tablesEnObjets(tables.evenements);
  const sallesBrutes = tablesEnObjets(tables.salles);
  const preparationBrute = tablesEnObjets(tables.preparation);
  const infosBrutes = tablesEnObjets(tables.infos);

  const infos = {};
  for (const l of infosBrutes) {
    const cle = normaliser(l.cle).replace(/-/g, '_');
    if (cle) infos[cle] = texte(l.valeur);
  }

  const zonesParId = construireZones(sallesBrutes);
  const salles = [];
  const sallesParCle = new Map();
  for (const s of sallesBrutes) {
    const nom = texte(s.salle);
    if (!nom) continue;
    const z = zoneDepuisLibelle(s.zone);
    const zone = z ? zonesParId.get(z.numero === null ? z.nom : z.numero) || null : null;
    const salle = {
      nom, cle: normaliser(nom), zone, zoneLibelle: texte(s.zone),
      typePoint: texte(s.type_point) || 'Salle', capacite: nombre(s.capacite),
      x: nombre(s.x), y: nombre(s.y), notes: texte(s.notes),
    };
    salles.push(salle);
    sallesParCle.set(salle.cle, salle);
    if (zone) zone.salles.push(salle);
  }
  const zones = [...zonesParId.values()].sort((a, b) => (a.numero ?? 99) - (b.numero ?? 99));
  const zoneDeSalle = (nomSalle) => {
    const s = sallesParCle.get(normaliser(nomSalle));
    return s ? s.zone : null;
  };

  const exposants = [];
  for (const e of exposantsBruts) {
    const nom = texte(e.nom);
    if (!nom) continue;
    const type = typeExposantCanonique(e.type);
    const { secteur, connu } = secteurCanonique(e.secteur, avertissements, `exposant ${nom}`);
    const salle = texte(e.salle);
    exposants.push({
      cle: cleExposant(type, nom), type, typeSlug: slugType(type), nom,
      organisation: texte(e.organisation), secteur, secteurConnu: connu,
      sousTitre: texte(e.sous_titre), description: texte(e.description), niveau: texte(e.niveau),
      site: texte(e.site), ville: texte(e.ville), salle, salleAVenir: salle === '',
      stand: texte(e.stand), presence: texte(e.presence), zone: zoneDeSalle(salle), evenements: [],
    });
  }
  const exposantsParNom = new Map(exposants.map((e) => [normaliser(e.nom), e]));

  const evenements = [];
  for (const ev of evenementsBruts) {
    const titre = texte(ev.titre);
    if (!titre) continue;
    const debut = heureEnMinutes(ev.debut);
    const fin = heureEnMinutes(ev.fin);
    const { secteur, connu } = secteurCanonique(ev.secteur, avertissements, `événement ${titre}`);
    const intervenantsTexte = texte(ev.intervenants);
    const intervenants = intervenantsTexte.split(/[,;/&+]|\bet\b/).map((t) => normaliser(t)).filter(Boolean)
      .map((n) => exposantsParNom.get(n)).filter(Boolean).map((e) => e.cle);
    const salle = texte(ev.salle);
    evenements.push({
      cle: cleEvenement(titre, debut), format: formatCanonique(ev.format), titre, secteur, secteurConnu: connu,
      public: publicsDepuis(ev.public), debut, fin, salle, salleAVenir: salle === '',
      description: texte(ev.description), intervenantsTexte, intervenants, zone: zoneDeSalle(salle), synthetique: false,
    });
  }
  const debutFestival = heureEnMinutes(infos.heure_debut);
  if (debutFestival !== null && !evenements.some((e) => normaliser(e.titre).startsWith('ouverture'))) {
    evenements.push({
      cle: cleEvenement('Ouverture du festival', debutFestival), format: 'Ouverture', titre: 'Ouverture du festival',
      secteur: '', secteurConnu: true, public: ['Tous'], debut: debutFestival, fin: null, salle: 'Accueil', salleAVenir: false,
      description: infos.slogan || '', intervenantsTexte: '', intervenants: [], zone: zoneDeSalle('Accueil'), synthetique: true,
    });
  }
  evenements.sort((a, b) => (a.debut ?? 9999) - (b.debut ?? 9999) || a.titre.localeCompare(b.titre, 'fr'));
  const exposantsParCle = new Map(exposants.map((e) => [e.cle, e]));
  for (const ev of evenements) for (const cle of ev.intervenants) exposantsParCle.get(cle).evenements.push(ev.cle);

  const questions = preparationBrute
    .map((q) => ({ typeExposant: typeExposantCanonique(q.type_exposant), question: texte(q.question), ordre: nombre(q.ordre) ?? 999 }))
    .filter((q) => q.question)
    .sort((a, b) => TYPES_EXPOSANT.indexOf(a.typeExposant) - TYPES_EXPOSANT.indexOf(b.typeExposant) || a.ordre - b.ordre)
    .map((q) => ({ ...q, cle: `${slugType(q.typeExposant)}:${q.ordre}` }));

  return { exposants, evenements, salles, zones, questions, infos, avertissements };
}

// ---------------------------------------------------------------- diff et version

// Changements de salle, de début et de fin entre deux modèles, par clé.
export function diff(avant, apres, options = {}) {
  const changements = [];
  const comparer = (genre, listeAvant, listeApres, champs) => {
    const a = new Map(listeAvant.map((x) => [x.cle, x]));
    const b = new Map(listeApres.map((x) => [x.cle, x]));
    for (const [cle, x] of a) {
      const y = b.get(cle);
      if (!y) { if (options.inclureAjoutsRetraits) changements.push({ cle, genre, champ: 'retire', avant: x.salle, apres: null }); continue; }
      for (const champ of champs) if (x[champ] !== y[champ]) changements.push({ cle, genre, champ, avant: x[champ], apres: y[champ] });
    }
    if (options.inclureAjoutsRetraits) for (const [cle, y] of b) if (!a.has(cle)) changements.push({ cle, genre, champ: 'ajoute', avant: null, apres: y.salle });
  };
  comparer('evenement', avant.evenements, apres.evenements, ['salle', 'debut', 'fin']);
  comparer('exposant', avant.exposants, apres.exposants, ['salle']);
  return changements;
}

export function versionDe(tables) {
  return empreinte(tables);
}

// ---------------------------------------------------------------- lecture des sources

// Réponse gviz (« /*O_o*/ google.visualization.Query.setResponse({...}); ») → table.
export function tablesDepuisGviz(texteReponse) {
  const debut = texteReponse.indexOf('{');
  const fin = texteReponse.lastIndexOf('}');
  if (debut < 0 || fin < 0) throw new Error('gviz : réponse illisible');
  const rep = JSON.parse(texteReponse.slice(debut, fin + 1));
  if (rep.status !== 'ok' || !rep.table) throw new Error(`gviz : ${rep.status || 'erreur'} ${JSON.stringify(rep.errors || '')}`);
  const cols = rep.table.cols || [];
  const lignes = (rep.table.rows || []).map((r) => (r.c || []).map((c) => (c && c.v !== null && c.v !== undefined ? c.v : '')));
  if (lignes.length && lignes[0].some((c) => typeof c === 'string' && c.includes('#REF!'))) {
    throw new Error('gviz : #REF! (IMPORTRANGE non autorisé dans le classeur Export public)');
  }
  if (rep.table.parsedNumHeaders > 0 || cols.some((c) => texte(c.label))) lignes.unshift(cols.map((c) => texte(c.label)));
  return lignes;
}

export function tablesDepuisSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.tables || typeof snapshot.tables !== 'object') {
    throw new Error('snapshot illisible');
  }
  return { version: snapshot.version || versionDe(snapshot.tables), genere_le: snapshot.genere_le || null, source: snapshot.source || 'snapshot', tables: snapshot.tables };
}
