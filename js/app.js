// L'adaptateur navigateur : navigation, rendu, réseau, stockage, horloge, mesures.
// Toute la logique vit dans les modules purs (donnees, visite, stats, sources, plan).
import { CONFIG } from './config.js';
import { construireModele, diff, normaliser } from './donnees.js';
import * as Visite from './visite.js';
import { creerStats, plateforme, identifiantAleatoire, termeDeRecherche, CLE_APPAREIL } from './stats.js';
import * as Passeport from './passeport.js';
import { routeDepuisScan, zoneVisee, codeVise, lireAvecJsQR } from './scan.js';
import { creerSources, creerRafraichisseur, urlAction } from './sources.js';
import { nouveauJeton, empreinteDe, afficherCode, JETON } from './gains.js';
import { analyserRoute, ficheOuverte, ROUTES_EXPOSANT } from './routes.js';
import { ecran, navigation, piedDePage, titreDocument, filtrerEvenements, filtrerExposants, typesPresents, bandeauAnnonces, h as echapper } from './rendu.js';
import { rechercherSurPlan, construireScene, cameraPour, cadrerSur, zoomer, altitudes, projeter, facesVisibles, ordreDeDessin, tranches, etiquette, H_DALLE, INCLINAISON, ORIENTATION_DEFAUT } from './plan.js';
import { t, tt, langue, definirLangue, definirTraductions, langueInitiale, CLE_STOCKAGE_LANGUE, definirLanguesProposees, languesProposees } from './i18n.js';
import { dictionnaireDepuis } from './donnees.js';

const journal = (...a) => { if (location.hostname === 'localhost' || location.search.includes('debug')) console.info('[festival]', ...a); };
const stockage = (() => { try { localStorage.setItem('festival.test', '1'); localStorage.removeItem('festival.test'); return localStorage; } catch { return Visite.stockageMemoire(); } })();

const etat = {
  statsRefusees: false, // « Ne pas envoyer de statistiques » (Besoin d'aide ?), sécurité 05
  route: analyserRoute(location.hash),
  modele: construireModele({}), tables: null, version: null, source: null, derniereMaj: null, bandeau: '',
  // La langue affichée (ADR-0012) et les traductions du bandeau jointes à l'état
  // du script ({ en, es, zh }) — celles du tableur passent par tt().
  langue: 'fr', bandeaux: null,
  // Le thème, clair par défaut (le festival a lieu le jour) ; le sombre est un choix, mémorisé.
  theme: 'clair',
  // Version du code chargé, et version que le service worker sert réellement.
  // Les deux sont affichées en pied de page : leur écart révèle un cache périmé.
  versionAppli: CONFIG.version, versionSW: null,
  visite: Visite.etatInitial(),
  // Le Grand Défi tel que le Worker le publie (défis actifs, objectif), ou null :
  // pas de Worker, ou jamais joint. Le Passeport, lui, vit dans etat.visite.jeu.
  grandDefi: null,
  ui: {
    rechercheProgramme: '', filtreDomaineProgramme: '', filtreFormat: '', filtrePublic: '',
    rechercheExposants: '', ongletExposants: 'École', filtreDomaineExposants: '',
    recherchePlan: '', zoneOuverte: null, salleAllumee: null, etagePlan: null, feuillePlan: null, suggestionsOuvertes: false,
    filtresOuverts: false, etapePreparer: 0, bandeauFerme: '',
    messageScanner: '', // la phrase de l'écran scanner (grand-defi 10), clé de t()
  },
  reseau: { enErreur: false, refus: null },
  maintenant: { jourJ: false, minutes: 0 },
  debug: location.search.includes('debug'),
};

const stockageVisite = Visite.creerStockageVisite(stockage);
etat.visite = stockageVisite.charger();

// ---------------------------------------------------------------- langue

// L'URL d'abord (« ?lang=en » avant ou après le dièse), puis le choix mémorisé,
// puis la langue du téléphone. Le squelette de index.html est en français : on
// le traduit ici, avant le premier rendu.
function parametreLangue() {
  const dansRecherche = new URLSearchParams(location.search).get('lang');
  return dansRecherche || (analyserRoute(location.hash).params.lang || null);
}
function appliquerLangue(l, { memoriser = false } = {}) {
  etat.langue = definirLangue(l);
  document.documentElement.lang = etat.langue;
  const squelette = { '.visuellement-cache[href="#ecran"]': t('Aller au contenu'), '#ecran > .maj': t('Chargement…'), 'noscript p': t('Cette application a besoin de JavaScript.') };
  for (const [sel, texte] of Object.entries(squelette)) { const e = document.querySelector(sel); if (e) e.textContent = texte; }
  if (memoriser) { try { stockage.setItem(CLE_STOCKAGE_LANGUE, etat.langue); } catch { /* quota ou navigation privée */ } }
}
definirLanguesProposees(CONFIG.langues || ['fr']);
appliquerLangue(langueInitiale({ param: parametreLangue(), stockage, navigateur: navigator.languages || navigator.language }));

// Le thème : posé sur <html data-theme> (styles.css) et dans la couleur de la barre du navigateur.
const CLE_STOCKAGE_THEME = 'festival.theme';
function appliquerTheme(theme, { memoriser = false } = {}) {
  etat.theme = theme === 'sombre' ? 'sombre' : 'clair';
  document.documentElement.dataset.theme = etat.theme === 'sombre' ? 'dark' : 'light';
  const couleur = document.querySelector('meta[name="theme-color"]');
  if (couleur) couleur.content = etat.theme === 'sombre' ? '#06182C' : '#F8F8F8';
  if (memoriser) { try { stockage.setItem(CLE_STOCKAGE_THEME, etat.theme); } catch { /* quota ou navigation privée */ } }
}
appliquerTheme((() => { try { return stockage.getItem(CLE_STOCKAGE_THEME); } catch { return null; } })());

function changerTheme() {
  appliquerTheme(etat.theme === 'sombre' ? 'clair' : 'sombre', { memoriser: true });
  stats.noter('ecran', `theme:${etat.theme}`);
  rendre({ conserver: true });
}

function changerLangue(l) {
  if (!languesProposees().includes(l) || l === etat.langue) return;
  appliquerLangue(l, { memoriser: true });
  stats.noter('ecran', `langue:${l}`);
  rendre({ conserver: true });
}

