/* ======================================================
   IMPORTS
====================================================== */

import fs from "fs";
import https from "https";
import path from "path";
import { execSync } from "child_process";

/* ======================================================
   CONFIGURATION – SOURCE BANQUE DE FRANCE (WEBSTAT)
====================================================== */

// Série officielle Banque de France
// MIR1 – Crédits nouveaux à l’habitat – durée ≥ 20 ans
const WEBSTAT_URL =
  "https://api.webstat.banque-france.fr/webstat-fr/v1/data/series/MIR1/MIR1.M.FR.B.A22.A.R.A.2254U6.EUR.N";

/* ======================================================
   FETCH JSON (ROBUSTE)
====================================================== */

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        let data = "";

        res.on("data", chunk => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(
              new Error("❌ Impossible de parser le JSON Webstat")
            );
          }
        });
      })
      .on("error", err => {
        reject(
          new Error("❌ Erreur réseau Webstat : " + err.message)
        );
      });
  });
}

/* ======================================================
   EXTRACTION DU DERNIER TAUX DISPONIBLE
====================================================== */

function extractLatestRateFromWebstat(json) {
  const observations =
    json?.series?.[0]?.observations;

  if (!Array.isArray(observations) || observations.length === 0) {
    return null;
  }

  // Dernière observation chronologique
  const last = observations[observations.length - 1];

  const value = Number(last?.value);

  return Number.isFinite(value) ? value : null;
}

/* ======================================================
   LECTURE DU TAUX PRÉCÉDENT (GIT)
====================================================== */

function readPreviousRateFromGit(filePath) {
  try {
    const previousFile = execSync(
      `git show HEAD~1:${filePath}`,
      { encoding: "utf8" }
    );

    const previousData = JSON.parse(previousFile);

    return previousData?.marche?.taux_credit?.moyen ?? null;

  } catch {
    // Premier run / historique indisponible
    return null;
  }
}

/* ======================================================
   MAIN
====================================================== */

async function run() {
  console.log("📊 Récupération du taux Banque de France (Webstat)…");

  const json = await fetchJSON(WEBSTAT_URL);
  const taux = extractLatestRateFromWebstat(json);

  if (!Number.isFinite(taux)) {
    console.warn("⚠️ Aucun taux valide trouvé – arrêt sans écriture");
    return;
  }

  console.log(`✔ Taux récupéré : ${taux.toFixed(2)} %`);

  const baseDir = "espace-client";

  if (!fs.existsSync(baseDir)) {
    console.warn(`⚠️ Dossier "${baseDir}" introuvable`);
    return;
  }

  const dossiers = fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const periode = new Date().toISOString().slice(0, 7); // YYYY-MM

  for (const bien of dossiers) {
    const filePath = path.join(baseDir, bien, `${bien}_data.json`);

    if (!fs.existsSync(filePath)) continue;

    const data = JSON.parse(
      fs.readFileSync(filePath, "utf-8")
    );

    const tauxPrecedent = readPreviousRateFromGit(filePath);

    data.marche = data.marche || {};
    data.marche.taux_credit = {
      moyen: taux,
      precedent: tauxPrecedent,
      duree: "25 ans",
      source: "Banque de France – Webstat (MIR1)",
      periode
    };

    fs.writeFileSync(
      filePath,
      JSON.stringify(data, null, 2),
      "utf-8"
    );

    console.log(`✔ Taux mis à jour pour : ${bien}`);
  }
}

/* ======================================================
   EXECUTION
====================================================== */

run().catch(err => {
  console.error("❌ Erreur critique mise à jour taux :", err);
  process.exit(1);
});
