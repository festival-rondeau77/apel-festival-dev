// La page des résultats du questionnaire, pour l'APEL (ADR-0026, .scratch/questionnaire).
// Le code vient du lien (#c=<code>), ou se tape ; il est gardé sur cet appareil. Les
// réponses viennent du Worker (POST ?action=resultats) ; les comptes sont ceux de
// questionnaire.js (filtrer, synthese, enCsv), testés. `pageResultats` est pure ; le
// reste, en bas, touche le navigateur.
import { CONFIG } from './config.js';
import { urlJeu } from './passeport.js';
import { urlAction } from './sources.js';
import { QUESTIONS, filtrer, synthese, enCsv } from './questionnaire.js';

const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const Q = Object.fromEntries(QUESTIONS.map((q) => [q.cle, q]));
const virgule = (x, chiffres = 1) => (x === null || x === undefined ? '–' : x.toFixed(chiffres).replace('.', ','));
const pourcent = (x) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)} %`);
const nomJour = (iso) => { const [a, m, j] = String(iso).split('-').map(Number); return new Date(Date.UTC(a, m - 1, j)).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); };

export const PUBLICS = [['tous', 'Tout le monde'], ['eleves', 'Élèves'], ['parents', 'Parents']];
export const ETABLISSEMENTS = [['tous', 'Tous'], ...Q.etablissement.choix.map((c, i) => [String(i), c])];
const LIBELLES_TEXTES = [['suggestion', 'Les suggestions pour la prochaine édition'], ['manque_lesquels', 'Les formations et métiers demandés'], ['utile_autre', '« Autre » parmi ce qui a été utile'], ['manque_autre', '« Autre » parmi ce qui a manqué']];

// Une rangée de barres. `valeurs` : [{ libelle, valeur, texte }], `valeur` de 0 à 1 (la
// largeur, posée ensuite par le CSSOM : la CSP refuse les styles en ligne).
function barres(titre, valeurs, { classe = '', note = '' } = {}) {
  return `<section class="graphe ${classe}"><h3>${h(titre)}${note ? ` <small>${h(note)}</small>` : ''}</h3>
    ${valeurs.map((v) => `<div class="ligne-barre"><span>${h(v.libelle)}</span><span class="piste"><i data-part="${Math.round(Math.max(0, Math.min(1, v.valeur || 0)) * 1000) / 10}"></i></span><em>${h(v.texte)}</em></div>`).join('')}
  </section>`;
}

// La page pour des réponses (celles du Worker) et des filtres { public, etablissement, essais }.
export function pageResultats(donnees, filtres) {
  const toutes = donnees.reponses || [];
  const essais = toutes.filter((l) => l.essai).length;
  const lignes = filtrer(toutes, filtres);
  const s = synthese(lignes);
  const n = s.n;
  const parts = (q, comptes, sur = n) => q.choix.map((c, i) => ({ libelle: c, valeur: sur ? comptes[i] / sur : 0, texte: sur ? `${Math.round((comptes[i] / sur) * 100)} %` : '–' }));
  const bouton = (groupe, valeur, libelle, actif) => `<button type="button" data-groupe="${groupe}" data-valeur="${h(valeur)}" aria-pressed="${actif ? 'true' : 'false'}">${h(libelle)}</button>`;
  const jours = [...new Set(lignes.map((l) => l.jour))].sort();
  const textes = LIBELLES_TEXTES.map(([champ, titre]) => {
    const liste = s.textes.filter((x) => x.champ === champ);
    const qui = (x) => [Number.isInteger(x.profil) ? Q.profil.choix[x.profil] : '', Number.isInteger(x.etablissement) ? Q.etablissement.choix[x.etablissement] : '', nomJour(x.jour)].filter(Boolean).join(' · ');
    return `<section class="graphe"><h3>${h(titre)} <small>(${liste.length})</small></h3>${liste.length
      ? `<ul>${liste.map((x) => `<li>${h(x.texte)}<small>${h(qui(x))}</small></li>`).join('')}</ul>` : '<p class="vide">Rien pour l’instant.</p>'}</section>`;
  }).join('');
  return `<div class="barre">
      <div class="filtres">
        <div class="groupe" role="group" aria-label="Public"><span>Public</span>${PUBLICS.map(([v, l]) => bouton('public', v, l, filtres.public === v)).join('')}</div>
        <div class="groupe" role="group" aria-label="Établissement"><span>Établissement</span>${ETABLISSEMENTS.map(([v, l]) => bouton('etablissement', v, l, String(filtres.etablissement) === v)).join('')}</div>
        ${essais ? `<label class="essais"><input type="checkbox" id="essais"${filtres.essais ? ' checked' : ''}> Compter les ${essais} réponses d’essai (avant l’ouverture)</label>` : ''}
      </div>
      <div class="actions"><button type="button" class="excel" data-action="excel">Télécharger en Excel</button><button type="button" class="secondaire" data-action="actualiser">Actualiser</button></div>
    </div>
    <div class="chiffres">
      <div><b>${n}</b><span>${n > 1 ? 'réponses' : 'réponse'}</span></div>
      <div><b>${virgule(s.satisfaction)} / 5</b><span>satisfaction globale</span></div>
      <div><b>${pourcent(s.aides)}</b><span>aidés « beaucoup » ou « assez » dans leur réflexion</span></div>
      <div><b>${virgule(s.appli)} / 5</b><span>pour l’application du Festival</span></div>
    </div>
    <h2>Les réponses</h2>
    <div class="graphes">
      ${barres(Q.satisfaction.titre, s.notes.map((c, i) => ({ libelle: `${i + 1}${i === 0 ? ' · pas du tout' : i === 4 ? ' · très satisfait(e)' : ''}`, valeur: n ? c / n : 0, texte: String(c) })), { classe: 'f' })}
      ${barres(Q.aspects.titre, Q.aspects.lignes.map((l, i) => ({ libelle: l, valeur: s.aspects[i] === null ? 0 : s.aspects[i] / 5, texte: virgule(s.aspects[i]) })), { classe: 'f', note: 'moyenne sur 5, sans les « Sans avis »' })}
      ${barres(Q.utile.titre, parts(Q.utile, s.compte.utile), { note: '3 au plus' })}
      ${barres(Q.manque.titre, parts(Q.manque, s.compte.manque), { classe: 'a' })}
      ${barres(Q.reflexion.titre, parts(Q.reflexion, s.compte.reflexion))}
      ${barres(Q.connu.titre, parts(Q.connu, s.compte.connu))}
      ${barres(Q.profil.titre, parts(Q.profil, s.compte.profil))}
      ${barres(Q.etablissement.titre, parts(Q.etablissement, s.compte.etablissement))}
      ${jours.length ? barres('Par jour', jours.map((j) => { const c = lignes.filter((l) => l.jour === j).length; return { libelle: nomJour(j), valeur: n ? c / n : 0, texte: String(c) }; })) : ''}
    </div>
    <h2>Ce qu’ils ont écrit</h2>
    <div class="textes">${textes}</div>
    <p class="pied">Réponses anonymes : ni nom, ni e-mail, ni heure, ni téléphone n’est gardé avec elles ; seulement le jour. Le fichier Excel contient une ligne par réponse.</p>`;
}

// ---------------------------------------------------------------- le navigateur

if (typeof document !== 'undefined') {
  const CLE = 'festival.resultats.code';
  const JEU = urlJeu(location.hostname, CONFIG.jeuUrl);
  const $ = (id) => document.getElementById(id);
  const filtres = { public: 'tous', etablissement: 'tous', essais: false };
  let donnees = null;
  let code = '';
  const lien = /(?:^#|&)c=([^&]+)/.exec(location.hash);
  try { code = lien ? decodeURIComponent(lien[1]) : localStorage.getItem(CLE) || ''; } catch { code = lien ? decodeURIComponent(lien[1]) : ''; }
  if (lien) history.replaceState(null, '', location.pathname); // le code ne reste pas dans la barre d'adresse

  const dessiner = () => {
    if (!donnees) return;
    $('resultats').innerHTML = pageResultats(donnees, filtres);
    for (const i of $('resultats').querySelectorAll('[data-part]')) i.style.width = `${Number(i.dataset.part) || 0}%`;
    $('resultats').hidden = false;
  };
  const demanderCode = (message = '') => { $('acces').hidden = false; $('resultats').hidden = true; $('acces-erreur').textContent = message; $('maj').textContent = ''; $('code').focus(); };

  async function charger() {
    if (!code) return demanderCode();
    if (!JEU) return demanderCode('Le jeu n’est pas configuré sur ce site.');
    try {
      const rep = await fetch(urlAction(JEU, 'resultats'), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ code }), cache: 'no-store' });
      if (rep.status === 403) { try { localStorage.removeItem(CLE); } catch { /* rien à oublier */ } code = ''; return demanderCode('Ce code n’est pas le bon.'); }
      if (rep.status === 503) { $('maj').textContent = 'Les résultats ne sont pas encore ouverts (code à poser : bin/jeu.sh resultats).'; return undefined; }
      if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
      donnees = await rep.json();
      try { localStorage.setItem(CLE, code); } catch { /* navigation privée : le code se retapera */ }
      $('acces').hidden = true;
      $('maj').textContent = `Mis à jour à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · ouvert aux visiteurs le ${donnees.ouverture ? new Date(donnees.ouverture).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' }) : '(date du festival à remplir dans Infos)'}`;
      dessiner();
    } catch {
      $('maj').textContent = 'Pas de réseau : nouvel essai dans une minute.';
    }
    return undefined;
  }

  function telecharger() {
    if (!donnees) return;
    const blob = new Blob([enCsv(filtrer(donnees.reponses, filtres))], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `questionnaire-festival-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  $('acces').addEventListener('submit', (e) => { e.preventDefault(); code = $('code').value.trim(); charger(); });
  $('resultats').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.groupe) { filtres[b.dataset.groupe] = b.dataset.valeur; dessiner(); }
    if (b.dataset.action === 'excel') telecharger();
    if (b.dataset.action === 'actualiser') charger();
  });
  $('resultats').addEventListener('change', (e) => { if (e.target.id === 'essais') { filtres.essais = e.target.checked; dessiner(); } });
  setInterval(() => { if (document.visibilityState === 'visible' && donnees) charger(); }, 60_000);
  charger();
}
