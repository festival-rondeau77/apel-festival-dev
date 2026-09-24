// Module Stats : la file de mesures anonymes. Logique pure ; le stockage,
// l'horloge, l'aléa et l'envoi sont injectés. Aucun envoi ne bloque l'interface ;
// un échec remet la salve en file (avec plafond) ; un refus définitif vide la file.

import { normaliser } from './donnees.js';

export const CLE_FILE = 'festival.stats.file';
// L'identifiant du PASSEPORT du Grand Défi (ADR-0014). Jusqu'au 2026-09-24 il servait
// aussi aux mesures ; il ne sert plus qu'au jeu (sécurité 05), et les téléphones qui
// l'avaient gardent leurs points.
export const CLE_APPAREIL = 'festival.appareil';
// L'identifiant des MESURES : { id, jour }, renouvelé chaque jour (sécurité 05). On compte
// les téléphones d'une journée, jamais le parcours d'une personne d'un jour à l'autre.
export const CLE_APPAREIL_STATS = 'festival.stats.appareil';
// « Ne pas envoyer de statistiques » (Besoin d'aide ?), mémorisé sur le téléphone.
export const CLE_REFUS = 'festival.stats.refus';
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

// Le script refuse une salve entière si une cible ou un détail ressemble à une
// formule de tableur (sécurité 02 : worker/src/mesures.js, texteSur). Une recherche
// tapée « =maths » ou « -bts » ferait donc perdre toutes les mesures qui
// l'accompagnent : on la ramène ici à ce que le script accepte. Ce n'est PAS la
// protection (un attaquant n'utilise pas l'appli), seulement de quoi ne rien perdre.
const HORS_TEXTE = /[^\p{L}\p{M}\p{N} .,:;'’·&()\/?!«»"#%+@_-]/gu;
export function nettoyer(v, n) {
  const t = v === null || v === undefined ? '' : String(v);
  return tronquer(t.replace(HORS_TEXTE, '').replace(/^[\s=+\-@]+/, ''), n);
}

// Ce qu'une recherche envoie (sécurité 05) : le terme tapé seulement s'il fait partie
// du vocabulaire du festival (noms d'exposants, domaines, formations, titres…), sinon
// « autre ». Un élève peut taper un nom ou un numéro ; ça ne quitte pas le téléphone.
// Le nombre de résultats, lui, part toujours (« ce qui manquait »).
export function termeDeRecherche(texte, vocabulaire) {
  const terme = normaliser(texte);
  if (!terme) return '';
  if (terme.length < 3) return 'autre';
  return (vocabulaire || []).some((v) => normaliser(v).includes(terme)) ? terme : 'autre';
}

// Le jour civil du téléphone, AAAA-MM-JJ.
function jourDe(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

  // L'identifiant des mesures du jour : relu à chaque salve, pour changer à minuit.
  function appareilDuJour() {
    const jour = jourDe(horloge());
    let courant = null;
    try { courant = JSON.parse(lire(CLE_APPAREIL_STATS) || 'null'); } catch { courant = null; }
    if (courant && courant.jour === jour && typeof courant.id === 'string') return courant.id;
    const id = identifiantAleatoire(aleatoire);
    ecrire(CLE_APPAREIL_STATS, JSON.stringify({ id, jour }));
    return id;
  }
  const refusees = () => lire(CLE_REFUS) === '1';

  let file = [];
  try { const brut = JSON.parse(lire(CLE_FILE) || '[]'); if (Array.isArray(brut)) file = brut.filter((m) => m && typeof m.action === 'string'); } catch { file = []; }
  let enCours = false;

  function persister() { ecrire(CLE_FILE, JSON.stringify(file)); }

  function noter(action, cible = '', detail = '') {
    if (!action || refusees()) return;
    file.push({ t: horloge(), action: tronquer(action, 40), cible: nettoyer(cible, LONGUEUR_CIBLE), detail: nettoyer(detail, LONGUEUR_DETAIL) });
    if (file.length > plafond) file = file.slice(file.length - plafond);
    persister();
  }

  // Vide la file par salves. Renvoie le nombre de mesures envoyées.
  async function vider() {
    if (enCours || !envoyer || file.length === 0 || refusees()) return 0;
    enCours = true;
    let envoyees = 0;
    try {
      while (file.length) {
        const salve = file.slice(0, taille);
        let resultat;
        try { resultat = await envoyer({ appareil: appareilDuJour(), origine: dou, mesures: salve }); } catch { resultat = { ok: false, definitif: false }; }
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
    return { appareil: appareilDuJour(), origine: dou, mesures: salve };
  }

  function remettre(salve) {
    file = [...(salve.mesures || []), ...file].slice(-plafond);
    persister();
  }

  return {
    get appareil() { return appareilDuJour(); },
    noter, vider, preleverSalve, remettre, refusees,
    // Refuser jette aussi ce qui attendait : rien de noté avant le refus ne part après.
    refuser() { ecrire(CLE_REFUS, '1'); file = []; persister(); },
    accepter() { try { stockage.removeItem(CLE_REFUS); } catch { /* stockage indisponible */ } },
    file: () => file.slice(), taille: () => file.length,
  };
}
