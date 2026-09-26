// Logique du plan : le bâtiment relevé (batiment.js) joint aux Salles du tableur,
// la projection axonométrique, la caméra (tourner, incliner, cadrer), l'ordre de
// dessin, la recherche depuis le plan, la phrase de guidage, le contenu d'une
// Salle ou d'un Village. Pure : aucune mesure d'écran ici, l'adaptateur passe la
// taille de la scène et applique les coordonnées au SVG (ADR-0013).
import { normaliser, contient, cleDePorte, ETAGES, ETAGE_PAR_DEFAUT } from './donnees.js';
import { BATIMENT, CENTRE } from './batiment.js';
import { t, tt } from './i18n.js';

// ---------------------------------------------------------------- constantes

export const H_DALLE = 2.6;   // épaisseur d'un plancher
export const H_MUR = 3.4;     // hauteur des cloisons
const DEG = Math.PI / 180;
// Inclinaison de la caméra : 90° = vue de dessus. En vue d'ensemble on s'arrête
// juste avant la verticale, où la profondeur cesserait d'être visible.
export const INCLINAISON = { min: 12 * DEG, max: 88 * DEG, defaut: 30 * DEG, plat: 90 * DEG };
export const ORIENTATION_DEFAUT = 3.45; // radians : le parvis en haut, l'aile ouest à gauche
export const ZOOM = { min: 0.6, max: 6 };
// Écart entre deux dalles À L'ÉCRAN, en unités du plan : constant tant que la
// caméra est peu inclinée, puis grandit jusqu'à la profondeur du bâtiment quand
// on redresse, pour que la vue de dessus ne superpose jamais les étages.
const ECART = { bas: 36, angleBas: 40 * DEG, angleHaut: 88 * DEG, marge: 10 };

// Hauteur d'une Pièce selon sa nature ; 'v', 'r', 's' sont au sol.
const HAUTEUR = { a: 2.2, p: 1.6, g: 3.4, v: 0, r: 0, s: 0 };
const ESTIME_PLAT = (k) => HAUTEUR[k] === 0;

// ---------------------------------------------------------------- jointure tableur ↔ relevé

// La clé de porte (« Salle 110 » = « 110 ») vit dans donnees.js depuis le ticket
// appsheet 02 : la même règle rapproche la salle d'un exposant de l'onglet Salles.
export { cleDePorte };

// La scène : les Étages du relevé, chaque Pièce jointe à la Salle du tableur qui
// porte son nom, les Salles que le relevé ne connaît pas mises à part.
export function construireScene(modele, batiment = BATIMENT) {
  const sallesParPorte = new Map();
  for (const s of modele.salles) sallesParPorte.set(cleDePorte(s.nom), s);
  const vues = new Set();
  const etages = batiment.map((niv, index) => {
    const pieces = niv.pieces.map((p, i) => {
      const cle = cleDePorte(p.nom);
      const salle = sallesParPorte.get(cle) || null;
      if (salle) vues.add(salle.cle);
      const H = ESTIME_PLAT(p.k) ? 0 : (HAUTEUR[p.k] ?? H_MUR) * (p.h || 1);
      const cx = p.poly.reduce((a, q) => a + q[0], 0) / p.poly.length;
      const cy = p.poly.reduce((a, q) => a + q[1], 0) / p.poly.length;
      return { i, nom: p.nom, court: p.court || p.nom, k: salle ? '' : (p.k || 'n'), poly: p.poly, H, plat: H === 0, centre: [cx, cy], salle, zone: salle ? salle.zone : null, etage: niv.etage };
    });
    return { index, etage: niv.etage, contour: niv.contour, trous: niv.trous || [], sol: niv.sol || null, pieces };
  });
  const aLocaliser = modele.salles.filter((s) => !vues.has(s.cle));
  const parSalle = new Map();
  for (const e of etages) for (const p of e.pieces) if (p.salle) parSalle.set(p.salle.cle, { etage: e, piece: p });
  return { etages, parSalle, aLocaliser };
}