const stats = creerStats({
  stockage,
  // Le nom d'hôte, et rien d'autre : il dit « recette » ou « le vrai site » sans
  // qu'on ait à le configurer, et il ne peut pas mentir sur la provenance.
  origine: location.hostname,
  envoyer: async (salve) => {
    const url = urlMesures();
    if (!url) return { ok: false, definitif: true };
    // Coupe-circuit (sécurité 04) : `stats_actives` = non dans l'onglet Infos, on n'envoie
    // plus rien et la file se vide — le Worker jetterait de toute façon.
    if (mesuresCoupees()) return { ok: true };
    try {
      const rep = await fetch(url, { method: 'POST', body: JSON.stringify(salve), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', keepalive: true });
      // Le Worker répond avec le vrai code HTTP : 400 et 413 sont définitifs, le reste
      // (403, 5xx, réseau) se renvoie.
      if (!rep.ok) return { ok: false, definitif: rep.status === 400 || rep.status === 413 };
      let corps = null;
      try { corps = await rep.json(); } catch { corps = null; }
      if (corps && corps.ok === true) return { ok: true };
      return { ok: false, definitif: Boolean(corps && corps.statut >= 400 && corps.statut < 500) };
    } catch { return { ok: false, definitif: false }; }
  },
});

// Les mesures vont au Worker (ticket 19, `?action=mesures`) ; sans Worker, nulle part.
// Une fonction, pas une constante : JEU_URL est défini plus bas dans ce module.
function urlMesures() {
  return JEU_URL ? urlAction(JEU_URL, 'mesures') : '';
}
const mesuresCoupees = () => /^(non|no|0|false|faux)$/i.test(String(etat.modele && etat.modele.infos && etat.modele.infos.stats_actives || '').trim());

// Le Passeport du Grand Défi (ADR-0014) : un identifiant à lui, gardé tant que le
// téléphone le garde. Il ne sert à rien d'autre ; les mesures ont le leur, renouvelé
// chaque jour (sécurité 05, stats.js). Un téléphone qui jouait avant le 2026-09-24
// retrouve ici son identifiant, donc ses points.
const ID_PASSEPORT = (() => {
  try {
    let id = stockage.getItem(CLE_APPAREIL);
    if (!id) { id = identifiantAleatoire(); stockage.setItem(CLE_APPAREIL, id); }
    return id;
  } catch { return identifiantAleatoire(); }
})();
// Le rendu en a besoin pour le stand du défi mystère (grand-defi 06) : calculé ici
// comme au Worker, rien de plus n'est envoyé.
etat.appareil = ID_PASSEPORT;

// Le vocabulaire du festival : ce qu'une recherche a le droit d'envoyer (sécurité 05).
function vocabulaire(m) {
  return [
    ...m.exposants.flatMap((e) => [e.nom, e.organisation, e.sousTitre, e.village, e.ville, ...(e.domaines || [])]),
    ...m.evenements.flatMap((e) => [e.titre, e.format]),
    ...m.zones.map((z) => z.nom), ...m.salles.map((s) => s.nom),
  ].filter(Boolean);
}

const $ = (s) => document.querySelector(s);
const el = { main: $('#ecran'), nav: $('#nav'), bandeau: $('#bandeau'), annonces: $('#annonces'), pied: $('#pied'), messages: $('#messages'), annonce: $('#annonce') };

// ---------------------------------------------------------------- horloge et messages

function calculerMaintenant() {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  etat.maintenant = { jourJ: etat.modele.infos.date === iso, minutes: d.getHours() * 60 + d.getMinutes(), iso, ms: d.getTime() };
}

function message(texte, { classe = '', duree = 6000, action = null } = {}) {
  const div = document.createElement('div');
  div.className = `message ${classe}`;
  div.setAttribute('role', 'status');
  div.innerHTML = `<span>${texte}</span>${action ? `<button type="button">${echapper(action.libelle)}</button>` : `<button type="button" aria-label="${echapper(t('Fermer'))}">✕</button>`}`;
  div.querySelector('button').addEventListener('click', () => { if (action) action.faire(); div.remove(); });
  el.messages.appendChild(div);
  if (duree) setTimeout(() => div.remove(), duree);
}

// ---------------------------------------------------------------- rendu

let scrollAvant = null;
function rendre({ conserver = false } = {}) {
  const actif = document.activeElement;
  const champActif = actif && actif.dataset ? actif.dataset.champ : null;
  const selection = champActif ? [actif.selectionStart, actif.selectionEnd] : null;
  const y = window.scrollY;
  calculerMaintenant();
  el.main.innerHTML = ecran(etat);
  // La largeur de la jauge du Grand Défi, par le CSSOM : la CSP refuse l'attribut style (sécurité 06).
  for (const s of el.main.querySelectorAll('[data-part]')) s.style.width = `${Number(s.dataset.part) || 0}%`;
  el.nav.innerHTML = navigation(etat);
  el.pied.innerHTML = piedDePage(etat);
  document.title = titreDocument(etat);
  peindreBandeau();
  peindreAnnonces();
  if (champActif) {
    const champ = el.main.querySelector(`[data-champ="${champActif}"]`);
    if (champ) { champ.focus({ preventScroll: true }); try { champ.setSelectionRange(selection[0], selection[1]); } catch { /* type search sur certains navigateurs */ } }
  }
  if (conserver) window.scrollTo(0, y);
  else if (scrollAvant !== null) { window.scrollTo(0, scrollAvant); scrollAvant = null; }
  else window.scrollTo(0, 0);
  document.body.classList.toggle('plan-ouvert', etat.route.nom === 'plan');
  if (etat.route.nom === 'plan') initialiserPlan();
  else { if (plan.anim) cancelAnimationFrame(plan.anim); plan.anim = null; plan.cam = null; plan.cible = ''; plan.noeuds = []; }
  if (etat.route.nom === 'scanner') demarrerScanner(); else arreterScanner();
}

// ---------------------------------------------------------------- navigation

// La position de défilement de chaque écran, pour la rendre au retour. Le
// mécanisme existait dans rendre() mais `scrollAvant` n'était JAMAIS écrit : le
// retour ne restaurait donc rien, sur aucun écran. On ne restaure qu'au retour
// d'une fiche — arriver sur une liste par la navigation doit montrer son début.
const positions = new Map();
const FICHES = ['evenement', ...ROUTES_EXPOSANT];

function appliquerRoute() {
  const precedente = etat.route.nom;
  positions.set(precedente, window.scrollY);
  etat.route = analyserRoute(location.hash);
  if (FICHES.includes(precedente) && !FICHES.includes(etat.route.nom) && positions.has(etat.route.nom)) {
    scrollAvant = positions.get(etat.route.nom);
  }
  const p = etat.route.params;
  if (etat.route.nom === 'scanner' && precedente !== 'scanner') { scanner.bloque = false; etat.ui.messageScanner = ''; }
  if (etat.route.nom === 'plan') {
    etat.ui.salleAllumee = p.salle || null;
    // « village » et « zone » désignent la même chose : le second est l'ancien
    // nom, gardé parce qu'il peut dormir dans un favori ou un QR code déjà gravé.
    if (p.village !== undefined) etat.ui.zoneOuverte = p.village;
    else if (p.zone !== undefined) etat.ui.zoneOuverte = p.zone;
    if (p.salle) { etat.ui.recherchePlan = ''; etat.ui.zoneOuverte = null; }
    etat.ui.feuillePlan = null;
    // La croix ramène d'où l'on vient quand un écran de l'appli précède le plan,
    // à l'accueil sinon (arrivée directe par l'URL ou un QR code).
    if (precedente !== 'plan') plan.retour = demarre ? 'back' : 'accueil';
  }
  if (etat.route.nom === 'exposants') {
    if (p.onglet) etat.ui.ongletExposants = p.onglet;
    if (p.domaine !== undefined) etat.ui.filtreDomaineExposants = p.domaine;
    else if (p.secteur !== undefined) etat.ui.filtreDomaineExposants = p.secteur;
  }
  // Le jeton d'une Carte (ou le secret d'un ancien chevalet) ne part jamais dans
  // les mesures : seule la clé de l'Exposant, ou l'étiquette d'une Carte pas encore attribuée.
  const fiche = ficheOuverte(etat.route, etat.modele);
  if (fiche && fiche.qr) stats.noter('qr_scan', fiche.cle || fiche.etiquette);
  if (fiche && fiche.cle) stats.noter('fiche_exposant', fiche.cle);
  if (etat.route.nom === 'evenement') stats.noter('fiche_evenement', p.cle || '');
  stats.noter('ecran', etat.route.nom);
  const cleFiche = etat.route.nom === 'evenement' ? p.cle : fiche && fiche.cle;
  if (cleFiche && Visite.contient(etat.visite, cleFiche)) {
    const entree = etat.visite.entrees.find((e) => e.cle === cleFiche);
    if (entree.alerte && !entree.alerte.vue) { setTimeout(() => { modifierVisite(Visite.marquerAlerteVue(etat.visite, cleFiche)); }, 4000); }
  }
  rendre();
}

let demarre = false;
window.addEventListener('hashchange', appliquerRoute);

// ---------------------------------------------------------------- visite

function modifierVisite(nouvel) {
  if (nouvel === etat.visite) return;
  etat.visite = nouvel;
  stockageVisite.sauver(nouvel);
  rendre({ conserver: true });
}

function objetParCle(cle) {
  return etat.modele.evenements.find((e) => e.cle === cle) || etat.modele.exposants.find((e) => e.cle === cle) || null;
}

function basculerEtoile(cle) {
  const objet = objetParCle(cle);
  if (!objet) return;
  const dans = Visite.contient(etat.visite, cle);
  modifierVisite(Visite.basculer(etat.visite, objet, Date.now()));
  stats.noter(dans ? 'visite_retrait' : 'visite_ajout', cle);
  const nom = objet.titre ? tt(objet.titre) : objet.nom;
  if (dans) { message(echapper(t('Retiré de ma visite : %s', nom)), { duree: 2500 }); return; }
  // Le conflit se dit MAINTENANT, pendant que le Visiteur peut encore choisir : la
  // détection existait déjà, elle n'était lue qu'à l'ouverture de Ma visite (ADR-0010).
  const conflits = Visite.chevauchementsDe(etat.visite, etat.modele, cle);
  if (!conflits.length) { message(echapper(t('★ Ajouté à ma visite : %s', nom)), { duree: 2500 }); return; }
  const autre = objetParCle(conflits[0].a === cle ? conflits[0].b : conflits[0].a);
  message(echapper(t('★ Ajouté, mais à la même heure que « %s »', autre ? (autre.titre ? tt(autre.titre) : autre.nom) : t('un autre événement'))),
    { classe: 'alerte', duree: 9000, action: { libelle: t('Voir'), faire: () => { location.hash = '#/visite'; } } });
}

function ajouterAuCalendrier(cle) {
  const ev = etat.modele.evenements.find((e) => e.cle === cle);
  const ics = Visite.icalendar(ev, etat.modele.infos);
  if (!ics) { message(echapper(t('Date du festival inconnue : impossible de créer le rappel.')), { classe: 'alerte' }); return; }
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${normaliser(ev.titre)}.ics`; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  stats.noter('calendrier', cle);
}

// ---------------------------------------------------------------- Grand Défi (ADR-0014, ADR-0016)

// Le Worker du jeu : celui de config.js, ou celui que `npm run servir` sert à côté
// de l'appli. Vide = pas de jeu du tout, l'appli d'avant le Grand Défi.
const JEU_URL = Passeport.urlJeu(location.hostname, CONFIG.jeuUrl);
// Le Worker local de `npm run servir` et de la fumée : rien à étaler, rien à attendre.
const JEU_LOCAL = JEU_URL === './jeu';
const CLE_JEU = 'festival.jeu';
// Sans Worker, le jeu gardé d'une visite précédente ne s'affiche pas : aucune trace.
try { etat.grandDefi = JEU_URL ? Passeport.lireJeuPublic(JSON.parse(stockage.getItem(CLE_JEU) || 'null')) : null; } catch { etat.grandDefi = null; }

async function chargerJeu() {
  if (!JEU_URL) return;
  const rep = await fetch(urlAction(JEU_URL, 'jeu'), { cache: 'no-store' });
  if (!rep.ok) throw new Error(`jeu : HTTP ${rep.status}`);
  const jeu = Passeport.lireJeuPublic(await rep.json());
  if (!jeu) throw new Error('jeu : réponse illisible');
  try { stockage.setItem(CLE_JEU, JSON.stringify(jeu)); } catch { /* quota ou navigation privée */ }
  if (JSON.stringify(jeu) === JSON.stringify(etat.grandDefi)) return;
  etat.grandDefi = jeu;
  rendre({ conserver: true });
}

// La file d'envoi des validations : chacune reste dans le téléphone (Ma visite)
// jusqu'à ce que la réponse du Worker la montre traitée. Seul un 400 (salve
// refusée pour de bon) l'abandonne ; le reste, réseau compris, se renvoie.
const fileJeu = Passeport.creerEnvoi({
  obtenir: () => etat.visite.jeu,
  modifier: (jeu) => modifierVisite({ ...etat.visite, jeu }),
  envoyer: async (validations) => {
    const rep = await fetch(urlAction(JEU_URL, 'stats'), {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ appareil: ID_PASSEPORT, origine: location.hostname.slice(0, 80), validations }),
    });
    if (rep.status === 400) return { ok: false, definitif: true };
    if (!rep.ok) return { ok: false };
    const corps = await rep.json();
    return corps && corps.ok ? { ok: true, passeport: corps.passeport } : { ok: false };
  },
});
// Sans Worker, rien ne part : les validations restent gardées dans le téléphone.
const envoiJeu = { envoyer: () => (JEU_URL ? fileJeu.envoyer() : Promise.resolve()) };

// Gagner (grand-defi 07). Le jeton privé de ce téléphone, tiré ici au premier besoin et
// gardé avec le Passeport : seule son empreinte part au Worker ; lui-même ne sort que
// dans le QR de l'écran « Vous avez gagné », que scanne l'Organisateur.
const CLE_JETON = 'festival.jeton';
const JETON_GAIN = (() => {
  try {
    let j = stockage.getItem(CLE_JETON);
    if (!j || !JETON.test(j)) { j = nouveauJeton(); stockage.setItem(CLE_JETON, j); }
    return j;
  } catch { return nouveauJeton(); }
})();
// L'adresse absolue du Worker (./jeu en local) : c'est elle que porte le QR.
etat.remise = { worker: JEU_URL ? new URL(JEU_URL, location.href).href.replace(/\/+$/, '') : '', jeton: JETON_GAIN };

// Les gains de ce Passeport (`?action=gain`), demandés quand l'état annonce un Tirage
// pas encore vu (passeport.gainsARelire) : après un temps tiré entre 0 et 20 s, pour que
// 600 téléphones ne frappent pas le Worker à la même seconde ; tout de suite pour un
// gagnant qui attend sa Remise, et sur la machine. Un échec se retente au prochain état (une minute).
let demandeGains = null;
function demanderGains(marque) {
  if (demandeGains) return;
  const nouveau = Boolean(marque) && marque !== etat.visite.jeu.tirageVu;
  demandeGains = setTimeout(async () => {
    try {
      const rep = await fetch(urlAction(JEU_URL, 'gain'), {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ appareil: ID_PASSEPORT, empreinte: await empreinteDe(JETON_GAIN) }),
      });
      if (!rep.ok) throw new Error(`gain : HTTP ${rep.status}`);
      modifierVisite({ ...etat.visite, jeu: Passeport.appliquerGains(etat.visite.jeu, await rep.json(), marque) });
    } catch (e) { journal('gains indisponibles', e); }
    finally { demandeGains = null; }
  }, nouveau && !JEU_LOCAL ? Math.random() * 20_000 : 0);
}

// « Copier le message » (le mail d'un absent), quand le lien mailto ne mène à rien.
async function copierMessage(code) {
  const g = (etat.visite.jeu.gains || []).find((x) => x.code === code);
  if (!g) return;
  const i = etat.modele.infos || {};
  const adresse = String(i.contact_email || '').trim();
  const { sujet, corps } = Passeport.messageAbsent(g, { email: adresse, festival: i.nom || undefined });
  try {
    await navigator.clipboard.writeText(`${adresse ? `${adresse}\n` : ''}${sujet}\n\n${corps}`);
    message(echapper(adresse ? t('Message copié : collez-le dans un mail à %s.', adresse) : t('Message copié : collez-le dans un mail à l’école.')));
  } catch {
    message(echapper(t('Copie impossible : écrivez à l’école avec votre code %s.', afficherCode(code))), { classe: 'orange' });
  }
}

// `choix` : le numéro du choix touché (défi à choix), qui part avec la preuve.
function validerDefi(defi, cle, choix) {
  const fiche = ficheOuverte(etat.route, etat.modele);
  const secret = fiche && fiche.cle === cle ? fiche.secret : '';
  if (!secret || !defi || !cle) return;
  const n = choix === undefined || choix === '' ? undefined : Number(choix);
  const v = Passeport.nouvelleValidation({ id: identifiantAleatoire(), defi, exposant: cle, secret, choix: n, t: Date.now() });
  modifierVisite({ ...etat.visite, jeu: Passeport.ajouterValidation(etat.visite.jeu, v) });
  envoiJeu.envoyer();
}

// Une réponse à une question (grand-defi 04) : le numéro du choix touché part avec le
// jeton du QR spécial, lu dans la route (#/question/<défi>/<jeton>) et jamais
// ailleurs. Une seule réponse à la fois : la suivante attend le verdict du Worker.
function repondre(defi, choix) {
  const { nom, params } = etat.route;
  const q = nom === 'question' && params.defi === defi ? Passeport.questionIci(etat.grandDefi, etat.visite.jeu, defi, { jeton: params.jeton }) : null;
  const n = Number(choix);
  if (!q || !q.peutRepondre || !Number.isInteger(n)) return;
  const v = Passeport.nouvelleValidation({ id: identifiantAleatoire(), defi, exposant: '', secret: params.jeton || '', choix: n, t: Date.now() });
  modifierVisite({ ...etat.visite, jeu: Passeport.ajouterValidation(etat.visite.jeu, v) });
  envoiJeu.envoyer();
}

// Un vote autour d'un Événement (grand-defi 05) : le numéro du choix touché, et rien
// d'autre ; l'heure du téléphone part avec, le Worker la retient ou prend l'heure
// d'arrivée. Seulement dans une fenêtre ouverte, un vote à la fois.
function voter(defi, choix) {
  const { nom, params } = etat.route;
  const v = nom === 'vote' && params.defi === defi ? Passeport.voteIci(etat.grandDefi, etat.visite.jeu, defi, Date.now()) : null;
  const n = Number(choix);
  if (!v || !v.peutVoter || !Number.isInteger(n)) return;
  const val = Passeport.nouvelleValidation({ id: identifiantAleatoire(), defi, exposant: '', secret: '', choix: n, t: Date.now() });
  modifierVisite({ ...etat.visite, jeu: Passeport.ajouterValidation(etat.visite.jeu, val) });
  envoiJeu.envoyer();
}

// Une réponse à un instant gagnant (grand-defi 08) : enregistrée au geste (son heure
// part avec elle), envoyée dans la minute, à un moment tiré au hasard, pour qu'une salle
// entière qui répond à la même seconde n'arrive pas d'un coup au Worker. Tout de suite sur
// la machine. Un autre envoi (retour du réseau, autre validation) peut l'emporter plus tôt.
function repondreInstant(defi, choix) {
  const { nom, params } = etat.route;
  const q = nom === 'instant' && params.defi === defi ? Passeport.instantIci(etat.grandDefi, etat.visite.jeu, defi, Date.now()) : null;
  const n = Number(choix);
  if (!q || q.statut !== 'ouvert' || !Number.isInteger(n)) return;
  const v = Passeport.nouvelleValidation({ id: identifiantAleatoire(), defi, exposant: '', secret: '', choix: n, t: Date.now() });
  modifierVisite({ ...etat.visite, jeu: Passeport.ajouterValidation(etat.visite.jeu, v) });
  setTimeout(() => envoiJeu.envoyer(), JEU_LOCAL ? 0 : Passeport.delaiEnvoiInstant(Math.random()));
}

// Rejouer depuis le début (essai, grand-defi 11) : ce téléphone oublie son Passeport
// et ses validations, puis l'appli redémarre et en tire un nouveau (ID_PASSEPORT est
// fixé au démarrage). Ma visite reste. Au Worker, l'ancien Passeport garde ses lignes.
function rejouer() {
  if (!Passeport.rejouerOuvert(etat.modele.infos)) return;
  try { stockage.removeItem(CLE_APPAREIL); stockage.removeItem(CLE_JETON); } catch { /* navigation privée : rien à oublier */ }
  stockageVisite.sauver({ ...etat.visite, jeu: Passeport.etatJeuInitial() });
  history.replaceState(null, '', '#/');
  location.reload();
}

window.addEventListener('online', () => envoiJeu.envoyer());

// ---------------------------------------------------------------- scanner (grand-defi 10, ADR-0017)

// Scanner DANS l'appli : le QR d'un Chevalet ouvre sa fiche au même Passeport,
// là où un lecteur de QR du téléphone ouvre souvent une fenêtre cloisonnée, avec
// sa propre mémoire. Le navigateur lit les QR s'il sait (BarcodeDetector,
// Chrome sur Android) ; sinon js/vendor/jsqr.js (Safari), chargé à la demande.
// Le message affiché vit dans l'état (etat.ui.messageScanner), pas dans la page ;
// la caméra, elle, vit ici, et survit aux rendus (le flux est rebranché sur la
// nouvelle <video>). Chaque ouverture porte un numéro de session : arrêter en
// change le numéro, et une boucle ou une ouverture d'une session finie s'éteint.
// Les adresses de CETTE appli : la page qui scanne, et son urlPublique (celle du
// dev sur le dev, réécrite par deploy.sh). Chemin compris : sur github.io, dev,
// prod et maquettes partagent un hôte.
const BASES_APPLI = [location.href, CONFIG.urlPublique];
const scanner = { flux: null, session: 0, ouverture: false, minuteur: null, bloque: false, detecteur: undefined, jsQR: null, toile: null };

function messageScanner(cle) {
  if (etat.ui.messageScanner === cle) return;
  etat.ui.messageScanner = cle;
  if (etat.route.nom === 'scanner') rendre({ conserver: true });
}

async function lecteurQR() {
  if (scanner.detecteur === undefined) {
    scanner.detecteur = null;
    try { if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) scanner.detecteur = new BarcodeDetector({ formats: ['qr_code'] }); } catch { scanner.detecteur = null; }
  }
  if (scanner.detecteur || scanner.jsQR) return;
  await new Promise((charge, echec) => { const s = document.createElement('script'); s.src = './js/vendor/jsqr.js'; s.onload = charge; s.onerror = echec; document.head.appendChild(s); });
  scanner.jsQR = window.jsQR;
}

// Seulement le QR visé : celui du cadre blanc, pas son voisin sur la table (scan.js).
async function lireImage(video) {
  if (!video || !video.videoWidth) return null;
  const boiteL = video.clientWidth || video.videoWidth, boiteH = video.clientHeight || video.videoHeight;
  if (scanner.detecteur) {
    const zone = zoneVisee(video.videoWidth, video.videoHeight, boiteL, boiteH);
    const r = await scanner.detecteur.detect(video);
    return codeVise(r.map((c) => ({ texte: c.rawValue, centre: { x: c.boundingBox.x + c.boundingBox.width / 2, y: c.boundingBox.y + c.boundingBox.height / 2 } })), zone);
  }
  const largeur = 480, hauteur = Math.round((video.videoHeight * largeur) / video.videoWidth);
  const toile = scanner.toile || (scanner.toile = document.createElement('canvas'));
  toile.width = largeur; toile.height = hauteur;
  const ctx = toile.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, largeur, hauteur);
  return lireAvecJsQR(scanner.jsQR, ctx.getImageData(0, 0, largeur, hauteur).data, largeur, hauteur, zoneVisee(largeur, hauteur, boiteL, boiteH));
}

// Appelé à chaque rendu de l'écran scanner : ouvre la caméra la première fois,
// la rebranche ensuite. Après un refus, on ne redemande pas à chaque rendu :
// il faut revenir sur l'écran (appliquerRoute remet `bloque` à faux).
async function demarrerScanner() {
  const video = $('#scanner-video');
  if (!video || scanner.bloque) return;
  if (scanner.flux) { if (video.srcObject !== scanner.flux) { video.srcObject = scanner.flux; video.play().catch(() => {}); } return; }
  if (scanner.ouverture) return;
  scanner.ouverture = true;
  const moi = ++scanner.session;
  const encore = () => scanner.session === moi && etat.route.nom === 'scanner';
  messageScanner('Ouverture de la caméra…');
  let flux = null;
  try {
    await lecteurQR(); // le lecteur d'abord : s'il manque, la caméra n'est même pas allumée
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('caméra'), { name: 'NotFoundError' });
    flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch (e) {
    if (flux) flux.getTracks().forEach((p) => p.stop());
    if (!encore()) return;
    scanner.ouverture = false; scanner.bloque = true;
    messageScanner(e && e.name === 'NotAllowedError' ? 'Caméra refusée : autorisez-la dans les réglages du navigateur.' : 'Pas de caméra disponible sur cet appareil.');
    return;
  }
  if (!encore()) { flux.getTracks().forEach((p) => p.stop()); return; } // quitté pendant l'ouverture
  scanner.ouverture = false;
  scanner.flux = flux;
  const courante = $('#scanner-video');
  if (courante) { courante.srcObject = flux; courante.play().catch(() => {}); }
  messageScanner('Visez le QR code du stand.');
  const tour = async () => {
    if (scanner.session !== moi) return;
    let texte = null;
    try { texte = await lireImage($('#scanner-video')); } catch { texte = null; }
    if (scanner.session !== moi) return; // arrêté pendant la lecture : cette boucle s'éteint
    const route = texte ? routeDepuisScan(texte, BASES_APPLI) : null;
    if (route) {
      arreterScanner();
      // Vibrer n'est permis qu'après un geste sur la page (sinon le navigateur le refuse et le dit en console).
      if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(60);
      location.replace(route);
      return;
    }
    if (texte) messageScanner('Ce QR code n’est pas celui d’un stand du festival.');
    scanner.minuteur = setTimeout(tour, texte ? 1500 : 150);
  };
  tour();
}

function arreterScanner() {
  clearTimeout(scanner.minuteur); scanner.minuteur = null;
  if (scanner.flux) scanner.flux.getTracks().forEach((p) => p.stop());
  scanner.flux = null;
  scanner.ouverture = false;
  scanner.session++; // toute boucle ou ouverture en cours devient caduque
}

// ---------------------------------------------------------------- gestes

let minuteurRecherche = null;
document.addEventListener('input', (e) => {
  const champ = e.target.dataset ? e.target.dataset.champ : null;
  if (!champ) return;
  // Le carnet (grand-defi 02) : gardé dans Ma visite à chaque frappe, sans nouveau
  // rendu (le curseur reste où il est) ; il ne part jamais, ni au Worker ni dans les mesures.
  if (champ === 'carnet') {
    etat.visite = Visite.ecrireCarnet(etat.visite, e.target.dataset.cle, e.target.value);
    stockageVisite.sauver(etat.visite);
    return;
  }
  etat.ui[champ] = e.target.value;
  clearTimeout(minuteurRecherche);
  minuteurRecherche = setTimeout(() => {
    if (champ === 'recherchePlan') { etat.ui.salleAllumee = null; etat.ui.zoneOuverte = null; etat.ui.feuillePlan = null; }
    rendre({ conserver: true });
    noterRecherche(champ);
  }, 180);
});

function noterRecherche(champ) {
  if (normaliser(etat.ui[champ]).length < 2) return;
  const terme = termeDeRecherche(etat.ui[champ], vocabulaire(etat.modele));
  let n = 0;
  if (champ === 'rechercheProgramme') n = filtrerEvenements(etat.modele, etat.ui).length;
  else if (champ === 'rechercheExposants') n = filtrerExposants(etat.modele, etat.ui, typesPresents(etat.modele).includes(etat.ui.ongletExposants) ? etat.ui.ongletExposants : typesPresents(etat.modele)[0]).length;
  else n = rechercherSurPlan(etat.modele, etat.ui[champ]) ? 1 : 0;
  clearTimeout(noterRecherche.minuteur);
  noterRecherche.minuteur = setTimeout(() => stats.noter('recherche', terme, String(n)), 900);
}

document.addEventListener('click', (e) => {
  const cible = e.target.closest('[data-action]');
  if (!cible) return;
  const { action, cle, valeur, filtre, champ } = cible.dataset;
  switch (action) {
    case 'etoile': e.preventDefault(); basculerEtoile(cle); break;
    case 'retirer': e.preventDefault(); modifierVisite(Visite.retirer(etat.visite, cle)); break;
    case 'effacer': etat.ui[champ] = ''; if (champ === 'recherchePlan') { etat.ui.salleAllumee = null; etat.ui.feuillePlan = null; } rendre({ conserver: true }); el.main.querySelector(`[data-champ="${champ}"]`)?.focus(); break;
    case 'filtre': etat.ui[filtre] = etat.ui[filtre] === valeur && filtre !== 'filtrePublic' ? '' : valeur; rendre({ conserver: true }); break;
    case 'filtres': etat.ui.filtresOuverts = !etat.ui.filtresOuverts; rendre({ conserver: true }); break;
    // Changer d'onglet garde le Domaine : il traverse les onglets (voir ecranExposants),
    // et le compte affiché sur chaque onglet dit déjà combien on y trouvera.
    case 'onglet': etat.ui.ongletExposants = valeur; rendre({ conserver: true }); break;
    case 'zone': etat.ui.zoneOuverte = etat.ui.zoneOuverte === valeur ? null : valeur; etat.ui.salleAllumee = null; etat.ui.recherchePlan = ''; etat.ui.feuillePlan = null; rendre({ conserver: true }); break;
    case 'salle': etat.ui.salleAllumee = valeur; etat.ui.recherchePlan = ''; etat.ui.zoneOuverte = null; etat.ui.feuillePlan = null; rendre({ conserver: true }); break;
    // Toucher un étage l'ouvre à plat ; le retoucher quand il est ouvert ferme
    // ce qui était sélectionné dessus. Le village allumé, lui, traverse les vues.
    case 'etage': {
      const ouvert = ($('#plan-plein') || {}).dataset?.nom === valeur;
      if (!ouvert) etat.ui.etagePlan = valeur;
      etat.ui.salleAllumee = null; etat.ui.recherchePlan = ''; etat.ui.feuillePlan = null;
      if (ouvert) etat.ui.zoneOuverte = null;
      rendre({ conserver: true }); break;
    }
    case 'vue-ensemble': etat.ui.etagePlan = null; etat.ui.salleAllumee = null; etat.ui.recherchePlan = ''; etat.ui.feuillePlan = null; rendre({ conserver: true }); break;
    case 'zoom': { if (!plan.cam) break; const d = dimensionsPlan(); plan.cam = zoomer(plan.cam, Number(valeur) > 0 ? 1.4 : 1 / 1.4, d.largeur / 2, (d.hauteur - d.reserve.bas) / 2, plan.base); dessinerPlan(); break; }
    case 'recentrer': plan.yaw = ORIENTATION_DEFAUT; plan.pitch = INCLINAISON.defaut; plan.cible = ''; initialiserPlan(); break;
    case 'fermer-plan': fermerPlan(); break;
    case 'feuille': if (plan.feuilleGlisse) break; etat.ui.feuillePlan = ($('#feuille') || {}).dataset?.hauteur === 'repliee' ? 'mi' : 'repliee'; rendre({ conserver: true }); break;
    case 'calendrier': ajouterAuCalendrier(cle); break;
    case 'interet': modifierVisite(Visite.basculerInteret(etat.visite, valeur)); break;
    case 'niveau': modifierVisite(Visite.definirNiveau(etat.visite, valeur)); break;
    case 'suggestions': etat.ui.suggestionsOuvertes = !etat.ui.suggestionsOuvertes; rendre({ conserver: true }); break;
    case 'etape': etat.ui.etapePreparer = Number(valeur) || 0; rendre(); break;
    case 'avis': stats.noter('clic_avis'); break;
    case 'refus-stats': if (stats.refusees()) stats.accepter(); else stats.refuser(); etat.statsRefusees = stats.refusees(); rendre({ conserver: true }); break;
    case 'site': stats.noter('clic_site', cle); break;
    case 'recharger': rechargerNouvelleVersion(); break;
    case 'langue': changerLangue(valeur); break;
    case 'theme': changerTheme(); break;
    case 'valider-defi': validerDefi(cible.dataset.defi, cle, cible.dataset.choix); break;
    case 'repondre': repondre(cible.dataset.defi, cible.dataset.choix); break;
    case 'voter': voter(cible.dataset.defi, cible.dataset.choix); break;
    case 'repondre-instant': repondreInstant(cible.dataset.defi, cible.dataset.choix); break;
    case 'rejouer': rejouer(); break;
    case 'copier-message': copierMessage(cible.dataset.code); break;
    default: break;
  }
});

document.addEventListener('change', (e) => {
  const cible = e.target.closest('[data-action]');
  if (!cible) return;
  const { action, cle } = cible.dataset;
  if (action === 'fait') modifierVisite(Visite.basculerFait(etat.visite, cle));
  if (action === 'question') modifierVisite(Visite.basculerQuestion(etat.visite, cle));
});

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-action]')) { e.preventDefault(); e.target.click(); }
});

// ---------------------------------------------------------------- plan : caméra, dessin, gestes (ADR-0013)

// Le module Plan calcule ; ici on mesure la scène, on pose les coordonnées sur le
// SVG à chaque image, et on lit les doigts. La caméra vit ici, pas dans l'état
// rendu : elle bouge soixante fois par seconde et n'a pas à refaire l'écran.
const plan = {
  scene: null, modele: null,      // la scène jointe, recalculée quand le modèle change
  cam: null, base: 1,             // caméra courante, échelle qui cadre la vue entière
  yaw: ORIENTATION_DEFAUT, pitch: INCLINAISON.defaut, // l'orientation choisie en vue d'ensemble
  op: {},                         // opacité par étage
  cible: '',                      // ce que la caméra cadre (vue, salle, place réservée)
  noeuds: [], anim: null,
  retour: 'accueil',              // 'back' si un écran de l'appli précède le plan
  feuilleGlisse: false,           // la poignée vient d'être tirée : pas un appui
};
const SEUIL_GESTE = 4; // px : en deçà, c'est un appui, pas un déplacement
const REDUIRE_MOUVEMENT = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

function sceneCourante() {
  if (plan.modele !== etat.modele || !plan.scene) { plan.modele = etat.modele; plan.scene = construireScene(etat.modele); }
  return plan.scene;
}

// La place que la feuille prend sur la scène : en bas sur un téléphone (elle se
// pose par-dessus), rien au large (elle est à côté).
function reservePlan() {
  const feuille = $('#feuille');
  if (!feuille || getComputedStyle(feuille).position !== 'absolute') return { bas: 0 };
  return { bas: Math.min(feuille.offsetHeight, Math.round(($('#plan-viewport') || feuille).clientHeight * 0.55)) };
}
function dimensionsPlan() {
  const vp = $('#plan-viewport');
  return { largeur: vp ? vp.clientWidth : 360, hauteur: vp ? vp.clientHeight : 600, reserve: reservePlan() };
}

const points = (a) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
const chemin = (polys) => polys.map((poly) => `M${poly.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('L')}Z`).join('');
const etoileSvg = (x, y, r) => { let d = ''; for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.44 : r; d += `${k ? 'L' : 'M'}${(x + Math.cos(a) * rr).toFixed(1)} ${(y + Math.sin(a) * rr).toFixed(1)}`; } return `${d}Z`; };

// Les nœuds du SVG, retrouvés une fois par rendu : le squelette vient de rendu.js,
// dans l'ordre de la scène, et chaque Pièce porte son index.
function attacherPlan(svg, scene) {
  plan.noeuds = scene.etages.map((e) => {
    const g = svg.querySelector(`.etage[data-etage="${CSS.escape(e.etage)}"]`);
    const etiq = svg.querySelector(`.etiq-etage[data-etage="${CSS.escape(e.etage)}"]`);
    const parIndex = new Map([...g.querySelectorAll('.piece')].map((n) => [Number(n.dataset.i), n]));
    return {
      e, g, sol: g.querySelector('.sol'), tranches: g.querySelector('.tranches'), dalle: g.querySelector('.dalle'), trous: [...g.querySelectorAll('.vide')], gPieces: g.querySelector('.pieces'), ordre: '',
      pieces: e.pieces.map((p) => { const n = parIndex.get(p.i); return { p, g: n, cotes: n.querySelector('.cotes'), halo: n.querySelector('.halo'), ft: n.querySelector('.face-t'), txt: n.querySelector('.lbl'), spans: n.querySelectorAll('tspan'), marque: n.querySelector('.marque') }; }),
      etiq: { g: etiq, filet: etiq.querySelector('.filet'), nom: etiq.querySelector('.nom'), det: etiq.querySelector('.det') },
    };
  });
}

function dessinerPlan() {
  const cam = plan.cam, scene = plan.scene;
  if (!cam || !scene || !plan.noeuds.length) return;
  const vp = $('#plan-viewport');
  const petit = (vp ? vp.clientWidth : 400) < 560;
  const axo = ($('#plan-plein') || {}).dataset?.vue === 'axo';
  const zs = altitudes(scene, cam);
  for (const nd of plan.noeuds) {
    const zT = zs[nd.e.index];
    const op = plan.op[nd.e.etage] ?? 1;
    nd.g.style.opacity = op;
    nd.g.classList.toggle('eteint', op < 0.2);
    if (nd.sol) nd.sol.setAttribute('points', points(nd.e.sol.map(([x, y]) => projeter(x, y, zT, cam))));
    const tr = tranches(nd.e.contour, zT, cam);
    while (nd.tranches.childNodes.length < tr.length) nd.tranches.append(document.createElementNS('http://www.w3.org/2000/svg', 'polygon'));
    tr.forEach((q, i) => nd.tranches.childNodes[i].setAttribute('points', points(q.points)));
    nd.dalle.setAttribute('d', chemin([nd.e.contour, ...nd.e.trous].map((poly) => poly.map(([x, y]) => projeter(x, y, zT, cam)))));
    nd.e.trous.forEach((tp, i) => nd.trous[i].setAttribute('points', points(tp.map(([x, y]) => projeter(x, y, zT - H_DALLE, cam)))));
    const ordre = ordreDeDessin(nd.e.pieces, cam);
    const cle = ordre.join();
    if (nd.ordre !== cle) { nd.ordre = cle; for (const i of ordre) nd.gPieces.append(nd.pieces[i].g); }
    for (const s of nd.pieces) {
      const { haut, cotes } = facesVisibles(s.p.poly, zT, s.p.H, cam);
      const pts = points(haut);
      s.ft.setAttribute('points', pts);
      s.halo.setAttribute('points', pts);
      while (s.cotes.childNodes.length < cotes.length) s.cotes.append(document.createElementNS('http://www.w3.org/2000/svg', 'polygon'));
      while (s.cotes.childNodes.length > cotes.length) s.cotes.lastChild.remove();
      cotes.forEach((c, i) => { const n = s.cotes.childNodes[i]; n.setAttribute('points', points(c.points)); n.style.setProperty('--o', `${Math.round(c.ombre * 100)}%`); });
      const xs = haut.map((q) => q[0]), ys = haut.map((q) => q[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const label = s.txt.dataset.label ?? (s.txt.dataset.label = s.g.classList.contains('muette') ? '' : s.g.getAttribute('aria-label') ? s.g.getAttribute('aria-label').split(',')[0] : s.spans[0].textContent);
      // Les repères extérieurs gardent leur nom ; les Salles l'écrivent si la place le permet.
      const et = label ? etiquette(label, x1 - x0, y1 - y0, { petit }) : null;
      if (!et || (axo && cam.scale < plan.base * 1.6 && !s.p.salle && s.p.k !== 'p')) s.txt.setAttribute('opacity', 0);
      else {
        s.txt.setAttribute('opacity', 1);
        s.txt.setAttribute('font-size', et.taille.toFixed(1));
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const pose = (n, texte, y) => { if (n.textContent !== texte) n.textContent = texte; n.setAttribute('x', cx.toFixed(1)); n.setAttribute('y', y.toFixed(1)); };
        if (et.lignes.length === 1) { pose(s.spans[0], et.lignes[0], cy); pose(s.spans[1], '', cy); }
        else { pose(s.spans[0], et.lignes[0], cy - et.taille * 0.56); pose(s.spans[1], et.lignes[1], cy + et.taille * 0.56); }
      }
      s.marque.setAttribute('d', s.g.classList.contains('visite') ? etoileSvg(x1 - 6, y0 + 6, 4.6) : '');
    }
    // L'étiquette de l'étage, à gauche de sa dalle, en vue d'ensemble seulement.
    const visible = axo && op > 0.6;
    nd.etiq.g.setAttribute('opacity', visible ? 1 : 0);
    nd.etiq.g.style.pointerEvents = visible ? 'auto' : 'none';
    nd.etiq.g.setAttribute('tabindex', visible ? '0' : '-1');
    if (visible) {
      let bb; try { bb = nd.dalle.getBBox(); } catch { bb = null; }
      if (bb) {
        // Le nom colle au bord gauche de la scène, le filet le relie à sa dalle.
        const X = 12, Y = bb.y + bb.height / 2;
        nd.etiq.nom.setAttribute('x', X); nd.etiq.nom.setAttribute('y', Y - 3); nd.etiq.nom.setAttribute('text-anchor', 'start');
        nd.etiq.det.setAttribute('x', X); nd.etiq.det.setAttribute('y', Y + 13); nd.etiq.det.setAttribute('text-anchor', 'start');
        let largeurTexte = 90; try { largeurTexte = Math.max(nd.etiq.nom.getComputedTextLength(), nd.etiq.det.getComputedTextLength()); } catch { /* hors navigateur */ }
        const finTexte = X + largeurTexte + 8;
        nd.etiq.filet.setAttribute('x1', finTexte); nd.etiq.filet.setAttribute('y1', Y + 3); nd.etiq.filet.setAttribute('x2', Math.max(finTexte, bb.x + 4)); nd.etiq.filet.setAttribute('y2', Y + 3);
      }
    }
  }
}

// La caméra vole d'où elle est vers sa cible : tourner, incliner, cadrer et
// effacer les autres étages en un seul mouvement.
function volerPlan(camCible, opCible, duree = 640) {
  if (plan.anim) cancelAnimationFrame(plan.anim);
  const d = REDUIRE_MOUVEMENT.matches ? 0 : duree;
  const c0 = { ...plan.cam }, o0 = { ...plan.op }, t0 = performance.now();
  const pas = (now) => {
    if (!plan.cam) { plan.anim = null; return; } // le plan a été fermé en plein vol
    const u = d ? Math.min(1, (now - t0) / d) : 1;
    const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    for (const k of Object.keys(camCible)) plan.cam[k] = c0[k] + (camCible[k] - c0[k]) * e;
    for (const k of Object.keys(opCible)) plan.op[k] = (o0[k] ?? 1) + (opCible[k] - (o0[k] ?? 1)) * e;
    dessinerPlan();
    plan.anim = u < 1 ? requestAnimationFrame(pas) : null;
  };
  plan.anim = requestAnimationFrame(pas);
}

function initialiserPlan() {
  const vp = $('#plan-viewport'), svg = $('#plan-svg'), plein = $('#plan-plein');
  if (!vp || !svg || !plein) return;
  const scene = sceneCourante();
  attacherPlan(svg, scene);
  const vue = plein.dataset.nom || 'axo';
  const axo = vue === 'axo';
  const allumee = svg.querySelector('.piece.allumee');
  const dims = dimensionsPlan();
  const cle = `${vue}|${allumee ? allumee.dataset.valeur : ''}|${dims.reserve.bas}|${dims.largeur}x${dims.hauteur}`;
  if (plan.cible !== cle || !plan.cam) {
    let cam = cameraPour(scene, vue, { ...dims, yaw: plan.yaw, pitch: plan.pitch });
    plan.base = cam.scale;
    if (allumee && !axo) {
      const nd = plan.noeuds.find((n) => n.e.etage === vue);
      const piece = nd && nd.pieces.find((s) => s.g === allumee);
      if (piece) cam = cadrerSur(cam, scene, piece.p, dims);
    }
    const op = Object.fromEntries(scene.etages.map((e) => [e.etage, axo || e.etage === vue ? 1 : 0]));
    if (plan.cam) volerPlan(cam, op);
    else { plan.cam = cam; plan.op = op; dessinerPlan(); }
    plan.cible = cle;
  } else dessinerPlan();

  // Les doigts : un doigt tourne et incline en vue d'ensemble, déplace à plat ;
  // deux doigts zooment. La capture de pointeur n'est prise QU'au-delà de quatre
  // pixels : un appui reste un clic sur la Pièce touchée, sinon Safari redirige
  // le clic vers le conteneur et plus rien ne répond.
  const pointeurs = new Map();
  let pincement = 0, bouge = false;
  const capture = new Set();
  const prendre = (id) => { if (capture.has(id)) return; try { vp.setPointerCapture(id); capture.add(id); } catch { /* relâché */ } };
  const rendreCapture = (id) => { if (!capture.has(id)) return; try { vp.releasePointerCapture(id); } catch { /* déjà */ } capture.delete(id); };
  const milieu = () => { const [a, b] = [...pointeurs.values()]; return [(a.x + b.x) / 2, (a.y + b.y) / 2]; };
  const local = (x, y) => { const r = vp.getBoundingClientRect(); return [x - r.left, y - r.top]; };
  vp.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.outils, .feuille')) return;
    pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    bouge = false;
    if (pointeurs.size === 2) { const [a, b] = [...pointeurs.values()]; pincement = Math.hypot(a.x - b.x, a.y - b.y); for (const id of pointeurs.keys()) prendre(id); bouge = true; }
  });
  vp.addEventListener('pointermove', (e) => {
    const p = pointeurs.get(e.pointerId);
    if (!p || !plan.cam) return;
    if (pointeurs.size === 1) {
      if (!bouge && Math.abs(e.clientX - p.x0) + Math.abs(e.clientY - p.y0) <= SEUIL_GESTE) return;
      if (!bouge) { bouge = true; prendre(e.pointerId); vp.classList.add('attrape'); if (plan.anim) { cancelAnimationFrame(plan.anim); plan.anim = null; } }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (plein.dataset.vue === 'axo') {
        plan.yaw += dx * 0.008;
        plan.pitch = Math.min(INCLINAISON.max, Math.max(INCLINAISON.min, plan.pitch - dy * 0.006));
        const facteur = plan.cam.scale / plan.base;
        const cam = cameraPour(scene, 'axo', { ...dimensionsPlan(), yaw: plan.yaw, pitch: plan.pitch });
        plan.base = cam.scale;
        plan.cam = zoomer(cam, facteur, cam.panX, cam.panY, plan.base);
      } else { plan.cam.panX += dx; plan.cam.panY += dy; }
      dessinerPlan();
    } else if (pointeurs.size === 2) {
      p.x = e.clientX; p.y = e.clientY;
      const [a, b] = [...pointeurs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pincement > 0) { const [mx, my] = local(...milieu()); plan.cam = zoomer(plan.cam, d / pincement, mx, my, plan.base); dessinerPlan(); }
      pincement = d; bouge = true;
    }
  });
  const fin = (e) => { rendreCapture(e.pointerId); pointeurs.delete(e.pointerId); pincement = 0; if (!pointeurs.size) vp.classList.remove('attrape'); };
  vp.addEventListener('pointerup', fin);
  vp.addEventListener('pointercancel', fin);
  vp.addEventListener('click', (e) => { if (bouge) { e.stopPropagation(); e.preventDefault(); bouge = false; } }, true);
  vp.addEventListener('wheel', (e) => { e.preventDefault(); if (!plan.cam) return; const [mx, my] = local(e.clientX, e.clientY); plan.cam = zoomer(plan.cam, e.deltaY < 0 ? 1.15 : 1 / 1.15, mx, my, plan.base); dessinerPlan(); }, { passive: false });

  // La poignée de la feuille : tirer vers le haut l'agrandit, vers le bas la réduit.
  const tete = $('#feuille .feuille-tete');
  if (tete) {
    let depart = null;
    tete.addEventListener('pointerdown', (e) => { if (e.target.closest('.pastille')) return; depart = e.clientY; });
    const lacher = (e) => {
      if (depart === null) return;
      const dy = e.clientY - depart; depart = null;
      if (Math.abs(dy) < 30) return;
      plan.feuilleGlisse = true;
      setTimeout(() => { plan.feuilleGlisse = false; }, 400);
      deplacerFeuille(dy < 0 ? 1 : -1);
    };
    tete.addEventListener('pointerup', lacher);
    tete.addEventListener('pointercancel', () => { depart = null; });
  }
}

const HAUTEURS_FEUILLE = ['repliee', 'mi', 'deployee'];
function deplacerFeuille(sens) {
  const feuille = $('#feuille');
  const actuelle = feuille ? feuille.dataset.hauteur : 'repliee';
  const i = Math.min(2, Math.max(0, HAUTEURS_FEUILLE.indexOf(actuelle) + sens));
  etat.ui.feuillePlan = HAUTEURS_FEUILLE[i];
  rendre({ conserver: true });
}

function fermerPlan() {
  if (plan.retour === 'back' && history.length > 1) history.back();
  else location.hash = '#/';
}

let minuteurTaille = null;
window.addEventListener('resize', () => {
  if (etat.route.nom !== 'plan') return;
  clearTimeout(minuteurTaille);
  minuteurTaille = setTimeout(() => { plan.cible = ''; initialiserPlan(); }, 120);
});

// ---------------------------------------------------------------- données

let sources = null;

// Le bandeau est le canal des Organisateurs : un message saisi dans le tableur.
// Il s'affichait AUSSI en notification éphémère, donc deux fois le même texte,
// dont une par-dessus le contenu. Un seul canal désormais : le bandeau, refermable.
// Sa fermeture se retient dans la Visite ; un message différent revient malgré tout.
// Le bandeau est mémorisé en français (c'est la clé de « refermé ») ; ses
// traductions viennent de l'état du script quand il les joint, sinon de tt().
function afficherBandeau(texte, bandeaux = undefined) {
  if (bandeaux !== undefined) etat.bandeaux = bandeaux;
  if (texte === etat.bandeau && bandeaux === undefined) return;
  etat.bandeau = texte;
  peindreBandeau();
}

function texteBandeau() {
  const fr = etat.bandeau || '';
  if (!fr || etat.langue === 'fr') return fr;
  const duScript = etat.bandeaux && typeof etat.bandeaux[etat.langue] === 'string' && etat.bandeaux[etat.langue].trim();
  return duScript || tt(fr);
}

function peindreBandeau() {
  const texte = etat.bandeau || '';
  const cache = texte && etat.visite.bandeauFerme === texte;
  el.bandeau.hidden = !texte || cache;
  if (el.bandeau.hidden) { el.bandeau.textContent = ''; return; }
  el.bandeau.innerHTML = `<span>${echapper(texteBandeau())}</span><button type="button" data-action="fermer-bandeau" aria-label="${echapper(t('Fermer ce message'))}">✕</button>`;
}

// Le bandeau d'annonce du Grand Défi (grand-defi 06) : au-dessus de l'écran, dans le
// flux, repeint à chaque rendu (le rafraîchissement de chaque minute en fait un).
// Une annonce nouvelle est aussi dite aux lecteurs d'écran, une fois.
const annoncesDites = new Set();
function peindreAnnonces() {
  const html = bandeauAnnonces(etat);
  if (el.annonces.innerHTML !== html) el.annonces.innerHTML = html;
  el.annonces.hidden = !html;
  const texte = el.annonces.textContent.trim();
  if (texte && !annoncesDites.has(texte)) { annoncesDites.add(texte); el.annonce.textContent = texte; }
}

el.bandeau.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="fermer-bandeau"]')) return;
  modifierVisite({ ...etat.visite, bandeauFerme: etat.bandeau || '' });
  peindreBandeau();
});

function installerTables(tables, version, source, { heure = Date.now(), silencieux = false } = {}) {
  const ancien = etat.modele;
  etat.tables = tables;
  etat.version = version;
  etat.source = source;
  etat.derniereMaj = heure;
  etat.modele = construireModele(tables);
  definirTraductions(dictionnaireDepuis(tables));
  for (const a of etat.modele.avertissements) console.warn('[festival] donnée à vérifier dans le tableur :', a);
  afficherBandeau(etat.modele.infos.bandeau || ''); // le bandeau vit dans Infos : valable pour toute source, pas seulement l'état du script
  if (!silencieux && ancien && ancien.exposants.length + ancien.evenements.length) {
    const changements = diff(ancien, etat.modele);
    if (changements.length) {
      const r = Visite.appliquerDiff(etat.visite, changements, Date.now());
      etat.visite = r.etat;
      stockageVisite.sauver(etat.visite);
      for (const a of r.alertes) {
        const o = objetParCle(a.cle);
        message(`⚠︎ ${echapper(o ? (o.titre ? tt(o.titre) : o.nom) : a.cle)} : ${echapper(Visite.texteAlerte(a))}`, { classe: 'orange', duree: 12000 });
      }
      stats.noter('donnees_changees', version, String(changements.length));
    }
  }
}

async function chargerSnapshot() {
  try {
    const rep = await fetch('./data/snapshot.json', { cache: 'no-cache' });
    if (!rep.ok) throw new Error(`snapshot HTTP ${rep.status}`);
    return await rep.json();
  } catch (e) { journal('snapshot indisponible', e); return null; }
}

async function rafraichirDonnees() {
  const r = await sources.rafraichir(etat.version);
  etat.reseau.enErreur = false;
  etat.reseau.refus = r.refus ? r.refus[0] : null;
  // Une source refusée n'a rien à nous apprendre : ni ses tables, ni son bandeau, ni
  // même son heure — dire « mis à jour » ici serait mentir, puisqu'on garde l'ancien.
  if (!r.refus) {
    if (r.bandeau !== null && r.bandeau !== undefined) afficherBandeau(r.bandeau, r.bandeaux === undefined ? null : r.bandeaux);
    // Le Worker annonce un défi (le mystère) que le jeu gardé tait encore : on le recharge
    // tout de suite, sans attendre les cinq minutes du jeu (grand-defi 06).
    if (Array.isArray(r.annonces)) etat.annonces = r.annonces;
    if (JEU_URL && Passeport.jeuARecharger(etat.grandDefi, r.annonces)) chargerJeu().catch((e) => journal('jeu indisponible', e));
    // Un Tirage a eu lieu (grand-defi 07) : ce téléphone a-t-il gagné ?
    if (JEU_URL && Passeport.gainsARelire(etat.visite.jeu, r.tirage, Date.now())) demanderGains(r.tirage);
    if (r.change) installerTables(r.tables, r.version, r.source);
    else { etat.derniereMaj = Date.now(); etat.source = r.source; }
  }
  rendre({ conserver: true });
}

const rafraichisseur = creerRafraichisseur({
  intervalle: CONFIG.intervalleDonnees, visible: () => document.visibilityState === 'visible', journal,
  executer: async () => { try { await rafraichirDonnees(); } catch (e) { etat.reseau.enErreur = true; el.pied.innerHTML = piedDePage(etat); throw e; } },
});

const rafraichisseurJeu = creerRafraichisseur({
  intervalle: CONFIG.intervalleJeu, visible: () => document.visibilityState === 'visible', journal, executer: chargerJeu,
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { rafraichisseur.surVisibilite(); rafraichisseurJeu.surVisibilite(); envoiJeu.envoyer(); envoyerStatsSiDu(); rendre({ conserver: true }); }
  else { envoyerStatsEnArrierePlan(); arreterScanner(); } // la caméra ne tourne pas dans une poche ; le retour la rouvre
});

// ---------------------------------------------------------------- rappels

const rappelsFaits = new Set();
function verifierRappels() {
  calculerMaintenant();
  if (!etat.maintenant.jourJ) return;
  for (const ev of Visite.rappelsAFaire(etat.visite, etat.modele, etat.maintenant.minutes)) {
    if (rappelsFaits.has(ev.cle)) continue;
    rappelsFaits.add(ev.cle);
    message(`🔔 ${echapper(t('Dans %s min', ev.debut - etat.maintenant.minutes))} : ${echapper(tt(ev.titre))} · ${echapper(ev.salle || t('salle à venir'))}`, { classe: 'orange', duree: 60000 });
  }
}

// ---------------------------------------------------------------- mesures

// Au passage en arrière-plan, la Salve ne part que si la plus vieille Mesure attend
// depuis plus de dix minutes (stats.envoiDu, mesures compactes 04) ; sinon la file,
// gardée sur le téléphone, part au retour ou à la prochaine ouverture.
function envoyerStatsEnArrierePlan() {
  const url = urlMesures();
  if (!url || !navigator.sendBeacon || !stats.envoiDu() || mesuresCoupees()) return;
  const salve = stats.preleverSalve();
  const ok = navigator.sendBeacon(url, new Blob([JSON.stringify(salve)], { type: 'text/plain;charset=utf-8' }));
  if (!ok) stats.remettre(salve);
}
// Comme le rafraîchisseur de données, on n'appelle pas le réseau depuis un
// téléphone rangé dans une poche : ce qui reste en file partira au retour au
// premier plan, ou par sendBeacon au passage en arrière-plan. Sous la charge
// mesurée par ADR-0006, chaque requête évitée est un créneau d'exécution rendu.
setInterval(() => { if (document.visibilityState === 'visible') stats.vider().catch(() => {}); }, CONFIG.intervalleStats);
// À l'ouverture et au retour au premier plan, la file retenue part si elle a trop attendu.
function envoyerStatsSiDu() { if (stats.envoiDu()) stats.vider().catch(() => {}); }

// ---------------------------------------------------------------- service worker et nouvelle version

let swEnAttente = null;
function rechargerNouvelleVersion() {
  if (swEnAttente) swEnAttente.postMessage({ type: 'activer' });
  else location.reload();
}
// Demande au service worker quelle version il sert. Renvoie null s'il n'y en a
// pas encore un aux commandes (première visite) ou s'il ne répond pas : dans ce
// cas le pied de page n'affiche que la version du code, sans rien alléguer.
async function versionServiceWorker() {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return null;
  return new Promise((resoudre) => {
    const canal = new MessageChannel();
    const minuteur = setTimeout(() => resoudre(null), 2000);
    canal.port1.onmessage = (e) => { clearTimeout(minuteur); resoudre((e.data && e.data.version) || null); };
    try { navigator.serviceWorker.controller.postMessage({ type: 'version' }, [canal.port2]); }
    catch { clearTimeout(minuteur); resoudre(null); }
  });
}

async function enregistrerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    const proposer = (worker) => {
      swEnAttente = worker;
      message(echapper(t('Nouvelle version disponible.')), { duree: 0, action: { libelle: t('Recharger'), faire: rechargerNouvelleVersion } });
    };
    if (reg.waiting && navigator.serviceWorker.controller) proposer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) proposer(w); });
    });
    // Le rechargement n'a de sens que lorsqu'une NOUVELLE version prend la main.
    // À la toute première visite, le service worker s'installe et prend la main
    // aussi : recharger là recharge la page sous les pieds du Visiteur.
    let recharge = false;
    const avaitUnControleur = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!avaitUnControleur || recharge) return;
      recharge = true;
      location.reload();
    });
  } catch (e) { journal('service worker non enregistré', e); }
}

// ---------------------------------------------------------------- démarrage

async function demarrer() {
  // Le snapshot embarqué est lu avant le premier rendu (instantané une fois en cache) ;
  // chargerInitial() choisit entre lui et le cache local, le plus récent gagne.
  // Le programme vient du Worker (ticket 20) : celui du jeu, le même programme (ADR-0016),
  // local sous ./jeu sur la machine de développement.
  sources = creerSources({ config: { ...CONFIG, programmeUrl: JEU_URL }, fetch: (u, o) => fetch(u, o), stockage, snapshot: await chargerSnapshot(), journal });
  const initial = sources.chargerInitial();
  if (initial) installerTables(initial.tables, initial.version, initial.sourceOrigine || initial.source, { heure: initial.heure || Date.now(), silencieux: true });
  else etat.derniereMaj = null;
  const installee = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  // « installee·ios·fr », « navigateur·android·en »… : d'où vient la donnée en
  // cible, et en detail comment l'appli est ouverte, sur quelle famille d'appareil,
  // et dans quelle langue — ce qui dira combien de Visiteurs ne lisent pas le français.
  etat.statsRefusees = stats.refusees();
  stats.noter('ouverture', initial ? initial.source : 'aucune',
    `${installee ? 'installee' : 'navigateur'}·${plateforme(navigator.userAgent, navigator.maxTouchPoints)}·${langue()}`);
  appliquerRoute();
  demarre = true;
  enregistrerServiceWorker();
  versionServiceWorker().then((v) => { etat.versionSW = v; el.pied.innerHTML = piedDePage(etat); });
  rafraichisseur.demarrer();
  if (JEU_URL) rafraichisseurJeu.demarrer();
  envoiJeu.envoyer();
  envoyerStatsSiDu();
  verifierRappels();
  setInterval(verifierRappels, 30000);
  // L'écran de vote suit l'horloge : une fenêtre s'ouvre ou se ferme sans geste. De même
  // l'instant gagnant (sa fenêtre) et le Lot flash (son compte à rebours), grand-defi 08.
  setInterval(() => { if (['vote', 'instant', 'gagne'].includes(etat.route.nom) && document.visibilityState === 'visible') rendre({ conserver: true }); }, 20000);
  window.__festival = { etat, rendre, stats, sources, changerLangue, changerTheme, chargerJeu, rafraichirDonnees }; // pour le test de fumée et le débogage
}

demarrer();
