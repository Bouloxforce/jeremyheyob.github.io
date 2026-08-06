import fs from "fs";
import path from "path";

import {
  slugify,
  readJson,
  writeJson,
  ensureDirectory,
  exists
} from "./utils.js";

// --------------------------------------------------
// Dossiers du projet
// --------------------------------------------------

const CLIENT_DIR = "espace-client/biens";
const VISITE_DIR = "espace-visite/biens";
const TEMPLATE_PATH = "espace-visite/archives/template_data.json";

// --------------------------------------------------
// Vérifications
// --------------------------------------------------

if (!exists(CLIENT_DIR)) {
  console.error("❌ Dossier client introuvable.");
  process.exit(1);
}

if (!exists(TEMPLATE_PATH)) {
  console.error("❌ Template introuvable.");
  process.exit(1);
}

// --------------------------------------------------
// Lecture du template
// --------------------------------------------------

const template = readJson(TEMPLATE_PATH);

// --------------------------------------------------
// Recherche des biens
// --------------------------------------------------

const fichiers = fs.readdirSync(CLIENT_DIR)
  .filter(file => file.endsWith("_data.json"));

console.log(`📁 ${fichiers.length} bien(s) trouvé(s).`);
