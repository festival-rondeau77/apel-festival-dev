// Module Scan (pur) : ce qu'un QR lu par la caméra DANS l'appli devient
// (grand-defi 10). Un lecteur de QR du téléphone ouvre souvent le lien dans une
// fenêtre cloisonnée, avec sa propre mémoire, donc un autre Passeport ; scanné
// ici, le même QR ouvre la même route sans quitter l'appli.

// Le texte d'un QR → la route de l'appli (« #/exposant/…?s=… »), ou null si ce
// n'est pas un QR du festival. `hotes` : les hôtes de l'appli (prod, dev, celui
// qui sert la page), jamais un autre site.
export function routeDepuisScan(texte, hotes) {
  if (typeof texte !== 'string') return null;
  let url;
  try { url = new URL(texte.trim()); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || !hotes.includes(url.host)) return null;
  return url.hash.startsWith('#/') && url.hash.length > 2 ? url.hash : null;
}
