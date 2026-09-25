// Navigation par fragment d'URL : « #/programme », « #/evenement/<clé> »,
// « #/exposant/<clé>?qr=1 », « #/carte/<étiquette>/<jeton> », « #/c/<étiquette> »,
// « #/plan?salle=Salle 12 ». Pure.
import { exposantDeCarte, etiquetteCanonique } from './donnees.js';

const ROUTES = [
  ['', 'accueil'], ['programme', 'programme'], ['evenement', 'evenement'], ['exposants', 'exposants'], ['exposant', 'exposant'],
  ['plan', 'plan'], ['visite', 'visite'], ['preparer', 'preparer'], ['questions', 'questions'], ['aide', 'aide'],
  ['scanner', 'scanner'], ['rejouer', 'rejouer'], ['defis', 'defis'], ['regle', 'regle'], ['carte', 'carte'], ['c', 'cartePublique'],
];

// Les routes qui ouvrent la fiche d'un Exposant (voir ficheOuverte).
export const ROUTES_EXPOSANT = ['exposant', 'carte', 'cartePublique'];

export function analyserRoute(hash) {
  let h = String(hash || '');
  if (h.startsWith('#')) h = h.slice(1);
  if (h.startsWith('/')) h = h.slice(1);
  const [chemin, requete = ''] = h.split('?');
  const segments = chemin.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  const params = {};
  for (const morceau of requete.split('&')) {
    if (!morceau) continue;
    const [k, v = ''] = morceau.split('=');
    try { params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch { params[k] = v; }
  }
  const nom = (ROUTES.find(([seg]) => seg === (segments[0] || '')) || [null, 'inconnue'])[1];
  if ((nom === 'evenement' || nom === 'exposant') && segments[1]) params.cle = segments[1];
  if ((nom === 'carte' || nom === 'cartePublique') && segments[1]) params.etiquette = segments[1];
  if (nom === 'carte' && segments[2]) params.jeton = segments[2];
  return { nom, params, chemin: segments.join('/') };
}

// L'URL profonde d'un Exposant, telle qu'encodée dans un QR code : `qr` pour
// celui des affiches (la fiche, sans point), `secret` pour celui du chevalet, qui
// prouve le passage au stand (Grand Défi, ADR-0014).
export function urlExposant(base, cle, { qr = false, secret = '' } = {}) {
  const b = String(base || '').replace(/\/+$/, '');
  const requete = secret ? `?s=${encodeURIComponent(secret)}` : (qr ? '?qr=1' : '');
  return `${b}/#/exposant/${encodeURIComponent(cle)}${requete}`;
}

// Le QR d'une Carte du Grand Défi (ADR-0018) : l'étiquette, publique, suffit au
// téléphone pour ouvrir la fiche hors ligne (l'attribution est dans le tableur) ;
// le jeton, secret, est la Preuve. Le Worker ne croit que le jeton : changer
// l'étiquette du lien ne fait gagner aucun point.
export function urlCarte(base, etiquette, jeton) {
  return `${String(base || '').replace(/\/+$/, '')}/#/carte/${encodeURIComponent(etiquette)}/${encodeURIComponent(jeton)}`;
}

// Le lien public d'une Carte : la fiche de l'Exposant auquel elle est attribuée,
// sans rien prouver. Il ne porte que l'étiquette, jamais le jeton.
export function urlPublicCarte(base, etiquette) {
  return `${String(base || '').replace(/\/+$/, '')}/#/c/${encodeURIComponent(etiquette)}`;
}

// La fiche d'Exposant qu'ouvre une route : sa clé (null pour une Carte pas encore
// attribuée), le secret à présenter (le jeton d'une Carte, ou le secret d'un
// ancien chevalet `?s=`), `qr` si on arrive par un QR. null hors des fiches.
export function ficheOuverte(route, modele) {
  const p = route.params;
  if (route.nom === 'exposant') return { cle: p.cle || null, secret: p.s || '', qr: p.qr === '1' || Boolean(p.s), etiquette: '' };
  if (!ROUTES_EXPOSANT.includes(route.nom)) return null;
  const ex = exposantDeCarte(modele, p.etiquette);
  const etiquette = etiquetteCanonique(p.etiquette) || String(p.etiquette || '');
  return { cle: ex ? ex.cle : null, secret: ex && route.nom === 'carte' ? p.jeton || '' : '', qr: true, etiquette };
}
