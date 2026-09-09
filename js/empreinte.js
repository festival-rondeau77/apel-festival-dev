// Empreinte de version des six tables (les cinq du tableur et les traductions). Ce fichier existe en deux exemplaires
// identiques (au mot-clé `export` près) : app/js/empreinte.js pour l'appli et
// script/empreinte.js pour le script Apps Script. Un test vérifie qu'ils ne
// divergent pas : la même donnée doit donner la même empreinte des deux côtés.

var ORDRE_TABLES = ['exposants', 'evenements', 'salles', 'preparation', 'infos', 'traductions'];

function celluleCanonique(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

// Une table (tableau de lignes, chaque ligne un tableau de cellules) devient
// une chaîne : cellules vides de fin retirées, lignes vides ignorées.
function tableCanonique(lignes) {
  var sortie = [];
  (lignes || []).forEach(function (ligne) {
    var cellules = (ligne || []).map(celluleCanonique);
    while (cellules.length && cellules[cellules.length - 1] === '') cellules.pop();
    if (cellules.length) sortie.push(cellules.join(''));
  });
  return sortie.join('');
}

function canonique(tables) {
  return ORDRE_TABLES.map(function (nom) {
    return nom + '=' + tableCanonique(tables && tables[nom]);
  }).join('');
}

// cyrb53 : hachage 53 bits, rapide, sans dépendance, identique partout.
function cyrb53(str, seed) {
  var h1 = 0xdeadbeef ^ (seed || 0), h2 = 0x41c6ce57 ^ (seed || 0);
  for (var i = 0; i < str.length; i++) {
    var ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// L'empreinte : une courte chaîne en base 36, par exemple "1k2x9ab3cd".
export function empreinte(tables) {
  return cyrb53(canonique(tables)).toString(36);
}
