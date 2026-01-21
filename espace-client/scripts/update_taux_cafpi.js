import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";

const BIENS_DIR = path.join("espace-client", "biens");
const URL = "https://www.cafpi.fr/credit-immobilier/barometre-taux";

async function run() {
  // =========================
  // 1️⃣ Chargement page CAFPI
  // =========================
  const res = await fetch(URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; taux-scraper/1.0)",
      "Accept": "text/html"
    }
  });

  if (!res.ok) {
    throw new Error("Impossible de charger la page CAFPI");
  }

  const html = await res.text();
  const dom = new JSDOM(html);
  const document = dom.window.document;

  // =========================
  // 2️⃣ Extraction taux moyen 25 ans
  // =========================
  let tauxMoyen25 = null;

  document.querySelectorAll("table tr").forEach(row => {
    const cells = [...row.querySelectorAll("td")];
    if (cells.length < 3) return;

    const duree = cells[0].textContent.trim();

    // On cible strictement la ligne "25 ans"
    if (/^25\s*ans$/i.test(duree)) {
      const tauxMoyenText = cells[2].textContent.trim(); // ✅ colonne "taux moyen"

      const match = tauxMoyenText.match(/([0-9]+(?:[.,][0-9]+)?)/);
      if (match) {
        tauxMoyen25 = parseFloat(match[1].replace(",", "."));
      }
    }
  });

  if (!Number.isFinite(tauxMoyen25)) {
    throw new Error("Taux moyen 25 ans CAFPI introuvable");
  }

  // =========================
  // 3️⃣ Mise à jour du JSON
  // =========================
  const files = fs
    .readdirSync(BIENS_DIR)
    .filter(f => f.endsWith("_data.json"));

  for (const file of files) {
    const filePath = path.join(BIENS_DIR, file);

    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const precedent = Number(data?.marche?.taux_credit?.moyen) || null;

      data.marche ??= {};
      data.marche.taux_credit = {
        moyen: tauxMoyen25,
        precedent: precedent,
        duree: "25 ans",
        source: "CAFPI – baromètre (taux moyen)",
        periode: new Date().toISOString().slice(0, 7),
        updatedAt: new Date().toISOString()
      };

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");

      console.log(`✔ Taux CAFPI mis à jour pour ${file}`);
    } catch (err) {
      console.warn(`⚠️ Erreur mise à jour ${file} :`, err.message);
    }
  }
}

// =========================
// ▶️ Exécution
// =========================
run().catch(err => {
  console.warn("⚠️ Taux CAFPI non mis à jour (conservation du dernier taux) :", err.message);
  // On ne casse PAS la CI : dépendance externe non bloquante
  process.exit(0);
});
