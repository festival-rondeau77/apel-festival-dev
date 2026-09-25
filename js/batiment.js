// Le bâtiment : géométrie relevée sur les plans d'évacuation du lycée Maurice
// Rondeau (rez-de-chaussée et 1er étage, salle par salle, quatre escaliers, patio,
// arc du restaurant), extérieur stylisé d'après les deux vues aériennes de la
// plaquette d'accès. Extrait par script de la maquette « Rondeau relevé sur plan »
// du 2026-09-22 (ADR-0013). Données pures : aucun texte destiné au Visiteur, aucune
// affectation — le tableur dit quelle Pièce est une Salle du festival, et de quel
// Village. Réserves à lever sur place : ticket 13.
//
// Unités : 1 = 10 px du scan du plan RDC redressé (≈ 1,3 m). Le 1er étage a été
// recalé sur le RDC par les centres des quatre escaliers. Le parvis est en haut.
//
// Une Pièce : { nom, court?, k?, h?, poly }
//   nom    ce qui est écrit sur la porte (« 110 », « CDI », « Auditorium ») — la
//          clé de jointure avec la colonne `salle` du tableur
//   court  libellé abrégé quand le nom ne tient pas
//   k      nature — absent : pièce pouvant accueillir le festival ; 'n' pièce hors
//          festival ; 'c' circulation ; 'e' escalier ; 'p' repère extérieur ;
//          's' parvis ou cour ; 'v' pelouse ; 'r' voirie ; 'a' arbre ; 'g' bâtiment
//          voisin (fantôme)
//   h      hauteur relative (1 par défaut)
//   poly   sommets [x, y], dans l'ordre
//
// Un Étage : { etage, contour, trous, sol?, pieces }
//   contour  l'emprise de la dalle ; trous : le patio, à jour
//   sol      le terrain autour (rez-de-chaussée seulement), plat, sous la dalle

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const disque = (cx, cy, r, n = 18) => Array.from({ length: n }, (_, i) => [+(cx + r * Math.cos((i / n) * 2 * Math.PI)).toFixed(2), +(cy + r * Math.sin((i / n) * 2 * Math.PI)).toFixed(2)]);

// Emprise commune aux deux niveaux : aile principale + bloc du patio + aile EPS.
const PATIO = [[71, 72], [94, 72], [94, 96], [71, 96]];
const ESCALIERS = [
  { nom: 'Escalier Nord', k: 'e', poly: disque(111.5, 57, 4.4) },
  { nom: 'Escalier Ouest', k: 'e', poly: disque(66, 61.5, 4.4) },
  { nom: 'Escalier Sud', k: 'e', poly: disque(101.5, 103, 4.4) },
  { nom: 'Escalier Est', k: 'e', poly: disque(172, 73, 3.8) },
];
const ARBRES = [[74, 30], [80, 31], [130, 30], [140, 30.5], [150, 31], [160, 31], [170, 31.5], [130, 47], [140, 47.5], [150, 48], [160, 48], [170, 48.5], [30, 13], [45, 13], [60, 13], [75, 13], [90, 13], [105, 13], [120, 13], [135, 13], [150, 13], [165, 13]].map(([x, y]) => ({ nom: 'Arbre', k: 'a', poly: disque(x, y, 1.6, 10) }));

// Le centre autour duquel la vue d'ensemble tourne : le bâtiment, pas le terrain.
export const CENTRE = [101, 78];

