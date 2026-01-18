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
   NOUVELLES RÈGLES MÉTIER
====================================================== */

// Détecte un changement de date de mise en ligne
function hasMiseEnLigneChanged(previousISO, currentISO) {
  if (!previousISO || !currentISO) return false;
  return previousISO !== currentISO;
}

// Reset TOTAL des stats actuelles (sauf visites_programmees)
function resetStatsActuel(stats) {
  if (!stats?.actuel) return;

  stats.actuel.appels = 0;
  stats.actuel.emails = 0;
  stats.actuel.visites_effectuees = 0;
  stats.actuel.offres = 0;
  stats.actuel.vues_leboncoin = 0;
  stats.actuel.favoris_leboncoin = 0;

  // volontairement NON reset
  // stats.actuel.visites_programmees
}

// Mise à jour du cumul selon la règle finale
function updateCumul(stats, miseEnLigneChanged) {
  if (!stats) return stats;

  const KEYS = [
    "appels",
    "emails",
    "visites_effectuees",
    "offres",
    "vues_leboncoin",
    "favoris_leboncoin"
  ];

  const actuel = stats.actuel || {};
  const cumul = stats.cumul || {};

  // CAS NORMAL → réplique stricte
  if (!miseEnLigneChanged) {
    stats.cumul = {};
    KEYS.forEach(k => {
      stats.cumul[k] = toNumber(actuel[k]);
    });
    return stats;
  }

  // NOUVELLE MISE EN LIGNE → cumul historique
  stats.cumul = {};
  KEYS.forEach(k => {
    stats.cumul[k] =
      toNumber(cumul[k]) +
      toNumber(actuel[k]);
  });

  return stats;
}

/* ======================================================
   HISTORIQUE AUTOMATIQUE (DATES → EVENTS)
====================================================== */

function syncHistoriqueFromDates(data) {
  if (!data) return;

  data.historique = Array.isArray(data.historique)
    ? data.historique
    : [];

  const exists = (action) =>
    data.historique.some(
      h => typeof h.action === "string" && h.action === action
    );

  // ✍️ Mandat signé
  if (data.dates?.mandat_signe) {
    const action = "✍️ Mandat signé";

    if (!exists(action)) {
      data.historique.push({
        date: data.dates.mandat_signe,
        action
      });
    }
  }

  // 📢 Mise en ligne
  if (data.dates?.mise_en_ligne) {
    const action = "📢 Mise en ligne de l’annonce";

    if (!exists(action)) {
      data.historique.push({
        date: data.dates.mise_en_ligne,
        action
      });
    }
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

  const mois = Math.max(jours / 30, 1);

  const vues = toNumber(data.stats?.cumul?.vues_leboncoin);
  const appels = toNumber(data.stats?.cumul?.appels);
  const visites = toNumber(data.stats?.cumul?.visites_effectuees);

  const vuesMensuelles = vues / mois;
  const appelsMensuels = appels / mois;
  const visitesMensuelles = visites / mois;

  const SEUILS = {
    vuesMensuelles: 200,
    appelsMensuels: 3,
    visitesMensuelles: 2,
    vuesParAppel: 100
  };

  const statsInsuffisantes =
    vuesMensuelles < SEUILS.vuesMensuelles ||
    appelsMensuels < SEUILS.appelsMensuels ||
    visitesMensuelles < SEUILS.visitesMensuelles ||
    (appels > 0 && vues / appels > SEUILS.vuesParAppel);

  if (jours < 21) {
    return {
      text:
        `Le bien est en commercialisation depuis ${jours} jours.\n\n` +
        "Cette phase correspond à une période normale d’exposition. " +
        "La stratégie actuelle est maintenue.",
      proposeRDV: false,
      noAlertes: false
    };
  }

  if (jours < 30 && statsInsuffisantes) {
    return {
      text:
        `Le bien est en commercialisation depuis ${jours} jours.\n\n` +
        "Les indicateurs sont insuffisants au regard de la durée de diffusion. " +
        "Un point stratégique pourra être envisagé.",
      proposeRDV: false,
      noAlertes: false
    };
  }

  if (statsInsuffisantes) {
    return {
      text:
        `Le bien est en commercialisation depuis ${jours} jours.\n\n` +
        "Les statistiques confirment une performance insuffisante. " +
        "Un rendez-vous est nécessaire afin d’ajuster la stratégie commerciale.",
      proposeRDV: true,
      noAlertes: false
    };
  }

  return {
    text:
      `Le bien est en commercialisation depuis ${jours} jours.\n\n` +
      "Les indicateurs sont cohérents avec la durée de diffusion. " +
      "La stratégie actuelle est maintenue.",
    proposeRDV: false,
    noAlertes: false
  };
}

/* ======================================================
   EXÉCUTION PRINCIPALE
====================================================== */

if (!fs.existsSync(BIENS_DIR)) {
  console.error("❌ Dossier biens introuvable");
  process.exit(1);
}

const fichiers = fs
  .readdirSync(BIENS_DIR)
  .filter(f => f.endsWith("_data.json"));

let rdvRecommandeGlobal = false;
const biensAvecRDV = [];

for (const fichier of fichiers) {
  const filePath = path.join(BIENS_DIR, fichier);

  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw);

  // 🔥 Historique automatique à partir des dates
  syncHistoriqueFromDates(data);

  // 🔁 Détection changement mise en ligne
  const previousMiseEnLigne =
    data._meta?.previous_mise_en_ligne || null;

  const currentMiseEnLigne =
    data.dates?.mise_en_ligne || null;

  const miseEnLigneChanged = hasMiseEnLigneChanged(
    previousMiseEnLigne,
    currentMiseEnLigne
  );

  // 🔄 Reset TOTAL si nouvelle mise en ligne
  if (miseEnLigneChanged) {
    resetStatsActuel(data.stats);
  }

  // 📊 Mise à jour du cumul
  data.stats = updateCumul(data.stats, miseEnLigneChanged);

  // 🧠 Analyse stratégique
  const analysis = buildAnalysis(data);

  data.analysis = {
    ...analysis,
    generatedAt: new Date().toISOString()
  };

  if (analysis.proposeRDV === true) {
    rdvRecommandeGlobal = true;
    biensAvecRDV.push(
      data.bien?.nom || fichier.replace("_data.json", "")
    );
  }

  // 🧠 Persistance meta
  data._meta = data._meta || {};
  data._meta.previous_mise_en_ligne = currentMiseEnLigne;

  // 💾 Sauvegarde
  fs.writeFileSync(
    filePath,
    JSON.stringify(data, null, 2),
    "utf-8"
  );

  console.log(`✔ Analyse mise à jour : ${fichier}`);
}

/* ======================================================
   FLAGS POUR GITHUB ACTIONS
====================================================== */

if (rdvRecommandeGlobal) {
  fs.appendFileSync(process.env.GITHUB_ENV, "RDV_RECOMMANDE=true\n");
  fs.appendFileSync(
    process.env.GITHUB_ENV,
    `RDV_BIENS=${biensAvecRDV.join(", ")}\n`
  );
}
