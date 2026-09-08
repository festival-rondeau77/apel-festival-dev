// Jeu d'icônes de l'appli : un seul style, tracé à 1.8, extrémités rondes,
// dessin sur une grille de 24. Elles prennent la couleur du texte autour
// (currentColor), ce qui les rend justes en thème clair comme en thème sombre.
// Aucune police d'icônes, aucun emoji : le rendu doit être le même partout.

const T = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

const D = {
  accueil: `<path ${T} d="M3.6 10.4 12 3.6l8.4 6.8V20a1 1 0 0 1-1 1h-4.6v-6H9.2v6H4.6a1 1 0 0 1-1-1z"/>`,
  plan: `<path ${T} d="m3.4 6.6 5.8-2.4v13.2L3.4 19.8zm5.8-2.4 5.6 2.4v13.2l-5.6-2.4m5.6-10.8 5.8-2.4v13.2l-5.8 2.4"/>`,
  exposants: `<path ${T} d="M12 3.4 22 8l-10 4.6L2 8zm-6 6.4v5.2c0 1.9 2.7 3.4 6 3.4s6-1.5 6-3.4V9.8"/>`,
  programme: `<circle ${T} cx="12" cy="12" r="8.6"/><path ${T} d="M12 7.2V12l3.2 2"/>`,
  visite: `<path class="coeur" ${T} d="m12 3.8 2.62 5.3 5.86.86-4.24 4.13 1 5.83L12 17.19l-5.24 2.76 1-5.83-4.24-4.13 5.86-.86z"/>`,
  preparer: `<path ${T} d="M4.4 6.6h9m-9 5.4h9m-9 5.4h6"/><path ${T} d="m16.4 5.6 1.8 1.8 3.4-3.4"/>`,
  aide: `<circle ${T} cx="12" cy="12" r="8.6"/><path ${T} d="M9.6 9.4a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2.2-2.5 3.9"/><path ${T} d="M12 17.3h.01"/>`,
  lieu: `<path ${T} d="M12 21.4s6.6-5.4 6.6-10.2A6.6 6.6 0 0 0 5.4 11.2C5.4 16 12 21.4 12 21.4z"/><circle ${T} cx="12" cy="11" r="2.4"/>`,
  calendrier: `<rect ${T} x="3.6" y="5.4" width="16.8" height="15" rx="2.2"/><path ${T} d="M3.6 10.2h16.8M8.4 3.4v3.4m7.2-3.4v3.4"/>`,
  externe: `<path ${T} d="M14.2 4.2h5.6v5.6m0-5.6L12 12"/><path ${T} d="M18 14.4v4.2a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8V7.8A1.8 1.8 0 0 1 5.4 6h4.2"/>`,
  fermer: `<path ${T} d="M6 6l12 12M18 6 6 18"/>`,
  recherche: `<circle ${T} cx="10.8" cy="10.8" r="6.6"/><path ${T} d="m20 20-4.6-4.6"/>`,
  chevron: `<path ${T} d="m9.6 5.4 6.6 6.6-6.6 6.6"/>`,
  retour: `<path ${T} d="M19 12H5m0 0 6.2-6.2M5 12l6.2 6.2"/>`,
  plus: `<path ${T} d="M12 5.4v13.2M5.4 12h13.2"/>`,
  moins: `<path ${T} d="M5.4 12h13.2"/>`,
  recentrer: `<circle ${T} cx="12" cy="12" r="7.2"/><path ${T} d="M12 2.6v2.6m0 13.6v2.6M2.6 12h2.6m13.6 0h2.6"/>`,
  alerte: `<path ${T} d="M10.3 4.3 2.6 17.6a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path ${T} d="M12 9.4v4m0 3.2h.01"/>`,
  info: `<circle ${T} cx="12" cy="12" r="8.6"/><path ${T} d="M12 11.4v5m0-8.4h.01"/>`,
  qr: `<rect ${T} x="3.6" y="3.6" width="6.6" height="6.6" rx="1.4"/><rect ${T} x="13.8" y="3.6" width="6.6" height="6.6" rx="1.4"/><rect ${T} x="3.6" y="13.8" width="6.6" height="6.6" rx="1.4"/><path ${T} d="M14 14h2.4v2.4H14zm4 4h2.4v2.4H18z"/>`,
  cloche: `<path ${T} d="M18 8.4a6 6 0 1 0-12 0c0 5.4-2.4 7.2-2.4 7.2h16.8S18 13.8 18 8.4z"/><path ${T} d="M13.7 19.2a2 2 0 0 1-3.4 0"/>`,
  toilettes: `<circle ${T} cx="8" cy="5.4" r="1.8"/><path ${T} d="M8 9v11.4m-2.4-7.8L8 9l2.4 3.6"/><circle ${T} cx="16.4" cy="5.4" r="1.8"/><path ${T} d="M16.4 9 14 15h4.8l-2.4-6zm0 6v5.4"/>`,
  cafe: `<path ${T} d="M4.4 8.4h12v6.2a4.4 4.4 0 0 1-4.4 4.4H8.8a4.4 4.4 0 0 1-4.4-4.4z"/><path ${T} d="M16.4 10.2h1.8a2.4 2.4 0 0 1 0 4.8h-1.8M4.4 21.4h12"/>`,
  porte: `<path ${T} d="M5.6 21V4.6a1.6 1.6 0 0 1 1.6-1.6h9.6a1.6 1.6 0 0 1 1.6 1.6V21"/><path ${T} d="M3.6 21h16.8M14.6 12.2h.01"/>`,
  train: `<rect ${T} x="5.4" y="3.6" width="13.2" height="12.6" rx="2.6"/><path ${T} d="M5.4 10.8h13.2M8.6 20.4l1.8-4.2m5 4.2-1.8-4.2"/><path ${T} d="M9 13.6h.01M15 13.6h.01"/>`,
  bus: `<rect ${T} x="3.6" y="4.4" width="16.8" height="11.6" rx="2.4"/><path ${T} d="M3.6 11h16.8M7.4 20v-4m9.2 4v-4"/><path ${T} d="M7.4 13.8h.01m9.2 0h.01"/>`,
  parking: `<rect ${T} x="3.6" y="3.6" width="16.8" height="16.8" rx="3.4"/><path ${T} d="M9.6 16.8V7.6h3.2a2.9 2.9 0 0 1 0 5.8H9.6"/>`,
  wifi: `<path ${T} d="M2.6 9.2a13.4 13.4 0 0 1 18.8 0M6 12.8a8.4 8.4 0 0 1 12 0M9.4 16.4a3.6 3.6 0 0 1 5.2 0"/><path ${T} d="M12 20h.01"/>`,
  document: `<path ${T} d="M13.6 3.4H7.2a1.8 1.8 0 0 0-1.8 1.8v13.6a1.8 1.8 0 0 0 1.8 1.8h9.6a1.8 1.8 0 0 0 1.8-1.8V8.2z"/><path ${T} d="M13.6 3.4v4.8h4.8M8.8 13h6.4m-6.4 3.4h4"/>`,
  avis: `<path ${T} d="M20.4 12.6a7.4 7.4 0 0 1-8 7.4l-5.2 1.4 1.4-4.2a7.4 7.4 0 1 1 11.8-4.6z"/>`,
  prive: `<rect ${T} x="4.4" y="10.2" width="15.2" height="10.2" rx="2.4"/><path ${T} d="M8 10.2V7.4a4 4 0 0 1 8 0v2.8"/>`,
  itineraire: `<path ${T} d="M12 21.4 3.4 3.4l18 8.2-8.4 3.4z"/>`,
  telephone: `<path ${T} d="M21 16.5v3a2 2 0 0 1-2.2 2 19.6 19.6 0 0 1-8.5-3 19.3 19.3 0 0 1-6-6 19.6 19.6 0 0 1-3-8.6A2 2 0 0 1 3.3 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.4 9.8a16 16 0 0 0 6 6l1.2-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>`,
  courrier: `<rect ${T} x="3.4" y="5" width="17.2" height="14" rx="2.2"/><path ${T} d="m3.8 6.6 8.2 5.8 8.2-5.8"/>`,
};

export function icone(nom, taille = 24) {
  const d = D[nom];
  if (!d) return '';
  return `<svg viewBox="0 0 24 24" width="${taille}" height="${taille}" aria-hidden="true" focusable="false">${d}</svg>`;
}

// La marque de l'appli : une étoile à huit branches, tracée, qui sert de motif
// dans l'en-tête d'accueil et de repère sur le plan.
export function marque(taille = 200) {
  return `<svg viewBox="0 0 100 100" width="${taille}" height="${taille}" aria-hidden="true" focusable="false">
    <g stroke="currentColor" stroke-width="9" stroke-linecap="round" fill="none">
      <path d="M50 12v76M12 50h76M23.2 23.2l53.6 53.6M76.8 23.2 23.2 76.8"/>
    </g>
  </svg>`;
}
