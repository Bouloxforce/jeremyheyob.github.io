/**
 * espace-client/scripts/generate_analysis.js
 *
 * RÔLE UNIQUE :
 * - Calcul des statistiques hebdomadaires
 * - Conservation UNIQUEMENT de N et N-1
 * - Génération fiable de analysis.evolution_text
 * - Protection contre toute double exécution la même semaine
 *
 * COMPATIBLE :
 * - Node.js 18+
 * - ES Modules ("type": "module")
 * - GitHub Actions
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* =========================
   RÉSOLUTION DES CHEMINS (ESM)
========================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dossier contenant les *_data.json
const BIENS_DIR = path.join(__dirname, "..", "biens");

/* =========================
   OUTILS DATE (Europe/Paris)
========================= */

function getParisYMD(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date); // YYYY-MM-DD
}

function parseYMDToUTC(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatUTCToYMD(date) {
  return date.toISOString().slice(0, 10);
}

function getMondayKeyParis(todayYMD) {
  const d = parseYMDToUTC(todayYMD);
  const day = d.getUTCDay(); // 0 = dimanche
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return formatUTCToYMD(d);
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

  while (keys.length > keep) {
    delete obj[keys.shift()];
  }
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
  "favoris_leboncoin",
];

const LABELS = {
  appels: "Appels",
  emails: "Emails",
  visites_effectuees: "Visites effectuées",
  offres: "Offres",
  vues_leboncoin: "Vues Leboncoin",
  favoris_leboncoin: "Favoris Leboncoin",
};

/* =========================
   LOGIQUE MÉTIER
========================= */

function buildWeeklySnapshot(cumul, base) {
  const out = {};
  for (const key of STAT_KEYS) {
    const value = toNumber(cumul[key]) - toNumber(base[key]);
    out[key] = value < 0 ? 0 : value; // sécurité absolue
  }
  return out;
}

function buildEvolutionText(snapshot) {
  return STAT_KEYS.map(key => {
    const v = toNumber(snapshot[key]);
    if (v > 0) return `${LABELS[key]} : +${v}`;
    return `${LABELS[key]} : stable`;
  }).join("\n");
}

/* =========================
   TRAITEMENT D’UN BIEN
========================= */

function processBien(filePath) {
  const todayYMD = getParisYMD();
  const mondayKey = getMondayKeyParis(todayYMD);

  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  /* --- Sécurisation de la structure --- */
  data.stats = data.stats || {};
  data.stats.cumul = data.stats.cumul || {};
  data.stats_weekly_snapshot = data.stats_weekly_snapshot || {};
  data._meta = data._meta || {};
  data._meta.weekly_cumul_base = data._meta.weekly_cumul_base || {};
  data.analysis = data.analysis || {};

  /* =========================
     BASE HEBDOMADAIRE
  ========================= */

  if (!data._meta.weekly_cumul_base[mondayKey]) {
    data._meta.weekly_cumul_base[mondayKey] = {};
    for (const key of STAT_KEYS) {
      data._meta.weekly_cumul_base[mondayKey][key] =
        toNumber(data.stats.actuel?.[key]);
    }
  }

  /* =========================
     SNAPSHOT HEBDOMADAIRE
  ========================= */

  const base = data._meta.weekly_cumul_base[mondayKey];
  const snapshot = buildWeeklySnapshot(data.stats.actuel, base);

  data.stats_weekly_snapshot[mondayKey] = snapshot;

  /* =========================
     RÉTENTION : N / N-1
  ========================= */

  pruneToNWeeks(data._meta.weekly_cumul_base, 2);
  pruneToNWeeks(data.stats_weekly_snapshot, 2);

  /* =========================
     ANALYSE
  ========================= */

  data.analysis.evolution_text = buildEvolutionText(snapshot);
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

const files = fs.readdirSync(BIENS_DIR).filter(f => f.endsWith("_data.json"));

files.forEach(file => {
  processBien(path.join(BIENS_DIR, file));
});

console.log("✔ Weekly stats N / N-1 générées avec succès");