// Les étages du plan : ceux du relevé, dans l'ordre du bâtiment.
export function etagesPresents(scene) {
  return scene && scene.etages.length ? scene.etages.map((e) => e.etage) : ETAGES.slice(0, 1);
}

// Le plan d'un étage : ses Pièces, et les Villages qui y ont au moins une Salle.
export function planDeLEtage(scene, modele, etage) {
  const e = scene.etages.find((x) => x.etage === etage);
  if (!e) return { salles: [], zones: [], etage: null };
  const salles = e.pieces.filter((p) => p.salle).map((p) => p.salle);
  const zones = modele.zones.filter((z) => salles.some((s) => s.zone === z));
  return { salles, zones, etage: e };
}

// L'étage à ouvrir pour une Salle : celui où le relevé la dessine, sinon celui
// que le tableur déclare, sinon rien (la Salle est à localiser).
export function etageDeSalle(scene, salle) {
  if (!salle) return null;
  const j = scene.parSalle.get(salle.cle);
  if (j) return j.etage.etage;
  return etagesPresents(scene).includes(salle.etage) ? salle.etage : null;
}

// ---------------------------------------------------------------- projection

// La caméra : yaw (tourner autour du bâtiment), pitch (incliner), scale, panX,
// panY (en pixels de scène). Un point du plan (x, y) à l'altitude z devient un
// point d'écran.
export function projeter(x, y, z, cam) {
  const dx = x - CENTRE[0], dy = y - CENTRE[1];
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const X = dx * cy - dy * sy, Y = dx * sy + dy * cy;
  return [X * cam.scale + cam.panX, (Y * Math.sin(cam.pitch) - z * Math.cos(cam.pitch)) * cam.scale + cam.panY];
}

// Profondeur : petit = loin de la caméra. Sert à dessiner du fond vers l'avant.
export function profondeur(x, y, cam) {
  return (x - CENTRE[0]) * Math.sin(cam.yaw) + (y - CENTRE[1]) * Math.cos(cam.yaw);
}

// L'emprise du bâtiment dans la direction de la profondeur, pour savoir de
// combien écarter les dalles quand on redresse la caméra.
function profondeurBatiment(scene, yaw) {
  let a = Infinity, b = -Infinity;
  const c = { yaw };
  for (const e of scene.etages) for (const s of e.contour) { const d = profondeur(s[0], s[1], c); a = Math.min(a, d); b = Math.max(b, d); }
  return Number.isFinite(b - a) ? b - a : 0;
}

// L'écart entre deux dalles À L'ÉCRAN pour cette inclinaison, puis l'altitude de
// chaque étage qui le réalise : z = écart / cos(pitch). À la verticale, cos → 0,
// on borne pour rester fini ; l'étage qui n'est pas ouvert est de toute façon
// effacé à ce moment-là.
export function ecartDalles(pitch, profondeurBat) {
  if (pitch <= ECART.angleBas) return ECART.bas;
  const u = Math.min(1, (pitch - ECART.angleBas) / (ECART.angleHaut - ECART.angleBas));
  const lisse = u * u * (3 - 2 * u);
  return ECART.bas + (Math.max(ECART.bas, profondeurBat * Math.sin(pitch) + ECART.marge) - ECART.bas) * lisse;
}
export function altitudes(scene, cam) {
  const ecran = ecartDalles(cam.pitch, profondeurBatiment(scene, cam.yaw));
  const z = ecran / Math.max(Math.cos(cam.pitch), 0.02);
  return scene.etages.map((e) => e.index * z);
}

// Le cadre qu'occuperaient ces étages à l'échelle 1, sans décalage.
export function cadre(scene, etages, cam, zs) {
  const c = { yaw: cam.yaw, pitch: cam.pitch, scale: 1, panX: 0, panY: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of etages) for (const s of e.contour) for (const dz of [0, -H_DALLE, H_MUR]) {
    const [a, b] = projeter(s[0], s[1], zs[e.index] + dz, c);
    x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b);
  }
  return { x0, y0, l: x1 - x0, h: y1 - y0 };
}

