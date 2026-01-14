import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";

const BIEN = "nael";
const FILE_PATH = path.join("espace-client", BIEN, `${BIEN}_data.json`);
const URL = "https://www.cafpi.fr/credit-immobilier/barometre-taux";

async function run() {
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

  let tauxMoyen25 = null;

  // 🔍 Recherche ciblée dans les tableaux
  document.querySelectorAll("table tr").forEach(row => {
    const cells = [...row.querySelectorAll("td")];
    if (cells.length >= 3) {
      const duree = cells[0].textContent.trim();

      if (/25\s*ans/i.test(duree)) {
        const tauxMoyenText = cells[2].textContent.trim(); // colonne "taux moyen"

        const match = tauxMoyenText.match(/([0-9]+(?:[.,][0-9]+)?)/);
        if (match) {
          tauxMoyen25 = parseFloat(match[1].replace(",", "."));
        }
      }
    }
  });

  if (!Number.isFinite(tauxMoyen25)) {
    throw new Error("Taux moyen 25 ans CAFPI introuvable");
  }

  const data = JSON.parse(fs.readFileSync(FILE_PATH, "utf-8"));
  const precedent = data.marche?.taux_credit?.moyen ?? null;

  data.marche = data.marche || {};
  data.marche.taux_credit = {
    moyen: tauxMoyen25,
    precedent: precedent,
    duree: "25 ans",
    source: "CAFPI – baromètre (taux moyen)",
    periode: new Date().toISOString().slice(0, 7)
  };

  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), "utf-8");

  console.log("✔ Taux moyen CAFPI 25 ans mis à jour :", tauxMoyen25);
}

run().catch(err => {
  console.error("❌ Erreur taux CAFPI :", err.message);
  process.exit(1);
});
