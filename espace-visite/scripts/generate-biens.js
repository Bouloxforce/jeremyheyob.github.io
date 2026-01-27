import fs from "fs";
import path from "path";

// Dossiers
const BIENS_DIR = "espace-visite/biens";
const OUTPUT_FILE = "espace-visite/biens.json";

// Structure finale
const result = {
  disponibles: [],
  sous_compromis: []
};

// Sécurité
if (!fs.existsSync(BIENS_DIR)) {
  console.error("❌ Dossier espace-visite/biens introuvable");
  process.exit(1);
}

// Parcours des biens
const dossiers = fs.readdirSync(BIENS_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

for (const slug of dossiers) {
  const dataPath = path.join(BIENS_DIR, slug, "data.json");

  if (!fs.existsSync(dataPath)) continue;

  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

  if (!data.nom || !data.ville || !data.photos_count || data.photos_count < 1) {
    console.warn(`⚠️ Bien ignoré (données incomplètes) : ${slug}`);
    continue;
  }

  const bien = {
    nom: data.nom,
    slug,
    ville: data.infos?.Secteur
      ? `${data.ville} - Secteur ${data.infos.Secteur}`
      : data.ville,
    type: data.type || "",
    surface: data.surface || null,
    exterieur: data.exterieur || null,
    annee: data.annee || null,
    etage: data.etage || null,
    photo: `/espace-visite/biens/${slug}/photos/photo-accueil.webp`
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