// La caméra qui cadre la vue demandée dans une scène de largeur × hauteur pixels :
// « axo » = tous les étages empilés, sinon un étage seul vu de dessus. Le `reserve`
// est la place laissée en bas (la feuille) ou à droite (le panneau large).
export function cameraPour(scene, vue, { largeur, hauteur, yaw = ORIENTATION_DEFAUT, pitch = INCLINAISON.defaut, reserve = { bas: 0, droite: 0, gauche: 0 } } = {}) {
  const axo = vue === 'axo';
  const cam = { yaw: axo ? yaw : 0, pitch: axo ? pitch : INCLINAISON.plat, scale: 1, panX: 0, panY: 0 };
  const zs = altitudes(scene, cam);
  const etages = axo ? scene.etages : scene.etages.filter((e) => e.etage === vue);
  if (!etages.length) return cam;
  const b = cadre(scene, etages, cam, zs);
  const L = Math.max(80, largeur - (reserve.droite || 0) - (reserve.gauche || 0)), Hh = Math.max(80, hauteur - (reserve.bas || 0));
  const marge = 0.86;
  cam.scale = Math.min(L * marge / b.l, Hh * marge / b.h);
  cam.panX = (reserve.gauche || 0) + L / 2 - (b.x0 + b.l / 2) * cam.scale;
  cam.panY = Hh / 2 - (b.y0 + b.h / 2) * cam.scale;
  return cam;
}

// La même caméra, resserrée sur une Salle : assez pour qu'elle soit franche,
// assez large pour que ses voisines restent reconnaissables.
export function cadrerSur(cam, scene, piece, { largeur, hauteur, reserve = { bas: 0, droite: 0, gauche: 0 }, facteur = 1.8 } = {}) {
  const zs = altitudes(scene, cam);
  const z = zs[scene.etages.findIndex((e) => e.etage === piece.etage)] || 0;
  const [px, py] = projeter(piece.centre[0], piece.centre[1], z + piece.H, { ...cam, scale: 1, panX: 0, panY: 0 });
  const scale = Math.min(ZOOM.max * cam.scale, cam.scale * facteur);
  const L = largeur - (reserve.droite || 0) - (reserve.gauche || 0), Hh = hauteur - (reserve.bas || 0);
  return { ...cam, scale, panX: (reserve.gauche || 0) + L / 2 - px * scale, panY: Hh / 2 - py * scale };
}

// Zoomer d'un facteur autour d'un point d'écran, entre ZOOM.min et ZOOM.max fois
// l'échelle de référence (celle qui cadre la vue entière).
export function zoomer(cam, ratio, px, py, reference = cam.scale) {
  const k2 = Math.min(ZOOM.max * reference, Math.max(ZOOM.min * reference, cam.scale * ratio));
  const reel = k2 / cam.scale;
  return { ...cam, scale: k2, panX: px - (px - cam.panX) * reel, panY: py - (py - cam.panY) * reel };
}

// ---------------------------------------------------------------- dessin

// Une Pièce extrudée : sa face haute, et ses faces latérales tournées vers la
// caméra, du fond vers l'avant, chacune avec son ombre (0..1, 1 = pleine lumière).
export function facesVisibles(poly, z0, H, cam) {
  const haut = poly.map(([x, y]) => projeter(x, y, z0 + H, cam));
  if (H <= 0) return { haut, cotes: [] };
  const bas = poly.map(([x, y]) => projeter(x, y, z0, cam));
  const cotes = [];
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const nx = poly[j][1] - poly[i][1], ny = -(poly[j][0] - poly[i][0]);
    const vers = nx * Math.sin(cam.yaw) + ny * Math.cos(cam.yaw);
    if (vers <= 0) continue; // face tournée vers l'arrière
    const d = (profondeur(poly[i][0], poly[i][1], cam) + profondeur(poly[j][0], poly[j][1], cam)) / 2;
    const ombre = 0.62 + 0.3 * Math.abs(nx * Math.cos(cam.yaw) - ny * Math.sin(cam.yaw)) / Math.hypot(nx, ny);
    cotes.push({ d, points: [haut[i], haut[j], bas[j], bas[i]], ombre: Math.round(ombre * 100) / 100 });
  }
  cotes.sort((u, v) => u.d - v.d);
  return { haut, cotes };
}

