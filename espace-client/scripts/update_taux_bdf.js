import fs from "fs";
import https from "https";
import path from "path";
import { execSync } from "child_process";

const CSV_URL =
  "https://www.banque-france.fr/system/files/2024-12/taux-credits-habitat.csv";

/* =========================
   RÉCUPÉRATION CSV
========================= */
function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        let data = "";
        res.on("data", chunk => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

/* =========================
   EXTRACTION TAUX (ROBUSTE)
========================= */
function extractTaux(csv) {
  const lines = csv.split("\n");

  const target = lines.find(line => {
    const l = line.toLowerCase();
    return (
      l.includes("crédit") &&
      l.includes("habitat") &&
      (l.includes("20") || l.includes("plus"))
    );
  });

  if (!target) return null;

  const cols = target.split(";");

  // Recherche du dernier nombre valide (robuste aux changements de colonnes)
  for (let i = cols.length - 1; i >= 0; i--) {
    const value = parseFloat(cols[i].replace(",", "."));
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

/* =========================
   LECTURE TAUX PRÉCÉDENT VIA GIT
========================= */
function readPreviousRateFromGit(filePath) {
  try {
    const previousFile = execSync(
      `git show HEAD~1:${filePath}`,
      { encoding: "utf8" }
    );

    const previousData = JSON.parse(previousFile);
    return previousData?.marche?.taux_credit?.moyen ?? null;

  } catch {
    // Premier run / fichier absent / historique indisponible
    return null;
  }
}

/* =========================
   MAIN
========================= */
async function run() {
  const csv = await fetchCSV(CSV_URL);
  const taux = extractTaux(csv);

  // 🔒 Sécurité : ne casse pas le workflow si la BDF change
  if (!taux) {
    console.warn("⚠️ Taux non trouvé – aucune mise à jour effectuée");
    return;
  }

  const baseDir = "espace-client";

  if (!fs.existsSync(baseDir)) {
    console.warn(`⚠️ Dossier "${baseDir}" introuvable`);
    return;
  }

  const dossiers = fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const periode = new Date().toISOString().slice(0, 7);

  for (const bien of dossiers) {
    const filePath = path.join(baseDir, bien, `${bien}_data.json`);
    if (!fs.existsSync(filePath)) continue;

    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    const tauxPrecedent = readPreviousRateFromGit(filePath);

    data.marche = data.marche || {};
    data.marche.taux_credit = {
      moyen: taux,
      precedent: tauxPrecedent,
      duree: "25 ans",
      source: "Banque de France",
      periode
    };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`✔ Taux mis à jour pour ${bien}`);
  }
}

run().catch(err => {
  console.error("❌ Erreur script taux BDF :", err);
});
