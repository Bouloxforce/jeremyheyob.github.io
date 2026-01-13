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
   EXTRACTION TAUX
========================= */
function extractTaux(csv) {
  const lines = csv.split("\n");

  const target = lines.find(l =>
    l.includes("Crédits à l’habitat") &&
    l.includes("supérieure à 20 ans")
  );

  if (!target) return null;

  const cols = target.split(";");
  const taux = parseFloat(cols[cols.length - 1].replace(",", "."));

  return Number.isFinite(taux) ? taux : null;
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

  } catch (err) {
    // Premier run / fichier absent / historique non dispo
    return null;
  }
}

/* =========================
   MAIN
========================= */
async function run() {
  const csv = await fetchCSV(CSV_URL);
  const taux = extractTaux(csv);

  if (!taux) {
    console.error("❌ Taux non trouvé");
    process.exit(1);
  }

  const baseDir = "espace-client";
  const dossiers = fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const now = new Date();
  const periode = now.toISOString().slice(0, 7);

  for (const bien of dossiers) {
    const filePath = path.join(baseDir, bien, `${bien}_data.json`);
    if (!fs.existsSync(filePath)) continue;

    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    // 🔑 Lecture du taux précédent depuis Git
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

run();
