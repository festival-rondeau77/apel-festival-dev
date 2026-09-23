// Navigation par fragment d'URL : « #/programme », « #/evenement/<clé> »,
// « #/exposant/<clé>?qr=1 », « #/exposant/<clé>?s=<secret> », « #/plan?salle=Salle 12 ». Pure.

const ROUTES = [
  ['', 'accueil'], ['programme', 'programme'], ['evenement', 'evenement'], ['exposants', 'exposants'], ['exposant', 'exposant'],
  ['plan', 'plan'], ['visite', 'visite'], ['preparer', 'preparer'], ['questions', 'questions'], ['aide', 'aide'],
];

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