// L'ordre de dessin des Pièces d'un étage : ce qui est au sol d'abord, puis les
// volumes du fond vers l'avant.
export function ordreDeDessin(pieces, cam) {
  return pieces.map((p) => ({ i: p.i, d: (p.plat ? -1e4 : 0) + profondeur(p.centre[0], p.centre[1], cam) }))
    .sort((u, v) => u.d - v.d).map((o) => o.i);
}

// Les tranches d'une dalle (son épaisseur), du fond vers l'avant.
export function tranches(contour, zHaut, cam) {
  const zBas = zHaut - H_DALLE;
  const quads = [];
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i], b = contour[(i + 1) % contour.length];
    quads.push({ d: (profondeur(a[0], a[1], cam) + profondeur(b[0], b[1], cam)) / 2, points: [projeter(a[0], a[1], zHaut, cam), projeter(b[0], b[1], zHaut, cam), projeter(b[0], b[1], zBas, cam), projeter(a[0], a[1], zBas, cam)] });
  }
  return quads.sort((u, v) => u.d - v.d);
}

// Un nom tient sur une ligne, sur deux, ou pas du tout : une pièce trop petite
// reste muette plutôt que de laisser déborder son nom sur sa voisine.
export function etiquette(nom, largeurPx, hauteurPx, { petit = false } = {}) {
  const taille = Math.max(petit ? 7.5 : 8, Math.min(13.5, largeurPx / 4.4));
  const place = Math.floor((largeurPx - 6) / (taille * 0.505));
  if (place >= nom.length) return { lignes: [nom], taille };
  const mots = String(nom).split(' ');
  if (hauteurPx > taille * 2.3 && mots.length > 1) {
    let meilleur = null;
    for (let i = 1; i < mots.length; i++) {
      const a = mots.slice(0, i).join(' '), b = mots.slice(i).join(' ');
      const m = Math.max(a.length, b.length);
      if (!meilleur || m < meilleur.m) meilleur = { a, b, m };
    }
    if (meilleur && meilleur.m <= place) return { lignes: [meilleur.a, meilleur.b], taille };
  }
  return null;
}

// ---------------------------------------------------------------- contenu

// Ce qui se trouve dans une Zone : ses Salles, ses Exposants, ses Événements.
export function contenuZone(modele, zone) {
  const salles = new Set(zone.salles.map((s) => s.cle));
  return {
    salles: zone.salles,
    exposants: modele.exposants.filter((e) => salles.has(normaliser(e.salle))),
    evenements: modele.evenements.filter((e) => salles.has(normaliser(e.salle))),
  };
}

// Ce qui se trouve dans une Salle précise : c'est ce qu'on veut voir quand on
// touche une salle sur le plan, et non le contenu de toute sa Zone.
export function contenuSalle(modele, salle) {
  const dedans = (o) => normaliser(o.salle) === salle.cle;
  return {
    exposants: modele.exposants.filter(dedans).sort((a, b) => String(a.stand).localeCompare(String(b.stand), 'fr', { numeric: true }) || a.nom.localeCompare(b.nom, 'fr')),
    evenements: modele.evenements.filter(dedans),
  };
}

export function salleParNom(modele, nom) {
  const n = normaliser(nom);
  return modele.salles.find((s) => s.cle === n) || modele.salles.find((s) => cleDePorte(s.nom) === cleDePorte(nom)) || null;
}

