/**
 * espace-client/scripts/generate_analysis.js
 *
 * RÔLE UNIQUE :
 * - Calcul des statistiques hebdomadaires
 * - Conservation UNIQUEMENT de N et N-1
 * - Génération fiable de analysis.evolution_text
 * - Gestion métier des resets (nouvelle mise en ligne)
 *
 * COMPATIBLE :
 * - Node.js 18+
 * - ES Modules
 * - GitHub Actions
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* =========================
   RÉSOLUTION DES CHEMINS
========================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BIENS_DIR = path.join(__dirname, "..", "biens");

/* =========================
   OUTILS DATE (Europe/Paris)
========================= */

function getParisYMD(date = new Date()) {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function getMondayKeyParis(todayYMD) {
  const d = new Date(`${todayYMD}T00:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/* =========================
   OUTILS DIVERS
========================= */

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pruneToNWeeks(obj, keep = 2) {
  const keys = Object.keys(obj)
    .filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .sort();
  while (keys.length > keep) delete obj[keys.shift()];
}

/* =========================
   CONFIG MÉTRIQUES
========================= */

const STAT_KEYS = [
  "appels",
  "emails",
  "visites_effectuees",
  "offres",
  "vues_leboncoin",
  "favoris_leboncoin"
];

const LABELS = {
  appels: "Appels",
  emails: "Emails",
  visites_effectuees: "Visites effectuées",
  offres: "Offres",
  vues_leboncoin: "Vues Leboncoin",
  favoris_leboncoin: "Favoris Leboncoin"
};

/* =========================
   LOGIQUE MÉTIER
========================= */

function buildWeeklySnapshot(actuel, base) {
  const out = {};
  for (const key of STAT_KEYS) {
    const diff = toNumber(actuel[key]) - toNumber(base[key]);
    out[key] = diff > 0 ? diff : 0;
  }
  return out;
}

function buildEvolutionText(snapshot) {
  return STAT_KEYS.map(key => {
    const v = toNumber(snapshot[key]);
    return v > 0
      ? `${LABELS[key]} : +${v}`
      : `${LABELS[key]} : stable`;
  }).join("\n");
}

function hasExploitableWeeklyData(stats_weekly_snapshot) {
  const weeks = Object.values(stats_weekly_snapshot || {});
  if (weeks.length < 2) return false;
  return weeks.some(week =>
    Object.values(week).some(v => toNumber(v) > 0)
  );
}

/* =========================
   TRAITEMENT D’UN BIEN
========================= */

function processBien(filePath) {
  const todayYMD = getParisYMD();
  const mondayKey = getMondayKeyParis(todayYMD);
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  /* --- Sécurisation --- */
  data.stats ??= {};
  data.stats.actuel ??= {};
  data.stats.cumul ??= {};
  data.stats_weekly_snapshot ??= {};
  data.analysis ??= {};
  data._meta ??= {};
  data._meta.weekly_cumul_base ??= {};

  /* =========================
     RESET PARTIEL – NOUVELLE MISE EN LIGNE
  ========================= */

  const miseEnLigne = data.dates?.mise_en_ligne || null;

  if (!data._meta.mise_en_ligne_ref) {
    data._meta.mise_en_ligne_ref = miseEnLigne;
  }

  if (miseEnLigne && data._meta.mise_en_ligne_ref !== miseEnLigne) {

    // 🔥 Reset DONNÉES ACTUELLES uniquement
    data.stats.actuel = {
      appels: 0,
      emails: 0,
      visites_effectuees: 0,
      visites_programmees: 0,
      offres: 0,
      vues_leboncoin: 0,
      favoris_leboncoin: 0
    };

    // 🔥 Reset temporel & analyse
    data.stats_weekly_snapshot = {};
    data._meta.weekly_cumul_base = {};
    delete data._meta.last_weekly_run;

    data.analysis = {
      text: "",
      evolution_text: "",
      generatedAt: null,
      noExploitableData: true
    };

    data._meta.mise_en_ligne_ref = miseEnLigne;
  }

  /* =========================
     NORMALISATION DES CUMULS
  ========================= */

  for (const key of STAT_KEYS) {
    if (toNumber(data.stats.actuel[key]) > toNumber(data.stats.cumul[key])) {
      data.stats.cumul[key] = toNumber(data.stats.actuel[key]);
    }
  }

  /* =========================
     BASE HEBDOMADAIRE (figée 1×)
  ========================= */

  if (!data._meta.weekly_cumul_base[mondayKey]) {
    data._meta.weekly_cumul_base[mondayKey] = {};
    for (const key of STAT_KEYS) {
      data._meta.weekly_cumul_base[mondayKey][key] =
        toNumber(data.stats.actuel[key]);
    }
  }

  /* =========================
     SNAPSHOT HEBDOMADAIRE
  ========================= */

  const base = data._meta.weekly_cumul_base[mondayKey];
  const snapshot = buildWeeklySnapshot(data.stats.actuel, base);
  data.stats_weekly_snapshot[mondayKey] = snapshot;

  pruneToNWeeks(data._meta.weekly_cumul_base, 2);
  pruneToNWeeks(data.stats_weekly_snapshot, 2);

  /* =========================
     ANALYSE – GARDE DONNÉES
  ========================= */

  if (hasExploitableWeeklyData(data.stats_weekly_snapshot)) {
    data.analysis.evolution_text = buildEvolutionText(snapshot);
    data.analysis.noExploitableData = false;
  } else {
    data.analysis.evolution_text =
      "Les données sont en cours de collecte.\n" +
      "Les indicateurs de tendance seront disponibles dès que des données exploitables auront été enregistrées.";
    data.analysis.noExploitableData = true;
  }

  data._meta.last_weekly_run = mondayKey;
  data.analysis.generatedAt = new Date().toISOString();

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/* =========================
   EXÉCUTION GLOBALE
========================= */

if (!fs.existsSync(BIENS_DIR)) {
  console.error("❌ Dossier biens introuvable :", BIENS_DIR);
  process.exit(1);
}

fs.readdirSync(BIENS_DIR)
  .filter(f => f.endsWith("_data.json"))
  .forEach(f => processBien(path.join(BIENS_DIR, f)));

console.log("✔ Weekly stats N / N-1 générées avec succès");
