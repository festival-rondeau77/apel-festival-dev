// La référence : chaque texte fixe de l'appli, tel qu'il est écrit dans le code
// (rendu.js, plan.js, visite.js, app.js, index.html) et dans les énumérations
// du modèle (villages, domaines, formats, publics, organisations, étages…).
// Un test vérifie que en.js, es.js et zh.js traduisent chacun de ces textes, et
// qu'aucun t('…') du code n'est absent d'ici. Ajouter une phrase = l'ajouter
// dans les quatre fichiers.
export default [
  // navigation, écrans, retours
  'Accueil', 'Plan', 'Exposants', 'Programme', 'Ma visite',
  'Le plan', 'Le programme', 'Les exposants', 'Préparer ma visite', "Besoin d'aide ?", 'Mes questions',
  'Plan du festival', 'Événement', 'Exposant', 'Page introuvable', "Cette page n'existe pas.", "Retour à l'accueil",
  'Langue', 'Aller au contenu', 'Chargement…', 'Cette application a besoin de JavaScript.',
  // types, formats, publics, niveaux, organisations, étages, points du plan
  'École', 'Pro', 'Entreprise', 'Ancien élève', 'Écoles', 'Pros', 'Entreprises', 'Anciens élèves',
  'Conférence', 'Table ronde', 'Atelier', 'Ouverture', 'Conférences', 'Tables rondes', 'Ateliers',
  'Tous', 'Collégiens', 'Lycéens', 'Étudiants', 'Parents', 'Tout public',
  '3e', '2nde', '1re', 'Terminale', 'étudiant', 'parent',
  'Université', 'Prépa', 'Lycée', 'CFA', 'UFA', 'Association',
  'Rez-de-chaussée', '1er étage', 'Étage',
  'Salle', 'Auditorium', 'Toilettes', 'Foodtruck', 'WC', 'Café', 'Confs', 'Entrée',
  // villages et domaines (noms longs et courts)
  'Santé & Soin', 'Commerce, Marketing & Management', 'Banque, Finance & Droit', 'Ingénierie, Industrie & Sciences',
  'Numérique & Cybersécurité', 'Communication, Médias & Création', 'Formations professionnelles',
  'Services, Éducation & Sécurité', 'Orientation générale',
  'Santé', 'Commerce', 'Finance & Droit', 'Ingénierie', 'Numérique', 'Médias & Création', 'Formations pro', 'Services', 'Orientation',
  'Village', 'village', 'Village à venir', 'Village %s', 'Zone %s',
  // lignes, gestes, filtres
  'Ajouter à ma visite', 'Retirer de ma visite', 'Dans ma visite', 'À visiter', 'Marquer comme fait',
  'salle à venir', 'stand %s', '%s min', 'Effacer la recherche', 'Filtres', 'Retirer le filtre %s',
  '%s résultat', '%s résultats', '%s au total', 'Domaine', 'Format', 'Public',
  'Filtrer par domaine', 'Filtrer par format', 'Filtrer par public',
  // accueil
  "Festival de l'Orientation", 'Date à confirmer', '%s à %s', "Aller à l'essentiel", 'Préparer et se repérer',
  '%s élément', '%s éléments', 'En ce moment', 'Prochain événement', 'Le festival commence par',
  'Par où commencer ?', "Choisis un domaine, on te montre son village et qui l'anime.", 'Ouverture du festival',
  // programme et événement
  '%s rendez-vous', 'et l’ouverture', 'Un domaine, une école, un intervenant',
  'Aucun événement ne correspond. Élargissez la recherche ou les filtres.',
  "Le programme arrive bientôt : les événements confirmés s'afficheront ici.",
  'Événement introuvable', "Cet événement n'est plus au programme, ou le lien est incomplet.", 'Voir le programme',
  'Changement', 'Quand', 'Où', 'Avec', 'heure à venir', 'Ajouter au calendrier', 'Voir la salle sur le plan',
  'Les intervenants', "Rappel 10 min avant, si l'appli est ouverte",
  // exposants et exposant
  "Type d'exposant", 'Un métier, un nom, une entreprise', 'Une école, une formation, une ville',
  '%s à rencontrer', 'dans %s village', 'dans %s villages',
  'Aucun exposant ne correspond. Élargissez la recherche ou les filtres.', 'La liste des exposants arrive bientôt.',
  'Exposant introuvable', "Cet exposant n'est pas (ou plus) dans la liste, ou le lien est incomplet.", 'Voir les exposants',
  'Carte pas encore attribuée',
  "Rejouer depuis le début (essai)", "Rejouer depuis le début", "Rejouer n'est possible que pendant l'essai du Grand Défi.", "Pour l'essai du Grand Défi : ce téléphone redevient un nouveau joueur, comme s'il ouvrait l'appli pour la première fois.", "Les points de ce téléphone (%s) sont effacés.", "Les défis redeviennent à faire.", "Ma visite et vos questions restent.", "Tout effacer et rejouer", "Annuler", "Ce bouton n'existe que pendant l'essai : il disparaîtra avant le festival.", "Cette carte n'est pas encore attribuée à un stand. Un organisateur peut vous aider.",
  'Vous venez de scanner le QR code du stand', 'Formations', 'Métier', 'Métiers', 'Parcours',
  'Niveau', 'Ville', 'Présent', 'Formations présentées', 'Voir sur le plan', 'Intervient aussi',
  // plan
  'Voir la fiche', "Voir l'événement", "Rien trouvé. Essayez le numéro de la salle ou le nom de l'école.",
  '%s exposant ici', '%s exposants ici', "Aucun exposant dans cette salle pour l'instant", 'Voir tout le village %s %s',
  'Événements dans cette salle', 'Le plan en liste (villages et salles)', 'salles à venir', "Rien à cet étage pour l'instant.",
  'Une salle, une école, un événement',
  "Plan de l'Ensemble Scolaire Maurice Rondeau : %s", 'La liste équivalente est dans la fiche, sous le plan.',
  "Vue d'ensemble", 'Fermer le plan', 'Ouvrir le plan : %s', 'La fiche', 'Agrandir ou réduire la fiche', 'Villages',
  '%s village', '%s villages', '%s salle', '%s salles', 'Salles à localiser',
  "Deux étages empilés : touchez un étage pour l'ouvrir, une salle pour la voir.",
  // les repères extérieurs du relevé (batiment.js), seuls textes de la géométrie
  'Arrêt bus 26 · 44 · 46', 'Arrêt bus 26 (Bussy)', 'RER A',
  'Zoomer', 'Dézoomer', 'Recentrer le plan', 'Salles', 'et', 'Salles à venir.', 'Événements',
  "Rien n'est encore affecté à ce village.",
  "demandez à l'accueil", 'salle à localiser',
  // ma visite
  '%s stand', '%s stands', 'Votre carnet de visite', "n'est plus au programme",
  'deux événements en même temps. Gardez-en un.', 'Rendez-vous à heure fixe', "Stands à visiter quand j'ai un créneau",
  "Rien pour l'instant. Touchez l'étoile sur un événement ou un exposant pour construire votre matinée.",
  'Mes questions à poser', "Ma visite reste dans ce téléphone. Rien n'est envoyé nulle part.",
  '%s au lieu de %s', '(sans salle)', 'commence à %s au lieu de %s', 'finit à %s au lieu de %s',
  // préparer
  'Me situer', 'Ma sélection', 'Étapes de la préparation', 'Étape %s sur %s',
  'Questions à poser à une école', 'Questions à poser à un pro', 'Questions à poser à une entreprise', 'Questions à poser à un ancien élève',
  'Pour une école', 'Pour un pro', 'Pour une entreprise', 'Pour un ancien élève',
  'Les questions types arrivent bientôt.', 'Cochez les questions posées : vos coches restent dans le téléphone.',
  'À avoir sous les yeux devant le stand', 'Toutes les questions',
  'Je suis', "Ce qui m'intéresse", "Centres d'intérêt",
  '%s exposant', '%s exposants', '%s événement', '%s événements', '%s et %s correspondent à ce que vous avez dit.',
  'Revenir à une sélection courte', 'Tout voir',
  "Rien ne correspond encore. Revenez à l'étape précédente et élargissez vos centres d'intérêt.",
  'Votre carnet est prêt. Le jour du festival, gardez-le ouvert : il vous dit quoi faire et quand.',
  'Ouvrir ma visite', 'Voir le plan',
  // besoin d'aide
  "Où est l'accueil ?", "À l'entrée du lycée", 'Où sont les toilettes ?', "Près de l'accueil", 'Où prendre un café ?',
  'Comment retrouver une salle ?', "Tapez son numéro ou le nom de l'école dans le plan : la salle s'allume en orange.",
  'Qui contacter ?', "L'équipe APEL à l'accueil, village 1", 'Infos pratiques', 'Horaires', 'entrée libre',
  'Adresse', 'RER', 'Bus', 'Parking', 'Restauration', 'Wifi', "Ouvrir l'itinéraire", 'Et aussi',
  'Règlement du festival', 'Lire le règlement', 'Donner mon avis', "Deux minutes, pour nous aider à faire mieux l'an prochain.",
  'Le questionnaire de satisfaction sera disponible le jour du festival.', 'Vie privée',
  "L'appli compte de façon anonyme les écrans consultés, pour préparer le festival de l'an prochain : aucun nom, aucun contact, aucune position. Ce que vous ajoutez à « Ma visite » reste sur votre téléphone.", "Statistiques anonymes", "Elles comptent les écrans consultés pour préparer le festival de l'an prochain. Aucun nom, aucun contact, aucune position.", "Désactivées sur ce téléphone : plus rien ne part.", "Ne pas envoyer de statistiques", "Réactiver les statistiques",
  // pied de page et messages
  'Mis à jour le %s à %s (%s)', 'tableur', 'classeur public', 'version embarquée', 'dernière version connue',
  'lecture en direct en échec, nouvel essai bientôt', 'source %s refusée (%s)', 'version %s', 'cache périmé %s',
  '%s changement', '%s changements',
  'Retiré de ma visite : %s', '★ Ajouté à ma visite : %s', '★ Ajouté, mais à la même heure que « %s »', 'un autre événement', 'Voir',
  'Date du festival inconnue : impossible de créer le rappel.', 'Fermer', 'Fermer ce message',
  'Dans %s min', 'Nouvelle version disponible.', 'Recharger',
  'Version de recette : le programme et les salles sont en partie fictifs.',
  // Grand Défi
  'Mon grand défi', '+%s points en attente', 'Grand Défi', 'Défi %s', 'Valider', 'Validé', 'En attente', 'Refusé',
  // Grand Défi : tous les défis par scan (grand-defi 02)
  "Mes défis", "À faire", "Déjà utilisé pour le défi %s", "Domaine déjà croisé", "Scannez d’abord un autre stand", "Pas pour ce stand", "QR d’une école", "QR d’un pro", "QR d’une entreprise", "QR d’un ancien élève", "QR du stand %s", "QR d’un stand d’un domaine encore jamais scanné", "pas le même que pour le défi %s", "Un même scan valide plusieurs défis ici.", "Votre choix : %s", "Mon carnet", "Ce que je retiens de ce stand…", "Reste sur ce téléphone : rien n’est envoyé.", "Le Grand Défi n’est pas ouvert.",
  // Grand Défi : scanner depuis l'appli (grand-defi 10)
  'Scanner un QR', 'Scannez les QR des stands pour gagner des points.', 'Visez le QR code du stand.', 'Déjà gagné chez %s', 'Déjà gagné', 'Ouverture de la caméra…', 'Caméra refusée : autorisez-la dans les réglages du navigateur.', 'Pas de caméra disponible sur cet appareil.', 'Ce QR code n’est pas celui d’un stand du festival.',
  // Grand Défi : Chances, Paliers, badge, Règle du jeu (grand-defi 03)
  "Règle du jeu", "Au tirage", "%s chance", "%s chances", "Prochaine chance : plus que %s point", "Prochaine chance : plus que %s points", "Badge Explorateur 100 %", "+%s chance", "+%s chances", "Scannez les QR des chevalets pour gagner des points.", "À %s points, vous êtes au tirage de %s.", "À %s points, vous êtes au tirage.", "Plus de points, plus de chances.", "Tous les défis", "Soyez vigilant : plus de chances de gagner avec les instants gagnants, le défi mystère et les autres annonces.", "Lire le règlement du jeu",
];
