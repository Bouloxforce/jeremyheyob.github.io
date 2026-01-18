import fs from "fs";
import path from "path";

/* =========================
   PARAMÈTRES
========================= */

// ⚠️ À adapter si besoin
const BIENS_DIR = path.join("espace-client", "biens");

/* =========================
   OUTILS
========================= */

// Retourne le lundi de la semaine courante (clé snapshot)
function getWeekKey() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);

  // ramène au lundi
  const day = d.getDay(); // 0 = dimanche
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);

  return d.toISOString().slice(0, 10);
}

// Conversion sécurisée
function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Vérifie si toutes les valeurs sont à 0
function isAllZero(obj) {
  return Object.values(obj).every(v => v === 0);
}

/* =========================
   EXÉCUTION
========================= */

if (!fs.existsSync(BIENS_DIR)) {
  console.error("❌ Dossier biens introuvable");
  process.exit(1);
}

const fichiers = fs
  .readdirSync(BIENS_DIR)
  .filter(f => f.endsWith("_data.json"));

for (const fichier of fichiers) {
  const filePath = path.join(BIENS_DIR, fichier);
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw);

  // Sécurité structure
  data.stats = data.stats || {};
  data.stats.actuel = data.stats.actuel || {};
  data.stats_weekly_snapshot = data.stats_weekly_snapshot || {};
  data.analysis = data.analysis || {};

  const weekKey = getWeekKey();

  // 🔹 SNAPSHOT DE LA SEMAINE ÉCOULÉE
  const snapshot = {
    appels: toNumber(data.stats.actuel.appels),
    emails: toNumber(data.stats.actuel.emails),
    visites_effectuees: toNumber(data.stats.actuel.visites_effectuees),
    vues_leboncoin: toNumber(data.stats.actuel.vues_leboncoin),
    favoris_leboncoin: toNumber(data.stats.actuel.favoris_leboncoin)
  };

  // Enregistrement figé
  data.stats_weekly_snapshot[weekKey] = snapshot;

  // 🔹 COMPARAISON AVEC LA SEMAINE PRÉCÉDENTE
  const weeks = Object.keys(data.stats_weekly_snapshot).sort();

  if (weeks.length < 2) {
    data.analysis.evolution_text =
      "Les données d’évolution ne sont pas disponibles pour le moment.";
  } else {
    const current = data.stats_weekly_snapshot[weeks[weeks.length - 1]];
    const previous = data.stats_weekly_snapshot[weeks[weeks.length - 2]];

    if (isAllZero(previous)) {
      data.analysis.evolution_text =
        "Les données d’évolution ne sont pas disponibles pour le moment.";
    } else {
      const lines = [];

      function compare(label, key) {
        const diff = current[key] - previous[key];
        if (diff > 0) lines.push(`${label} : hausse de +${diff}`);
        else if (diff < 0) lines.push(`${label} : baisse de ${Math.abs(diff)}`);
        else lines.push(`${label} : stable`);
      }

      compare("Appels", "appels");
      compare("Emails", "emails");
      compare("Visites effectuées", "visites_effectuees");
      compare("Vues Leboncoin", "vues_leboncoin");
      compare("Favoris Leboncoin", "favoris_leboncoin");

      data.analysis.evolution_text = lines.join("\n");
    }
  }

  // Sauvegarde
  fs.writeFileSync(
    filePath,
    JSON.stringify(data, null, 2),
    "utf-8"
  );

  console.log(`✔ Snapshot hebdomadaire mis à jour : ${fichier}`);
}
