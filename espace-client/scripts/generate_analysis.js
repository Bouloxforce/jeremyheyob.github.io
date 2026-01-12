const fs = require("fs");
const path = require("path");

// 📁 Dossier contenant tous les biens
const DATA_DIR = path.join(__dirname, "..", "espace-client");

// 🔍 Sélection stricte : *_data.json
const fichiers = fs.readdirSync(DATA_DIR, { withFileTypes: true })
  .filter(entry =>
    entry.isFile() &&
    entry.name.endsWith("_data.json")
  )
  .map(entry => entry.name);

if (fichiers.length === 0) {
  console.log("Aucun fichier *_data.json trouvé.");
  process.exit(0);
}

fichiers.forEach((filename) => {
  const filePath = path.join(DATA_DIR, filename);

  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  // Sécurité structure minimale
  if (!data.stats || !data.dates) {
    console.log("Structure invalide, fichier ignoré :", filename);
    return;
  }

  // Génération de l’analyse
  data.analyse = data.analyse || {};
  data.analyse.commentaire = buildAnalysis(data);
  data.analyse.genere_le = new Date().toISOString();

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

  console.log("Analyse générée pour :", filename);
});
