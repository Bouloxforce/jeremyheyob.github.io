/**
 * espace-client/scripts/generate_analysis.js
 *
 * Objectif (workflow GitHub Actions):
 * - Mettre à jour les snapshots hebdo (stats_weekly_snapshot)
 * - Mettre à jour la base hebdo (_meta.weekly_cumul_base)
 * - Générer analysis.evolution_text à partir des snapshots (donc cohérent et “vrai”)
 *
 * Important:
 * - Le workflow update-analys.yml exécute UNIQUEMENT ce fichier.
 * - Donc toute logique “weekly stats” doit être ici (ou être importée ici).
 */

const fs = require("fs");
const path = require("path");

const BIENS_DIR = path.join(process.cwd(), "espace-client", "biens");

// ---------------------------
// Helpers dates (Europe/Paris)
// ---------------------------
function getParisYMD(date = new Date()) {
  // Renvoie "YYYY-MM-DD" selon le fuseau Europe/Paris
  const fmt = new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date); // fr-CA => YYYY-MM-DD
}

function parseYMDToUTCDate(ymd) {
  // "YYYY-MM-DD" -> Date UTC à minuit
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatUTCDateToYMD(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMondayKeyParis(todayYMD) {
  // todayYMD est en “Europe/Paris”, mais on calcule en UTC à partir de ce YMD (stable)
  const d = parseYMDToUTCDate(todayYMD); // UTC midnight
  const dow = d.getUTCDay(); // 0=dim,1=lun,...6=sam
  const offset = dow === 0 ? 6 : dow - 1; // nb jours à enlever pour revenir au lundi
  d.setUTCDate(d.getUTCDate() - offset);
  return formatUTCDateToYMD(d);
}

function addDaysYMD(ymd, days) {
  const d = parseYMDToUTCDate(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return formatUTCDateToYMD(d);
}

function toNumberSafe(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------
// Business logic: weekly stats
// ---------------------------
const STAT_KEYS = [
  "appels",
  "emails",
  "visites_effectuees",
  "offres",
  "vues_leboncoin",
  "favoris_leboncoin",
];

function getCumul(data) {
  const out = {};
  STAT_KEYS.forEach((k) => {
    out[k] = toNumberSafe(data?.stats?.cumul?.[k]);
  });
  return out;
}

function ensureObjects(data) {
  if (!data._meta || typeof data._meta !== "object") data._meta = {};
  if (!data._meta.weekly_cumul_base || typeof data._meta.weekly_cumul_base !== "object") {
    data._meta.weekly_cumul_base = {};
  }
  if (!data.stats_weekly_snapshot || typeof data.stats_weekly_snapshot !== "object") {
    data.stats_weekly_snapshot = {};
  }
  if (!data.analysis || typeof data.analysis !== "object") data.analysis = {};
}

function pruneByLastNWeeks(obj, keepWeeks = 8) {
  const keys = Object.keys(obj || {})
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .sort(); // asc

  if (keys.length <= keepWeeks) return;

  const toDelete = keys.slice(0, keys.length - keepWeeks);
  toDelete.forEach((k) => delete obj[k]);
}

function computeWeeklySnapshot(cumul, base) {
  const snap = {};
  STAT_KEYS.forEach((k) => {
    const v = toNumberSafe(cumul[k]) - toNumberSafe(base[k]);
    // clamp à 0 pour éviter incohérences si base > cumul (cas rare)
    snap[k] = v < 0 ? 0 : v;
  });
  return snap;
}

function buildEvolutionTextFromSnapshot(snapshot) {
  // Format texte “propre” (sans pictogrammes), compatible avec ton front (qui colorise)
  // Règle:
  // - Si valeur > 0 : "Label : +N"
  // - Sinon : "Label : stable"
  const lines = [];

  const map = [
    ["Appels", "appels"],
    ["Emails", "emails"],
    ["Visites effectuées", "visites_effectuees"],
    ["Offres", "offres"],
    ["Vues Leboncoin", "vues_leboncoin"],
    ["Favoris Leboncoin", "favoris_leboncoin"],
  ];

  for (const [label, key] of map) {
    const n = toNumberSafe(snapshot?.[key]);
    if (n > 0) {
      lines.push(`${label} : +${n}`);
    } else {
      lines.push(`${label} : stable`);
    }
  }

  return lines.join("\n");
}

// ---------------------------
// Analysis (minimal, non-destructif)
// ---------------------------
function generateAnalysisText(data, todayYMD) {
  // Tu peux enrichir ici (sans casser le reste).
  // On reste simple et non destructif.
  const mise = data?.dates?.mise_en_ligne;
  if (!mise || !/^\d{4}-\d{2}-\d{2}$/.test(mise)) return data?.analysis?.text || "";

  const d0 = parseYMDToUTCDate(mise);
  const d1 = parseYMDToUTCDate(todayYMD);

  const days = Math.max(0, Math.floor((d1.getTime() - d0.getTime()) / (1000 * 60 * 60 * 24)));
  // Phrase courte: tu avais déjà un texte de ce type dans ton JSON.
  const base = `Le bien est en commercialisation depuis ${days} jour${days > 1 ? "s" : ""}.`;

  // Phases 0-30 / 31-60 / 61-90 / +90
  let phase = "Phase normale de diffusion.";
  if (days <= 30) phase = "Phase 1 (0–30 jours) : phase de test du marché.";
  else if (days <= 60) phase = "Phase 2 (31–60 jours) : phase d’ajustement stratégique.";
  else if (days <= 90) phase = "Phase 3 (61–90 jours) : phase de derniers ajustements.";
  else phase = "Phase 4 (+90 jours) : phase de poursuite maîtrisée.";

  return `${base}\n\n${phase}`;
}

// ---------------------------
// Main: iterate all biens
// ---------------------------
function listDataFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith("_data.json"))
    .map((f) => path.join(dir, f));
}

function readJSON(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function writeJSON(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function processBienFile(filePath) {
  const todayYMD = getParisYMD(new Date());
  const mondayKey = getMondayKeyParis(todayYMD);
  const prevMondayKey = addDaysYMD(mondayKey, -7);

  const data = readJSON(filePath);
  ensureObjects(data);

  // 1) Base hebdo: si absente pour la semaine courante, on la fixe = cumul actuel
  const cumul = getCumul(data);

  if (!data._meta.weekly_cumul_base[mondayKey]) {
    data._meta.weekly_cumul_base[mondayKey] = { ...cumul };
  }

  // 2) Snapshot hebdo: cumul - base
  const base = data._meta.weekly_cumul_base[mondayKey];
  const snapshot = computeWeeklySnapshot(cumul, base);
  data.stats_weekly_snapshot[mondayKey] = snapshot;

  // 3) Nettoyage: garder les 8 dernières semaines
  pruneByLastNWeeks(data._meta.weekly_cumul_base, 2);
  pruneByLastNWeeks(data.stats_weekly_snapshot, 2);

  // 4) Générer evolution_text basé sur snapshot courant (donc “vrai”)
  data.analysis.evolution_text = buildEvolutionTextFromSnapshot(snapshot);

  // 5) Générer/mettre à jour un texte d’analyse simple (non destructif)
  //    (si tu veux garder ton propre texte custom, tu peux commenter cette ligne)
  data.analysis.text = generateAnalysisText(data, todayYMD);

  // 6) Métadonnées
  data.analysis.generatedAt = new Date().toISOString();

  // Optionnel: garder trace précédente (si tu en as besoin)
  // data._meta.previous_week_key = prevMondayKey;

  writeJSON(filePath, data);
}

function main() {
  const files = listDataFiles(BIENS_DIR);
  if (files.length === 0) {
    console.log("Aucun fichier *_data.json trouvé dans", BIENS_DIR);
    return;
  }

  files.forEach((f) => {
    try {
      processBienFile(f);
      console.log("OK:", path.basename(f));
    } catch (e) {
      console.error("ERREUR:", path.basename(f), e.message);
    }
  });
}

main();
