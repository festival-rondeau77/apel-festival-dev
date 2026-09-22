// L'adaptateur navigateur : navigation, rendu, réseau, stockage, horloge, mesures.
// Toute la logique vit dans les modules purs (donnees, visite, stats, sources, plan).
import { CONFIG } from './config.js';
import { construireModele, diff, normaliser } from './donnees.js';
import * as Visite from './visite.js';
import { creerStats, plateforme } from './stats.js';
import { creerSources, creerRafraichisseur, urlAction } from './sources.js';
import { analyserRoute } from './routes.js';
import { ecran, navigation, piedDePage, titreDocument, filtrerEvenements, filtrerExposants, typesPresents, h as echapper } from './rendu.js';
import { rechercherSurPlan, construireScene, cameraPour, cadrerSur, zoomer, altitudes, projeter, facesVisibles, ordreDeDessin, tranches, etiquette, H_DALLE, INCLINAISON, ORIENTATION_DEFAUT } from './plan.js';
import { t, tt, langue, definirLangue, definirTraductions, langueInitiale, CLE_STOCKAGE_LANGUE, LANGUES } from './i18n.js';
import { dictionnaireDepuis } from './donnees.js';

const journal = (...a) => { if (location.hostname === 'localhost' || location.search.includes('debug')) console.info('[festival]', ...a); };
const stockage = (() => { try { localStorage.setItem('festival.test', '1'); localStorage.removeItem('festival.test'); return localStorage; } catch { return Visite.stockageMemoire(); } })();

