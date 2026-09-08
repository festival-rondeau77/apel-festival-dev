// Logique du plan : disposition des Zones et des Salles (coordonnées 0 à 100),
// recherche depuis le plan, phrase de guidage, contenu d'une Zone. Pure.
import { normaliser, contient } from './donnees.js';

// Disposition stylisée d'après les vues extérieures du lycée : l'entrée et
// l'accueil en bas, l'auditorium (Conférences) à gauche, les bâtiments de
// salles au-dessus. Coordonnées et tailles en pour cent du plan.
const DISPOSITION_PAR_DEFAUT = {
  1: { x: 36, y: 78, w: 28, h: 16 },
  2: { x: 4, y: 44, w: 28, h: 28 },
  3: { x: 36, y: 44, w: 28, h: 28 },
  4: { x: 68, y: 44, w: 28, h: 28 },
  5: { x: 4, y: 10, w: 44, h: 28 },
  6: { x: 52, y: 10, w: 44, h: 28 },
  7: { x: 4, y: 78, w: 28, h: 16 },
};
const GRILLE = { colonnes: 3, marge: 4, ecart: 4 };

// Chaque Zone reçoit un rectangle ; les Zones hors disposition par défaut sont
// rangées en grille sous les autres.
export function disposerZones(zones) {
  const rects = [];
  let libres = 0;
  for (const z of zones) {
    const d = z.numero !== null ? DISPOSITION_PAR_DEFAUT[z.numero] : null;
    if (d) { rects.push({ zone: z, ...d }); continue; }
    const col = libres % GRILLE.colonnes, ligne = Math.floor(libres / GRILLE.colonnes);
    const w = (100 - 2 * GRILLE.marge - (GRILLE.colonnes - 1) * GRILLE.ecart) / GRILLE.colonnes;
    rects.push({ zone: z, x: GRILLE.marge + col * (w + GRILLE.ecart), y: 100 + GRILLE.ecart + ligne * 20, w, h: 16 });
    libres++;
  }
  return rects;
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
    const y = r.y + 6.5 + ((ligne + 0.5) / lignes) * (r.h - 7);
    return { salle: s, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, estimee: true };
  });
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

// La phrase pour s'y rendre : Zone puis notes de la Salle.
export function phraseGuidage(salle, nomSalle = '') {
  if (!salle) return nomSalle ? `${nomSalle} : salle à localiser, demandez à l'accueil` : "Salle à venir : demandez à l'accueil";
  const morceaux = [];
  if (salle.zone) morceaux.push(`Zone ${salle.zone.numero ?? ''} ${salle.zone.nom}`.replace(/\s+/g, ' ').trim());
  if (salle.notes) morceaux.push(salle.notes);
  if (!morceaux.length) morceaux.push(`${salle.nom} : demandez à l'accueil`);
  return morceaux.join(', ');
}

// Recherche depuis le plan : une Salle, sinon un Exposant, sinon un Événement.
// Renvoie la meilleure correspondance avec la Salle à allumer.
export function rechercherSurPlan(modele, requete) {
  const q = normaliser(requete);
  if (!q) return null;
  const salle = modele.salles.find((s) => s.cle === q) || modele.salles.find((s) => s.cle.includes(q)) || modele.salles.find((s) => contient(s.notes, requete));
  if (salle && !(modele.exposants.some((e) => normaliser(e.nom) === q))) return { genre: 'salle', salle, nomSalle: salle.nom, phrase: phraseGuidage(salle), libelle: salle.nom };
  const exposant = modele.exposants.find((e) => normaliser(e.nom) === q) || modele.exposants.find((e) => contient(e.nom, requete)) || modele.exposants.find((e) => contient(e.sousTitre, requete) || contient(e.ville, requete));
  if (exposant) {
    const s = salleParNom(modele, exposant.salle);
    return { genre: 'exposant', exposant, salle: s, nomSalle: exposant.salle, phrase: phraseGuidage(s, exposant.salle), libelle: exposant.nom };
  }
  const evenement = modele.evenements.find((e) => contient(e.titre, requete) || contient(e.intervenantsTexte, requete));
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
