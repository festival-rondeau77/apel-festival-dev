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
