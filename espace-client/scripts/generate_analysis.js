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

function buildAnalysis(data) {

  /* =========================
     🔴 PRIORITÉ ABSOLUE : COMPROMIS
  ========================= */
  if (hasCompromis(data.historique)) {
    return {
      text:
        "Acquéreur trouvé et validé.\n\n" +
        "La commercialisation du bien est désormais finalisée.",
      proposeRDV: false,
      noAlertes: true
    };
  }

  /* =========================
     📊 DONNÉES DE BASE
  ========================= */
  const jours = daysBetween(data.dates?.mise_en_ligne);

  const vues = Number(data.stats?.vues_leboncoin || 0);
  const appels = Number(data.stats?.appels || 0);
  const visites = Number(data.stats?.visites_effectuees || 0);

  const statsFaibles =
    vues < 150 ||
    appels < 2 ||
    visites < 1;

  if (jours === null) {
    return {
      text: "Analyse indisponible.",
      proposeRDV: false,
      noAlertes: false
    };
  }

  /* =========================
     🟢 < 21 JOURS
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
     🟠 ≥ 21 JOURS — PRÉ-ALERTE
  ========================= */
  if (jours >= 21 && jours < 30 && statsFaibles) {
    return {
      text:
        "Le bien est en commercialisation depuis " + jours + " jours.\n\n" +
        "Les indicateurs montrent une dynamique commerciale inférieure aux standards " +
        "observés sur le marché local. Cette situation nécessite une vigilance particulière.\n\n" +
        "Nous poursuivons l’analyse afin d’évaluer si des ajustements stratégiques " +
        "seront nécessaires prochainement.",
      proposeRDV: false,
      noAlertes: false
    };
  }

  /* =========================
     🔴 ≥ 30 JOURS — ACTION
  ========================= */
  if (jours >= 30 && statsFaibles) {
    return {
      text:
        "Le bien est en commercialisation depuis " + jours + " jours.\n\n" +
        "Les statistiques confirment une dynamique commerciale insuffisante " +
        "par rapport au marché local. Afin d’optimiser la vente, un ajustement " +
        "de la stratégie devient pertinent.\n\n" +
        "Je vous propose que nous organisions un rendez-vous afin d’analyser " +
        "ensemble les leviers possibles et définir les actions à mettre en place.",
      proposeRDV: true,
      noAlertes: false
    };
  }

  /* =========================
     🟢 STATS OK APRÈS 21 JOURS
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
