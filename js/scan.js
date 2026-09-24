// Module Scan (pur) : ce qu'un QR lu par la caméra DANS l'appli devient
// (grand-defi 10). Un lecteur de QR du téléphone ouvre souvent le lien dans une
// fenêtre cloisonnée, avec sa propre mémoire, donc un autre Passeport ; scanné
// ici, le même QR ouvre la même route sans quitter l'appli.

// Le texte d'un QR → la route de l'appli (« #/exposant/…?s=… »), ou null si ce
// n'est pas un QR de CETTE appli. `bases` : ses adresses de base (la page qui
// scanne, son urlPublique), chemin compris : sur github.io, le dev, la prod et
// les maquettes partagent un hôte, et un secret du dev n'a rien à faire en prod.
export function routeDepuisScan(texte, bases) {
  if (typeof texte !== 'string') return null;
  let url;
  try { url = new URL(texte.trim()); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol)) return null;
  const dossier = (u) => u.origin + u.pathname.replace(/[^/]*$/, ''); // « …/apel-festival-dev/index.html » → « …/apel-festival-dev/ »
  const ici = dossier(url);
  if (!bases.some((b) => { try { return dossier(new URL(b)) === ici; } catch { return false; } })) return null;
  return url.hash.startsWith('#/') && url.hash.length > 2 ? url.hash : null;
}

// ---------------------------------------------------------------- le QR visé (grand-defi 11)
// Sur une table, le chevalet (QR public) et la Carte du jeu sont souvent tous deux
// dans le champ de la caméra : lire « le premier QR trouvé » ouvrait parfois le
// voisin. On ne garde que le QR dont le centre est dans le cadre blanc de l'écran,
// le plus près du milieu.

// Le retrait du cadre blanc, de chaque côté : `.scanner .viseur { inset: 18% }` (styles.css).
export const RETRAIT_VISEUR = 0.18;

// Le cadre blanc, dans les coordonnées de l'image de la caméra. La vidéo remplit sa
// boîte en `object-fit: cover` : on n'en voit que la partie centrale.
export function zoneVisee(imageL, imageH, boiteL, boiteH, retrait = RETRAIT_VISEUR) {
  const echelle = Math.max(boiteL / imageL, boiteH / imageH);
  const visibleL = boiteL / echelle, visibleH = boiteH / echelle;
  const x0 = (imageL - visibleL) / 2, y0 = (imageH - visibleH) / 2;
  return { x: x0 + visibleL * retrait, y: y0 + visibleH * retrait, l: visibleL * (1 - 2 * retrait), h: visibleH * (1 - 2 * retrait) };
}

const dans = (p, z) => p.x >= z.x && p.x <= z.x + z.l && p.y >= z.y && p.y <= z.y + z.h;

// codes : [{ texte, centre: { x, y } }] → le texte du QR visé, ou null.
export function codeVise(codes, zone) {
  const milieu = { x: zone.x + zone.l / 2, y: zone.y + zone.h / 2 };
  const distance = (c) => Math.hypot(c.centre.x - milieu.x, c.centre.y - milieu.y);
  const vises = codes.filter((c) => dans(c.centre, zone)).sort((a, b) => distance(a) - distance(b));
  return vises.length ? vises[0].texte : null;
}

const centreJsQR = (l) => ({
  x: (l.topLeftCorner.x + l.topRightCorner.x + l.bottomLeftCorner.x + l.bottomRightCorner.x) / 4,
  y: (l.topLeftCorner.y + l.topRightCorner.y + l.bottomLeftCorner.y + l.bottomRightCorner.y) / 4,
});

// jsQR (Safari) ne rend qu'un QR par image : d'abord l'intérieur du cadre seul, puis
// l'image entière (un QR tenu de près déborde du cadre), gardée seulement si son
// centre est dans le cadre. pixels : RGBA, largeur × hauteur.
export function lireAvecJsQR(jsQR, pixels, largeur, hauteur, zone) {
  const x0 = Math.max(0, Math.floor(zone.x)), y0 = Math.max(0, Math.floor(zone.y));
  const l = Math.min(largeur - x0, Math.ceil(zone.l)), h = Math.min(hauteur - y0, Math.ceil(zone.h));
  if (l > 0 && h > 0) {
    const recadre = new Uint8ClampedArray(l * h * 4);
    for (let y = 0; y < h; y++) recadre.set(pixels.subarray(((y0 + y) * largeur + x0) * 4, ((y0 + y) * largeur + x0 + l) * 4), y * l * 4);
    const dedans = jsQR(recadre, l, h, { inversionAttempts: 'dontInvert' });
    if (dedans) return dedans.data;
  }
  const entier = jsQR(pixels, largeur, hauteur, { inversionAttempts: 'dontInvert' });
  return entier && dans(centreJsQR(entier.location), zone) ? entier.data : null;
}
