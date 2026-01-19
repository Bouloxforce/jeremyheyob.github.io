import fs from "fs";
import path from "path";

/* =========================
   CONFIG
========================= */

const BIENS_DIR = path.join("espace-client", "biens");

const METRICS = [
  { key: "appels", label: "Appels" },
  { key: "emails", label: "Emails" },
  { key: "visites_effectuees", label: "Visites effectuées" },
  { key: "offres", label: "Offres" },
  { key: "vues_leboncoin", label: "Vues Leboncoin" },
  { key: "favoris_leboncoin", label: "Favoris Leboncoin" }
];

/* =========================
   UTILITAIRES
========================= */

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Retourne le lundi ISO (YYYY-MM-DD)
function getWeekKey(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = dimanche
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function buildEvolutionText(snapshot) {
  if (!snapshot) return "";

  return METRICS.map(({ key, label }) => {
    const v = toNumber(snapshot[key]);
    if (v > 0) return `${label} : +${v}`;
    if (v < 0) return `${label} : ${v}`;
    return `${label} : stable`;
  }).join("\n");
}

/* =========================
   EXÉCUTION
========================= */

if (!fs.existsSync(BIENS_DIR)) {
  console.error("❌ Dossier biens introuvable");
  process.exit(1);
}

const files = fs.readdirSync(BIENS_DIR).filter(f => f.endsWith("_data.json"));

for (const file of files) {
  const filePath = path.join(BIENS_DIR, file);
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  data.stats = data.stats || {};
  data.stats.cumul = data.stats.cumul || {};
  data.stats_weekly_snapshot = data.stats_weekly_snapshot || {};
  data._meta = data._meta || {};
  data._meta.weekly_cumul_base = data._meta.weekly_cumul_base || {};
  data.analysis = data.analysis || {};

  const weekKey = getWeekKey();

  // 1️⃣ Base cumul (créée une seule fois par semaine)
  if (!data._meta.weekly_cumul_base[weekKey]) {
    data._meta.weekly_cumul_base[weekKey] = {
      appels: toNumber(data.stats.cumul.appels),
      emails: toNumber(data.stats.cumul.emails),
      visites_effectuees: toNumber(data.stats.cumul.visites_effectuees),
      offres: toNumber(data.stats.cumul.offres),
      vues_leboncoin: toNumber(data.stats.cumul.vues_leboncoin),
      favoris_leboncoin: toNumber(data.stats.cumul.favoris_leboncoin)
    };
  }

  const base = data._meta.weekly_cumul_base[weekKey];

  // 2️⃣ Snapshot hebdomadaire = cumul - base
  data.stats_weekly_snapshot[weekKey] = {
    appels: toNumber(data.stats.cumul.appels) - base.appels,
    emails: toNumber(data.stats.cumul.emails) - base.emails,
    visites_effectuees:
      toNumber(data.stats.cumul.visites_effectuees) - base.visites_effectuees,
    offres: toNumber(data.stats.cumul.offres) - base.offres,
    vues_leboncoin:
      toNumber(data.stats.cumul.vues_leboncoin) - base.vues_leboncoin,
    favoris_leboncoin:
      toNumber(data.stats.cumul.favoris_leboncoin) - base.favoris_leboncoin
  };

  // 3️⃣ Rétention : uniquement N et N-1
  const weeks = Object.keys(data.stats_weekly_snapshot).sort();
  while (weeks.length > 2) {
    const oldest = weeks.shift();
    delete data.stats_weekly_snapshot[oldest];
    delete data._meta.weekly_cumul_base[oldest];
  }

  // 4️⃣ Écriture UNIQUE de la tendance hebdomadaire
  data.analysis.evolution_text =
    buildEvolutionText(data.stats_weekly_snapshot[weekKey]);

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`✔ Weekly stats OK → ${file}`);
}
