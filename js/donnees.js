// Module Données : des cinq tables brutes (Exposants, Événements, Salles,
// Préparation, Infos) vers le modèle du glossaire (CONTEXT.md). Logique pure :
// ni DOM, ni réseau, ni horloge. Importable tel quel par Node pour les tests.
import { empreinte } from './empreinte.js';

// Les Villages : le festival est découpé par DOMAINE D'ACTIVITÉ, pas par type de
// formation. Un lycéen qui veut soigner va au village Santé & Soin, où il trouve
// côte à côte une prépa PASS, un CFA, une infirmière et un hôpital — au lieu de
// courir de « Écoles d'ingénieurs » à « Métiers ». Deux villages sont des
// fonctions et non des domaines : l'Accueil et les Conférences.
// Le numéro sert au repérage physique (« village 5 ») et à l'ordre du plan.
export const VILLAGES = [
  { numero: 1, nom: 'Accueil', court: 'Accueil', fonction: true },
  { numero: 2, nom: 'Santé & Soin', court: 'Santé' },
  { numero: 3, nom: 'Commerce, Marketing & Management', court: 'Commerce' },
  { numero: 4, nom: 'Banque, Finance & Droit', court: 'Finance & Droit' },
  { numero: 5, nom: 'Ingénierie, Industrie & Sciences', court: 'Ingénierie' },
  { numero: 6, nom: 'Numérique & Cybersécurité', court: 'Numérique' },
  { numero: 7, nom: 'Communication, Médias & Création', court: 'Médias & Création' },
  { numero: 8, nom: 'Formations professionnelles', court: 'Formations pro' },
  { numero: 9, nom: 'Services, Éducation & Sécurité', court: 'Services' },
  { numero: 10, nom: 'Orientation générale', court: 'Orientation' },
  { numero: 11, nom: 'Conférences', court: 'Conférences', fonction: true },
];

// Le vocabulaire des Domaines est celui des Villages, moins les deux fonctions :
// une seule liste à tenir dans le tableur, et « Ingénierie » veut dire la même
// chose sur le plan, dans un filtre et dans « ce qui m'intéresse ».
export const DOMAINES = VILLAGES.filter((v) => !v.fonction).map((v) => v.nom);

// Les huit Secteurs de septembre mélangeaient domaine et type de formation
// (« Ingénieurs » à côté de « Universités & prépas »), ce que la relecture APEL
// du 2026-09-08 a renvoyé. On garde leur traduction pour qu'un tableur pas encore
// migré continue de s'afficher : la valeur ancienne entre, la nouvelle sort.
export const DOMAINES_ANCIENS = {
  'commerce-management': 'Commerce, Marketing & Management',
  'ingenieurs-sciences-numerique': 'Ingénierie, Industrie & Sciences',
  'sante': 'Santé & Soin',
  'communication-medias': 'Communication, Médias & Création',
  'art-design-architecture': 'Communication, Médias & Création',
  'universites-prepas': 'Orientation générale',
  'metiers-alternance': 'Formations professionnelles',
  'international': 'Orientation générale',
};

export const TYPES_EXPOSANT = ['École', 'Pro', 'Entreprise', 'Ancien élève'];
export const FORMATS = ['Conférence', 'Table ronde', 'Atelier'];
export const PUBLICS = ['Tous', 'Collégiens', 'Lycéens', 'Étudiants', 'Parents'];
export const NIVEAUX = ['3e', '2nde', '1re', 'Terminale', 'étudiant', 'parent'];
// Le lycée tient sur deux niveaux ; une Salle sans niveau est au rez-de-chaussée,
// pour qu'une saisie incomplète ne fasse disparaître personne du plan.
export const ETAGES = ['Rez-de-chaussée', '1er étage'];
export const ETAGE_PAR_DEFAUT = ETAGES[0];
export const ZONES_PAR_DEFAUT = VILLAGES.map((v) => ({ numero: v.numero, nom: v.nom }));

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

// ---------------------------------------------------------------- villages, domaines, formats, publics

