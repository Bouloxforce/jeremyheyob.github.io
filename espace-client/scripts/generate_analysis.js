/**
 * espace-client/scripts/generate_analysis.js
 *
 * RÔLE UNIQUE :
 * - Calcul des statistiques hebdomadaires
 * - Conservation UNIQUEMENT de N et N-1
 * - Génération fiable de analysis.evolution_text
 * - Gestion métier des resets (nouvelle mise en ligne)
 *
 * LOGIQUE MÉTIER (VALIDÉE) :
 * - Tendance = résultats de la semaine écoulée (N vs N-1)
 * - Jamais de valeurs négatives
 * - Lecture vendeur simple et cohérente
 *
 * SOURCE UNIQUE :
 * - _meta.weekly_cumul_base
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

/**
 * Base hebdomadaire figée au lundi :
 * weekly_cumul_base[mondayKey] = cumul au début de la semaine
 */
function ensureWeeklyBase(data, mondayKey) {
  data._meta.weekly_cumul_base ??= {};

  if (!data._meta.weekly_cumul_base[mondayKey]) {
    data._meta.weekly_cumul_base[mondayKey] = {};
    for (const key of STAT_KEYS) {
      data._meta.weekly_cumul_base[mondayKey][key] =
        toNumber(data.stats.actuel[key]);
    }
  }
}

/**
 * Résultats de la semaine écoulée :
 * delta = base semaine N − base semaine N-1
 * → jamais négatif
 */
function computeWeeklyResults(basePrev, baseCurr) {
  const out = {};
  for (const key of STAT_KEYS) {
    const diff = toNumber(baseCurr[key]) - toNumber(basePrev[key]);
    out[key] = diff > 0 ? diff : 0;
  }
  return out;
}

function buildEvolutionTextFromWeeklyResults(delta) {
  return STAT_KEYS.map(key => {
    const v = toNumber(delta[key]);
    return v > 0
      ? `${LABELS[key]} : +${v}`
      : `${LABELS[key]} : stable`;
  }).join("\n");
}

function hasExploitableWeeklyData(weeklyBase) {
  const weeks = Object.keys(weeklyBase || {}).sort();
  if (weeks.length < 2) return false;

  const prev = weeklyBase[weeks[weeks.length - 2]];
  const curr = weeklyBase[weeks[weeks.length - 1]];

  return STAT_KEYS.some(
    key => toNumber(curr[key]) - toNumber(prev[key]) > 0
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
  data.analysis ??= {};
  data._meta ??= {};
  data._meta.weekly_cumul_base ??= {};
  data._meta.last_actuel_snapshot ??= {};
  data._meta.just_reset ??= false;
  data._meta.has_had_reset ??= false;
  for (const key of STAT_KEYS) {
     data._meta.last_actuel_snapshot[key] ??= 0;
     data.stats.cumul[key] ??= 0;
  }

  /* =========================
     🔒 DATE DE MISE EN LIGNE INITIALE (IMMUTABLE)
  ========================= */

  if (!data._meta.mise_en_ligne_initiale && data.dates?.mise_en_ligne) {
    data._meta.mise_en_ligne_initiale = data.dates.mise_en_ligne;
  }

  /* =========================
     RESET PARTIEL – NOUVELLE MISE EN LIGNE
  ========================= */

  const miseEnLigne = data.dates?.mise_en_ligne || null;

  if (!data._meta.mise_en_ligne_ref) {
    data._meta.mise_en_ligne_ref = miseEnLigne;
  }

  if (miseEnLigne && data._meta.mise_en_ligne_ref !== miseEnLigne) {
     
     data._meta.has_had_reset = true;
     data._meta.just_reset = true;

    for (const key of STAT_KEYS) {
     data._meta.last_actuel_snapshot[key] =
       toNumber(data.stats.actuel[key]);
   }

    data.stats.actuel = {
      appels: 0,
      emails: 0,
      visites_effectuees: 0,
      visites_programmees: 0,
      offres: 0,
      vues_leboncoin: 0,
      favoris_leboncoin: 0
    };

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
     BASE HEBDOMADAIRE (figée)
  ========================= */

  ensureWeeklyBase(data, mondayKey);
  pruneToNWeeks(data._meta.weekly_cumul_base, 2);

   for (const key of STAT_KEYS) {
     const actuel = toNumber(data.stats.actuel[key]);
     const prev = toNumber(data._meta.last_actuel_snapshot[key]);

     // 🔹 AVANT TOUT RESET → miroir strict
      if (!data._meta.has_had_reset) {
        data.stats.cumul[key] = actuel;
        data._meta.last_actuel_snapshot[key] = actuel;
        continue;
      }

     // 🔹 APRÈS RESET → ajout du delta uniquement
     const delta = actuel - prev;

     if (delta > 0) {
       data.stats.cumul[key] =
         toNumber(data.stats.cumul[key]) + delta;
     }

     data._meta.last_actuel_snapshot[key] = actuel;
   }

  /* =========================
     ANALYSE – TENDANCE VENDEUR
  ========================= */

  const weeklyBase = data._meta.weekly_cumul_base;
  const weeks = Object.keys(weeklyBase).sort();

  if (weeks.length >= 2 && hasExploitableWeeklyData(weeklyBase)) {

    const prevBase = weeklyBase[weeks[weeks.length - 2]];
    const currBase = weeklyBase[weeks[weeks.length - 1]];

    const delta = computeWeeklyResults(prevBase, currBase);

    data.analysis.evolution_text =
      buildEvolutionTextFromWeeklyResults(delta);

    data.analysis.noExploitableData = false;

  } else {
    data.analysis.evolution_text =
      "La tendance sur la semaine écoulée sera disponible dès que des données seront exploitables.";
    data.analysis.noExploitableData = true;
  }

  data._meta.last_weekly_run = mondayKey;
  data.analysis.generatedAt = new Date().toISOString();
  data._meta.just_reset = false;

  fs.writeFileSync(
    filePath,
    JSON.stringify(data, null, 2) + "\n",
    "utf-8"
  );
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

console.log("✔ Analyse hebdomadaire générée (logique vendeur – semaine écoulée)");
