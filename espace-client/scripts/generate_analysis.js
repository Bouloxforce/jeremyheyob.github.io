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
   CUMUL AUTOMATIQUE DES STATS
====================================================== */

function updateCumul(stats) {
  if (!stats) return stats;

  const actuel = stats.actuel || {};
  const cumul = stats.cumul || {};
  const ajouts = stats.ajouts_manuels || {};

  const keys = new Set([
    ...Object.keys(actuel),
    ...Object.keys(cumul),
    ...Object.keys(ajouts)
  ]);

  const nouveauCumul = {};

  for (const key of keys) {
    const vCumul = toNumber(cumul[key]);
    const vActuel = toNumber(actuel[key]);
    const vAjout = toNumber(ajouts[key]);

    nouveauCumul[key] = vCumul + vActuel + vAjout;
  }

  stats.cumul = nouveauCumul;
  stats.ajouts_manuels = {}; // sécurité

  return stats;
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

  // 📊 Cumul stats
  data.stats = updateCumul(data.stats);

  // 🧠 Analyse
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
