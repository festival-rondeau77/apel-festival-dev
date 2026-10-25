// Le lien court des questions flash (ADR-0027) : `/animation` ouvre la page animation du
// Worker de la même plateforme, sans laisser cette étape dans l'historique.
import { CONFIG } from './config.js';

export const urlAnimation = (jeuUrl) => (jeuUrl ? `${jeuUrl.replace(/\/+$/, '')}/?action=animation` : '');

if (typeof location !== 'undefined') {
  const url = urlAnimation(CONFIG.jeuUrl);
  if (url) location.replace(url);
  else document.getElementById('message').textContent = 'Le jeu n’est pas branché sur cette version de l’appli.';
}
