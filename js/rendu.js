// Rendu : une fonction de l'état (route, données, visite, réseau) vers du HTML.
// Aucun état caché dans le DOM ; les gestes modifient l'état puis re-rendent.
import { VILLAGES, DOMAINES, TYPES_EXPOSANT, FORMATS, NIVEAUX, minutesEnHeure, heureEnMinutes, contient, normaliser, publicInclut, etagesDeZone } from './donnees.js';
import { contient as visiteContient, matinee, suggestions, questionsPour, texteAlerte, alertesNonVues, compte, finDe } from './visite.js';
import { disposerZones, placerSalles, etendue, contenuZone, contenuSalle, rechercherSurPlan, sallesDeVisite, salleParNom, phraseGuidage, etagesPresents, planDeLEtage } from './plan.js';
import { icone } from './icones.js';

// ---------------------------------------------------------------- utilitaires

export function h(texte) {
  return String(texte ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const attr = (v) => h(v).replace(/`/g, '&#96;');
const url = (v) => /^(https?:|mailto:|tel:|geo:|maps:)/i.test(String(v)) ? attr(v) : '#';
// L'origine voyage dans le fragment d'URL (comme le marqueur de QR code) : elle
// survit ainsi à un rechargement et au bouton « précédent » du navigateur. Sans
// elle, le retour était déduit du TYPE de la fiche, si bien qu'une école ouverte
// depuis la Salle 21 du plan renvoyait à l'onglet « Écoles ».
const avecOrigine = (base, de) => (de ? `${base}${base.includes('?') ? '&' : '?'}de=${encodeURIComponent(de)}` : base);
const lienExposant = (cle, de = '') => avecOrigine(`#/exposant/${encodeURIComponent(cle)}`, de);
const lienEvenement = (cle, de = '') => avecOrigine(`#/evenement/${encodeURIComponent(cle)}`, de);
const lienPlanSalle = (salle) => `#/plan?salle=${encodeURIComponent(salle)}`;

// Une origine → où revenir, et sous quel nom. « plan:Salle 21 » ramène à la salle,
// « visite » à Ma visite, « domaine:Santé & Soin » à la liste filtrée.
export function retourDepuis(de, defaut) {
  const [genre, ...reste] = String(de || '').split(':');
  const valeur = reste.join(':');
  if (genre === 'plan' && valeur) return { href: lienPlanSalle(valeur), libelle: valeur };
  if (genre === 'village' && valeur) return { href: `#/plan?village=${encodeURIComponent(valeur)}`, libelle: 'Le plan' };
  if (genre === 'plan') return { href: '#/plan', libelle: 'Le plan' };
  if (genre === 'visite') return { href: '#/visite', libelle: 'Ma visite' };
  if (genre === 'programme') return { href: '#/programme', libelle: 'Le programme' };
  if (genre === 'preparer') return { href: '#/preparer', libelle: 'Préparer ma visite' };
  if (genre === 'exposants') return { href: '#/exposants', libelle: 'Les exposants' };
  return defaut;
}

const PLURIEL_TYPE = { 'École': 'Écoles', 'Pro': 'Pros', 'Entreprise': 'Entreprises', 'Ancien élève': 'Anciens élèves' };
const PLURIEL_FORMAT = { 'Conférence': 'Conférences', 'Table ronde': 'Tables rondes', 'Atelier': 'Ateliers' };
const NOM_COURT = new Map(VILLAGES.map((v) => [v.nom, v.court]));
// Sur le plan, les points d'intérêt portent un mot, pas un pictogramme : c'est
// ce qui reste lisible sur un écran de six centimètres.
const MOT_POINT = { Accueil: 'Accueil', Toilettes: 'WC', Foodtruck: 'Café', Auditorium: 'Confs' };
export const nomCourt = (s) => NOM_COURT.get(s) || s;
// Les Domaines d'un objet, en une puce lisible : le premier, puis « +2 ».
// Tout écrire mangerait la ligne sur un téléphone, et le premier suffit à situer.
function pucesDomaines(domaines) {
  if (!domaines || !domaines.length) return '';
  const reste = domaines.length - 1;
  return `<span class="puce neutre">${h(nomCourt(domaines[0]))}${reste ? ` +${reste}` : ''}</span>`;
}

function etoile(etat, objet, libelle) {
  const dans = visiteContient(etat.visite, objet.cle);
  return `<button class="etoile" type="button" data-action="etoile" data-cle="${attr(objet.cle)}" aria-pressed="${dans}" aria-label="${dans ? 'Retirer de ma visite' : 'Ajouter à ma visite'} : ${attr(libelle)}">${icone('visite')}</button>`;
}

function salleHtml(salle, salleAVenir) {
  if (salleAVenir || !salle) return '<span class="salle avenir">salle à venir</span>';
  return `<a class="salle" href="${lienPlanSalle(salle)}">${icone('lieu', 14)}${h(salle)}</a>`;
}

function dateLongue(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  const [a, m, j] = iso.split('-').map(Number);
  const t = new Date(a, m - 1, j).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const heureTexte = (v) => { const m = heureEnMinutes(v); return m === null ? v || '' : minutesEnHeure(m); };

const boutonRetirer = (cle, libelle) => `<button class="etoile" type="button" data-action="retirer" data-cle="${attr(cle)}" aria-label="Retirer de ma visite : ${attr(libelle)}">${icone('fermer', 20)}</button>`;
const coche = (entree) => `<div class="coche"><input type="checkbox" data-action="fait" data-cle="${attr(entree.cle)}" ${entree.fait ? 'checked' : ''} aria-label="Marquer comme fait"></div>`;

// Ma visite est une frise : une colonne d'horaires, puis un rail vertical dont
// chaque point est la case « fait ». Deux usages pour une seule gouttière, ce qui
// est la seule façon de montrer l'heure sans voler de largeur au titre sur un
// téléphone. Le point reste une vraie case à cocher (étiquette, clavier, `change`) ;
// seule son apparence change, et une cible tactile invisible lui donne ses 40 px.
const pointChrono = (entree, { petit = false } = {}) => `<label class="chrono-point${petit ? ' petit' : ''}">
    <input type="checkbox" data-action="fait" data-cle="${attr(entree.cle)}" ${entree.fait ? 'checked' : ''} aria-label="Marquer comme fait">
    <span class="cible" aria-hidden="true"></span></label>`;

// La colonne des horaires : début en gros, fin en dessous. Les deux se lisent comme
// une plage sans coûter la largeur qu'un « 9 h 45 – 10 h 15 » sur une ligne prendrait.
function colonneHeure(ev) {
  const debut = ev && ev.debut !== null && ev.debut !== undefined ? minutesEnHeure(ev.debut) : '';
  const fin = ev && ev.fin !== null && ev.fin !== undefined ? minutesEnHeure(ev.fin) : '';
  if (!debut) return '<div class="rail-heure"></div>';
  return `<div class="rail-heure"><span class="rail-debut">${h(debut)}</span>${fin ? `<span class="rail-fin">${h(fin)}</span>` : ''}</div>`;
}

function ligneEvenement(etat, ev, { avecHeure = true, chrono = false, chevauche = false, entree = null, de = '' } = {}) {
  const meta = [h(ev.format)];
  if (ev.fin !== null && ev.debut !== null) meta.push(`${ev.fin - ev.debut} min`);
  if (ev.intervenantsTexte) meta.push(h(ev.intervenantsTexte));
  const alerte = entree && entree.alerte && !entree.alerte.vue
    ? `<span class="alerte-ico">${icone('alerte', 15)}${h(texteAlerte(entree.alerte))}</span>` : '';
  return `<li class="ligne${chevauche ? ' chevauche' : ''}${entree && entree.fait ? ' fait' : ''}">
    ${chrono ? `${colonneHeure(ev)}${pointChrono(entree)}`
    : avecHeure ? `<div class="heure">${h(minutesEnHeure(ev.debut) || '—')}</div>` : (entree ? coche(entree) : '<div class="marque"></div>')}
    <div class="corps"><a href="${lienEvenement(ev.cle, de)}">${h(ev.titre)}</a>
      <div class="meta">${salleHtml(ev.salle, ev.salleAVenir)}<span>${meta.join(', ')}</span>${pucesDomaines(ev.domaines)}${alerte}</div></div>
    ${entree ? boutonRetirer(ev.cle, ev.titre) : etoile(etat, ev, ev.titre)}
  </li>`;
}

function ligneExposant(etat, ex, { entree = null, chrono = false, de = '', sansSalle = false } = {}) {
  const meta = [];
  if (ex.stand) meta.push(`<span>stand ${h(ex.stand)}</span>`);
  if (ex.organisation && ex.organisation !== ex.type) meta.push(`<span class="puce">${h(ex.organisation)}</span>`);
  if (ex.sousTitre) meta.push(`<span>${h(ex.sousTitre.length > 64 ? `${ex.sousTitre.slice(0, 62)}…` : ex.sousTitre)}</span>`);
  const alerte = entree && entree.alerte && !entree.alerte.vue
    ? `<span class="alerte-ico">${icone('alerte', 15)}${h(texteAlerte(entree.alerte))}</span>` : '';
  return `<li class="ligne${entree && entree.fait ? ' fait' : ''}">
    ${chrono ? `<div class="rail-heure"></div>${pointChrono(entree, { petit: true })}`
    : entree ? coche(entree) : `<div class="marque">${icone('exposants', 18)}</div>`}
    <div class="corps"><a href="${lienExposant(ex.cle, de)}">${h(ex.nom)}</a>
      <div class="meta">${sansSalle ? '' : salleHtml(ex.salle, ex.salleAVenir)}${meta.join('')}${alerte}</div></div>
    ${entree ? boutonRetirer(ex.cle, ex.nom) : etoile(etat, ex, ex.nom)}
  </li>`;
}

function champRecherche(nom, valeur, placeholder) {
  return `<div class="recherche"><span class="loupe">${icone('recherche', 19)}</span>
    <input type="search" data-champ="${nom}" value="${attr(valeur)}" placeholder="${attr(placeholder)}" aria-label="${attr(placeholder)}" autocomplete="off" autocorrect="off" autocapitalize="off" enterkeyhint="search">
    ${valeur ? `<button class="effacer" type="button" data-action="effacer" data-champ="${nom}" aria-label="Effacer la recherche">${icone('fermer', 17)}</button>` : ''}</div>`;
}

// Les Domaines dans l'ordre du festival, puis ceux que le tableur a inventés :
// une valeur inconnue reste cliquable au lieu de disparaître silencieusement.
function ordonner(presents, reference) {
  return reference.filter((s) => presents.has(s)).concat([...presents].filter((s) => !reference.includes(s)));
}

// Les filtres d'un écran : une définition par rangée. La commande compacte, le
// résumé des filtres posés et le compte de résultats sont trois vues de CE calcul,
// écrit une fois et servi au Programme comme aux Exposants. Trois rangées empilées
// dominaient huit rendez-vous et débordaient à droite sans que rien ne le dise.
function rangeesActives(rangees) {
  return rangees.filter((r) => r.actif).map((r) => ({ cle: r.cle, valeur: r.actif, libelle: r.libelle(r.actif) }));
}

function panneauFiltres(rangees, ouvert) {
  const actifs = rangeesActives(rangees);
  const utiles = rangees.filter((r) => r.valeurs.length > 1 || r.actif);
  if (!utiles.length) return '';
  return `<div class="barre-filtres">
    <button class="filtre commande${actifs.length ? ' pose' : ''}" type="button" data-action="filtres" aria-expanded="${Boolean(ouvert)}" aria-controls="panneau-filtres">
      ${icone('filtres', 17)}Filtres${actifs.length ? ` <span class="compte">${actifs.length}</span>` : ''}
    </button>
    ${actifs.map((a) => `<button class="filtre pose retirable" type="button" data-action="filtre" data-filtre="${attr(a.cle)}" data-valeur="" aria-label="Retirer le filtre ${attr(a.libelle)}">${h(a.libelle)}${icone('fermer', 15)}</button>`).join('')}
  </div>
  <div class="panneau-filtres" id="panneau-filtres"${ouvert ? '' : ' hidden'}>
    ${utiles.map((r) => `<div class="filtres" role="group" aria-label="${attr(r.aria)}">
      <span class="titre-filtre">${h(r.titre)}</span>
      <button class="filtre" type="button" data-action="filtre" data-filtre="${attr(r.cle)}" data-valeur="" aria-pressed="${!r.actif}">${h(r.tous)}</button>
      ${r.valeurs.map((v) => `<button class="filtre" type="button" data-action="filtre" data-filtre="${attr(r.cle)}" data-valeur="${attr(r.actif === v ? '' : v)}" aria-pressed="${r.actif === v}">${h(r.libelle(v))}</button>`).join('')}
    </div>`).join('')}
  </div>`;
}

// Le sous-titre d'une liste : ce qu'on voit d'abord, le total ensuite. Sans filtre,
// le total redevient l'information principale — c'est lui qui donne la mesure du
// festival ; avec un filtre, c'est le nombre de résultats qui explique l'écran.
export function sousTitreListe({ affiches, total, phraseTotale, filtre }) {
  if (!total) return '';
  if (!filtre) return phraseTotale;
  return `${affiches} résultat${affiches > 1 ? 's' : ''} · ${total} au total`;
}

export function entete(titre, sous = '', retour = null) {
  return `<header class="entete">${retour ? `<a class="retour" href="${attr(retour.href)}">${icone('retour', 18)}${h(retour.libelle)}</a>` : ''}<h1>${h(titre)}</h1>${sous ? `<p class="sous">${sous}</p>` : ''}</header>`;
}

// ---------------------------------------------------------------- accueil

// L'affiche coupe le titre en deux couleurs : FESTIVAL DE en framboise,
// L'ORIENTATION en turquoise. On reproduit la coupure quand le nom s'y prête, et
// on affiche le nom d'un seul tenant sinon — le tableur reste libre de le changer.
export function titreAffiche(nom) {
  const m = String(nom).match(/^(.*?)\s*(l['’]orientation)\s*$/i);
  if (!m) return h(nom);
  return `<span class="t1">${h(m[1])}</span> <span class="t2">${h(m[2])}</span>`;
}

// Les trois logos de l'affiche. L'Ensemble Scolaire réunit quatre entités
// (collège, lycée général et technologique, lycée professionnel, UFA) et une
// seule a un logo : l'UFA. Les trois autres sont donc nommées en toutes lettres.
function bandeauLogos() {
  return `<div class="logos">
    <img src="./logos/apel.svg" alt="APEL, le souffle de la liberté" width="88" height="60">
    <img src="./logos/ufa-maurice-rondeau.png" alt="UFA Maurice Rondeau Saint-Colomban" width="80" height="59">
    <img src="./logos/saint-colomban.png" alt="Saint Colomban" width="46" height="46">
  </div>`;
}

export function ecranAccueil(etat) {
  const { modele, maintenant } = etat;
  const infos = modele.infos;
  const prochain = prochainEvenement(modele, maintenant);
  const domaines = new Set(modele.exposants.flatMap((e) => e.domaines).filter(Boolean));
  const nb = compte(etat.visite);
  const horaires = infos.heure_debut && infos.heure_fin ? `${heureTexte(infos.heure_debut)} à ${heureTexte(infos.heure_fin)}` : '';
  // Les quatre verbes de l'affiche portent chacun une couleur ; les six boutons
  // s'y rangent, de sorte que l'appli et l'affiche se reconnaissent.
  const bouton = (href, ico, libelle, { extra = '', classe = '', ton = '' } = {}) =>
    `<a href="${href}" class="${classe}"${ton ? ` data-ton="${attr(ton)}"` : ''}>${icone(ico, 22)}<span>${h(libelle)}${extra}</span></a>`;
  return `<section class="affiche">
    ${bandeauLogos()}
    <h1>${titreAffiche(infos.nom || "Festival de l'Orientation")}</h1>
    <p class="quand">${h(dateLongue(infos.date) || 'Date à confirmer')}${horaires ? `<span>${h(horaires)}</span>` : ''}${infos.lieu ? `<span>${h(infos.lieu)}</span>` : ''}</p>
    ${infos.slogan ? `<p class="slogan">${h(infos.slogan)}</p>` : ''}
    ${infos.entree ? `<p class="entree-libre">${h(infos.entree)}</p>` : ''}
  </section>
  <nav class="grille-boutons" aria-label="Aller à l'essentiel">
    ${bouton('#/plan', 'plan', 'Plan du festival', { classe: 'principal', ton: 'explorer' })}
    ${bouton('#/exposants', 'exposants', 'Les exposants', { ton: 'echanger' })}
    ${bouton('#/programme', 'programme', 'Le programme', { ton: 'informer' })}
  </nav>
  <!-- « Préparer ma visite » et « Besoin d'aide ? » ne sont dans aucune barre de
       navigation : l'accueil est le seul endroit où on peut les trouver. -->
  <nav class="grille-boutons secondaires" aria-label="Préparer et se repérer">
    ${bouton('#/preparer', 'preparer', 'Préparer ma visite', { ton: 'construire' })}
    ${bouton('#/aide', 'aide', "Besoin d'aide ?")}
    ${nb ? bouton('#/visite', 'visite', 'Ma visite', { ton: 'construire', extra: `<span class="compte">${nb} élément${nb > 1 ? 's' : ''}</span>` }) : ''}
  </nav>
  ${prochain ? `<section class="prochain" aria-labelledby="prochain-titre">
    <p class="etiquette${prochain.enCours ? ' en-cours' : ''}">${prochain.enCours ? 'En ce moment' : (maintenant.jourJ ? 'Prochain événement' : 'Le festival commence par')}</p>
    <div class="carte-prochain">
      <p class="quand">${h(minutesEnHeure(prochain.debut))}</p>
      <h2 id="prochain-titre"><a href="${lienEvenement(prochain.cle)}">${h(prochain.titre)}</a></h2>
      <div class="meta">${salleHtml(prochain.salle, prochain.salleAVenir)}<span>${h(prochain.format)}${prochain.intervenantsTexte ? `, ${h(prochain.intervenantsTexte)}` : ''}</span></div>
    </div>
  </section>` : ''}
  ${domaines.size ? `<section class="commencer">
    <h2 class="titre-section">Par où commencer ?</h2>
    <p>Choisis un domaine, on te montre son village et qui l'anime.</p>
    <div class="domaines-accueil">${ordonner(domaines, DOMAINES).map((s) => `<a class="puce" href="#/exposants?domaine=${encodeURIComponent(s)}">${h(s)}</a>`).join('')}</div>
  </section>` : ''}`;
}

// L'Événement à mettre en avant : le jour J, celui en cours ou le prochain ; sinon le premier.
export function prochainEvenement(modele, maintenant) {
  const evs = modele.evenements.filter((e) => e.debut !== null);
  if (!evs.length) return null;
  if (!maintenant || !maintenant.jourJ) return { ...evs[0], enCours: false };
  const m = maintenant.minutes;
  const enCours = evs.find((e) => e.debut <= m && finDe(e) > m && !e.moment);
  if (enCours) return { ...enCours, enCours: true };
  const suivant = evs.find((e) => e.debut > m);
  return suivant ? { ...suivant, enCours: false } : null;
}

// ---------------------------------------------------------------- programme

export function filtrerEvenements(modele, ui) {
  return modele.evenements.filter((e) => {
    if (ui.filtreDomaineProgramme && !e.domaines.includes(ui.filtreDomaineProgramme) && !e.moment) return false;
    if (ui.filtreFormat && e.format !== ui.filtreFormat) return false;
    if (ui.filtrePublic && !publicInclut(e.public, ui.filtrePublic)) return false;
    if (ui.rechercheProgramme) {
      const q = ui.rechercheProgramme;
      if (![e.titre, e.description, e.intervenantsTexte, e.salle, ...e.domaines, e.format].some((t) => t && contient(t, q))) return false;
    }
    return true;
  });
}

export function ecranProgramme(etat) {
  const { modele, ui } = etat;
  const liste = filtrerEvenements(modele, ui);
  const domaines = ordonner(new Set(modele.evenements.flatMap((e) => e.domaines).filter(Boolean)), DOMAINES);
  const formats = FORMATS.filter((f) => modele.evenements.some((e) => e.format === f));
  const publics = [['3e', 'Collégiens'], ['Terminale', 'Lycéens'], ['étudiant', 'Étudiants'], ['parent', 'Parents']];
  const rangees = [
    { cle: 'filtreDomaineProgramme', titre: 'Domaine', tous: 'Tous', aria: 'Filtrer par domaine',
      valeurs: domaines, actif: ui.filtreDomaineProgramme, libelle: (v) => nomCourt(v) },
    { cle: 'filtreFormat', titre: 'Format', tous: 'Tous', aria: 'Filtrer par format',
      valeurs: formats, actif: ui.filtreFormat, libelle: (v) => PLURIEL_FORMAT[v] || v },
    { cle: 'filtrePublic', titre: 'Public', tous: 'Tout public', aria: 'Filtrer par public',
      valeurs: publics.map(([v]) => v), actif: ui.filtrePublic,
      libelle: (v) => (publics.find(([x]) => x === v) || [v, v])[1] },
  ];
  // Le compte annoncé doit égaler le nombre de lignes sous les yeux. L'ouverture
  // est une ligne, mais pas un rendez-vous : on la nomme au lieu de la taire.
  const rendezVous = liste.filter((e) => !e.moment).length;
  const ouverture = liste.length - rendezVous;
  const phraseTotale = `${rendezVous} rendez-vous${rendezVous > 1 ? '' : ''}${ouverture ? ' et l’ouverture' : ''}`;
  const filtre = Boolean(ui.filtreDomaineProgramme || ui.filtreFormat || ui.filtrePublic || ui.rechercheProgramme);
  return `${entete('Le programme', sousTitreListe({ affiches: liste.length, total: modele.evenements.length, phraseTotale, filtre }))}
  ${champRecherche('rechercheProgramme', ui.rechercheProgramme, 'Un domaine, une école, un intervenant')}
  ${panneauFiltres(rangees, ui.filtresOuverts)}
  ${liste.length ? `<ul class="liste">${liste.map((e) => ligneEvenement(etat, e, { de: 'programme' })).join('')}</ul>`
    : `<p class="vide">${modele.evenements.length ? 'Aucun événement ne correspond. Élargissez la recherche ou les filtres.' : 'Le programme arrive bientôt : les événements confirmés s\'afficheront ici.'}</p>`}
  ${modele.infos.restauration ? `<p class="info">${icone('cafe', 19)}${h(modele.infos.restauration)}</p>` : ''}`;
}

// ---------------------------------------------------------------- un événement

export function ecranEvenement(etat, cle) {
  const { modele } = etat;
  const ev = modele.evenements.find((e) => e.cle === cle);
  if (!ev) return `${entete('Événement introuvable', '', retourDepuis(etat.route.params.de, { href: '#/programme', libelle: 'Le programme' }))}
    <p class="vide">Cet événement n'est plus au programme, ou le lien est incomplet.</p>
    <div class="boutons"><a class="bouton" href="#/programme">Voir le programme</a></div>`;
  const intervenants = ev.intervenants.map((c) => modele.exposants.find((x) => x.cle === c)).filter(Boolean);
  const dans = visiteContient(etat.visite, ev.cle);
  const entree = etat.visite.entrees.find((e) => e.cle === ev.cle);
  return `<article class="fiche">
    ${entete(ev.titre, '', retourDepuis(etat.route.params.de, { href: '#/programme', libelle: 'Le programme' }))}
    <div class="puces"><span class="puce">${h(ev.format)}</span>${ev.domaines.map((d) => `<span class="puce neutre">${h(d)}</span>`).join('')}${ev.public.length ? `<span class="puce neutre">${h(ev.public.join(', '))}</span>` : ''}</div>
    ${entree && entree.alerte && !entree.alerte.vue ? `<p class="avert">${icone('alerte', 19)}<span>Changement : ${h(texteAlerte(entree.alerte))}</span></p>` : ''}
    <dl>
      <dt>Quand</dt><dd>${h(minutesEnHeure(ev.debut) || 'heure à venir')}${ev.fin !== null ? ` à ${h(minutesEnHeure(ev.fin))}` : ''}</dd>
      <dt>Où</dt><dd>${salleHtml(ev.salle, ev.salleAVenir)}${ev.zone ? `, village ${h(ev.zone.numero ?? '')} ${h(ev.zone.nom)}` : ''}</dd>
      ${ev.intervenantsTexte ? `<dt>Avec</dt><dd>${h(ev.intervenantsTexte)}</dd>` : ''}
    </dl>
    ${ev.description ? `<p class="description">${h(ev.description)}</p>` : ''}
    <div class="boutons">
      <button class="bouton${dans ? ' orange' : ''}" type="button" data-action="etoile" data-cle="${attr(ev.cle)}" aria-pressed="${dans}">${icone('visite', 19)}${dans ? 'Dans ma visite' : 'Ajouter à ma visite'}</button>
      ${ev.debut !== null && !ev.moment ? `<button class="bouton secondaire" type="button" data-action="calendrier" data-cle="${attr(ev.cle)}">${icone('calendrier', 19)}Ajouter au calendrier</button>` : ''}
      ${ev.salle && !ev.salleAVenir ? `<a class="bouton secondaire" href="${lienPlanSalle(ev.salle)}">${icone('plan', 19)}Voir la salle sur le plan</a>` : ''}
    </div>
    ${intervenants.length ? `<h2 class="titre-section">Les intervenants</h2><ul class="liste carte">${intervenants.map((x) => ligneExposant(etat, x)).join('')}</ul>` : ''}
    ${!ev.moment ? `<p class="rappel">${icone('cloche', 17)}Rappel 10 min avant, si l'appli est ouverte</p>` : ''}
  </article>`;
}

// ---------------------------------------------------------------- exposants

export function typesPresents(modele) {
  return TYPES_EXPOSANT.filter((t) => modele.exposants.some((e) => e.type === t));
}

export function filtrerExposants(modele, ui, type) {
  return modele.exposants.filter((e) => {
    if (type && e.type !== type) return false;
    if (ui.filtreDomaineExposants && !e.domaines.includes(ui.filtreDomaineExposants)) return false;
    if (ui.rechercheExposants) {
      const q = ui.rechercheExposants;
      if (![e.nom, e.sousTitre, e.organisation, e.ville, e.salle, e.village, ...e.domaines, e.description].some((t) => t && contient(t, q))) return false;
    }
    return true;
  }).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

// Les Exposants rangés par Village, dans l'ordre du plan. Ceux dont le stand
// n'est pas encore affecté ferment la marche plutôt que de disparaître.
export function grouperParVillage(liste) {
  const rang = new Map(VILLAGES.map((v, i) => [v.nom, i]));
  const groupes = new Map();
  for (const e of liste) {
    const cle = e.village || '';
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(e);
  }
  return [...groupes.entries()]
    .map(([village, exposants]) => ({ village, exposants }))
    .sort((a, b) => (a.village ? rang.get(a.village) ?? 97 : 99) - (b.village ? rang.get(b.village) ?? 97 : 99)
      || a.village.localeCompare(b.village, 'fr'));
}

export function ecranExposants(etat) {
  const { modele, ui } = etat;
  const types = typesPresents(modele);
  // Les onglets sont la taxonomie des Organisateurs ; un Secteur est la question
  // du Visiteur. Le filtre traverse donc les onglets : si celui qu'on affiche n'a
  // personne dans le Secteur choisi, on ouvre le premier qui en a. Sans cela,
  // « Par où commencer ? » envoie sur une liste vide dès qu'un Secteur n'est porté
  // que par des Pros ou des Entreprises.
  const demande = types.includes(ui.ongletExposants) ? ui.ongletExposants : types[0] || null;
  const compte = (t) => filtrerExposants(modele, ui, t).length;
  const type = ui.filtreDomaineExposants && demande && compte(demande) === 0
    ? (types.find((t) => compte(t) > 0) || demande)
    : demande;
  const liste = filtrerExposants(modele, ui, type);
  // Les Domaines proposés viennent de TOUS les Exposants, pas du seul onglet :
  // autrement le filtre actif disparaît de l'écran et devient impossible à annuler.
  const domaines = ordonner(new Set(modele.exposants.flatMap((e) => e.domaines).filter(Boolean)), DOMAINES);
  const total = modele.exposants.length;
  const villagesOccupes = modele.zones.filter((z) => !z.fonction && z.salles.length).length;
  const numeroDe = (nom) => { const z = modele.zones.find((x) => x.nom === nom); return z ? z.numero : null; };
  const rangees = [
    { cle: 'filtreDomaineExposants', titre: 'Domaine', tous: 'Tous', aria: 'Filtrer par domaine',
      valeurs: domaines, actif: ui.filtreDomaineExposants, libelle: (v) => nomCourt(v) },
  ];
  const filtre = Boolean(ui.filtreDomaineExposants || ui.rechercheExposants);
  const phraseTotale = `${total} à rencontrer${villagesOccupes ? `, dans ${villagesOccupes} village${villagesOccupes > 1 ? 's' : ''}` : ''}`;
  // Groupé par Village : c'est la question du Visiteur (« où vais-je trouver la
  // santé ? »), et c'est ce que le plan lui montrera. Une liste alphabétique de
  // cent trente noms ne répond à aucune question.
  const groupes = grouperParVillage(liste);
  return `${entete('Les exposants', sousTitreListe({ affiches: liste.length, total, phraseTotale, filtre }))}
  ${types.length > 1 ? `<div class="onglets" role="tablist" aria-label="Type d'exposant">
    ${types.map((t) => { const n = filtre ? compte(t) : null; return `<button class="onglet" type="button" role="tab" id="onglet-${attr(normaliser(t))}" aria-selected="${t === type}" data-action="onglet" data-valeur="${attr(t)}">${h(PLURIEL_TYPE[t])}${n === null ? '' : ` <span class="compte">${n}</span>`}</button>`; }).join('')}
  </div>` : ''}
  ${champRecherche('rechercheExposants', ui.rechercheExposants, type === 'Pro' ? 'Un métier, un nom, une entreprise' : 'Une école, une formation, une ville')}
  ${panneauFiltres(rangees, ui.filtresOuverts)}
  <div role="tabpanel" ${type ? `aria-labelledby="onglet-${attr(normaliser(type))}"` : ''}>
  ${groupes.length ? groupes.map(({ village, exposants }) => {
    const num = village ? numeroDe(village) : null;
    return `<h2 class="titre-village">${village
      ? `<a href="#/plan?village=${encodeURIComponent(num ?? village)}">${num !== null && num !== undefined ? `<span class="num">${h(num)}</span>` : ''}${h(village)}</a>`
      : 'Village à venir'}<span class="compte">${exposants.length}</span></h2>
    <ul class="liste">${exposants.map((e) => ligneExposant(etat, e, { de: 'exposants' })).join('')}</ul>`;
  }).join('')
    : `<p class="vide">${modele.exposants.length ? 'Aucun exposant ne correspond. Élargissez la recherche ou les filtres.' : 'La liste des exposants arrive bientôt.'}</p>`}
  </div>`;
}

// ---------------------------------------------------------------- un exposant

export function ecranExposant(etat, cle, { qr = false } = {}) {
  const { modele } = etat;
  const ex = modele.exposants.find((e) => e.cle === cle);
  if (!ex) return `${entete('Exposant introuvable', '', retourDepuis(etat.route.params.de, { href: '#/exposants', libelle: 'Les exposants' }))}
    <p class="vide">Cet exposant n'est pas (ou plus) dans la liste, ou le lien est incomplet.</p>
    <div class="boutons"><a class="bouton" href="#/exposants">Voir les exposants</a></div>`;
  const dans = visiteContient(etat.visite, ex.cle);
  const entree = etat.visite.entrees.find((e) => e.cle === ex.cle);
  const evenements = ex.evenements.map((c) => modele.evenements.find((e) => e.cle === c)).filter(Boolean);
  const salleObj = salleParNom(modele, ex.salle);
  const libSousTitre = { 'École': 'Formations', 'Pro': 'Métier', 'Entreprise': 'Métiers', 'Ancien élève': 'Parcours' }[ex.type] || 'Formations';
  const formations = ex.type === 'École' && ex.sousTitre ? ex.sousTitre.split(/;/).map((s) => s.trim()).filter(Boolean) : [];
  const questionsType = questionsPour(etat.visite, modele, ex.type);
  return `<article class="fiche">
    ${qr ? `<p class="qr-entete">${icone('qr', 22)}<span>Vous venez de scanner le QR code du stand${ex.salle ? `, ${h(ex.salle)}${ex.stand ? `, stand ${h(ex.stand)}` : ''}` : ''}</span></p>` : ''}
    ${entete(ex.nom, '', retourDepuis(etat.route.params.de, { href: `#/exposants?onglet=${encodeURIComponent(ex.type)}`, libelle: PLURIEL_TYPE[ex.type] || 'Les exposants' }))}
    <div class="puces"><span class="puce">${h(ex.type)}</span>${ex.organisation && ex.organisation !== ex.type ? `<span class="puce">${h(ex.organisation)}</span>` : ''}${ex.domaines.map((d) => `<span class="puce neutre">${h(d)}</span>`).join('')}</div>
    ${entree && entree.alerte && !entree.alerte.vue ? `<p class="avert">${icone('alerte', 19)}<span>Changement : ${h(texteAlerte(entree.alerte))}</span></p>` : ''}
    <dl>
      ${ex.type === 'Pro' && ex.organisation ? `<dt>Entreprise</dt><dd>${h(ex.organisation)}</dd>` : ''}
      ${ex.type !== 'École' && ex.sousTitre ? `<dt>${libSousTitre}</dt><dd>${h(ex.sousTitre)}</dd>` : ''}
      ${ex.niveau ? `<dt>Niveau</dt><dd>${h(ex.niveau)}</dd>` : ''}
      ${ex.ville ? `<dt>Ville</dt><dd>${h(ex.ville)}</dd>` : ''}
      ${ex.village ? `<dt>Village</dt><dd>${h(ex.village)}${salleObj && salleObj.zone && salleObj.zone.numero !== null ? ` (village ${h(salleObj.zone.numero)})` : ''}</dd>` : ''}
      <dt>Salle</dt><dd>${salleHtml(ex.salle, ex.salleAVenir)}${salleObj ? `, ${h(salleObj.etage.toLowerCase())}` : ''}${ex.stand ? `, stand ${h(ex.stand)}` : ''}</dd>
      ${ex.presence ? `<dt>Présent</dt><dd>${h(ex.presence)}</dd>` : ''}
    </dl>
    ${ex.description ? `<p class="description">${h(ex.description)}</p>` : ''}
    ${formations.length ? `<h2 class="titre-section">Formations présentées</h2><div class="puces">${formations.map((f) => `<span class="puce neutre">${h(f)}</span>`).join('')}</div>` : ''}
    <div class="boutons">
      <button class="bouton${dans ? ' orange' : ''}" type="button" data-action="etoile" data-cle="${attr(ex.cle)}" aria-pressed="${dans}">${icone('visite', 19)}${dans ? 'À visiter' : 'Ajouter à ma visite'}</button>
      ${ex.salle && !ex.salleAVenir ? `<a class="bouton secondaire" href="${lienPlanSalle(ex.salle)}">${icone('plan', 19)}Voir sur le plan</a>` : ''}
      ${questionsType.length ? `<a class="bouton secondaire" href="#/questions?type=${encodeURIComponent(ex.type)}">${icone('aide', 19)}Mes questions</a>` : ''}
      ${ex.site ? `<a class="bouton secondaire" href="${url(ex.site)}" target="_blank" rel="noopener" data-action="site" data-cle="${attr(ex.cle)}">${icone('externe', 19)}${h(ex.site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, ''))}</a>` : ''}
    </div>
    ${evenements.length ? `<h2 class="titre-section">Intervient aussi</h2><ul class="liste carte">${evenements.map((e) => ligneEvenement(etat, e)).join('')}</ul>` : ''}
  </article>`;
}

// ---------------------------------------------------------------- plan

const COULEUR_ZONE = (numero) => `var(--z${((numero ?? 1) - 1) % 11 + 1})`;
const co = (n) => Math.round(n * 100) / 100;

// Le nom d'une Zone sur au plus deux lignes qui tiennent dans son rectangle.
export function couperNomZone(nom, maxCaracteres) {
  const mots = String(nom).split(/\s+/);
  const lignes = [''];
  for (const mot of mots) {
    const courante = lignes[lignes.length - 1];
    if (courante && (courante + ' ' + mot).length > maxCaracteres && lignes.length < 2) lignes.push(mot);
    else lignes[lignes.length - 1] = courante ? `${courante} ${mot}` : mot;
  }
  return lignes.map((l) => (l.length > maxCaracteres ? `${l.slice(0, Math.max(1, Math.floor(maxCaracteres) - 1))}…` : l));
}

export function calculerPlan(modele, etage = null) {
  const { salles, zones } = etage ? planDeLEtage(modele, etage) : { salles: modele.salles, zones: modele.zones };
  const rects = disposerZones(zones);
  const placements = placerSalles(salles, rects);
  return { rects, placements, etendue: etendue(rects, placements) };
}

// L'étage affiché : celui de la salle qu'on cherche ou qu'on vient de toucher,
// sinon celui du village ouvert, sinon celui que le Visiteur a choisi. Chercher
// « Salle 43 » depuis le rez-de-chaussée doit monter d'un étage tout seul —
// sans quoi la recherche répond « rien trouvé » alors qu'elle a trouvé.
export function etageAffiche(modele, ui, cible) {
  const etages = etagesPresents(modele);
  if (cible && cible.etage && etages.includes(cible.etage)) return cible.etage;
  if (ui.etagePlan && etages.includes(ui.etagePlan)) return ui.etagePlan;
  return etages[0];
}

export function ecranPlan(etat) {
  const { modele, ui } = etat;
  const sallesVisite = sallesDeVisite(etat.visite, modele);
  const resultat = ui.recherchePlan ? rechercherSurPlan(modele, ui.recherchePlan) : null;
  const allumee = resultat && resultat.salle ? resultat.salle.cle : (ui.salleAllumee ? normaliser(ui.salleAllumee) : null);
  const salleAllumeeObj = allumee ? modele.salles.find((s) => s.cle === allumee) : null;
  const etages = etagesPresents(modele);
  const etage = etageAffiche(modele, ui, salleAllumeeObj);
  const { rects, placements, etendue: dim } = calculerPlan(modele, etage);
  // Une Zone explicitement touchée ouvre le panneau de la Zone ; une Salle
  // touchée ouvre le panneau de cette Salle seule, et non de toute sa Zone.
  const zoneOuverte = ui.zoneOuverte !== null && ui.zoneOuverte !== undefined
    ? modele.zones.find((z) => String(z.numero ?? z.nom) === String(ui.zoneOuverte)) : null;
  const zoneActive = zoneOuverte || (salleAllumeeObj ? salleAllumeeObj.zone : null);
  const salleDemandee = ui.salleAllumee && !salleAllumeeObj ? ui.salleAllumee : null;

  const svgZones = rects.map((r) => {
    // Le nom démarre après le numéro : deux chiffres prennent plus de place qu'un,
    // sans quoi « 10 » et « Orientation générale » se chevauchent.
    const chiffres = r.zone.numero === null ? 0 : String(r.zone.numero).length;
    const x0 = r.x + (chiffres ? 3.4 + chiffres * 2.2 : 2);
    const lignes = couperNomZone(r.zone.nom, (r.x + r.w - 1 - x0) / 1.3);
    return `<g class="zone-g">
      <rect class="zone-rect${zoneActive === r.zone ? ' active' : ''}" x="${co(r.x)}" y="${co(r.y)}" width="${co(r.w)}" height="${co(r.h)}" rx="2.4" fill="${COULEUR_ZONE(r.zone.numero)}" data-action="zone" data-valeur="${attr(r.zone.numero ?? r.zone.nom)}" tabindex="0" role="button" aria-label="${r.zone.fonction ? '' : 'Village '}${attr(r.zone.numero ?? '')} ${attr(r.zone.nom)}"/>
      <text class="zone-num" x="${co(r.x + 2.2)}" y="${co(r.y + 5)}">${h(r.zone.numero ?? '')}</text>
      ${lignes.map((l, i) => `<text class="zone-nom" x="${co(x0)}" y="${co(r.y + 4.4 + i * 2.7)}">${h(l)}</text>`).join('')}
    </g>`;
  }).join('');

  const svgSalles = placements.filter((p) => p.x !== null).map((p) => {
    const s = p.salle;
    const estPoi = Boolean(MOT_POINT[s.typePoint]);
    const label = estPoi ? MOT_POINT[s.typePoint] : s.nom.replace(/^salle\s+/i, 'S ');
    const dansVisite = sallesVisite.has(s.cle);
    const classes = ['salle-g', estPoi ? 'poi' : '', dansVisite ? 'visite' : '', allumee === s.cle ? 'allumee' : ''].filter(Boolean).join(' ');
    const w = Math.max(6.4, label.length * 1.32 + 2.4), hh = 4.2;
    return `<g class="${classes}" data-action="salle" data-valeur="${attr(s.nom)}" tabindex="0" role="button" aria-label="${attr(s.nom)}${p.estimee ? ' (position estimée)' : ''}">
      ${allumee === s.cle ? `<rect class="halo" x="${co(p.x - w / 2)}" y="${co(p.y - hh / 2)}" width="${co(w)}" height="${hh}" rx="1.4"/>` : ''}
      <rect class="salle-rect${p.estimee ? ' estimee' : ''}" x="${co(p.x - w / 2)}" y="${co(p.y - hh / 2)}" width="${co(w)}" height="${hh}" rx="1.2"/>
      <text class="salle-txt" x="${co(p.x)}" y="${co(p.y + 0.75)}">${h(label)}</text>
      ${dansVisite ? `<path class="salle-etoile" d="M${co(p.x + w / 2 - 0.2)} ${co(p.y - hh / 2 - 1.1)}v2.2m-1.1-1.1h2.2"/>` : ''}
    </g>`;
  }).join('');

  const contenu = zoneOuverte ? contenuZone(modele, zoneOuverte) : null;
  const contenuDeLaSalle = !zoneOuverte && salleAllumeeObj ? contenuSalle(modele, salleAllumeeObj) : null;
  // Le nom de la Salle allumée n'est plus écrit qu'UNE fois — il l'était trois :
  // dans le sous-titre, dans le guidage, puis dans le panneau. C'est le panneau
  // qui parle, et il passe AVANT la carte, pour être lu sans faire défiler.
  const guidage = resultat && !(resultat.genre === 'salle' && salleAllumeeObj)
    ? `<section class="guidage" aria-live="polite"><h2>${h(resultat.libelle)}</h2>
      <p><span class="ou">${h(resultat.nomSalle || 'salle à venir')}</span> — ${h(resultat.phrase)}</p>
      <div class="boutons">${resultat.exposant ? `<a class="bouton secondaire" href="${lienExposant(resultat.exposant.cle)}">Voir la fiche</a>${etoile(etat, resultat.exposant, resultat.exposant.nom)}` : ''}${resultat.evenement ? `<a class="bouton secondaire" href="${lienEvenement(resultat.evenement.cle)}">Voir l'événement</a>` : ''}</div>
    </section>`
    : salleDemandee ? `<section class="guidage" aria-live="polite"><h2>${h(salleDemandee)}</h2><p>${h(phraseGuidage(null, salleDemandee))}</p></section>`
    : ui.recherchePlan && !resultat ? '<p class="vide">Rien trouvé. Essayez le numéro de la salle ou le nom de l\'école.</p>' : '';

  const panneauSalle = contenuDeLaSalle ? `<section class="panneau-zone salle" aria-live="polite">
    <h2>${h(salleAllumeeObj.nom)}</h2>
    <p class="salles-de-la-zone">${h(phraseGuidage(salleAllumeeObj))}</p>
    <p class="salles-de-la-zone">${contenuDeLaSalle.exposants.length ? `${contenuDeLaSalle.exposants.length} exposant${contenuDeLaSalle.exposants.length > 1 ? 's' : ''} ici` : "Aucun exposant dans cette salle pour l'instant"}</p>
    ${salleAllumeeObj.zone ? `<div class="boutons"><button class="bouton secondaire" type="button" data-action="zone" data-valeur="${attr(salleAllumeeObj.zone.numero ?? salleAllumeeObj.zone.nom)}">Voir tout le village ${h(salleAllumeeObj.zone.numero ?? '')} ${h(salleAllumeeObj.zone.nom)}</button></div>` : ''}
    ${contenuDeLaSalle.exposants.length ? `<ul class="liste">${contenuDeLaSalle.exposants.map((e) => ligneExposant(etat, e, { de: `plan:${salleAllumeeObj.nom}`, sansSalle: true })).join('')}</ul>` : ''}
    ${contenuDeLaSalle.evenements.length ? `<h3 class="titre-section">Événements dans cette salle</h3><ul class="liste">${contenuDeLaSalle.evenements.map((e) => ligneEvenement(etat, e, { de: `plan:${salleAllumeeObj.nom}` })).join('')}</ul>` : ''}
  </section>` : '';

  const legende = `<div class="legende" aria-hidden="true">${rects.filter((r) => r.zone.numero !== null).map((r) => `<span style="--c:${COULEUR_ZONE(r.zone.numero)}">${h(r.zone.numero)} ${h(r.zone.nom)}</span>`).join('')}</div>`;

  // Les onglets d'étage : deux niveaux, deux plans. On ne les affiche que si le
  // tableur en connaît plus d'un — un festival de plain-pied n'a pas à choisir.
  const onglets = etages.length > 1 ? `<div class="onglets etages" role="tablist" aria-label="Étage">
    ${etages.map((e) => `<button class="onglet" type="button" role="tab" aria-selected="${e === etage}" data-action="etage" data-valeur="${attr(e)}">${h(e)}</button>`).join('')}
  </div>` : '';

  const listeEtage = (e) => modele.zones.filter((z) => z.salles.some((s) => s.etage === e))
    .map((z) => `<li class="ligne"><div class="heure">${h(z.numero ?? '·')}</div><div class="corps"><button class="filtre" type="button" data-action="zone" data-valeur="${attr(z.numero ?? z.nom)}">${h(z.nom)}</button><div class="meta"><span>${z.salles.filter((s) => s.etage === e).map((s) => h(s.nom)).join(', ') || 'salles à venir'}</span></div></div><div></div></li>`).join('');
  const equivalent = `<details class="equivalent"><summary>Le plan en liste (villages et salles)</summary>
    ${etages.map((e) => `<h3 class="titre-section">${h(e)}</h3><ul class="liste">${listeEtage(e) || '<li class="ligne"><div class="corps">Rien à cet étage pour l\'instant.</div></li>'}</ul>`).join('')}
  </details>`;

  const villagesDuPlan = rects.filter((r) => r.zone.numero !== null).map((r) => `${r.zone.numero} ${r.zone.nom}`).join(', ');
  return `${entete('Plan du festival', 'Touchez un village, ou cherchez une salle ou une école')}
  ${champRecherche('recherchePlan', ui.recherchePlan, 'Une salle, une école, un événement')}
  ${onglets}
  <div class="plan-cote-a-cote">
  ${guidage}
  ${panneauSalle}
  <div class="plan-carte">
  <div class="plan-viewport" id="plan-viewport">
    <svg viewBox="0 0 ${dim.largeur} ${dim.hauteur}" role="img" aria-labelledby="plan-titre plan-desc" preserveAspectRatio="xMidYMid meet">
      <title id="plan-titre">Plan stylisé de l'Ensemble Scolaire Maurice Rondeau — ${h(etage)}</title>
      <desc id="plan-desc">${h(etage)} : ${h(villagesDuPlan)}. La liste équivalente est sous le plan.</desc>
      <g class="plan-monde" id="plan-monde" data-hauteur="${dim.hauteur}">
        <rect x="0" y="0" width="${dim.largeur}" height="${dim.hauteur}" fill="transparent"/>
        ${svgZones}
        ${svgSalles}
        ${etage === etages[0] ? `<text class="entree-txt" x="50" y="${co(dim.hauteur - 1.5)}">Entrée</text>` : ''}
      </g>
    </svg>
    <div class="outils">
      <button type="button" data-action="zoom" data-valeur="1" aria-label="Zoomer">${icone('plus', 17)}</button>
      <button type="button" data-action="zoom" data-valeur="-1" aria-label="Dézoomer">${icone('moins', 17)}</button>
      <button type="button" data-action="recentrer" aria-label="Recentrer le plan">${icone('recentrer', 17)}</button>
    </div>
  </div>
  ${legende}
  </div>
  ${contenu ? `<section class="panneau-zone village" aria-live="polite">
    <h2><span class="num">${h(zoneOuverte.numero ?? '')}</span>${h(zoneOuverte.nom)}</h2>
    ${contenu.salles.length ? `<p class="salles-de-la-zone">Salles : ${contenu.salles.map((s) => `<a href="${lienPlanSalle(s.nom)}">${h(s.nom)}</a>`).join(', ')} — ${h(etagesDeZone(zoneOuverte).join(' et ').toLowerCase())}</p>` : '<p class="salles-de-la-zone">Salles à venir.</p>'}
    ${contenu.exposants.length ? `<h3 class="titre-section">Exposants</h3><ul class="liste">${contenu.exposants.map((e) => ligneExposant(etat, e, { de: `village:${zoneOuverte.numero ?? zoneOuverte.nom}` })).join('')}</ul>` : ''}
    ${contenu.evenements.length ? `<h3 class="titre-section">Événements</h3><ul class="liste">${contenu.evenements.map((e) => ligneEvenement(etat, e, { de: `village:${zoneOuverte.numero ?? zoneOuverte.nom}` })).join('')}</ul>` : ''}
    ${!contenu.exposants.length && !contenu.evenements.length ? '<p class="vide">Rien n\'est encore affecté à ce village.</p>' : ''}
  </section>` : ''}
  </div>
  ${equivalent}`;
}

// ---------------------------------------------------------------- ma visite

export function ecranVisite(etat) {
  const { modele } = etat;
  const lignes = matinee(etat.visite, modele);
  // Deux natures d'engagement, deux groupes (ADR-0010) : un stand glissé entre
  // deux conférences se lisait comme une conférence de plus. L'ordre calculé par
  // matinee() survit — il devient l'ordre à l'intérieur du groupe des stands.
  const rendezVous = lignes.filter((l) => l.genre === 'evenement');
  const stands = lignes.filter((l) => l.genre !== 'evenement');
  const chev = lignes.filter((l) => l.chevauche);
  const questions = questionsPour(etat.visite, modele);
  // Un groupe vide ne se compte pas : « 1 événement et 0 stand » comptait du vide.
  const parts = [];
  if (rendezVous.length) parts.push(`${rendezVous.length} rendez-vous`);
  if (stands.length) parts.push(`${stands.length} stand${stands.length > 1 ? 's' : ''}`);
  const sous = parts.length ? parts.join(' et ') : 'Votre carnet de visite';
  const ligne = (l) => {
    if (!l.objet) return `<li class="ligne"><div class="rail-heure"></div>${pointChrono(l.entree, { petit: true })}<div class="corps"><span>${h(l.entree.cle)}</span><div class="meta"><span class="puce alerte">n'est plus au programme</span></div></div>${boutonRetirer(l.entree.cle, l.entree.cle)}</li>`;
    return l.genre === 'evenement'
      ? ligneEvenement(etat, l.objet, { chrono: true, chevauche: l.chevauche, entree: l.entree, de: 'visite' })
      : ligneExposant(etat, l.objet, { chrono: true, entree: l.entree, de: 'visite' });
  };
  return `${entete('Ma visite', h(sous))}
  ${lignes.length ? `${chev.length ? `<p class="avert">${icone('alerte', 19)}<span>${h(minutesEnHeure(chev[0].objet ? chev[0].objet.debut : null))} : deux événements en même temps. Gardez-en un.</span></p>` : ''}
  ${rendezVous.length ? `<h2 class="titre-section">Rendez-vous à heure fixe</h2>
  <ul class="liste carte chrono">${rendezVous.map(ligne).join('')}</ul>` : ''}
  ${stands.length ? `<h2 class="titre-section">Stands à visiter quand j'ai un créneau</h2>
  <ul class="liste carte chrono">${stands.map(ligne).join('')}</ul>` : ''}`
    : `<p class="vide">Rien pour l'instant. Touchez l'étoile sur un événement ou un exposant pour construire votre matinée.</p>
  <div class="boutons"><a class="bouton" href="#/programme">${icone('programme', 19)}Le programme</a><a class="bouton secondaire" href="#/exposants">${icone('exposants', 19)}Les exposants</a></div>`}
  <div class="boutons">
    ${questions.length ? `<a class="bouton secondaire large" href="#/questions">${icone('aide', 19)}Mes questions à poser</a>` : ''}
    <a class="bouton secondaire large" href="#/preparer">${icone('preparer', 19)}Préparer ma visite</a>
    <a class="bouton secondaire large" href="#/aide">${icone('info', 19)}Besoin d'aide ?</a>
  </div>
  <p class="maj">Ma visite reste dans ce téléphone. Rien n'est envoyé nulle part.</p>`;
}

// ---------------------------------------------------------------- préparer ma visite

// Quatre étapes courtes plutôt qu'une page interminable. L'étape est un état
// d'interface et non une route : le parcours se fait d'une traite, et quatre
// entrées d'historique pour un aller simple ne rendraient service à personne.
const ETAPES_PREPARER = ['Me situer', 'Ma sélection', 'Mes questions', 'Ma visite'];
const MAX_SUGGESTIONS = 12;

export function ecranPreparer(etat, { seulementQuestions = false, typeQuestions = null } = {}) {
  const { modele, visite } = etat;
  const domainesPresents = new Set(modele.exposants.flatMap((e) => e.domaines).concat(modele.evenements.flatMap((e) => e.domaines)).filter(Boolean));
  const s = suggestions(visite, modele);
  const types = typesPresents(modele);
  const tout = etat.ui.suggestionsOuvertes;
  const questions = questionsPour(visite, modele, typeQuestions, { selonMaVisite: !seulementQuestions });
  const groupes = types.filter((t) => questions.some((q) => q.typeExposant === t));
  const article = (t) => (t === 'École' || t === 'Entreprise' ? 'une' : 'un');
  const blocQuestions = `${groupes.map((t) => `<h2 class="titre-section">Questions à poser à ${article(t)} ${h(t.toLowerCase())}</h2>
    <div class="carte">${questions.filter((q) => q.typeExposant === t).map((q) => `<div class="question${q.cochee ? ' cochee' : ''}">
      <input type="checkbox" id="q-${attr(q.cle)}" data-action="question" data-cle="${attr(q.cle)}" ${q.cochee ? 'checked' : ''}>
      <label for="q-${attr(q.cle)}">${h(q.question)}</label></div>`).join('')}</div>`).join('')}
    ${!groupes.length ? '<p class="vide">Les questions types arrivent bientôt.</p>' : ''}
    <p class="maj">Cochez les questions posées : vos coches restent dans le téléphone.</p>`;
  if (seulementQuestions) {
    return `${entete('Mes questions', typeQuestions ? `Pour ${article(typeQuestions)} ${h(typeQuestions.toLowerCase())}` : 'À avoir sous les yeux devant le stand', { href: '#/visite', libelle: 'Ma visite' })}
      ${typeQuestions ? '<div class="boutons"><a class="bouton secondaire" href="#/questions">Toutes les questions</a></div>' : ''}${blocQuestions}`;
  }

  const etape = Math.min(Math.max(Number(etat.ui.etapePreparer) || 0, 0), ETAPES_PREPARER.length - 1);
  const fil = `<ol class="etapes" aria-label="Étapes de la préparation">
    ${ETAPES_PREPARER.map((nom, i) => `<li${i === etape ? ' aria-current="step"' : ''}><button type="button" data-action="etape" data-valeur="${i}"><span class="num">${i + 1}</span>${h(nom)}</button></li>`).join('')}
  </ol>`;
  const boutons = (precedent, suivant) => `<div class="boutons nav-etapes">
    ${precedent ? `<button class="bouton secondaire" type="button" data-action="etape" data-valeur="${etape - 1}">${icone('retour', 18)}${h(ETAPES_PREPARER[etape - 1])}</button>` : ''}
    ${suivant ? `<button class="bouton" type="button" data-action="etape" data-valeur="${etape + 1}">${h(ETAPES_PREPARER[etape + 1])}${icone('chevron', 18)}</button>` : ''}
  </div>`;

  // Douze au TOTAL, pas douze par groupe : plafonner chaque type laissait
  // quarante-quatre lignes à l'écran, ce qui n'est plus une sélection.
  // Les événements passent d'abord : ils imposent une heure, donc une décision.
  const evAffiches = tout ? s.evenements : s.evenements.slice(0, MAX_SUGGESTIONS);
  const exAffiches = tout ? s.exposants : s.exposants.slice(0, Math.max(0, MAX_SUGGESTIONS - evAffiches.length));
  const trop = s.exposants.length + s.evenements.length > MAX_SUGGESTIONS;

  const corps = [
    // 1. Me situer
    `<h2 class="titre-section">Je suis</h2>
    <div class="choix" role="group" aria-label="Niveau">${NIVEAUX.map((n) => `<button class="filtre" type="button" data-action="niveau" data-valeur="${attr(n)}" aria-pressed="${visite.niveau === n}">${h(n)}</button>`).join('')}</div>
    <h2 class="titre-section">Ce qui m'intéresse</h2>
    <div class="choix" role="group" aria-label="Centres d'intérêt">${ordonner(domainesPresents, DOMAINES).map((x) => `<button class="filtre" type="button" data-action="interet" data-valeur="${attr(x)}" aria-pressed="${visite.interets.includes(x)}">${h(x)}</button>`).join('')}</div>`,
    // 2. Ma sélection
    `${s.exposants.length || s.evenements.length ? `<p class="sous-etape">${s.exposants.length} exposant${s.exposants.length > 1 ? 's' : ''} et ${s.evenements.length} événement${s.evenements.length > 1 ? 's' : ''} correspondent à ce que vous avez dit.</p>
    ${evAffiches.length ? `<h2 class="titre-section">Événements</h2><ul class="liste carte">${evAffiches.map((e) => ligneEvenement(etat, e, { de: 'preparer' })).join('')}</ul>` : ''}
    ${types.map((t) => { const l = exAffiches.filter((e) => e.type === t); return l.length ? `<h2 class="titre-section">${h(PLURIEL_TYPE[t])}</h2><ul class="liste carte">${l.map((e) => ligneExposant(etat, e, { de: 'preparer' })).join('')}</ul>` : ''; }).join('')}
    ${trop ? `<div class="boutons"><button class="bouton secondaire large" type="button" data-action="suggestions" aria-expanded="${Boolean(tout)}">${tout ? 'Revenir à une sélection courte' : 'Tout voir'}</button></div>` : ''}`
      : '<p class="vide">Rien ne correspond encore. Revenez à l\'étape précédente et élargissez vos centres d\'intérêt.</p>'}`,
    // 3. Mes questions
    `${blocQuestions}
    <div class="boutons"><a class="bouton secondaire large" href="#/questions">Toutes les questions</a></div>`,
    // 4. Ma visite
    `<p class="sous-etape">Votre carnet est prêt. Le jour du festival, gardez-le ouvert : il vous dit quoi faire et quand.</p>
    <div class="boutons"><a class="bouton large" href="#/visite">${icone('visite', 19)}Ouvrir ma visite</a></div>
    <div class="boutons"><a class="bouton secondaire large" href="#/plan">${icone('plan', 19)}Voir le plan</a><a class="bouton secondaire large" href="#/aide">${icone('info', 19)}Besoin d'aide ?</a></div>`,
  ][etape];

  return `${entete('Préparer ma visite', `Étape ${etape + 1} sur ${ETAPES_PREPARER.length} · ${ETAPES_PREPARER[etape]}`)}
  ${fil}
  ${corps}
  ${boutons(etape > 0, etape < ETAPES_PREPARER.length - 1)}`;
}

// ---------------------------------------------------------------- besoin d'aide ?

export function ecranAide(etat) {
  const i = etat.modele.infos;
  const salleAccueil = salleParNom(etat.modele, 'Accueil');
  const salleWc = salleParNom(etat.modele, 'Toilettes');
  const salleFood = salleParNom(etat.modele, 'Foodtruck');
  const bloc = (ico, titre, texte) => `<div class="aide-bloc">${icone(ico, 21)}<div><h3>${h(titre)}</h3><p>${texte}</p></div></div>`;
  // Une question qui mène quelque part est une ligne entièrement touchable.
  const blocLien = (ico, titre, texte, lien) => `<a class="aide-bloc" href="${attr(lien)}">${icone(ico, 21)}<div><h3>${h(titre)}</h3><p>${h(texte)}</p></div>${icone('chevron', 18)}</a>`;
  const adresse = [i.lieu, i.adresse].filter(Boolean).join(', ');
  const itineraire = adresse ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(adresse)}` : '';
  const horaires = [dateLongue(i.date), i.heure_debut && i.heure_fin ? `${heureTexte(i.heure_debut)} à ${heureTexte(i.heure_fin)}` : ''].filter(Boolean).join(', ');
  const contact = [
    i.contact_email ? `<a href="mailto:${attr(i.contact_email)}">${h(i.contact_email)}</a>` : '',
    i.contact_tel ? `<a href="tel:${attr(i.contact_tel.replace(/\s/g, ''))}">${h(i.contact_tel)}</a>` : '',
  ].filter(Boolean).join(' · ');
  return `${entete("Besoin d'aide ?", h(i.lieu || ''))}
  <section class="carte">
    ${blocLien('info', "Où est l'accueil ?", salleAccueil ? phraseGuidage(salleAccueil) : (i.entree || "À l'entrée du lycée"), '#/plan?salle=Accueil')}
    ${blocLien('toilettes', 'Où sont les toilettes ?', salleWc ? phraseGuidage(salleWc) : "Près de l'accueil", '#/plan?salle=Toilettes')}
    ${blocLien('cafe', 'Où prendre un café ?', i.restauration || (salleFood ? phraseGuidage(salleFood) : 'Foodtruck'), salleFood ? '#/plan?salle=Foodtruck' : '#/plan')}
    ${blocLien('recherche', 'Comment retrouver une salle ?', "Tapez son numéro ou le nom de l'école dans le plan : la salle s'allume en orange.", '#/plan')}
    ${bloc('telephone', 'Qui contacter ?', contact || "L'équipe APEL à l'accueil, village 1")}
  </section>
  <h2 class="titre-section">Infos pratiques</h2>
  <section class="carte">
    ${horaires ? bloc('programme', 'Horaires', `${h(horaires)}, entrée libre`) : ''}
    ${adresse ? bloc('lieu', 'Adresse', h(adresse)) : ''}
    ${i.entree ? bloc('porte', 'Entrée', h(i.entree)) : ''}
    ${i.rer ? bloc('train', 'RER', h(i.rer)) : ''}
    ${i.bus ? bloc('bus', 'Bus', h(i.bus)) : ''}
    ${i.parking ? bloc('parking', 'Parking', h(i.parking)) : ''}
    ${i.restauration ? bloc('cafe', 'Restauration', h(i.restauration)) : ''}
    ${i.wifi ? bloc('wifi', 'Wifi', h(i.wifi)) : ''}
  </section>
  ${itineraire ? `<div class="boutons"><a class="bouton large" href="${attr(itineraire)}" target="_blank" rel="noopener">${icone('itineraire', 19)}Ouvrir l'itinéraire</a></div>` : ''}
  <h2 class="titre-section">Et aussi</h2>
  <section class="carte">
    ${i.reglement_url ? blocLien('document', 'Règlement du festival', 'Lire le règlement', url(i.reglement_url)) : ''}
    ${i.avis_url ? `<a class="aide-bloc" href="${url(i.avis_url)}" target="_blank" rel="noopener" data-action="avis">${icone('avis', 21)}<div><h3>Donner mon avis</h3><p>Deux minutes, pour nous aider à faire mieux l'an prochain.</p></div>${icone('chevron', 18)}</a>`
      : bloc('avis', 'Donner mon avis', 'Le questionnaire de satisfaction sera disponible le jour du festival.')}
    ${bloc('prive', 'Vie privée', h(i.vie_privee || "L'application ne collecte aucune donnée personnelle."))}
  </section>`;
}

// ---------------------------------------------------------------- navigation

export function navigation(etat) {
  const nb = compte(etat.visite);
  const alertes = alertesNonVues(etat.visite).length;
  const nom = etat.route.nom;
  const actif = {
    accueil: nom === 'accueil', plan: nom === 'plan', exposants: nom === 'exposants' || nom === 'exposant',
    programme: nom === 'programme' || nom === 'evenement', visite: ['visite', 'preparer', 'questions'].includes(nom),
  };
  const badge = nb ? `<span class="badge${alertes ? ' alerte' : ''}" aria-label="${nb} élément${nb > 1 ? 's' : ''}${alertes ? `, ${alertes} changement${alertes > 1 ? 's' : ''}` : ''}">${alertes ? '!' : nb}</span>` : '';
  const item = (cle, href, ico, lib, extra = '') =>
    `<li><a href="${href}" ${actif[cle] ? 'aria-current="page"' : ''}>${icone(ico, 23)}${lib}${extra}</a></li>`;
  return `<ul>${item('accueil', '#/', 'accueil', 'Accueil')}${item('plan', '#/plan', 'plan', 'Plan')}${item('exposants', '#/exposants', 'exposants', 'Exposants')}${item('programme', '#/programme', 'programme', 'Programme')}${item('visite', '#/visite', 'visite', 'Ma visite', badge)}</ul>`;
}

// La date de dernière mise à jour, discrètement. Un échec de lecture en direct
// n'est pas montré au Visiteur : il n'y peut rien, et l'appli affiche de toute
// façon les dernières données connues. Il reste visible avec « ?debug » dans
// l'URL, pour les Organisateurs et le dépannage.
// La ligne de version. Elle répond, depuis l'appareil et sans outil, à « est-ce que
// ce téléphone a bien la dernière version ? ». `versionAppli` est celle du code
// chargé ; `versionSW` celle que le service worker sert. Un écart entre les deux,
// c'est un cache périmé : on le montre au lieu de le taire.
// À ne pas confondre avec `etat.version`, qui est l'empreinte des DONNÉES.
function ligneVersion(etat) {
  const { versionAppli, versionSW } = etat;
  if (!versionAppli) return '';
  const perime = versionSW && versionSW !== versionAppli;
  return `<p class="version">${perime
    ? `<span class="erreur">version ${h(versionAppli)} · cache périmé ${h(versionSW)}</span>`
    : `version ${h(versionAppli)}`}</p>`;
}

export function piedDePage(etat) {
  const { derniereMaj, source, reseau, debug } = etat;
  const version = ligneVersion(etat);
  if (!derniereMaj) return version;
  const d = new Date(derniereMaj);
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const jour = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const lib = { script: 'tableur', gviz: 'classeur public', snapshot: 'version embarquée', cache: 'dernière version connue' }[source] || source;
  const panne = debug && reseau && reseau.enErreur ? ' · <span class="erreur">lecture en direct en échec, nouvel essai bientôt</span>' : '';
  // Un refus de complétude se lit avec « ?debug », comme la panne : le Visiteur voit des
  // données complètes et n'a rien à faire, l'Organisateur a besoin de savoir pourquoi
  // l'heure de mise à jour ne bouge plus.
  const refuse = debug && reseau && reseau.refus
    ? ` · <span class="erreur">source ${h(reseau.refus.source)} refusée (${h(reseau.refus.motif)})</span>`
    : '';
  return `<p class="maj">Mis à jour le ${h(jour)} à ${h(heure)} (${h(lib)})${panne}${refuse}</p>${version}`;
}

// ---------------------------------------------------------------- aiguillage

export function ecran(etat) {
  const { route } = etat;
  switch (route.nom) {
    case 'accueil': return ecranAccueil(etat);
    case 'programme': return ecranProgramme(etat);
    case 'evenement': return ecranEvenement(etat, route.params.cle);
    case 'exposants': return ecranExposants(etat);
    case 'exposant': return ecranExposant(etat, route.params.cle, { qr: route.params.qr === '1' });
    case 'plan': return ecranPlan(etat);
    case 'visite': return ecranVisite(etat);
    case 'preparer': return ecranPreparer(etat);
    case 'questions': return ecranPreparer(etat, { seulementQuestions: true, typeQuestions: route.params.type || null });
    case 'aide': return ecranAide(etat);
    default: return `${entete('Page introuvable')}<p class="vide">Cette page n'existe pas.</p><div class="boutons"><a class="bouton" href="#/">Retour à l'accueil</a></div>`;
  }
}

export function titreDocument(etat) {
  const nomFestival = etat.modele.infos.nom || "Festival de l'Orientation";
  const t = { accueil: '', programme: 'Le programme', exposants: 'Les exposants', plan: 'Plan', visite: 'Ma visite', preparer: 'Préparer ma visite', questions: 'Mes questions', aide: "Besoin d'aide ?" }[etat.route.nom];
  if (etat.route.nom === 'evenement') { const e = etat.modele.evenements.find((x) => x.cle === etat.route.params.cle); return `${e ? e.titre : 'Événement'} · ${nomFestival}`; }
  if (etat.route.nom === 'exposant') { const e = etat.modele.exposants.find((x) => x.cle === etat.route.params.cle); return `${e ? e.nom : 'Exposant'} · ${nomFestival}`; }
  return t ? `${t} · ${nomFestival}` : nomFestival;
}
