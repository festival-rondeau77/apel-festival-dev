// Module Gains (grand-defi 07) : ce qui sert à gagner et à remettre un lot, partagé
// par le téléphone, le Worker (worker/src/index.js l'importe) et bin/tirage.mjs. Pur.
//
// Un gain a deux clés (ADR-0014) :
//   - le CODE PUBLIC (`K7M-Q4X`), tiré avec le lot : affiché sur l'écran « Vous avez
//     gagné », dicté ou écrit dans le mail d'un absent, saisi à la main par
//     l'Organisateur quand la caméra ne lit pas ;
//   - le JETON, privé : tiré au hasard par le téléphone et jamais envoyé. Seule son
//     empreinte (SHA-256) part au Worker, qui ne garde qu'elle ; le jeton lui-même
//     ne quitte le téléphone que dans le QR que scanne l'Organisateur.

// Six signes sans ambiguïté à l'oral ni à l'écrit : ni 0/O, ni 1/I/L.
export const ALPHABET_CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_PUBLIC = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/;
export const JETON = /^[A-Za-z0-9_-]{16,64}$/;
export const EMPREINTE = /^[0-9a-f]{64}$/;
export const SORTES = ['grand', 'flash'];

// Ce que tape un Organisateur (« k7m q4x », « K7M-Q4X ») → `K7MQ4X`, ou '' si ce
// n'est pas un code.
export function normaliserCode(texte) {
  const c = String(texte ?? '').toUpperCase().replace(/[\s-]/g, '');
  return CODE_PUBLIC.test(c) ? c : '';
}

export const afficherCode = (code) => `${code.slice(0, 3)}-${code.slice(3)}`;

// L'empreinte d'un jeton : SHA-256, en hexadécimal. Web Crypto (téléphone, Worker, Node ≥ 22).
export async function empreinteDe(jeton) {
  const octets = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jeton)));
  return [...octets].map((o) => o.toString(16).padStart(2, '0')).join('');
}

// Un jeton neuf : 24 octets aléatoires, en base64url (32 signes).
export function nouveauJeton() {
  const octets = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...octets)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Le QR de l'écran « Vous avez gagné » : la page de remise du Worker, le code et le
// jeton dans le fragment (#), qui n'est jamais envoyé au serveur ni écrit dans ses
// journaux : c'est le script de la page qui les lit. `urlWorker` : l'adresse absolue
// du Worker.
export function urlRemise(urlWorker, code, jeton = '') {
  const b = String(urlWorker || '');
  return `${b}${b.includes('?') ? '&' : '?'}action=remise#${code}${jeton ? `.${jeton}` : ''}`;
}

// Un gain tel que le Worker le rend au téléphone : { code, sorte, lot, remis } (remis :
// l'heure de la Remise en ms, ou null), vérifié avant d'être cru. null s'il ne se lit pas.
export function lireGain(g) {
  if (!g || typeof g !== 'object' || !CODE_PUBLIC.test(g.code) || !SORTES.includes(g.sorte) || !Number.isInteger(g.lot) || g.lot < 1) return null;
  return { code: g.code, sorte: g.sorte, lot: g.lot, remis: Number.isFinite(g.remis) && g.remis > 0 ? g.remis : null };
}
