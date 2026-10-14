// Le rideau (ticket teaser 02) : jusqu'à l'ouverture de l'appli, la page de garde du site est le
// teaser (teaser.html) ; l'appli reste derrière, pour les testeurs. Script classique (pas un
// module), chargé en tête d'index.html ET de teaser.html avant tout le reste : la décision se
// prend avant que l'appli ne démarre, et la CSP d'index.html n'admet pas de script en ligne.
//
// La date d'ouverture vit ICI, une seule fois, pour les deux pages : le compte à rebours du
// teaser la lit (window.FESTIVAL_OUVERTURE) et le rideau tombe tout seul à cet instant, sans
// publication. Passent quand même, avant l'heure : le téléphone marqué testeur (« ?testeurs »
// une fois, puis localStorage), la machine de développement, et toute route profonde
// (#/carte/…, #/programme) — le scan d'une Carte ouvre une vue web sans localStorage partagé.
// Après l'heure, teaser.html renvoie à l'appli.
(function (fenetre) {
  // Samedi 7 novembre 2026 à 9 h, heure de Paris (+01:00 : heure d'hiver depuis le 25 octobre).
  // Décision de l'utilisateur du 2026-10-14. Une valeur ISO avec son décalage : le téléphone
  // d'un testeur réglé ailleurs bascule au même instant.
  var OUVERTURE = '2026-11-07T09:00:00+01:00';
  var CLE_TESTEUR = 'festival.testeur';
  var LOCAL = ['localhost', '127.0.0.1', '[::1]'];

  // Pure : 'teaser' (aller au teaser), 'appli' (le teaser renvoie à l'appli), 'reste' (ne rien faire).
  function decider(ctx) {
    var ouvert = ctx.maintenant >= Date.parse(OUVERTURE);
    var route = String(ctx.hash || '').replace(/^#\/?/, '');
    if (ctx.surTeaser) return ouvert ? 'appli' : 'reste';
    if (ouvert || ctx.testeur || ctx.local || route) return 'reste';
    return 'teaser';
  }

  fenetre.FESTIVAL_OUVERTURE = OUVERTURE;
  fenetre.FESTIVAL_RIDEAU = { OUVERTURE: OUVERTURE, CLE_TESTEUR: CLE_TESTEUR, decider: decider };
  var loc = fenetre.location;
  if (!loc || typeof loc.replace !== 'function') return; // tests Node : seule la fonction pure sert

  var testeur = false, marque = /[?&]testeurs(?=&|=|$)/.test(loc.search);
  try {
    if (marque) fenetre.localStorage.setItem(CLE_TESTEUR, '1');
    testeur = fenetre.localStorage.getItem(CLE_TESTEUR) === '1';
  } catch (e) { testeur = marque; } // stockage refusé (navigation privée stricte) : la marque vaut pour cette page
  // « ?testeurs » seul disparaît de l'adresse, pour qu'elle ne soit pas recopiée telle quelle.
  if (marque && loc.search === '?testeurs' && fenetre.history && fenetre.history.replaceState) {
    try { fenetre.history.replaceState(null, '', loc.pathname + loc.hash); } catch (e) {}
  }
  var decision = decider({
    maintenant: Date.now(), hash: loc.hash, testeur: testeur,
    surTeaser: /\/teaser\.html$/.test(loc.pathname), local: LOCAL.indexOf(loc.hostname) !== -1,
  });
  if (decision === 'teaser') loc.replace('./teaser.html');
  else if (decision === 'appli') loc.replace('./' + loc.hash);
})(typeof window !== 'undefined' ? window : globalThis);
