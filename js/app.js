// L'adaptateur navigateur : navigation, rendu, réseau, stockage, horloge, mesures.
// Toute la logique vit dans les modules purs (donnees, visite, stats, sources, plan).
import { CONFIG } from './config.js';
import { construireModele, diff, normaliser } from './donnees.js';
import * as Visite from './visite.js';
import { creerStats, plateforme } from './stats.js';
import { creerSources, creerRafraichisseur, urlAction } from './sources.js';
import { analyserRoute } from './routes.js';
import { ecran, navigation, piedDePage, titreDocument, filtrerEvenements, filtrerExposants, typesPresents, calculerPlan, etageAffiche, h as echapper } from './rendu.js';
import { rechercherSurPlan, cadrageSalle } from './plan.js';

const journal = (...a) => { if (location.hostname === 'localhost' || location.search.includes('debug')) console.info('[festival]', ...a); };
const stockage = (() => { try { localStorage.setItem('festival.test', '1'); localStorage.removeItem('festival.test'); return localStorage; } catch { return Visite.stockageMemoire(); } })();

const etat = {
  route: analyserRoute(location.hash),
  modele: construireModele({}), tables: null, version: null, source: null, derniereMaj: null, bandeau: '',
  // Version du code chargé, et version que le service worker sert réellement.
  // Les deux sont affichées en pied de page : leur écart révèle un cache périmé.
  versionAppli: CONFIG.version, versionSW: null,
  visite: Visite.etatInitial(),
  ui: {
    rechercheProgramme: '', filtreDomaineProgramme: '', filtreFormat: '', filtrePublic: '',
    rechercheExposants: '', ongletExposants: 'École', filtreDomaineExposants: '',
    recherchePlan: '', zoneOuverte: null, salleAllumee: null, etagePlan: null, suggestionsOuvertes: false,
    filtresOuverts: false, etapePreparer: 0, bandeauFerme: '',
  },
  reseau: { enErreur: false, refus: null },
  maintenant: { jourJ: false, minutes: 0 },
  debug: location.search.includes('debug'),
};

const stockageVisite = Visite.creerStockageVisite(stockage);
etat.visite = stockageVisite.charger();