export const BATIMENT = [
  {
    etage: 'Rez-de-chaussée',
    contour: [[26.5, 40], [49.7, 42.5], [68.5, 43], [100, 49], [123, 56], [176, 58], [176, 77], [168, 79], [118, 79], [117.5, 84], [117, 86], [117, 125], [106, 134], [100, 134], [88, 132], [77, 127], [67, 120], [58, 112], [50, 103], [44, 93], [40, 84], [38, 77], [52, 77], [52, 56], [26.5, 53]],
    trous: [PATIO],
    sol: [[-6, -8], [212, -8], [212, 168], [-6, 168]],
    pieces: [
      // l'extérieur, stylisé
      { nom: "Rue", k: 'r', poly: [[-6, -8], [212, -8], [212, 2], [-6, 2]] },
      { nom: "Rue", k: 'r', poly: [[-6, -8], [8, -8], [8, 168], [-6, 168]] },
      { nom: "Rue", k: 'r', poly: [[182, 2], [196, 2], [196, 168], [182, 168]] },
      { nom: "Parvis", k: 's', poly: [[86, 36], [124, 43], [124, 57], [86, 50]] },
      // deux foodtrucks garés sur le parvis, côté est, à l'écart du hall d'entrée
      // (2026-09-25) ; l'emplacement exact est à relever sur place
      { nom: "Foodtruck", h: 0.7, poly: rect(111, 43, 5, 2.5) },
      { nom: "Foodtruck", h: 0.7, poly: rect(118, 44.5, 5, 2.5) },
      { nom: "Pelouse", k: 'v', poly: [[70, 22], [86, 25], [86, 40], [70, 36]] },
      { nom: "Pelouse", k: 'v', poly: [[124, 22], [178, 24], [178, 36], [124, 34]] },
      { nom: "Pelouse", k: 'v', poly: [[124, 40], [178, 41], [178, 56], [124, 54]] },
      { nom: "Pelouse", k: 'v', poly: [[22, 8], [178, 8], [178, 18], [22, 18]] },
      { nom: "Cour", k: 's', poly: [[38, 140], [112, 140], [112, 160], [38, 160]] },
      { nom: "Collège (aile)", k: 'g', poly: [[112, 140], [178, 143], [178, 155], [112, 152]] },
      { nom: "Amphithéâtre du collège", k: 'g', poly: [[196.5, 150], [196.21, 152.2], [195.36, 154.25], [194.01, 156.01], [192.25, 157.36], [190.2, 158.21], [188, 158.5], [185.8, 158.21], [183.75, 157.36], [181.99, 156.01], [180.64, 154.25], [179.79, 152.2], [179.5, 150], [179.79, 147.8], [180.64, 145.75], [181.99, 143.99], [183.75, 142.64], [185.8, 141.79], [188, 141.5], [190.2, 141.79], [192.25, 142.64], [194.01, 143.99], [195.36, 145.75], [196.21, 147.8]] },
      { nom: "Arrêt bus 26 · 44 · 46", k: 'p', poly: [[158, 18.5], [165, 18.5], [165, 22], [158, 22]] },
      { nom: "Arrêt bus 26 (Bussy)", k: 'p', poly: [[24, 18.5], [31, 18.5], [31, 22], [24, 22]] },
      { nom: "RER A", k: 'p', poly: [[178, 60], [186, 60], [186, 64], [178, 64]] },
      ...ARBRES,
      // le rez-de-chaussée, relevé
      ...ESCALIERS,
      { nom: "Salle polyvalente", k: 'n', h: 1.8, poly: [[49.7, 15.5], [68.5, 15.5], [68.5, 42.5], [49.7, 42.5]] },
      { nom: "Bureaux", k: 'n', poly: [[26.5, 40], [41, 41.5], [41, 54], [26.5, 52.5]] },
      { nom: "Local", k: 'n', poly: [[41, 41.5], [49.7, 42.5], [49.7, 55], [41, 54]] },
      { nom: "Hall ouest", k: 'c', poly: [[60, 43], [68, 44], [68, 52.5], [60, 52]] },
      { nom: "Bureaux 25-28", k: 'n', poly: [[53, 58.5], [58.5, 58.5], [58.5, 67], [53, 67]] },
      { nom: "Salle d'examens", k: 'n', poly: [[52, 67], [58, 67], [58, 77], [52, 77]] },
      { nom: "Bureaux 21 · 22 · 23", court: "21-23", k: 'n', poly: [[74.5, 48], [91, 51.5], [91, 59.5], [74.5, 56]] },
      { nom: "Hall d'entrée", poly: [[91, 50], [107.5, 53.5], [107.5, 61], [98, 62], [91, 58]] },
      { nom: "Atelier A01", court: "A01", k: 'n', poly: [[117, 57], [133, 58], [133, 67], [117, 66]] },
      { nom: "Atelier A02", court: "A02", k: 'n', poly: [[133, 58], [151, 58.5], [151, 67.5], [133, 67]] },
      { nom: "Atelier A03", court: "A03", k: 'n', poly: [[151, 58.5], [166, 59], [166, 67.5], [151, 67.5]] },
      { nom: "Atelier A04", court: "A04", k: 'n', poly: [[166, 59], [176, 59.5], [176, 68], [166, 67.5]] },
      { nom: "Couloir", k: 'c', poly: [[117, 67], [176, 68], [176, 70], [117, 69]] },
      { nom: "Auditorium", poly: [[110, 68.5], [132, 69.5], [132, 79], [110, 79]] },
      { nom: "Atelier A05", court: "A05", k: 'n', poly: [[132, 69.5], [168, 70], [168, 79], [132, 79]] },
      { nom: "Foyer", k: 'c', poly: [[108.5, 79], [117, 79], [117, 84], [108.5, 84]] },
      { nom: "Oratoire", k: 'n', poly: [[76, 64], [93.5, 64], [93.5, 74], [76, 74]] },
      { nom: "Salle multimédia", k: 'n', poly: [[62, 72], [71, 72], [71, 83], [62, 83]] },
      { nom: "Salle de permanence", poly: [[97.5, 72.5], [106, 72.5], [106, 83.5], [97.5, 83.5]] },
      { nom: "Arts plastiques", k: 'n', poly: [[97.5, 87], [106, 87], [106, 98], [97.5, 98]] },
      { nom: "Salle EPS", poly: [[108.5, 86], [117, 86], [117, 104], [108.5, 104]] },
      { nom: "Vestiaires", k: 'n', poly: [[108.5, 105], [117, 105], [117, 125], [108.5, 125]] },
      { nom: "Bureaux", k: 'n', poly: [[62, 85], [71, 85], [71, 98], [62, 98]] },
      { nom: "Restaurant scolaire", k: 'n', poly: [[41, 84], [60, 84], [60, 99], [97, 99], [97, 112], [106, 112], [106, 125], [100, 133], [88, 131], [77, 126], [67, 119], [58, 111], [50, 102], [44, 93]] },
    ],
  },
  {
    etage: '1er étage',
    contour: [[26.5, 40], [49.7, 42.5], [68.5, 43], [100, 49], [123, 56], [176, 58], [176, 77], [168, 79], [118, 79], [117.5, 84], [117, 86], [117, 118.5], [95, 118.5], [95, 108], [68.5, 108], [68.5, 115], [50.5, 115], [50.5, 77], [52, 56], [26.5, 53]],
    trous: [PATIO],
    pieces: [
      ...ESCALIERS,
      { nom: "Bureaux 125 · 126", court: "125-126", k: 'n', poly: [[40.5, 43], [52.5, 44.5], [52.5, 49.5], [40.5, 48]] },
      { nom: "Comptabilité 127", k: 'n', poly: [[40.5, 50], [52, 51.5], [52, 56], [40.5, 54.5]] },
      { nom: "Secrétariat 124", k: 'n', poly: [[58, 49.5], [67.5, 51], [67.5, 55.5], [58, 54]] },
      { nom: "Direction 122 · 123", court: "122-123", k: 'n', poly: [[67.5, 51], [81.5, 53], [81.5, 57.5], [67.5, 55.5]] },
      { nom: "Salle des profs 121", k: 'n', poly: [[81.5, 53], [91.5, 55], [91.5, 59.5], [81.5, 57.5]] },
      { nom: "Palier", k: 'c', poly: [[91.5, 55], [107, 58], [107, 62], [91.5, 59.5]] },
      { nom: "Atelier A101", court: "A101", k: 'n', poly: [[116.5, 59], [125.5, 59.5], [125.5, 66], [116.5, 65]] },
      { nom: "Atelier A102", court: "A102", k: 'n', poly: [[125.5, 59.5], [139.5, 59.5], [139.5, 66], [125.5, 66]] },
      { nom: "Atelier A103", court: "A103", k: 'n', poly: [[139.5, 59.5], [164, 59.5], [164, 66], [139.5, 66]] },
      { nom: "Atelier A104", court: "A104", k: 'n', poly: [[164, 59.5], [176, 59.5], [176, 66], [164, 66]] },
      { nom: "Couloir", k: 'c', poly: [[116.5, 66], [176, 66], [176, 69], [116.5, 69]] },
      { nom: "Amphithéâtre (haut de l'auditorium)", court: "Amphi", k: 'n', poly: [[107.5, 69], [124.5, 69], [124.5, 78], [107.5, 78]] },
      { nom: "Labo 109", k: 'n', poly: [[135.5, 70.5], [144.5, 70.5], [144.5, 78], [135.5, 78]] },
      { nom: "Bureaux 105-108", court: "105-108", k: 'n', poly: [[144.5, 70.5], [164, 70.5], [164, 78], [144.5, 78]] },
      { nom: "Magasin 106", k: 'n', poly: [[164, 69.5], [168, 69.5], [168, 78], [164, 78]] },
      { nom: "110", poly: [[95.5, 73], [104.5, 73], [104.5, 83], [95.5, 83]] },
      { nom: "111", poly: [[95.5, 85], [104.5, 85], [104.5, 95.5], [95.5, 95.5]] },
      { nom: "116", poly: [[107.5, 78], [115.5, 78], [115.5, 86], [107.5, 86]] },
      { nom: "115", poly: [[107.5, 87], [115.5, 87], [115.5, 95], [107.5, 95]] },
      { nom: "114", poly: [[107.5, 98], [115.5, 98], [115.5, 106], [107.5, 106]] },
      { nom: "113", poly: [[107.5, 109], [115.5, 109], [115.5, 118], [107.5, 118]] },
      { nom: "112", poly: [[95.5, 109], [104.5, 109], [104.5, 118], [95.5, 118]] },
      { nom: "138", poly: [[84, 98], [93, 98], [93, 105.5], [84, 105.5]] },
      { nom: "139", poly: [[69, 98], [81.5, 98], [81.5, 105.5], [69, 105.5]] },
      { nom: "140", poly: [[61, 84], [68.5, 84], [68.5, 97], [61, 97]] },
      { nom: "141", poly: [[61, 69], [68.5, 69], [68.5, 82], [61, 82]] },
      { nom: "CDI", poly: [[68.5, 61], [93, 61], [93, 70], [68.5, 70]] },
      { nom: "BDI", poly: [[93, 62.5], [104.5, 62.5], [104.5, 70], [93, 70]] },
      { nom: "Bureaux 128 · 129", court: "128-129", k: 'n', poly: [[52, 57.5], [59, 57.5], [59, 63], [52, 63]] },
      { nom: "132", poly: [[52, 64], [59, 64], [59, 73], [52, 73]] },
      { nom: "Bureau 133", k: 'n', poly: [[52, 74], [59, 74], [59, 82], [52, 82]] },
      { nom: "134", court: "134", poly: [[52, 83], [59, 83], [59, 93], [52, 93]] },
      { nom: "135", court: "135", poly: [[52, 93], [59, 93], [59, 100], [52, 100]] },
      { nom: "Atelier A137", court: "A137", k: 'n', poly: [[50.5, 101], [68.5, 101], [68.5, 115], [50.5, 115]] },
    ],
  },
];
