import fs from "fs";
import path from "path";

/* =========================
   PARAMÈTRES
========================= */

const BIENS_DIR = path.join("espace-client", "biens");

const KEYS = [
  { key: "appels", label: "Appels" },
  { key: "emails", label: "Emails" },
  { key: "visites_effectuees", label: "Visites effectuées" },
  { key: "offres", label: "Offres" },
  { key: "vues_leboncoin", label: "Vues Leboncoin" },
  { key: "favoris_leboncoin", label: "Favoris Leboncoin" }
];

/* =========================
   OUTILS
========================= */

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Retourne le lundi ISO de la semaine courante (YYYY-MM-DD)
function getWeekKey(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = dimanche, 1 = lundi
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function buildEvolutionText(current, previous) {
  if (!current || !previous) return null;

  const lines = [];

  KEYS.forEach(({ key, label }) => {
    const delta = toNumber(current[key]) - toNumber(previous[key]);

    if (delta > 0) {
      lines.push(`📈 ${label} : +${delta}`);
    } else if (delta < 0) {
      lines.push(`📉 ${label} : ${delta}`);
    } else {
      lines.push(`➖ ${label} : stable`);
    }
  });

  return lines.join("\n");
}

/* =========================
   EXÉCUTION
========================= */

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

  data.stats_weekly_snapshot = data.stats_weekly_snapshot || {};
  data._meta = data._meta || {};
  data._meta.weekly_cumul_base = data._meta.weekly_cumul_base || {};
  data.analysis = data.analysis || {};

  const currentWeekKey = getWeekKey();

  /* =====================================================
     1️⃣ NORMALISATION DES CLÉS DE SEMAINE
     → on supprime tout ce qui n’est PAS un lundi ISO
  ===================================================== */

  Object.keys(data.stats_weekly_snapshot).forEach(key => {
    const d = new Date(key);
    if (isNaN(d.getTime()) || d.getDay() !== 1) {
      delete data.stats_weekly_snapshot[key];
      delete data._meta.weekly_cumul_base[key];
    }
  });

  /* =====================================================
     2️⃣ BASE DE CUMUL POUR LA SEMAINE COURANTE
  ===================================================== */

  if (!data._meta.weekly_cumul_base[currentWeekKey]) {
    data._meta.weekly_cumul_base[currentWeekKey] = {
      appels: toNumber(data.stats.cumul?.appels),
      emails: toNumber(data.stats.cumul?.emails),
      visites_effectuees: toNumber(data.stats.cumul?.visites_effectuees),
      offres: toNumber(data.stats.cumul?.offres),
      vues_leboncoin: toNumber(data.stats.cumul?.vues_leboncoin),
      favoris_leboncoin: toNumber(data.stats.cumul?.favoris_leboncoin)
    };
  }

  const base = data._meta.weekly_cumul_base[currentWeekKey];

  /* =====================================================
     3️⃣ SNAPSHOT HEBDOMADAIRE (DIFF DE CUMUL)
  ===================================================== */

  data.stats_weekly_snapshot[currentWeekKey] = {
    appels: toNumber(data.stats.cumul?.appels) - base.appels,
    emails: toNumber(data.stats.cumul?.emails) - base.emails,
    visites_effectuees:
      toNumber(data.stats.cumul?.visites_effectuees) -
      base.visites_effectuees,
    offres: toNumber(data.stats.cumul?.offres) - base.offres,
    vues_leboncoin:
      toNumber(data.stats.cumul?.vues_leboncoin) - base.vues_leboncoin,
    favoris_leboncoin:
      toNumber(data.stats.cumul?.favoris_leboncoin) -
      base.favoris_leboncoin
  };

  /* =====================================================
     4️⃣ RÉTENTION : N ET N-1 UNIQUEMENT
  ===================================================== */

  const sortedWeeks = Object.keys(data.stats_weekly_snapshot).sort();

  while (sortedWeeks.length > 2) {
    const weekToDelete = sortedWeeks.shift();
    delete data.stats_weekly_snapshot[weekToDelete];
    delete data._meta.weekly_cumul_base[weekToDelete];
  }

  /* =====================================================
     5️⃣ ÉVOLUTION (N vs N-1)
  ===================================================== */

  const weeks = Object.keys(data.stats_weekly_snapshot).sort();

  if (weeks.length === 2) {
    const previousWeek = data.stats_weekly_snapshot[weeks[0]];
    const currentWeek = data.stats_weekly_snapshot[weeks[1]];

    const evolutionText = buildEvolutionText(
      currentWeek,
      previousWeek
    );

    if (evolutionText) {
      data.analysis.evolution_text = evolutionText;
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`✔ Weekly snapshot normalisé + évolution : ${fichier}`);
}
