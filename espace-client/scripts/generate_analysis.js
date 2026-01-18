/* ======================================================
   IMPORTS
====================================================== */

import fs from "fs";
import path from "path";

/* ======================================================
   CONSTANTES
====================================================== */

const BASE_DIR = "espace-client";
const BIENS_DIR = path.join(BASE_DIR, "biens");

/* ======================================================
   OUTILS GÉNÉRAUX
====================================================== */

function daysBetween(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return null;

  const now = new Date();
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ======================================================
   RÈGLES MÉTIER – STATS
====================================================== */

// Détection changement mise en ligne
function hasMiseEnLigneChanged(previousISO, currentISO) {
  if (!previousISO || !currentISO) return false;
  return previousISO !== currentISO;
}

// Reset TOTAL des stats actuelles
function resetStatsActuel(stats) {
  if (!stats?.actuel) return;

  stats.actuel.appels = 0;
  stats.actuel.emails = 0;
  stats.actuel.visites_effectuees = 0;
  stats.actuel.offres = 0;
  stats.actuel.vues_leboncoin = 0;
  stats.actuel.favoris_leboncoin = 0;
  // visites_programmees volontairement NON reset
}

// ✅ CUMUL DIFFÉRENTIEL (LA CLÉ)
function updateCumulDifferential(stats, meta) {
  if (!stats || !meta) return;

  const KEYS = [
    "appels",
    "emails",
    "visites_effectuees",
    "offres",
    "vues_leboncoin",
    "favoris_leboncoin"
  ];

  stats.cumul = stats.cumul || {};
  stats.actuel = stats.actuel || {};
  meta.previous_stats_actuel = meta.previous_stats_actuel || {};

  KEYS.forEach(key => {
    const current = toNumber(stats.actuel[key]);
    const previous = toNumber(meta.previous_stats_actuel[key]);
    const delta = current - previous;

    if (!Number.isFinite(stats.cumul[key])) {
      stats.cumul[key] = 0;
    }

    // ➕ on ajoute UNIQUEMENT la différence positive
    if (delta > 0) {
      stats.cumul[key] += delta;
    }
  });
}

// Sauvegarde de l’état actuel pour la prochaine exécution
function storePreviousStatsActuel(stats, meta) {
  meta.previous_stats_actuel = {
    appels: toNumber(stats.actuel?.appels),
    emails: toNumber(stats.actuel?.emails),
    visites_effectuees: toNumber(stats.actuel?.visites_effectuees),
    offres: toNumber(stats.actuel?.offres),
    vues_leboncoin: toNumber(stats.actuel?.vues_leboncoin),
    favoris_leboncoin: toNumber(stats.actuel?.favoris_leboncoin)
  };
}

/* ======================================================
   HISTORIQUE AUTOMATIQUE
====================================================== */

function syncHistoriqueFromDates(data) {
  if (!data) return;

  data.historique = Array.isArray(data.historique)
    ? data.historique
    : [];

  const exists = action =>
    data.historique.some(h => h.action === action);

  if (data.dates?.mandat_signe && !exists("✍️ Mandat signé")) {
    data.historique.push({
      date: data.dates.mandat_signe,
      action: "✍️ Mandat signé"
    });
  }

  if (data.dates?.mise_en_ligne && !exists("📢 Mise en ligne de l’annonce")) {
    data.historique.push({
      date: data.dates.mise_en_ligne,
      action: "📢 Mise en ligne de l’annonce"
    });
  }
}

/* ======================================================
   ANALYSE STRATÉGIQUE
====================================================== */

function buildAnalysis(data) {
  const jours = daysBetween(data.dates?.mise_en_ligne);

  if (jours === null) {
    return {
      text: "Analyse indisponible : date de mise en ligne manquante.",
      proposeRDV: false,
      noAlertes: false
    };
  }

  if (jours < 21) {
    return {
      text: `Le bien est en commercialisation depuis ${jours} jours.\n\nPhase normale de diffusion.`,
      proposeRDV: false,
      noAlertes: false
    };
  }

  return {
    text: `Le bien est en commercialisation depuis ${jours} jours.\n\nAnalyse basée sur les performances cumulées.`,
    proposeRDV: false,
    noAlertes: false
  };
}

/* ======================================================
   EXÉCUTION
====================================================== */

if (!fs.existsSync(BIENS_DIR)) {
  console.error("❌ Dossier biens introuvable");
  process.exit(1);
}

const fichiers = fs.readdirSync(BIENS_DIR).filter(f =>
  f.endsWith("_data.json")
);

for (const fichier of fichiers) {
  const filePath = path.join(BIENS_DIR, fichier);
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  data._meta = data._meta || {};

  syncHistoriqueFromDates(data);

  const previous = data._meta.previous_mise_en_ligne || null;
  const current = data.dates?.mise_en_ligne || null;
  const changed = hasMiseEnLigneChanged(previous, current);

  // 🔄 reset uniquement si mise en ligne modifiée
  if (changed) {
    resetStatsActuel(data.stats);
    data._meta.previous_stats_actuel = {};
  }

  // ➕ CUMUL PAR DIFFÉRENCE
  updateCumulDifferential(data.stats, data._meta);

  // 🧠 mémorisation de l’état actuel
  storePreviousStatsActuel(data.stats, data._meta);

  data.analysis = {
    ...buildAnalysis(data),
    generatedAt: new Date().toISOString()
  };

  data._meta.previous_mise_en_ligne = current;

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`✔ Analyse mise à jour : ${fichier}`);
}
