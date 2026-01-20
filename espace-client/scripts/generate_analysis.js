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

const EMAIL_QUEUE_PATH = path.join(__dirname, "..", "strategic_email_queue.json");

function queueStrategicEmail(item) {
  let arr = [];
  try {
    if (fs.existsSync(EMAIL_QUEUE_PATH)) {
      arr = JSON.parse(fs.readFileSync(EMAIL_QUEUE_PATH, "utf-8")) || [];
      if (!Array.isArray(arr)) arr = [];
    }
  } catch {
    arr = [];
  }
  arr.push(item);
  fs.writeFileSync(EMAIL_QUEUE_PATH, JSON.stringify(arr, null, 2) + "\n", "utf-8");
}

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

function addDaysISO(isoYMD, days) {
  const d = new Date(`${isoYMD}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Renvoie le dernier lundi STRICTEMENT avant endISO (YYYY-MM-DD)
function lastMondayBefore(endISO) {
  const end = new Date(`${endISO}T00:00:00Z`);
  // reculer d’un jour pour être "avant" la fin
  end.setUTCDate(end.getUTCDate() - 1);

  const day = end.getUTCDay(); // 0=dim,1=lun...
  const diff = day === 0 ? 6 : day - 1; // nb de jours à reculer pour tomber sur lundi
  end.setUTCDate(end.getUTCDate() - diff);
  return end.toISOString().slice(0, 10);
}

// Retourne la tranche de phase courante (start/end) basée UNIQUEMENT sur mise_en_ligne_initiale
function getPhaseWindow(miseEnLigneInitialeISO, todayISO) {
  if (!miseEnLigneInitialeISO) return null;

  const start = new Date(`${miseEnLigneInitialeISO}T00:00:00Z`);
  const today = new Date(`${todayISO}T00:00:00Z`);
  const diffDays = Math.floor((today - start) / (1000 * 60 * 60 * 24));

  // bornes de fin "logiques" des phases (0-30,31-60,61-90)
  if (diffDays <= 30) {
    return { label: "30", startISO: miseEnLigneInitialeISO, endISO: addDaysISO(miseEnLigneInitialeISO, 30) };
  }
  if (diffDays <= 60) {
    return { label: "60", startISO: addDaysISO(miseEnLigneInitialeISO, 31), endISO: addDaysISO(miseEnLigneInitialeISO, 60) };
  }
  if (diffDays <= 90) {
    return { label: "90", startISO: addDaysISO(miseEnLigneInitialeISO, 61), endISO: addDaysISO(miseEnLigneInitialeISO, 90) };
  }

  // 90+ : tranches de 30 jours après J90
  const daysAfter90 = diffDays - 90;
  const trancheIndex = Math.ceil(daysAfter90 / 30); // 1,2,3...
  const trancheEnd = addDaysISO(miseEnLigneInitialeISO, 90 + trancheIndex * 30);
  const trancheStart = addDaysISO(miseEnLigneInitialeISO, 90 + (trancheIndex - 1) * 30 + 1);

  return { label: "90+", startISO: trancheStart, endISO: trancheEnd };
}

function daysBetweenISO(aISO, bISO) {
  const a = new Date(`${aISO}T00:00:00Z`);
  const b = new Date(`${bISO}T00:00:00Z`);
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
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

function detectAlertes(data) {
  const a = [];

  const appels = toNumber(data.stats.actuel.appels);
  const emails = toNumber(data.stats.actuel.emails);
  const visites = toNumber(data.stats.actuel.visites_effectuees);
  const offres = toNumber(data.stats.actuel.offres);
  const vues = toNumber(data.stats.actuel.vues_leboncoin);

  // 🟥 PRIORITÉ 1 — Visites sans offres
  if (visites >= 3 && offres === 0) {
    a.push({
      p: 1,
      m: "❗ Visites sans offres"
    });
  }

  // 🟧 PRIORITÉ 2 — Contacts sans visites
  if (appels + emails >= 15 && visites === 0) {
    a.push({
      p: 2,
      m: "❗ Contacts sans visites"
    });
  }

  // 🟨 PRIORITÉ 3 — Vues sans contacts
  if (vues >= 200 && appels + emails === 0 ) {
    a.push({
      p: 3,
      m: "❗ Vues sans contacts"
    });
  }

  // 🟪 PRIORITÉ 4 — Aucune interaction récente
  const weeklyBase = data._meta.weekly_cumul_base || {};
  const weeks = Object.keys(weeklyBase).sort();
  if (weeks.length >= 2) {
    const prev = weeklyBase[weeks[weeks.length - 2]];
    const curr = weeklyBase[weeks[weeks.length - 1]];

    const delta =
      toNumber(curr.appels) - toNumber(prev.appels) +
      toNumber(curr.emails) - toNumber(prev.emails) +
      toNumber(curr.visites_effectuees) - toNumber(prev.visites_effectuees);

    if (delta === 0) {
      a.push({
        p: 4,
        m: "❗ Aucune interaction récente"
      });
    }
  }

  // ➜ tri par priorité + max 2 alertes
  return a
    .sort((x, y) => x.p - y.p)
    .slice(0, 2)
    .map(x => x.m);
}

function isStatsHealthyActuelOnly(data) {
  const actuel = data?.stats?.actuel || {};
  const vues = toNumber(actuel.vues_leboncoin);
  const appels = toNumber(actuel.appels);
  const emails = toNumber(actuel.emails);
  const visites = toNumber(actuel.visites_effectuees);
  const offres = toNumber(actuel.offres);

  const contacts = appels + emails;

  // Seuils simples (tu peux les ajuster plus tard)
  if (vues >= 200 && contacts === 0) return false;
  if (contacts >= 10 && visites === 0) return false;
  if (visites >= 5 && offres === 0) return false;

  return true;
}

/* =========================
   TRAITEMENT D’UN BIEN
========================= */

function processBien(filePath) {
  const todayYMD = getParisYMD();
  const mondayKey = getMondayKeyParis(todayYMD);
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

   // =========================
   // 🔒 DÉCLENCHEUR STRICT
   // =========================
   data._meta ??= {};
   data.stats ??= {};
   data.stats.actuel ??= {};

   const currentVues = toNumber(data.stats.actuel.vues_leboncoin);
   const lastVues = toNumber(data._meta.last_vues_leboncoin_snapshot);

   // ❌ CAS 3 : autres stats modifiées MAIS vues inchangées → STOP TOTAL
   const hasNewWeeklyData =
     Object.keys(data._meta.weekly_cumul_base || {}).length >= 2;

   if (
     Number.isFinite(lastVues) &&
     currentVues === lastVues &&
     !hasNewWeeklyData
   ) {
     return;
   }

  /* --- Sécurisation --- */
  data.stats ??= {};
  data.stats.actuel ??= {};
  data.stats.cumul ??= {};
  data.analysis ??= {};
  data.analysis.alertes ??= [];
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

  const miseInitiale = data._meta.mise_en_ligne_initiale || null;

  const phaseWin = getPhaseWindow(miseInitiale, todayYMD);
  const strategicMonday = phaseWin ? lastMondayBefore(phaseWin.endISO) : null;

  const isStrategicDay = strategicMonday && todayYMD === strategicMonday;

  // 🔒 21 premiers jours de la phase/tranche : interdiction totale de "changement de stratégie"
  const daysInCurrentWindow = phaseWin ? daysBetweenISO(phaseWin.startISO, todayYMD) + 1 : null;
  const inFirst21Days = Number.isFinite(daysInCurrentWindow) && daysInCurrentWindow <= 21;

  const healthy = isStatsHealthyActuelOnly(data);

  data.analysis ??= {};
  data.analysis.text ??= "";

  if (healthy) {
    data.analysis.text =
      "La commercialisation se déroule dans de bonnes conditions. Les indicateurs actuels sont cohérents avec le marché. La stratégie en place est maintenue.";
  } else {
    // Cas "non healthy"
    if (inFirst21Days) {
      // ✅ Alertes possibles, mais aucune stratégie
      data.analysis.text =
        "Les indicateurs actuels nécessitent une surveillance attentive. Une phase d’analyse est en cours afin d’objectiver la suite, sans ajustement de stratégie à ce stade.";
    } else if (phaseWin?.label === "90+") {
      // 🔒 En 90+, ton exigence : message uniquement le dernier lundi avant fin de tranche
      if (isStrategicDay) {
        data.analysis.text =
          "La commercialisation est entrée dans une phase prolongée. En l’absence d’évolution significative, un changement de stratégie est nécessaire afin de redéfinir les leviers d’action.";
      } else {
        // Hors lundi stratégique : on reste neutre
        data.analysis.text =
          "Les indicateurs actuels nécessitent une surveillance attentive. Un point stratégique sera réalisé au moment prévu dans le plan de commercialisation.";
      }
    } else {
      // phases 30 / 60 / 90
      if (isStrategicDay) {
        if (phaseWin?.label === "90") {
          data.analysis.text =
            "Les résultats actuels indiquent que la stratégie arrive à ses limites. Un changement de stratégie est nécessaire afin d’optimiser la commercialisation dans la phase suivante.";
        } else {
          // 30 ou 60
          data.analysis.text =
            "Les indicateurs actuels montrent que la commercialisation atteint un palier. Afin d’optimiser la suite, un ajustement de la stratégie est en cours de réflexion pour la prochaine phase.";
        }
      } else {
        // Hors lundi stratégique : analyse neutre (pas de bascule stratégie)
        data.analysis.text =
          "Les indicateurs actuels nécessitent une surveillance attentive. Un point d’analyse sera réalisé à l’approche de la prochaine phase.";
      }
    }
  }

  const bienNom = data?.bien?.nom || "Bien sans nom";

  // Un email interne uniquement si :
  // - stats non healthy
  // - pas dans les 21 premiers jours de la phase/tranche
  // - et on est le dernier lundi autorisé
  const shouldNotify = !healthy && !inFirst21Days && isStrategicDay;

  if (shouldNotify) {
    // On stocke une file de mails à envoyer (lue par le workflow)
    data._meta.pending_strategic_email ??= false;
    data._meta.pending_strategic_email = true;

    // On écrit aussi un petit fichier "queue" global (dans repo) pour le workflow
    // (voir étape 6 du workflow)
    queueStrategicEmail({
      bienNom,
      phase: phaseWin?.label || "?",
      todayISO: todayYMD,
      subject: `Action requise – Changement de stratégie (${bienNom})`,
      body:
  `Bonjour Jérémy,

  Un changement de stratégie est à prévoir pour le bien : ${bienNom}
  Phase : ${phaseWin?.label || "?"}
  Date : ${todayYMD}

  Merci de contacter le client afin de piloter l’ajustement de la stratégie (sans formuler “rendez-vous nécessaire”).

  — Analyse automatique`
    });
  }

    data.analysis.noExploitableData = false;

  if (!hasExploitableWeeklyData(data._meta.weekly_cumul_base)) {
     data.analysis.evolution_text =
       "La tendance sur la semaine écoulée sera disponible dès que des données seront exploitables.";
     data.analysis.noExploitableData = true;
   } else {
     data.analysis.noExploitableData = false;
   }

  data.analysis.alertes = detectAlertes(data);
  data._meta.last_weekly_run = mondayKey;
  data.analysis.generatedAt = new Date().toISOString();
  data._meta.just_reset = false;
  data.analysis.text = data.analysis.text || "";
  data._meta.last_vues_leboncoin_snapshot = currentVues;

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
