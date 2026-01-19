/**
 * espace-client/scripts/generate_analysis.js
 *
 * RÔLE UNIQUE :
 * - Calcul des statistiques hebdomadaires
 * - Conservation UNIQUEMENT de N et N-1
 * - Génération fiable de analysis.evolution_text
 * - Gestion métier des resets (nouvelle mise en ligne)
 *
 * MODIF (demande) :
 * - Suppression totale de stats_weekly_snapshot
 * - Tendance basée UNIQUEMENT sur _meta.weekly_cumul_base
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
   LOGIQUE MÉTIER (sans stats_weekly_snapshot)
========================= */

/**
 * Assure que weekly_cumul_base[mondayKey] existe, et le fige une seule fois.
 * Il représente le cumul "au début de semaine" (lundi).
 */
function ensureWeeklyBase(data, mondayKey) {
  data._meta.weekly_cumul_base ??= {};

  if (!data._meta.weekly_cumul_base[mondayKey]) {
    data._meta.weekly_cumul_base[mondayKey] = {};
    for (const key of STAT_KEYS) {
      data._meta.weekly_cumul_base[mondayKey][key] = toNumber(data.stats.actuel[key]);
    }
  }
}

/**
 * Calcule le "delta hebdo" pour une semaine donnée :
 * delta = actuel - base_debut_semaine
 */
function computeCurrentWeekDelta(actuel, base) {
  const out = {};
  for (const key of STAT_KEYS) {
    const diff = toNumber(actuel[key]) - toNumber(base[key]);
    out[key] = diff;
  }
  return out;
}

/**
 * Calcule le "delta" de la semaine précédente à partir de deux bases :
 * prevDelta = base_courante - base_precedente
 *
 * Explication :
 * - base_precedente = cumul figé au début de la semaine précédente
 * - base_courante   = cumul figé au début de la semaine courante (= fin de la semaine précédente)
 */
function computePreviousWeekDelta(prevBase, currBase) {
  const out = {};
  for (const key of STAT_KEYS) {
    out[key] = toNumber(currBase[key]) - toNumber(prevBase[key]);
  }
  return out;
}

/**
 * Produit le texte d'évolution en comparant :
 * diff = deltaSemaineCourante - deltaSemainePrecedente
 *
 * Résultat :
 * - +x si amélioration
 * - -x si baisse
 * - stable sinon
 */
function buildEvolutionTextFromDeltas(deltaCurr, deltaPrev) {
  return STAT_KEYS.map(key => {
    const d = toNumber(deltaCurr[key]) - toNumber(deltaPrev[key]);

    if (d > 0) return `${LABELS[key]} : +${d}`;
    if (d < 0) return `${LABELS[key]} : ${d}`; // négatif affiché tel quel
    return `${LABELS[key]} : stable`;
  }).join("\n");
}

/**
 * Données exploitables si :
 * - on a au moins 2 semaines (N et N-1) de weekly_cumul_base
 * - et si au moins un delta (courant ou précédent) a un mouvement (>0)
 */
function hasExploitableWeeklyDataFromBases(weeklyBase, actuel) {
  const weeks = Object.keys(weeklyBase || {}).sort();
  if (weeks.length < 2) return false;

  const prevKey = weeks[weeks.length - 2];
  const currKey = weeks[weeks.length - 1];

  const prevBase = weeklyBase[prevKey] || {};
  const currBase = weeklyBase[currKey] || {};

  const prevDelta = computePreviousWeekDelta(prevBase, currBase);
  const currDelta = computeCurrentWeekDelta(actuel, currBase);

  const anyMovement =
    Object.values(prevDelta).some(v => toNumber(v) > 0) ||
    Object.values(currDelta).some(v => toNumber(v) > 0);

  return anyMovement;
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

    // 🔥 Reset temporel & analyse (source unique = weekly_cumul_base)
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
     SOURCE UNIQUE : weekly_cumul_base
  ========================= */

  ensureWeeklyBase(data, mondayKey);

  // On conserve uniquement N et N-1
  pruneToNWeeks(data._meta.weekly_cumul_base, 2);

  /* =========================
     ANALYSE – TENDANCE (depuis weekly_cumul_base)
  ========================= */

  const weeklyBase = data._meta.weekly_cumul_base;
  const weeks = Object.keys(weeklyBase).sort();

  if (weeks.length >= 2 && hasExploitableWeeklyDataFromBases(weeklyBase, data.stats.actuel)) {
    const prevKey = weeks[weeks.length - 2];
    const currKey = weeks[weeks.length - 1];

    const prevBase = weeklyBase[prevKey];
    const currBase = weeklyBase toggleBack = weeklyBase[currKey];

    // Delta semaine précédente = base_courante - base_précédente
    const deltaPrev = computePreviousWeekDelta(prevBase, currBase);

    // Delta semaine courante (en cours) = actuel - base_courante
    const deltaCurr = computeCurrentWeekDelta(data.stats.actuel, currBase);

    data.analysis.evolution_text = buildEvolutionTextFromDeltas(deltaCurr, deltaPrev);
    data.analysis.noExploitableData = false;
  } else {
    data.analysis.evolution_text =
      "La tendance sur la semaine écoulée sera disponible dès que des données seront exploitables.";
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

console.log("✔ Weekly stats N / N-1 générées avec succès (source unique weekly_cumul_base)");