// La phrase pour s'y rendre : Village, étage, puis notes de la Salle. L'étage
// vient en deuxième parce que c'est la première décision du visiteur qui marche.
// Traduite au rendu : le mot « Village », le nom du village et l'étage viennent
// des dictionnaires statiques, les notes de la Salle de la traduction du tableur.
export function phraseGuidage(salle, nomSalle = '') {
  if (!salle) return nomSalle ? `${nomSalle} : ${t('salle à localiser')}, ${t("demandez à l'accueil")}` : `${t('salle à venir').charAt(0).toUpperCase()}${t('salle à venir').slice(1)} : ${t("demandez à l'accueil")}`;
  const morceaux = [];
  if (salle.zone) morceaux.push(`${t('Village')} ${salle.zone.numero ?? ''} ${t(salle.zone.nom)}`.replace(/\s+/g, ' ').trim());
  if (salle.etage && (salle.zone || salle.notes)) morceaux.push(t(salle.etage).toLowerCase());
  if (salle.notes) morceaux.push(tt(salle.notes));
  // Ni village ni note : l'étage seul ne suffit pas à trouver, on renvoie à l'accueil.
  if (!morceaux.length) return `${salle.nom} : ${salle.etage ? `${t(salle.etage).toLowerCase()}, ` : ''}${t("demandez à l'accueil")}`;
  return morceaux.join(', ');
}

// Recherche depuis le plan : une Salle, sinon un Exposant, sinon un Événement.
// Renvoie la meilleure correspondance avec la Salle à allumer.
export function rechercherSurPlan(modele, requete) {
  const q = normaliser(requete);
  if (!q) return null;
  const qp = cleDePorte(requete);
  const salle = modele.salles.find((s) => s.cle === q || cleDePorte(s.nom) === qp) || modele.salles.find((s) => s.typePoint !== 'Salle' && (normaliser(s.typePoint) === q || normaliser(t(s.typePoint)) === q)) || modele.salles.find((s) => s.cle.includes(q)) || modele.salles.find((s) => contient(s.notes, requete) || contient(tt(s.notes), requete));
  if (salle && !(modele.exposants.some((e) => normaliser(e.nom) === q))) return { genre: 'salle', salle, nomSalle: salle.nom, phrase: phraseGuidage(salle), libelle: salle.nom };
  const exposant = modele.exposants.find((e) => normaliser(e.nom) === q) || modele.exposants.find((e) => contient(e.nom, requete)) || modele.exposants.find((e) => contient(e.sousTitre, requete) || contient(tt(e.sousTitre), requete) || contient(e.ville, requete));
  if (exposant) {
    const s = salleParNom(modele, exposant.salle);
    return { genre: 'exposant', exposant, salle: s, nomSalle: exposant.salle, phrase: phraseGuidage(s, exposant.salle), libelle: exposant.nom };
  }
  const evenement = modele.evenements.find((e) => contient(e.titre, requete) || contient(tt(e.titre), requete) || contient(e.intervenantsTexte, requete));
  if (evenement) {
    const s = salleParNom(modele, evenement.salle);
    return { genre: 'evenement', evenement, salle: s, nomSalle: evenement.salle, phrase: phraseGuidage(s, evenement.salle), libelle: evenement.titre };
  }
  if (salle) return { genre: 'salle', salle, nomSalle: salle.nom, phrase: phraseGuidage(salle), libelle: salle.nom };
  return null;
}

// Les Salles de Ma visite (clés normalisées), pour les marquer sur le plan.
export function sallesDeVisite(etatVisite, modele) {
  const parCle = new Map([...modele.exposants, ...modele.evenements].map((o) => [o.cle, o]));
  const salles = new Set();
  for (const e of etatVisite.entrees) {
    const o = parCle.get(e.cle);
    const nom = o ? o.salle : e.salle;
    if (nom) salles.add(normaliser(nom));
  }
  return salles;
}

export { ETAGE_PAR_DEFAUT };
