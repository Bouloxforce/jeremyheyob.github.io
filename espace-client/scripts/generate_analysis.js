/* ======================================================
   OUTILS
====================================================== */

function daysBetween(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return null;

  const now = new Date();
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ======================================================
   ANALYSE STRATÉGIQUE PRINCIPALE
====================================================== */

function buildAnalysis(data) {

  /* =========================
     📅 DURÉE DE COMMERCIALISATION
  ========================= */

  const jours = daysBetween(data.dates?.mise_en_ligne);

  if (jours === null) {
    return {
      text: "Analyse indisponible : date de mise en ligne manquante.",
      proposeRDV: false,
      noAlertes: false
    };
  }

  const mois = Math.max(jours / 30, 1); // minimum 1 mois

  /* =========================
     📊 DONNÉES BRUTES
  ========================= */

  const vues = toNumber(data.stats?.vues_leboncoin);
  const appels = toNumber(data.stats?.appels);
  const visites = toNumber(data.stats?.visites_effectuees);

  /* =========================
     📈 NORMALISATION MENSUELLE
  ========================= */

  const vuesMensuelles = vues / mois;
  const appelsMensuels = appels / mois;
  const visitesMensuelles = visites / mois;

  /* =========================
     🎯 SEUILS MENSUELS
     (marché résidentiel standard,
      multi-diffusion active)
  ========================= */

  const SEUILS = {
    vuesMensuelles: 200,
    appelsMensuels: 3,
    visitesMensuelles: 2,
    vuesParAppel: 100
  };

  /* =========================
     🚨 STATS INSUFFISANTES
  ========================= */

  const statsInsuffisantes =
    vuesMensuelles < SEUILS.vuesMensuelles ||
    appelsMensuels < SEUILS.appelsMensuels ||
    visitesMensuelles < SEUILS.visitesMensuelles ||
    (appels > 0 && vues / appels > SEUILS.vuesParAppel);

  /* ======================================================
     🟢 MOINS DE 21 JOURS
  ====================================================== */

  if (jours < 21) {
    return {
      text:
        "Le bien est en commercialisation depuis " + jours + " jours.\n\n" +
        "Cette phase correspond à une période normale d’exposition. " +
        "La stratégie actuelle est maintenue et les indicateurs seront suivis attentivement.",
      proposeRDV: false,
      noAlertes: false
    };
  }

  /* ======================================================
     🟠 ENTRE 21 ET 30 JOURS
     → PRÉPARATION DU CLIENT
  ====================================================== */

  if (jours >= 21 && jours < 30 && statsInsuffisantes) {
    return {
      text:
        "Le bien est en commercialisation depuis " + jours + " jours.\n\n" +
        "Les indicateurs observés sont insuffisants au regard de la durée de diffusion. " +
        "Si cette tendance se confirme dans les prochains jours, " +
        "un point stratégique sera nécessaire afin d’envisager un changement de stratégie.\n\n" +
        "Je reste attentif à l’évolution de la situation.",
      proposeRDV: false,
      noAlertes: false
    };
  }

  /* ======================================================
     🔴 30 JOURS ET PLUS
     → CHANGEMENT DE STRATÉGIE
  ====================================================== */

  if (jours >= 30 && statsInsuffisantes) {
    return {
      text:
        "Le bien est en commercialisation depuis " + jours + " jours.\n\n" +
        "Les statistiques confirment une performance insuffisante par rapport " +
        "à la durée de diffusion. Dans ce contexte, " +
        "un changement de stratégie est désormais nécessaire.\n\n" +
        "Je vous propose que nous organisions un rendez-vous afin de faire un point complet " +
        "et définir ensemble les actions à mettre en place pour relancer efficacement la vente.",
      proposeRDV: true,
      noAlertes: false
    };
  }

  /* ======================================================
     🟢 STATS COHÉRENTES
  ====================================================== */

  return {
    text:
      "Le bien est en commercialisation depuis " + jours + " jours.\n\n" +
      "Les indicateurs observés sont cohérents avec la durée de diffusion. " +
      "La stratégie actuelle est maintenue.",
    proposeRDV: false,
    noAlertes: false
  };
}

/* ======================================================
   EXPORT / UTILISATION
====================================================== */

export { buildAnalysis };