// Une valeur du tableur vers un Domaine du festival : le libellé exact d'abord,
// puis la traduction d'un ancien Secteur, sinon on garde la valeur telle quelle
// et on le signale. Ne jamais faire disparaître ce qu'un Organisateur a écrit.
function domaineCanonique(valeur, avertissements, ou) {
  const v = texte(valeur);
  if (!v) return { domaine: '', connu: false };
  const n = normaliser(v);
  for (const d of DOMAINES) if (normaliser(d) === n) return { domaine: d, connu: true };
  for (const v2 of VILLAGES) if (normaliser(v2.nom) === n) return { domaine: v2.nom, connu: true };
  const ancien = DOMAINES_ANCIENS[n];
  if (ancien) return { domaine: ancien, connu: true };
  if (avertissements) avertissements.push({ type: 'domaine-inconnu', valeur: v, ou });
  return { domaine: v, connu: false };
}

// « Santé & Soin ; Numérique & Cybersécurité » → deux Domaines. Le point-virgule
// sépare, pas la virgule : les noms de villages en contiennent.
export function domainesDepuis(valeur, avertissements, ou) {
  const bruts = texte(valeur).split(/[;|]/).map((d) => d.trim()).filter(Boolean);
  const domaines = [];
  let tousConnus = true;
  for (const b of bruts) {
    const { domaine, connu } = domaineCanonique(b, avertissements, ou);
    if (!connu) tousConnus = false;
    if (domaine && !domaines.includes(domaine)) domaines.push(domaine);
  }
  return { domaines, connus: tousConnus };
}

// Le Village d'un Exposant : là où est son stand. Unique par construction — un
// stand n'est qu'à un endroit. Vide tant que l'Organisateur ne l'a pas affecté.
function villageCanonique(valeur, avertissements, ou) {
  const v = texte(valeur);
  if (!v) return { village: '', connu: false };
  const n = normaliser(v);
  for (const x of VILLAGES) if (normaliser(x.nom) === n || normaliser(x.court) === n) return { village: x.nom, connu: true };
  const ancien = DOMAINES_ANCIENS[n];
  if (ancien) return { village: ancien, connu: true };
  if (avertissements) avertissements.push({ type: 'village-inconnu', valeur: v, ou });
  return { village: v, connu: false };
}

