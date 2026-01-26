/**
 * Génère automatiquement espace-visite/biens.json
 * à partir des data.json présents dans :
 * espace-visite/biens/*/data.json
 *
 * Exécuté par GitHub Actions (Node 18)
 */

import fs from "fs";
import path from "path";

const BIENS_DIR = "espace-visite/biens";
const OUTPUT_FILE = "espace-visite/biens.json";

const result = {
  disponibles: [],
  sous_compromis: []
};

// Sécurité : le dossier biens doit exister
if (!fs.existsSync(BIENS_DIR)) {
  console.error(`❌ Dossier introuvable : ${BIENS_DIR}`);
  process.exit(1);
}

// Parcours de tous les dossiers de biens
const dossiers = fs.readdirSync(BIENS_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

for (const slug of dossiers) {
  const dataPath = path.join(BIENS_DIR, slug, "data.json");

  if (!fs.existsSync(dataPath)) {
    console.warn(`⚠️ data.json manquant pour le bien : ${slug}`);
    continue;
  }

  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

  // Champs OBLIGATOIRES
  if (!data.nom || !data.ville || !data.photos || !data.photos.length) {
    console.warn(`⚠️ Bien ignoré (champs manquants) : ${slug}`);
    continue;
  }

  const bien = {
    nom: data.nom,
    slug: slug,
    ville: data.ville,
    type: data.type || "",
    surface: data.surface || null,
    exterieur: data.exterieur || null,
    annee: data.annee || null,
    etage: data.etage || null,
    photo: `/espace-visite/biens/${slug}/photos/${data.photos[0]}`
  };

  if (data.statut === "sous_compromis") {
    result.sous_compromis.push(bien);
  } else {
    result.disponibles.push(bien);
  }
}

// Écriture du fichier final
fs.writeFileSync(
  OUTPUT_FILE,
  JSON.stringify(result, null, 2),
  "utf8"
);

console.log("✅ biens.json généré avec succès");
console.log(`   → ${result.disponibles.length} bien(s) disponible(s)`);
console.log(`   → ${result.sous_compromis.length} bien(s) sous compromis`);
