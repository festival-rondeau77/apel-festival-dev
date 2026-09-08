// Configuration de l'appli. bin/deploy.sh la lit par import (pas par grep) et réécrit
// `version:` à chaque publication : gardez une valeur par ligne pour ces réécritures-là.
export const CONFIG = {
  // URL du script Apps Script (web app « exécuter en tant que moi, accès anonyme »).
  // Vide tant que bin/wizard-apps-script.sh n'a pas été joué : l'appli passe alors
  // directement au classeur Export public puis au snapshot.
  scriptUrl: 'https://script.google.com/macros/s/AKfycbwSZkZMUmp63P8wU40x8mJXXqYQHJeHEwV4vUT92_OcoosJ46F9PcFUZN-IWzQsVl_x/exec',
  // Classeur « Festival — Export public (lu par l'appli) », lu via gviz (ADR-0003).
  sheetId: '1-1TURF3X40DQ1NvMUavUbyc7ZNsOl4rGTLqMgRsQFqc',
  // Hébergement GitHub Pages, deux plateformes (ADR-domaine 0007) : la prod sert le
  // domaine de l'association, le dev garde une URL github.io laide pour qu'elle ne soit
  // ni transmise ni imprimée. bin/deploy.sh choisit par --cible ; l'appli ne lit jamais
  // ce bloc.
  cibles: {
    prod: { owner: 'festival-rondeau77', repo: 'apel-festival' },
    dev: { owner: 'festival-rondeau77', repo: 'apel-festival-dev' },
  },
  // L'URL de la PRODUCTION, toujours : c'est elle que bin/qrcodes.mjs grave dans les
  // chevalets (ADR-domaine 0009). Un QR code n'encode jamais le dev ;
  // bin/deploy.sh --cible=dev la réécrit dans la seule copie servie.
  urlPublique: 'https://festival-rondeau77.github.io/apel-festival-dev/',
  // Version de l'appli : change à chaque déploiement (bin/deploy.sh), pilote le cache du service worker.
  version: '2026.09.09-1764a96',
  // Rafraîchissement des données (ms) et envoi des mesures (ms).
  // intervalleStats est à 180 s, pas 30 : le test de charge du 2026-09-08 a mesuré
  // que l'écriture de l'onglet Stats plafonne vers 2,2 requêtes par seconde (le
  // verrou du script sérialise), et qu'au-delà elle se dégrade en entraînant les
  // lectures avec elle. À 300 téléphones, 30 s donne 10 req/s — 4,5 fois trop ;
  // 120 s donne encore 2,5 ; 180 s donne 1,67, soit 24 % de marge. Le raisonnement
  // complet et les mesures sont dans ADR-0006 ; la campagne elle-même vit dans
  // docs/test-de-charge.md, sur la branche worktree-test-de-charge. Ne pas baisser
  // sans les relire : c'est le tiers le plus lourd de la charge, et retarder des
  // mesures ne coûte rien au Visiteur, qui ne les voit jamais.
  intervalleDonnees: 60000,
  intervalleStats: 180000,
};
