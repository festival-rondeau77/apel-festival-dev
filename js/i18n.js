// Module i18n : l'appli en quatre langues (ADR-0012). Le FRANÇAIS reste la
// référence et la clé de tout — clés stables, QR codes, Ma visite, empreinte de
// version ne changent pas. La traduction est une couche de lecture :
//   t(texte)   les textes fixes de l'appli, dictionnaires statiques de i18n/
//   tt(texte)  les textes libres du tableur, dictionnaire produit par le script
//              Apps Script (table `traductions`), puis les statiques en secours
// Sans traduction, le français s'affiche : rien ne peut manquer à l'écran.
// Logique pure : la langue courante est un état de module que l'adaptateur pose.
import { minutesEnHeure } from './donnees.js';
import en from './i18n/en.js';
import es from './i18n/es.js';
import zh from './i18n/zh.js';

export const LANGUES = ['fr', 'en', 'es', 'zh'];
export const LANGUE_PAR_DEFAUT = 'fr';
export const LOCALES = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', zh: 'zh-CN' };
// Le nom de chaque langue DANS cette langue : c'est ce qu'un Visiteur qui ne lit
// pas le français doit reconnaître d'un coup d'œil sur le sélecteur.
export const NOMS_LANGUES = { fr: 'Français', en: 'English', es: 'Español', zh: '中文' };
export const CLE_STOCKAGE_LANGUE = 'festival.langue';

const DICOS = { fr: {}, en, es, zh };

let langueCourante = LANGUE_PAR_DEFAUT;
let traductions = new Map(); // texte français → { en, es, zh }

export function langue() { return langueCourante; }
export function locale() { return LOCALES[langueCourante] || LOCALES.fr; }

export function definirLangue(l) {
  langueCourante = LANGUES.includes(l) ? l : LANGUE_PAR_DEFAUT;
  return langueCourante;
}

export function definirTraductions(dictionnaire) {
  traductions = dictionnaire instanceof Map ? dictionnaire : new Map();
}

// « fr-FR », « en-US », « zh-Hans-CN » → « fr », « en », « zh » ; inconnue → null.
export function langueDepuis(code) {
  const c = String(code || '').toLowerCase().split(/[-_]/)[0];
  return LANGUES.includes(c) ? c : null;
}

// La langue à l'ouverture : le paramètre d'URL (`?lang=en` ou `#/…?lang=en`),
// puis le choix mémorisé, puis la langue du téléphone, puis le français.
export function langueInitiale({ param = null, stockage = null, navigateur = null } = {}) {
  const parUrl = langueDepuis(param);
  if (parUrl) return parUrl;
  try {
    const memorisee = stockage ? langueDepuis(stockage.getItem(CLE_STOCKAGE_LANGUE)) : null;
    if (memorisee) return memorisee;
  } catch { /* stockage indisponible */ }
  const langues = Array.isArray(navigateur) ? navigateur : [navigateur];
  for (const l of langues) { const c = langueDepuis(l); if (c) return c; }
  return LANGUE_PAR_DEFAUT;
}

function interpoler(texte, params) {
  if (!params.length) return texte;
  let i = 0;
  return texte.replace(/%s/g, () => (i < params.length ? String(params[i++]) : '%s'));
}

// Un texte fixe de l'appli. La clé est la phrase française telle qu'elle est
// écrite dans le code ; « %s » reçoit les paramètres dans l'ordre.
export function t(texte, ...params) {
  const dico = DICOS[langueCourante];
  const traduit = dico && Object.prototype.hasOwnProperty.call(dico, texte) ? dico[texte] : texte;
  return interpoler(traduit, params);
}

// Singulier ou pluriel selon n. En français le pluriel commence à 2 (« 0 résultat »),
// dans les autres langues tout ce qui n'est pas 1 est pluriel (« 0 results »).
export function tn(singulier, pluriel, n, ...params) {
  const plusieurs = langueCourante === 'fr' ? n > 1 : n !== 1;
  return t(plusieurs ? pluriel : singulier, n, ...params);
}

// Un texte libre du tableur : sa traduction machine si le script l'a produite,
// sinon le dictionnaire statique (pour les valeurs que l'appli fabrique elle-même,
// comme « Ouverture du festival »), sinon le texte tel quel.
export function tt(texte) {
  const s = texte === null || texte === undefined ? '' : String(texte);
  if (langueCourante === 'fr' || !s) return s;
  const cle = s.trim();
  const ligne = traductions.get(cle);
  const traduit = ligne && typeof ligne[langueCourante] === 'string' && ligne[langueCourante].trim() ? ligne[langueCourante].trim() : null;
  if (traduit) return traduit;
  const dico = DICOS[langueCourante];
  return dico && Object.prototype.hasOwnProperty.call(dico, cle) ? dico[cle] : s;
}

// L'heure au format de la langue : « 9 h 30 » en français, « 9:30 » ailleurs.
export function heure(minutes) {
  if (minutes === null || minutes === undefined) return '';
  if (langueCourante === 'fr') return minutesEnHeure(minutes);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

// Les dictionnaires, pour les tests de couverture.
export function dictionnaire(l) { return DICOS[l] || null; }