const stats = creerStats({
  stockage,
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
  div.innerHTML = `<span>${texte}</span>${action ? `<button type="button">${action.libelle}</button>` : '<button type="button" aria-label="Fermer">✕</button>'}`;
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
  if (etat.route.nom === 'plan') initialiserPlan();
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
    planTransform.centrerSur = p.salle || null;
    if (!p.salle) { planTransform.k = 1; planTransform.tx = 0; planTransform.ty = 0; } // « Plan » montre toujours la vue d'ensemble
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
  const nom = objet.titre || objet.nom;
  if (dans) { message(`Retiré de ma visite : ${echapper(nom)}`, { duree: 2500 }); return; }
  // Le conflit se dit MAINTENANT, pendant que le Visiteur peut encore choisir : la
  // détection existait déjà, elle n'était lue qu'à l'ouverture de Ma visite (ADR-0010).
  const conflits = Visite.chevauchementsDe(etat.visite, etat.modele, cle);
  if (!conflits.length) { message(`★ Ajouté à ma visite : ${echapper(nom)}`, { duree: 2500 }); return; }
  const autre = objetParCle(conflits[0].a === cle ? conflits[0].b : conflits[0].a);
  message(`★ Ajouté, mais à la même heure que « ${echapper(autre ? autre.titre || autre.nom : 'un autre événement')} »`,
    { classe: 'alerte', duree: 9000, action: { libelle: 'Voir', faire: () => { location.hash = '#/visite'; } } });
}

function ajouterAuCalendrier(cle) {
  const ev = etat.modele.evenements.find((e) => e.cle === cle);
  const ics = Visite.icalendar(ev, etat.modele.infos);
  if (!ics) { message('Date du festival inconnue : impossible de créer le rappel.', { classe: 'alerte' }); return; }
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
    if (champ === 'recherchePlan') { etat.ui.salleAllumee = null; etat.ui.zoneOuverte = null; planTransform.centrerSur = 'resultat'; }
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
    case 'effacer': etat.ui[champ] = ''; if (champ === 'recherchePlan') etat.ui.salleAllumee = null; rendre({ conserver: true }); el.main.querySelector(`[data-champ="${champ}"]`)?.focus(); break;
    case 'filtre': etat.ui[filtre] = etat.ui[filtre] === valeur && filtre !== 'filtrePublic' ? '' : valeur; rendre({ conserver: true }); break;
    case 'filtres': etat.ui.filtresOuverts = !etat.ui.filtresOuverts; rendre({ conserver: true }); break;
    // Changer d'onglet garde le Domaine : il traverse les onglets (voir ecranExposants),
    // et le compte affiché sur chaque onglet dit déjà combien on y trouvera.
    case 'onglet': etat.ui.ongletExposants = valeur; rendre({ conserver: true }); break;
    case 'zone': etat.ui.zoneOuverte = etat.ui.zoneOuverte === valeur ? null : valeur; etat.ui.salleAllumee = null; etat.ui.recherchePlan = ''; rendre({ conserver: true }); break;
    case 'salle': etat.ui.salleAllumee = valeur; etat.ui.recherchePlan = ''; etat.ui.zoneOuverte = null; planTransform.centrerSur = valeur; rendre({ conserver: true }); break;
    // Changer d'étage remet le plan à plat : on regarde un autre niveau, pas la
    // même chose sous un autre angle.
    case 'etage': etat.ui.etagePlan = valeur; etat.ui.salleAllumee = null; etat.ui.zoneOuverte = null; planTransform.k = 1; planTransform.tx = 0; planTransform.ty = 0; rendre({ conserver: true }); break;
    case 'zoom': zoomerPlan(Number(valeur) > 0 ? 1.4 : 1 / 1.4); break;
    case 'recentrer': planTransform.k = 1; planTransform.tx = 0; planTransform.ty = 0; appliquerTransformPlan(); break;
    case 'calendrier': ajouterAuCalendrier(cle); break;
    case 'interet': modifierVisite(Visite.basculerInteret(etat.visite, valeur)); break;
    case 'niveau': modifierVisite(Visite.definirNiveau(etat.visite, valeur)); break;
    case 'suggestions': etat.ui.suggestionsOuvertes = !etat.ui.suggestionsOuvertes; rendre({ conserver: true }); break;
    case 'etape': etat.ui.etapePreparer = Number(valeur) || 0; rendre(); break;
    case 'avis': stats.noter('clic_avis'); break;
    case 'site': stats.noter('clic_site', cle); break;
    case 'recharger': rechargerNouvelleVersion(); break;
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

// ---------------------------------------------------------------- plan : zoom et déplacement

const planTransform = { k: 1, tx: 0, ty: 0, centrerSur: null };
const SEUIL_GESTE = 4; // px : en deçà, c'est un appui, pas un déplacement
let planPointeurs = new Map();
let planPincementDistance = 0;

function facteurPlan() {
  const svg = $('#plan-viewport svg');
  if (!svg) return { f: 1, cx: 50, cy: 50 };
  const vb = svg.viewBox.baseVal;
  const r = svg.getBoundingClientRect();
  const f = Math.min(r.width / vb.width, r.height / vb.height);
  return { f, cx: vb.width / 2, cy: vb.height / 2, vb, r };
}

function appliquerTransformPlan() {
  const monde = $('#plan-monde');
  if (!monde) return;
  planTransform.k = Math.min(6, Math.max(0.6, planTransform.k));
  monde.setAttribute('transform', `translate(${planTransform.tx.toFixed(2)} ${planTransform.ty.toFixed(2)}) scale(${planTransform.k.toFixed(3)})`);
}

function zoomerPlan(ratio, px = null, py = null) {
  const { f, cx, cy, vb, r } = facteurPlan();
  let ux = cx, uy = cy;
  if (px !== null && vb) {
    // Coordonnées du pointeur en unités du viewBox (avant transformation).
    const ox = (r.width - vb.width * f) / 2, oy = (r.height - vb.height * f) / 2;
    ux = (px - r.left - ox) / f; uy = (py - r.top - oy) / f;
  }
  const k2 = Math.min(6, Math.max(0.6, planTransform.k * ratio));
  const reel = k2 / planTransform.k;
  planTransform.tx = ux - (ux - planTransform.tx) * reel;
  planTransform.ty = uy - (uy - planTransform.ty) * reel;
  planTransform.k = k2;
  appliquerTransformPlan();
}

function centrerPlanSur(x, y, k = 2.2) {
  const { cx, cy } = facteurPlan();
  planTransform.k = k;
  planTransform.tx = cx - k * x;
  planTransform.ty = cy - k * y;
  appliquerTransformPlan();
}

function initialiserPlan() {
  const vp = $('#plan-viewport');
  if (!vp) return;
  if (planTransform.centrerSur) {
    // Le même Étage que celui qui est à l'écran : la disposition était calculée
    // tous étages confondus, si bien que les coordonnées de centrage ne
    // correspondaient à rien dès qu'il y avait deux niveaux.
    let cle = null;
    if (planTransform.centrerSur === 'resultat') { const r = rechercherSurPlan(etat.modele, etat.ui.recherchePlan); cle = r && r.salle ? r.salle.cle : null; }
    else cle = normaliser(planTransform.centrerSur);
    const salle = etat.modele.salles.find((s) => s.cle === cle) || null;
    const { rects, placements } = calculerPlan(etat.modele, etageAffiche(etat.modele, etat.ui, salle));
    const cadre = cle ? cadrageSalle(rects, placements, cle) : null;
    if (cadre) centrerPlanSur(cadre.x, cadre.y, cadre.k);
    else if (planTransform.centrerSur !== 'resultat') { planTransform.k = 1; planTransform.tx = 0; planTransform.ty = 0; }
    planTransform.centrerSur = null;
  }
  appliquerTransformPlan();
  planPointeurs = new Map();
  let bouge = false;
  // La capture de pointeur n'est prise QUE lorsqu'un vrai déplacement commence.
  // Un simple appui ne capture rien, donc le clic atteint la Zone ou la Salle
  // touchée : Safari (contrairement à Chrome) redirige sinon le clic vers le
  // conteneur du plan, et plus rien ne répond.
  const capture = new Set();
  const prendreCapture = (id) => { if (capture.has(id)) return; try { vp.setPointerCapture(id); capture.add(id); } catch { /* pointeur déjà relâché */ } };
  const rendreCapture = (id) => { if (!capture.has(id)) return; try { vp.releasePointerCapture(id); } catch { /* déjà relâché */ } capture.delete(id); };

  vp.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.outils')) return;
    planPointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    bouge = false;
    if (planPointeurs.size === 2) {
      const [a, b] = [...planPointeurs.values()];
      planPincementDistance = Math.hypot(a.x - b.x, a.y - b.y);
      for (const id of planPointeurs.keys()) prendreCapture(id); // le pincement est toujours un geste, jamais un appui
      bouge = true;
    }
  });
  vp.addEventListener('pointermove', (e) => {
    const p = planPointeurs.get(e.pointerId);
    if (!p) return;
    const { f } = facteurPlan();
    if (planPointeurs.size === 1) {
      if (!bouge && Math.abs(e.clientX - p.x0) + Math.abs(e.clientY - p.y0) <= SEUIL_GESTE) return; // encore un appui, pas un déplacement
      if (!bouge) { bouge = true; prendreCapture(e.pointerId); }
      planTransform.tx += (e.clientX - p.x) / f; planTransform.ty += (e.clientY - p.y) / f;
      p.x = e.clientX; p.y = e.clientY;
      appliquerTransformPlan();
    } else if (planPointeurs.size === 2) {
      p.x = e.clientX; p.y = e.clientY;
      const [a, b] = [...planPointeurs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (planPincementDistance > 0) zoomerPlan(d / planPincementDistance, (a.x + b.x) / 2, (a.y + b.y) / 2);
      planPincementDistance = d;
      bouge = true;
    }
  });
  const fin = (e) => { rendreCapture(e.pointerId); planPointeurs.delete(e.pointerId); planPincementDistance = 0; };
  vp.addEventListener('pointerup', fin);
  vp.addEventListener('pointercancel', fin);
  // Un déplacement ne doit pas être compris comme un appui sur ce qui se trouve dessous.
  vp.addEventListener('click', (e) => { if (bouge) { e.stopPropagation(); e.preventDefault(); bouge = false; } }, true);
  vp.addEventListener('wheel', (e) => { e.preventDefault(); zoomerPlan(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
}

// ---------------------------------------------------------------- données

let sources = null;

// Le bandeau est le canal des Organisateurs : un message saisi dans le tableur.
// Il s'affichait AUSSI en notification éphémère, donc deux fois le même texte,
// dont une par-dessus le contenu. Un seul canal désormais : le bandeau, refermable.
// Sa fermeture se retient dans la Visite ; un message différent revient malgré tout.
function afficherBandeau(texte) {
  if (texte === etat.bandeau) return;
  etat.bandeau = texte;
  peindreBandeau();
}

function peindreBandeau() {
  const texte = etat.bandeau || '';
  const cache = texte && etat.visite.bandeauFerme === texte;
  el.bandeau.hidden = !texte || cache;
  if (el.bandeau.hidden) { el.bandeau.textContent = ''; return; }
  el.bandeau.innerHTML = `<span>${echapper(texte)}</span><button type="button" data-action="fermer-bandeau" aria-label="Fermer ce message">✕</button>`;
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
        message(`⚠︎ ${echapper(o ? (o.titre || o.nom) : a.cle)} : ${echapper(Visite.texteAlerte(a))}`, { classe: 'orange', duree: 12000 });
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
    if (r.bandeau !== null && r.bandeau !== undefined) afficherBandeau(r.bandeau);
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
    message(`🔔 Dans ${ev.debut - etat.maintenant.minutes} min : ${echapper(ev.titre)} · ${echapper(ev.salle || 'salle à venir')}`, { classe: 'orange', duree: 60000 });
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
      message('Nouvelle version disponible.', { duree: 0, action: { libelle: 'Recharger', faire: rechargerNouvelleVersion } });
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
  // « installee·ios », « navigateur·android »… : d'où vient la donnée en cible,
  // et en detail comment l'appli est ouverte ET sur quelle famille d'appareil.
  stats.noter('ouverture', initial ? initial.source : 'aucune',
    `${installee ? 'installee' : 'navigateur'}·${plateforme(navigator.userAgent, navigator.maxTouchPoints)}`);
  appliquerRoute();
  enregistrerServiceWorker();
  versionServiceWorker().then((v) => { etat.versionSW = v; el.pied.innerHTML = piedDePage(etat); });
  rafraichisseur.demarrer();
  verifierRappels();
  setInterval(verifierRappels, 30000);
  window.__festival = { etat, rendre, stats, sources }; // pour le test de fumée et le débogage
}

demarrer();
