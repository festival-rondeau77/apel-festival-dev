// Module Stats : la file de mesures anonymes. Logique pure ; le stockage,
// l'horloge, l'aléa et l'envoi sont injectés. Aucun envoi ne bloque l'interface ;
// un échec remet la salve en file (avec plafond) ; un refus définitif vide la file.

export const CLE_FILE = 'festival.stats.file';
export const CLE_APPAREIL = 'festival.appareil';
const LONGUEUR_CIBLE = 120;
const LONGUEUR_DETAIL = 80;
const LONGUEUR_ORIGINE = 80;

export const ACTIONS = [
  'ouverture', 'ecran', 'fiche_evenement', 'fiche_exposant', 'recherche', 'visite_ajout', 'visite_retrait',
  'qr_scan', 'clic_avis', 'clic_site', 'calendrier', 'donnees_changees',
];

function tronquer(v, n) {
  const t = v === null || v === undefined ? '' : String(v);
  return t.length > n ? t.slice(0, n) : t;
}

// La plateforme, en trois seaux et rien de plus : c'est ce qui décide s'il faudra
// un jour une application native, et laquelle en premier. On ne garde ni la version
// du système, ni le modèle, ni rien qui rapprocherait deux visites — un seau parmi
// trois n'identifie personne, là où un user-agent complet est une empreinte.
// iPadOS 13+ se déclare « Macintosh » : c'est l'écran tactile qui le trahit.
export function plateforme(ua, pointsTactiles = 0) {
  const t = String(ua || '');
  if (/iPad|iPhone|iPod/.test(t)) return 'ios';
  if (/Macintosh/.test(t) && pointsTactiles > 1) return 'ios';
  if (/Android/.test(t)) return 'android';
  return 'autre';
}

export function identifiantAleatoire(aleatoire) {
  if (aleatoire) return aleatoire();
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

// stockage : { getItem, setItem } ; horloge : () → ms ; envoyer : (salve) → Promise<{ ok, definitif }>.
export function creerStats({ stockage, horloge = () => Date.now(), envoyer, aleatoire, origine = '', plafond = 500, taille = 50 } = {}) {
  // L'origine voyage par salve, pas par mesure : c'est une propriété de
  // l'expéditeur, comme l'appareil. Elle sépare la recette du vrai — sans elle,
  // notre navigation de mise au point se mélange aux mesures des visiteurs dans
  // le même onglet, et plus rien n'est séparable après coup.
  const dou = tronquer(origine, LONGUEUR_ORIGINE);
  const lire = (cle) => { try { return stockage.getItem(cle); } catch { return null; } };
  const ecrire = (cle, v) => { try { stockage.setItem(cle, v); } catch { /* stockage indisponible : on continue en mémoire */ } };

  let appareil = lire(CLE_APPAREIL);
  if (!appareil) { appareil = identifiantAleatoire(aleatoire); ecrire(CLE_APPAREIL, appareil); }

  let file = [];
  try { const brut = JSON.parse(lire(CLE_FILE) || '[]'); if (Array.isArray(brut)) file = brut.filter((m) => m && typeof m.action === 'string'); } catch { file = []; }
  let enCours = false;

  function persister() { ecrire(CLE_FILE, JSON.stringify(file)); }

  function noter(action, cible = '', detail = '') {
    if (!action) return;
    file.push({ t: horloge(), action: tronquer(action, 40), cible: tronquer(cible, LONGUEUR_CIBLE), detail: tronquer(detail, LONGUEUR_DETAIL) });
    if (file.length > plafond) file = file.slice(file.length - plafond);
    persister();
  }

  // Vide la file par salves. Renvoie le nombre de mesures envoyées.
  async function vider() {
    if (enCours || !envoyer || file.length === 0) return 0;
    enCours = true;
    let envoyees = 0;
    try {
      while (file.length) {
        const salve = file.slice(0, taille);
        let resultat;
        try { resultat = await envoyer({ appareil, origine: dou, mesures: salve }); } catch { resultat = { ok: false, definitif: false }; }
        if (resultat && resultat.ok) {
          file = file.slice(salve.length);
          envoyees += salve.length;
          persister();
        } else if (resultat && resultat.definitif) {
          file = [];
          persister();
          break;
        } else {
          break; // on garde la salve en file pour plus tard
        }
      }
    } finally { enCours = false; }
    return envoyees;
  }

  // Une salve prête pour sendBeacon au passage en arrière-plan (la file est vidée de ce qui part).
  function preleverSalve() {
    const salve = file.slice(0, taille);
    file = file.slice(salve.length);
    persister();
    return { appareil, origine: dou, mesures: salve };
  }

  function remettre(salve) {
    file = [...(salve.mesures || []), ...file].slice(-plafond);
    persister();
  }

  return { appareil, noter, vider, preleverSalve, remettre, file: () => file.slice(), taille: () => file.length };
}