// « RDC », « rez de chaussée », « 0 » → Rez-de-chaussée ; « 1 », « 1er », « étage 1 » → 1er étage.
export function etageCanonique(valeur) {
  const n = normaliser(valeur);
  if (!n) return ETAGE_PAR_DEFAUT;
  if (/^(rdc|rez|0)/.test(n) || n.includes('rez-de-chaussee')) return ETAGES[0];
  if (/1/.test(n)) return ETAGES[1];
  for (const e of ETAGES) if (normaliser(e) === n) return e;
  return ETAGE_PAR_DEFAUT;
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

// Une Zone du plan EST un Village : même numéro, même nom. La liste par défaut
// donne les onze villages ; le tableur fait foi sur le nom, et peut en ajouter.
const VILLAGE_PAR_NUMERO = new Map(VILLAGES.map((v) => [v.numero, v]));

function construireZones(sallesBrutes) {
  const zones = new Map();
  const neuve = (numero, nom) => {
    const v = numero === null ? null : VILLAGE_PAR_NUMERO.get(numero);
    return {
      numero, nom, libelle: numero === null ? nom : `${numero} · ${nom}`, salles: [],
      court: v && normaliser(v.nom) === normaliser(nom) ? v.court : nom,
      fonction: Boolean(v && v.fonction),
    };
  };
  for (const v of VILLAGES) zones.set(v.numero, neuve(v.numero, v.nom));
  for (const s of sallesBrutes) {
    const z = zoneDepuisLibelle(s.zone);
    if (!z) continue;
    const id = z.numero === null ? z.nom : z.numero;
    if (!zones.has(id)) zones.set(id, neuve(z.numero, z.nom));
    else if (z.numero !== null && z.nom) zones.get(id).nom = z.nom; // le tableur fait foi sur le nom
  }
  return zones;
}

// L'étage d'un Village est celui de ses Salles. Un village dont les salles sont
// réparties sur les deux niveaux apparaît sur les deux plans, avec les seules
// salles de l'étage affiché : c'est le cas d'un gros village qui déborde.
export function etagesDeZone(zone) {
  const etages = [];
  for (const s of zone.salles) if (!etages.includes(s.etage)) etages.push(s.etage);
  return etages.length ? etages : [ETAGE_PAR_DEFAUT];
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
      nom, cle: normaliser(nom), zone, zoneLibelle: texte(s.zone), etage: etageCanonique(s.niveau ?? s.etage),
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
    const ou = `exposant ${nom}`;
    // Village et Domaines sont deux questions différentes : « où est son stand »
    // et « de quoi il parle ». Un tableur d'avant la relecture n'a ni l'un ni
    // l'autre : sa colonne Secteur répond alors approximativement aux deux.
    const { village, connu: villageConnu } = villageCanonique(e.village || e.secteur, avertissements, ou);
    const { domaines, connus } = domainesDepuis(e.domaines || e.village || e.secteur, avertissements, ou);
    const salle = texte(e.salle);
    const zone = zoneDeSalle(salle);
    // La salle fait foi sur le village : c'est elle qui dit où le Visiteur ira.
    // Un désaccord est une erreur de saisie, qu'on signale sans rien casser.
    if (village && zone && normaliser(zone.nom) !== normaliser(village)) {
      avertissements.push({ type: 'village-en-desaccord', valeur: `${village} ≠ ${zone.nom} (${salle})`, ou });
    }
    exposants.push({
      cle: cleExposant(type, nom), type, typeSlug: slugType(type), nom,
      organisation: texte(e.organisation), village: zone ? zone.nom : village, villageConnu,
      domaines, domainesConnus: connus,
      sousTitre: texte(e.sous_titre), description: texte(e.description), niveau: texte(e.niveau),
      site: texte(e.site), ville: texte(e.ville), salle, salleAVenir: salle === '',
      stand: texte(e.stand), presence: texte(e.presence), zone, evenements: [],
    });
  }
  const exposantsParNom = new Map(exposants.map((e) => [normaliser(e.nom), e]));

  const evenements = [];
  for (const ev of evenementsBruts) {
    const titre = texte(ev.titre);
    if (!titre) continue;
    const debut = heureEnMinutes(ev.debut);
    const fin = heureEnMinutes(ev.fin);
    // Un Événement n'a pas de Village (il se tient aux Conférences), seulement
    // des Domaines : une table ronde sur l'alternance parle santé ET bâtiment.
    const { domaines, connus } = domainesDepuis(ev.domaines || ev.secteur, avertissements, `événement ${titre}`);
    const intervenantsTexte = texte(ev.intervenants);
    const intervenants = intervenantsTexte.split(/[,;/&+]|\bet\b/).map((t) => normaliser(t)).filter(Boolean)
      .map((n) => exposantsParNom.get(n)).filter(Boolean).map((e) => e.cle);
    const salle = texte(ev.salle);
    evenements.push({
      cle: cleEvenement(titre, debut), format: formatCanonique(ev.format), titre, domaines, domainesConnus: connus,
      // Un Moment (l'ouverture) est un repère de la matinée, pas un rendez-vous
      // auquel s'inscrire : ni fin, ni intervenant, ni rappel, ni calendrier. Le
      // modèle le décide une fois pour tous les écrans, qui se contentent de lire.
      moment: formatCanonique(ev.format) === 'Ouverture',
      public: publicsDepuis(ev.public), debut, fin, salle, salleAVenir: salle === '',
      description: texte(ev.description), intervenantsTexte, intervenants, zone: zoneDeSalle(salle), synthetique: false,
    });
  }
  const debutFestival = heureEnMinutes(infos.heure_debut);
  if (debutFestival !== null && !evenements.some((e) => normaliser(e.titre).startsWith('ouverture'))) {
    evenements.push({
      cle: cleEvenement('Ouverture du festival', debutFestival), format: 'Ouverture', titre: 'Ouverture du festival', moment: true,
      domaines: [], domainesConnus: true, public: ['Tous'], debut: debutFestival, fin: null, salle: 'Accueil', salleAVenir: false,
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
