import fs from "fs";
import path from "path";

/* =========================
   PARAMÈTRES
========================= */

const BIENS_DIR = path.join("espace-client", "biens");

/* =========================
   OUTILS
========================= */

function getWeekKey() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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

  const weekKey = getWeekKey();

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

  data.stats_weekly_snapshot[weekKey] = {
    appels: toNumber(data.stats.cumul.appels) - base.appels,
    emails: toNumber(data.stats.cumul.emails) - base.emails,
    visites_effectuees: toNumber(data.stats.cumul.visites_effectuees) - base.visites_effectuees,
    offres: toNumber(data.stats.cumul.offres) - base.offres,
    vues_leboncoin: toNumber(data.stats.cumul.vues_leboncoin) - base.vues_leboncoin,
    favoris_leboncoin: toNumber(data.stats.cumul.favoris_leboncoin) - base.favoris_leboncoin
  };

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`✔ Snapshot hebdomadaire mis à jour : ${fichier}`);
}
