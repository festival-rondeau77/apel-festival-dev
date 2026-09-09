// Logique du plan : disposition des Villages et des Salles (coordonnées 0 à 100),
// étage par étage, recherche depuis le plan, phrase de guidage, contenu d'une
// Zone. Pure.
import { normaliser, contient, ETAGES, ETAGE_PAR_DEFAUT } from './donnees.js';
import { t, tt } from './i18n.js';

// Tant que l'établissement ne nous a pas donné ses plans du rez-de-chaussée et
// du premier étage, la disposition est une grille : deux colonnes de villages,
// et une bande basse pour les deux fonctions (Accueil, Conférences). C'est faux
// géométriquement et juste topologiquement — on ne prétend pas placer un couloir
// qu'on n'a pas vu. Quand les plans arriveront, seules ces constantes bougent.
const GRILLE = { colonnes: 2, marge: 4, ecart: 4, hauteur: 26, bande: 15 };

// Les Villages d'un étage reçoivent chacun un rectangle ; l'Accueil et les
// Conférences sont rangés en bande basse, du côté de l'entrée.
export function disposerZones(zones) {
  const { marge, ecart, colonnes, hauteur, bande } = GRILLE;
  const villages = zones.filter((z) => !z.fonction);
  const fonctions = zones.filter((z) => z.fonction);
  const w = (100 - 2 * marge - (colonnes - 1) * ecart) / colonnes;
  const rects = villages.map((z, i) => ({
    zone: z,
    x: marge + (i % colonnes) * (w + ecart),
    y: marge + Math.floor(i / colonnes) * (hauteur + ecart),
    w, h: hauteur,
  }));
  if (!fonctions.length) return rects;
  const y = marge + Math.ceil(villages.length / colonnes) * (hauteur + ecart);
  const wf = (100 - 2 * marge - (fonctions.length - 1) * ecart) / fonctions.length;
  fonctions.forEach((z, i) => rects.push({ zone: z, x: marge + i * (wf + ecart), y, w: wf, h: bande }));
  return rects;
}

// Les étages où quelque chose se passe, dans l'ordre du bâtiment. Un étage sans
// une seule salle n'a pas d'onglet : on ne fait pas cliquer sur du vide.
export function etagesPresents(modele) {
  const presents = ETAGES.filter((e) => modele.salles.some((s) => s.etage === e));
  return presents.length ? presents : [ETAGE_PAR_DEFAUT];
}

// Le plan d'un étage : ses salles, et les villages qui en ont au moins une.
export function planDeLEtage(modele, etage) {
  const salles = modele.salles.filter((s) => s.etage === etage);
  const zones = modele.zones.filter((z) => z.salles.some((s) => s.etage === etage));
  return { salles, zones };
}

// Les Salles avec X, Y sont posées telles quelles ; les autres sont réparties dans
// le rectangle de leur Zone (position estimée, signalée), pour que chaque Salle
// existe sur le plan même sans plan intérieur.
export function placerSalles(salles, rects) {
  const parZone = new Map(rects.map((r) => [r.zone, r]));
  const compteur = new Map();
  const total = new Map();
  for (const s of salles) if (s.x === null || s.y === null) total.set(s.zone, (total.get(s.zone) || 0) + 1);
  return salles.map((s) => {
    if (s.x !== null && s.y !== null) return { salle: s, x: s.x, y: s.y, estimee: false };
    const r = s.zone ? parZone.get(s.zone) : null;
    if (!r) return { salle: s, x: null, y: null, estimee: true };
    const n = total.get(s.zone), i = compteur.get(s.zone) || 0;
    compteur.set(s.zone, i + 1);
    const colonnes = Math.max(1, Math.ceil(Math.sqrt(n)));
    const lignes = Math.ceil(n / colonnes);
    const col = i % colonnes, ligne = Math.floor(i / colonnes);
    const x = r.x + ((col + 0.5) / colonnes) * r.w;
    // 9 et non 6,5 : le nom d'un village tient sur deux lignes (« Commerce,
    // Marketing & Management »), et les salles passaient dessous.
    const y = r.y + 9 + ((ligne + 0.5) / lignes) * (r.h - 10);
    return { salle: s, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, estimee: true };
  });
}

// Le cadrage d'une Salle : assez serré pour qu'elle soit franche, assez large pour
// que son Village reste reconnaissable autour d'elle. C'était jusqu'ici un
// agrandissement CONSTANT de 2,2× calculé dans l'adaptateur navigateur, qui sortait
// les bords du village du cadre et privait le Visiteur de son seul repère.
// Géométrie pure : le module Plan connaît la disposition, l'adaptateur applique.
const CADRAGE = { villagesVisibles: 1.35, kMin: 1.3, kMax: 2.4, poidsSalle: 2 };

export function cadrageSalle(rects, placements, cleSalle) {
  const p = placements.find((q) => q.salle.cle === cleSalle && q.x !== null);
  if (!p) return null;
  const r = rects.find((x) => x.zone === p.salle.zone);
  if (!r) return { x: p.x, y: p.y, k: CADRAGE.kMax };
  // Montrer environ 1,35 largeur de village : le village tient dans le cadre avec
  // de la marge, donc il se reconnaît, et la salle reste grande.
  const k = Math.min(CADRAGE.kMax, Math.max(CADRAGE.kMin, 100 / (Math.max(r.w, r.h) * CADRAGE.villagesVisibles)));
  // Le centre penche vers la Salle sans lâcher le centre du Village.
  const cx = (CADRAGE.poidsSalle * p.x + (r.x + r.w / 2)) / (CADRAGE.poidsSalle + 1);
  const cy = (CADRAGE.poidsSalle * p.y + (r.y + r.h / 2)) / (CADRAGE.poidsSalle + 1);
  return { x: Math.round(cx * 10) / 10, y: Math.round(cy * 10) / 10, k: Math.round(k * 100) / 100 };
}

export function etendue(rects, placements) {
  let maxY = 100;
  for (const r of rects) maxY = Math.max(maxY, r.y + r.h + 4);
  for (const p of placements) if (p.y !== null) maxY = Math.max(maxY, p.y + 6);
  return { largeur: 100, hauteur: Math.ceil(maxY) };
}

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
  return modele.salles.find((s) => s.cle === n) || null;
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
  const salle = modele.salles.find((s) => s.cle === q) || modele.salles.find((s) => s.cle.includes(q)) || modele.salles.find((s) => contient(s.notes, requete) || contient(tt(s.notes), requete));
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
