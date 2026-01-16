/* ======================================================
IMPORTS
====================================================== */

import fs from "fs";
import path from "path";

/* ======================================================
   OUTILS
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

  keys.forEach(key => {
    const vCumul = Number(cumul[key]) || 0;
    const vActuel = Number(actuel[key]) || 0;
    const vAjout  = Number(ajouts[key]) || 0;

    nouveauCumul[key] = vCumul + vActuel + vAjout;
  });

  // 🔒 Sécurité : on vide les ajouts après intégration
  stats.ajouts_manuels = {};

  stats.cumul = nouveauCumul;

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

  const vues = toNumber(data.stats?.vues_leboncoin);
  const appels = toNumber(data.stats?.appels);
  const visites = toNumber(data.stats?.visites_effectuees);

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
        "La stratégie actuelle est maintenue et les indicateurs seront suivis attentivement.",
      proposeRDV: false,
      noAlertes: false
    };
  }

  if (jours >= 21 && jours < 30 && statsInsuffisantes) {
    return {
      text:
        `Le bien est en commercialisation depuis ${jours} jours.\n\n` +
        "Les indicateurs observés sont insuffisants au regard de la durée de diffusion. " +
        "Si cette tendance se confirme, un point stratégique sera nécessaire.",
      proposeRDV: false,
      noAlertes: false
    };
  }

  if (jours >= 30 && statsInsuffisantes) {
    return {
      text:
        `Le bien est en commercialisation depuis ${jours} jours.\n\n` +
        "Les statistiques confirment une performance insuffisante par rapport " +
        "à la durée de diffusion. Un changement de stratégie est désormais nécessaire.\n\n" +
        "Il est désormais nécessaire d'organiser un rendez-vous, afin de définir une nouvelle stratégie " +
        "à mettre en place pour relancer efficacement la vente.",
      proposeRDV: true,
      noAlertes: false
    };
  }

  return {
    text:
      `Le bien est en commercialisation depuis ${jours} jours.\n\n` +
      "Les indicateurs observés sont cohérents avec la durée de diffusion. " +
      "La stratégie actuelle est maintenue.",
    proposeRDV: false,
    noAlertes: false
  };
}

/* ======================================================
   EXÉCUTION RÉELLE (LECTURE + ÉCRITURE)
====================================================== */

const BASE_DIR = "espace-client";

const dossiers = fs.readdirSync(BASE_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

let rdvRecommandeGlobal = false;
let biensAvecRDV = [];

for (const bien of dossiers) {
  const filePath = path.join(BASE_DIR, "bien", `${bien}_data.json`);

  if (!fs.existsSync(filePath)) continue;

  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw);

  // ✅ NOUVEAU : mise à jour automatique des cumulés
  data.stats = updateCumul(data.stats);

  const analysis = buildAnalysis(data);

  data.analysis = {
    ...analysis,
    generatedAt: new Date().toISOString()
  };

   if (analysis.proposeRDV === true) {
     rdvRecommandeGlobal = true;

     const nomBien = data.bien?.nom || bien;
     biensAvecRDV.push(nomBien);
   }

  fs.writeFileSync(
    filePath,
    JSON.stringify(data, null, 2),
    "utf-8"
  );

  console.log(`✔ Analyse mise à jour : ${bien}`);
}

/* ======================================================
   FLAG POUR GITHUB ACTIONS (EMAIL)
====================================================== */

if (rdvRecommandeGlobal) {
  fs.appendFileSync(process.env.GITHUB_ENV, "RDV_RECOMMANDE=true\n");

  fs.appendFileSync(
    process.env.GITHUB_ENV,
    "RDV_BIENS=" + biensAvecRDV.join(", ") + "\n"
  );
}
