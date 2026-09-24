// Le diagnostic se lit sur le téléphone, sans câble : une erreur qui empêche le
// premier affichage remplace « Chargement… » par son message et sa ligne. Un fichier
// et non un <script> en ligne : la CSP (sécurité 06) refuse le JavaScript en ligne.
(function () {
  var montre = function (texte) {
    var m = document.querySelector('#ecran .maj');
    if (m && /^(Chargement|Loading|Cargando|加载)/.test(m.textContent)) { m.textContent = 'Erreur au démarrage : ' + texte; m.className = 'maj erreur'; }
  };
  window.addEventListener('error', function (e) { montre((e.message || 'inconnue') + (e.filename ? ' — ' + e.filename.split('/').pop() + ':' + e.lineno : '')); });
  window.addEventListener('unhandledrejection', function (e) { montre(String(e.reason && e.reason.message || e.reason || 'promesse rejetée')); });
})();
