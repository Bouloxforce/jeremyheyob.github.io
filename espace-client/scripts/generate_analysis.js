import fs from "fs";
import path from "path";

/* =========================
   CONFIG
========================= */

const FILE = path.resolve("espace-client/nael/nael_data.json");

/* =========================
   OUTILS
========================= */

function hasCompromis(historique) {
  if (!Array.isArray(historique)) return false;

  return historique.some(e =>
    typeof e.action === "string" &&
    e.action.toLowerCase().includes("compromis")
  );
}

function daysBetween(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return null;

  const now = new Date();
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}

/* =========================
   ANALYSE STRATÉGIQUE
========================= */

function buildAnalysis(data) {

  /* 🔴 PRIORITÉ ABSOLUE : COMPROMIS */
  if (hasCompromis(data.historique)) {
    return {
      text:
        "✍️ Un acquéreur a été trouvé et validé.\n\n" +
        "La commercialisation du bien est désormais finalisée.",
      proposeRDV: false,
      noAlertes: true
    };
  }

  const jours = daysBetween(data.dates?.mise_en_ligne);

  if (jours === null) {
    return {
      text: "Analyse indisponible à ce stade.",
      proposeRDV: false,
      noAlertes: false
    };
  }

  const vues = Number(data.stats?.vues_leboncoin || 0);
  const appels = Number(data.stats?.appels || 0);
  const visites = Number(data.stats?.visites_effectuees || 0);

  /* 🔎 STATISTIQUES INSUFFISANTES – MARCHÉ LOCAL */
  const statsInsuffisantes =
    vues < 200 ||
    appels < 3 ||
    visites < 2 ||
    (appels > 0 && vues / appels > 100);

  /* =========================
     🟢 MOINS DE 21 JOURS
  ========================= */
  if (jours < 21) {
    return {
      text:
        "Le bien est en commercialisation depuis " + jours + " jours.\n\n" +
        "Cette phase correspond à une diffusion normale sur le marché local. " +
        "La stratégie actuelle est maintenue.",
      proposeRDV: false,
      noAlertes: false
    };
  }

  /* =========================
     🟠 ENTRE 21 ET 29 JOURS
     + STATISTIQUES INSUFFISANTES
  ========================= */
  if (jours >= 21 && jours < 30 && statsInsuffisantes) {
    return {
      text:
        "Le bien est en commercialisation depuis " + jours + " jours.\n\n" +
        "Les indicateurs sont en-dessous des standards observés sur le marché local.\n\n" +
        "Si les chiffres ne s’améliorent pas dans les prochains jours, " +
        "nous programmerons un rendez-vous afin d’envisager un changement de stratégie.",
      proposeRDV: false,
      noAlertes: false
    };
  }

  /* =========================
     🔴 30 JOURS OU PLUS
     + STATISTIQUES INSUFFISANTES
     => CHANGEMENT DE STRATÉGIE
  ========================= */
  if (jours >= 30 && statsInsuffisantes) {
    return {
      text:
        "Après plus de " + jours + " jours de commercialisation, " +
        "les chiffres confirment que la stratégie actuelle n’est pas adaptée au marché local.\n\n" +
        "Un changement de stratégie devient indispensable afin de relancer efficacement la vente.",
      proposeRDV: true,
      noAlertes: false
    };
  }

  /* =========================
     🟢 STATISTIQUES COHÉRENTES
  ========================= */
  return {
    text:
      "Le bien est en commercialisation depuis " + jours + " jours.\n\n" +
      "Les indicateurs observés sont cohérents avec le marché local. " +
      "La stratégie actuelle est maintenue.",
    proposeRDV: false,
    noAlertes: false
  };
}

/* =========================
   EXÉCUTION
========================= */

// 1️⃣ Lecture du JSON
const raw = fs.readFileSync(FILE, "utf-8");
const data = JSON.parse(raw);

// 2️⃣ Génération de l’analyse
const analysis = buildAnalysis(data);

// 3️⃣ Injection dans le JSON
data.analysis = {
  text: analysis.text,
  proposeRDV: analysis.proposeRDV,
  noAlertes: analysis.noAlertes,
  generatedAt: new Date().toISOString()
};

// 4️⃣ Écriture du fichier
fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf-8");

// 5️⃣ Déclencheur GitHub Actions (MAIL)
if (analysis.proposeRDV === true && process.env.GITHUB_ENV) {
  fs.appendFileSync(
    process.env.GITHUB_ENV,
    "RDV_RECOMMANDE=true\n"
  );
}
