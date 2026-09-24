// Configuration de l'appli. bin/deploy.sh la lit par import (pas par grep) et réécrit
// `version:` à chaque publication : gardez une valeur par ligne pour ces réécritures-là.
export const CONFIG = {
  // URL du script Apps Script (web app « exécuter en tant que moi, accès anonyme »).
  // Vide tant que bin/wizard-apps-script.sh n'a pas été joué : l'appli passe alors
  // directement au classeur Export public puis au snapshot.
  scriptUrl: 'https://script.google.com/macros/s/AKfycbwSZkZMUmp63P8wU40x8mJXXqYQHJeHEwV4vUT92_OcoosJ46F9PcFUZN-IWzQsVl_x/exec',
  // Le classeur lu en secours via gviz quand le script ne répond pas (ADR-0003, 0004).
  // Depuis le 2026-09-23 : « Festival — Données du site (production) » (l'ancienne
  // Recette, en lecture publique), celui que le script sert — l'Export public
  // (1-1TURF3X…) est alimenté par le maître, pas par lui, et le secours y affichait
  // un autre festival quand le script ralentissait (37 s mesurées ce soir-là).
  // Le jour où la cellule classeur_recette est vidée, revenir à l'Export public
  // (et retirer `onglets`), comme le Worker du jeu (docs/tableur.md).
  sheetId: '1JQLl1_DQ8H14_b_LPByCnGSYNrYC9SOIWUced_E7u6Q',
  onglets: { exposants: 'Export Exposants', evenements: 'Export Événements', salles: 'Export Salles', preparation: 'Export Préparation', infos: 'Export Infos', traductions: 'Traductions' },
  // Hébergement GitHub Pages, deux plateformes (ADR-domaine 0007) : la prod sert le
  // domaine de l'association, le dev garde une URL github.io laide pour qu'elle ne soit
  // ni transmise ni imprimée. bin/deploy.sh choisit par --cible ; l'appli ne lit jamais
  // ce bloc.
  cibles: {
    prod: { owner: 'festival-rondeau77', repo: 'apel-festival', jeu: 'https://festival-jeu.festival-e23.workers.dev' },
    // `classeur` : le secours gviz de la copie servie en dev (le classeur de dev, fictif,
    // mêmes onglets « Export … »), écrit par bin/deploy.sh --cible=dev.
    dev: { owner: 'festival-rondeau77', repo: 'apel-festival-dev', jeu: 'https://festival-jeu-dev.festival-e23.workers.dev', classeur: '1JQLl1_DQ8H14_b_LPByCnGSYNrYC9SOIWUced_E7u6Q' },
  },
  // Le Worker (ADR-0016, worker/) : le Grand Défi ET, depuis le ticket 20, le programme
  // (etat, donnees) à la place du script. Celui de la PRODUCTION ici ;
  // bin/deploy.sh --cible=dev y écrit celui du dev dans la seule copie servie, et
  // --demo le vide. Vide = pas de jeu : l'appli d'avant le Grand Défi. Sur la
  // machine (npm run servir), l'appli joue contre le Worker local, jamais celui-ci.
  jeuUrl: 'https://festival-jeu-dev.festival-e23.workers.dev',
  // L'URL de la PRODUCTION, toujours : c'est elle que bin/qrcodes.mjs grave dans les
  // chevalets (ADR-domaine 0009). Un QR code n'encode jamais le dev ;
  // bin/deploy.sh --cible=dev la réécrit dans la seule copie servie.
  urlPublique: 'https://festival-rondeau77.github.io/apel-festival-dev/',
  // Version de l'appli : change à chaque déploiement (bin/deploy.sh), pilote le cache du service worker.
  version: '2026.09.24-9b59c30',
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
  // Relecture des règles du Grand Défi (défis actifs, objectif) : cinq minutes.
  // Le Passeport, lui, revient avec chaque validation. Le défi mystère (grand-defi
  // 06) demandera une minute : c'est là qu'il faudra recompter les requêtes.
  intervalleJeu: 300000,
  intervalleStats: 180000,
  // Les langues proposées au Visiteur (ADR-0016, 2026-09-23). Français seul : sans
  // traduction automatique, les textes du tableur resteraient en français sous des
  // menus traduits, une interface à moitié traduite. Avec une seule langue, ni
  // détection de la langue du téléphone, ni « ?lang= », ni sélecteur. Les
  // dictionnaires de app/js/i18n/ restent en place : remettre
  // ['fr', 'en', 'es', 'zh'] rallume tout, sans rien réécrire.
  langues: ['fr'],
};