const etat = {
  route: analyserRoute(location.hash),
  modele: construireModele({}), tables: null, version: null, source: null, derniereMaj: null, bandeau: '',
  // La langue affichée (ADR-0012) et les traductions du bandeau jointes à l'état
  // du script ({ en, es, zh }) — celles du tableur passent par tt().
  langue: 'fr', bandeaux: null,
  // Version du code chargé, et version que le service worker sert réellement.
  // Les deux sont affichées en pied de page : leur écart révèle un cache périmé.
  versionAppli: CONFIG.version, versionSW: null,
  visite: Visite.etatInitial(),
  ui: {
    rechercheProgramme: '', filtreDomaineProgramme: '', filtreFormat: '', filtrePublic: '',
    rechercheExposants: '', ongletExposants: 'École', filtreDomaineExposants: '',
    recherchePlan: '', zoneOuverte: null, salleAllumee: null, etagePlan: null, feuillePlan: null, suggestionsOuvertes: false,
    filtresOuverts: false, etapePreparer: 0, bandeauFerme: '',
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
appliquerLangue(langueInitiale({ param: parametreLangue(), stockage, navigateur: navigator.languages || navigator.language }));

function changerLangue(l) {
  if (!LANGUES.includes(l) || l === etat.langue) return;
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
    if (!CONFIG.scriptUrl) return { ok: false, definitif: true };
    try {
      const rep = await fetch(urlAction(CONFIG.scriptUrl, 'stats'), { method: 'POST', body: JSON.stringify(salve), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', keepalive: true });
      // Apps Script répond toujours HTTP 200 : le verdict est dans le corps ({ ok } ou { erreur, statut }).
      if (!rep.ok) return { ok: false, definitif: false };
      let corps = null;
      try { corps = await rep.json(); } catch { corps = null; }
      if (corps && corps.ok === true) return { ok: true };
      return { ok: false, definitif: Boolean(corps && corps.statut >= 400 && corps.statut < 500) };
    } catch { return { ok: false, definitif: false }; }
  },
});

const $ = (s) => document.querySelector(s);
const el = { main: $('#ecran'), nav: $('#nav'), bandeau: $('#bandeau'), pied: $('#pied'), messages: $('#messages'), annonce: $('#annonce') };

// ---------------------------------------------------------------- horloge et messages

function calculerMaintenant() {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  etat.maintenant = { jourJ: etat.modele.infos.date === iso, minutes: d.getHours() * 60 + d.getMinutes(), iso };
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
  el.nav.innerHTML = navigation(etat);
  el.pied.innerHTML = piedDePage(etat);
  document.title = titreDocument(etat);
  peindreBandeau();
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
}

// ---------------------------------------------------------------- navigation

// La position de défilement de chaque écran, pour la rendre au retour. Le
// mécanisme existait dans rendre() mais `scrollAvant` n'était JAMAIS écrit : le
// retour ne restaurait donc rien, sur aucun écran. On ne restaure qu'au retour
// d'une fiche — arriver sur une liste par la navigation doit montrer son début.
const positions = new Map();
const FICHES = ['exposant', 'evenement'];

function appliquerRoute() {
  const precedente = etat.route.nom;
  positions.set(precedente, window.scrollY);
  etat.route = analyserRoute(location.hash);
  if (FICHES.includes(precedente) && !FICHES.includes(etat.route.nom) && positions.has(etat.route.nom)) {
    scrollAvant = positions.get(etat.route.nom);
  }
  const p = etat.route.params;
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
  if (etat.route.nom === 'exposant' && p.qr === '1') stats.noter('qr_scan', p.cle || '');
  if (etat.route.nom === 'exposant') stats.noter('fiche_exposant', p.cle || '');
  if (etat.route.nom === 'evenement') stats.noter('fiche_evenement', p.cle || '');
  stats.noter('ecran', etat.route.nom);
  if (['evenement', 'exposant'].includes(etat.route.nom) && p.cle && Visite.contient(etat.visite, p.cle)) {
    const entree = etat.visite.entrees.find((e) => e.cle === p.cle);
    if (entree.alerte && !entree.alerte.vue) { setTimeout(() => { modifierVisite(Visite.marquerAlerteVue(etat.visite, p.cle)); }, 4000); }
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

// ---------------------------------------------------------------- gestes

let minuteurRecherche = null;
document.addEventListener('input', (e) => {
  const champ = e.target.dataset ? e.target.dataset.champ : null;
  if (!champ) return;
  etat.ui[champ] = e.target.value;
  clearTimeout(minuteurRecherche);
  minuteurRecherche = setTimeout(() => {
    if (champ === 'recherchePlan') { etat.ui.salleAllumee = null; etat.ui.zoneOuverte = null; etat.ui.feuillePlan = null; }
    rendre({ conserver: true });
    noterRecherche(champ);
  }, 180);
});

function noterRecherche(champ) {
  const terme = normaliser(etat.ui[champ]);
  if (!terme || terme.length < 2) return;
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
    case 'site': stats.noter('clic_site', cle); break;
    case 'recharger': rechargerNouvelleVersion(); break;
    case 'langue': changerLangue(valeur); break;
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
    if (r.change) installerTables(r.tables, r.version, r.source);
    else { etat.derniereMaj = Date.now(); etat.source = r.source; }
  }
  rendre({ conserver: true });
}

const rafraichisseur = creerRafraichisseur({
  intervalle: CONFIG.intervalleDonnees, visible: () => document.visibilityState === 'visible', journal,
  executer: async () => { try { await rafraichirDonnees(); } catch (e) { etat.reseau.enErreur = true; el.pied.innerHTML = piedDePage(etat); throw e; } },
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { rafraichisseur.surVisibilite(); rendre({ conserver: true }); }
  else envoyerStatsEnArrierePlan();
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

function envoyerStatsEnArrierePlan() {
  if (!CONFIG.scriptUrl || !navigator.sendBeacon || stats.taille() === 0) return;
  const salve = stats.preleverSalve();
  const ok = navigator.sendBeacon(urlAction(CONFIG.scriptUrl, 'stats'), new Blob([JSON.stringify(salve)], { type: 'text/plain;charset=utf-8' }));
  if (!ok) stats.remettre(salve);
}
// Comme le rafraîchisseur de données, on n'appelle pas le réseau depuis un
// téléphone rangé dans une poche : ce qui reste en file partira au retour au
// premier plan, ou par sendBeacon au passage en arrière-plan. Sous la charge
// mesurée par ADR-0006, chaque requête évitée est un créneau d'exécution rendu.
setInterval(() => { if (document.visibilityState === 'visible') stats.vider().catch(() => {}); }, CONFIG.intervalleStats);

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
  sources = creerSources({ config: CONFIG, fetch: (u, o) => fetch(u, o), stockage, snapshot: await chargerSnapshot(), journal });
  const initial = sources.chargerInitial();
  if (initial) installerTables(initial.tables, initial.version, initial.sourceOrigine || initial.source, { heure: initial.heure || Date.now(), silencieux: true });
  else etat.derniereMaj = null;
  const installee = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  // « installee·ios·fr », « navigateur·android·en »… : d'où vient la donnée en
  // cible, et en detail comment l'appli est ouverte, sur quelle famille d'appareil,
  // et dans quelle langue — ce qui dira combien de Visiteurs ne lisent pas le français.
  stats.noter('ouverture', initial ? initial.source : 'aucune',
    `${installee ? 'installee' : 'navigateur'}·${plateforme(navigator.userAgent, navigator.maxTouchPoints)}·${langue()}`);
  appliquerRoute();
  demarre = true;
  enregistrerServiceWorker();
  versionServiceWorker().then((v) => { etat.versionSW = v; el.pied.innerHTML = piedDePage(etat); });
  rafraichisseur.demarrer();
  verifierRappels();
  setInterval(verifierRappels, 30000);
  window.__festival = { etat, rendre, stats, sources, changerLangue }; // pour le test de fumée et le débogage
}

demarrer();
