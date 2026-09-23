// Module Défis : les règles du Grand Défi, lues du tableur (ADR-0015). Logique
// pure, partagée : le téléphone s'en sert pour PROPOSER un défi, le Worker
// (worker/src/index.js l'importe tel quel) pour le JUGER. Un Défi est une ligne de
// l'onglet `Défis` : un Type de preuve et ses paramètres. Un réglage invalide
// désactive son défi et dit pourquoi ; il ne casse jamais le reste.
import { tablesEnObjets, normaliser, slugType, typeExposantCanonique, TYPES_EXPOSANT } from './donnees.js';

export const OBJECTIF_PAR_DEFAUT = 100;
const ID = /^[a-z0-9-]{1,20}$/i;
const OUI = ['oui', 'vrai', 'true', 'x', '1'];
const NON = ['non', 'faux', 'false', '0'];

const texte = (v) => (v === null || v === undefined ? '' : String(v).trim());
const oui = (v) => v === true || OUI.includes(normaliser(v));
const non = (v) => v === false || NON.includes(normaliser(v));

// Un Type de preuve : lire ses paramètres dans la ligne (ou dire ce qui cloche),
// dire si un exposant scanné peut le prouver, juger une validation reçue. Un
// mécanisme vraiment nouveau est un type de plus ici, sans toucher aux autres.
export const TYPES_PREUVE = {
  'scan-exposant': {
    lireParams(l) {
      const brut = texte(l.type_exposant);
      if (!brut) return { motif: 'type_exposant vide' };
      const canon = typeExposantCanonique(brut);
      if (!TYPES_EXPOSANT.includes(canon)) return { motif: `type_exposant inconnu : ${brut}` };
      return { params: { type_exposant: slugType(canon) } };
    },
    proposable: (defi, exposant) => typeof exposant === 'string' && exposant.startsWith(`${defi.params.type_exposant}:`),
    juger(v, defi, { exposant }) {
      if (!v.preuve || !v.preuve.secret) return 'preuve attendue';
      if (!exposant) return 'secret inconnu';
      if (!this.proposable(defi, exposant)) return 'exposant d’un autre type';
      return '';
    },
  },
};

function lireObjectif(valeur) {
  const premier = Number(texte(valeur).split(/[;,\s]+/)[0]);
  return Number.isInteger(premier) && premier > 0 ? premier : OBJECTIF_PAR_DEFAUT;
}

// Les onglets `Défis` et `Infos` (tables brutes, première ligne = en-têtes) → le jeu.
// `defis` garde aussi les défis désactivés (leurs points comptent toujours) ;
// `invalides` liste ce qui a été écarté, avec le motif.
export function lireJeu(tableDefis, tableInfos) {
  const infos = {};
  for (const l of tablesEnObjets(tableInfos)) infos[normaliser(l.cle).replace(/-/g, '_')] = l.valeur;
  const jeu = { actif: oui(infos.grand_defi), objectif: lireObjectif(infos.paliers), defis: [], invalides: [] };
  const entetes = Array.isArray(tableDefis) && Array.isArray(tableDefis[0]) ? tableDefis[0].map((e) => normaliser(e).replace(/-/g, '_')) : [];
  // gviz rend la PREMIÈRE feuille quand l'onglet demandé n'existe pas : sans ces
  // en-têtes, ce n'est pas l'onglet Défis, et il n'y a pas de jeu.
  if (!['id', 'titre', 'points', 'type_preuve'].every((c) => entetes.includes(c))) {
    jeu.invalides.push({ id: '', motif: 'onglet Défis absent ou sans ses en-têtes (id, titre, points, type_preuve)' });
    return jeu;
  }
  const vus = new Set();
  for (const l of tablesEnObjets(tableDefis)) {
    const id = texte(l.id);
    if (!id) continue;
    const ecarter = (motif) => jeu.invalides.push({ id, motif });
    if (!ID.test(id)) { ecarter('identifiant illisible (lettres, chiffres, tirets)'); continue; }
    if (vus.has(id)) { ecarter('identifiant en double'); continue; }
    vus.add(id);
    const points = texte(l.points) === '' ? NaN : Number(l.points);
    if (!Number.isInteger(points) || points < 0 || points > 1000) { ecarter(`points illisibles : « ${texte(l.points)} »`); continue; }
    const type = TYPES_PREUVE[normaliser(l.type_preuve)];
    if (!type) { ecarter(`type de preuve inconnu : « ${texte(l.type_preuve)} »`); continue; }
    const { params, motif } = type.lireParams(l);
    if (motif) { ecarter(motif); continue; }
    jeu.defis.push({ id, titre: texte(l.titre), points, type_preuve: normaliser(l.type_preuve), actif: !non(l.actif), params });
  }
  return jeu;
}

// Ce que le téléphone reçoit : les défis actifs et leurs réglages publics. Sans
// défi actif, pas de jeu à l'écran.
export function jeuPublic(jeu) {
  const defis = jeu.defis.filter((d) => d.actif).map(({ actif, ...d }) => d);
  return { actif: jeu.actif && defis.length > 0, objectif: jeu.objectif, defis };
}

export function proposable(defi, exposant) {
  const type = TYPES_PREUVE[defi && defi.type_preuve];
  return Boolean(type && type.proposable(defi, exposant));
}

// Le verdict sur une validation : { statut: ok | deja | refus, motif }.
// `exposant` est la clé de l'Exposant dont le secret a été présenté (null si
// inconnu) ; `faits`, les défis déjà validés par ce Passeport.
export function juger(v, { jeu, exposant = null, faits = new Set() }) {
  const refus = (motif) => ({ statut: 'refus', motif });
  if (!jeu.actif) return refus('jeu coupé');
  const defi = jeu.defis.find((d) => d.id === v.defi && d.actif);
  if (!defi) return refus('défi inconnu ou inactif');
  const motif = TYPES_PREUVE[defi.type_preuve].juger(v, defi, { exposant });
  if (motif) return refus(motif);
  if (faits.has(defi.id)) return { statut: 'deja', motif: '' };
  return { statut: 'ok', motif: '' };
}

// Les points d'un Passeport, avec les points du tableur du moment (ADR-0015) :
// une correction le jour J profite à tous.
export function pointsDe(idsValides, jeu) {
  const parId = new Map(jeu.defis.map((d) => [d.id, d.points]));
  return [...new Set(idsValides)].reduce((s, id) => s + (parId.get(id) || 0), 0);
}
