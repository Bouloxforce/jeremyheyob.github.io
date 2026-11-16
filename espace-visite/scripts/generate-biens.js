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
  const bienDir = path.join(BIENS_DIR, slug);
  const dataPath = path.join(BIENS_DIR, slug, `${slug}_data.json`);
  const documentsDir = path.join(bienDir, "documents");
  const documentsJsonPath = path.join(bienDir, "documents.json");

  // ---------- BIENS.JSON ----------
  if (fs.existsSync(dataPath)) {
    const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

    if (!data.nom || !data.ville || !data.photos_count || data.photos_count < 1) {
      console.warn(`⚠️ Bien ignoré (données incomplètes) : ${slug}`);
    } else {
      const bien = {
        nom: data.nom,
        slug,
        ville: data.infos?.Secteur
          ? `${data.ville} - Secteur ${data.infos.Secteur}`
          : data.ville,
        bien_type: data.bien_type,   // 👈 ICI
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
  }

  // ---------- DOCUMENTS.JSON ----------
  if (fs.existsSync(documentsDir)) {
    const files = fs.readdirSync(documentsDir)
      .filter(f => f.toLowerCase().endsWith(".pdf"));

    const documents = files.map(file => ({
      file,
      title: path.basename(file, path.extname(file))
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, l => l.toUpperCase())
    }));

    fs.writeFileSync(
      documentsJsonPath,
      JSON.stringify(documents, null, 2),
      "utf8"
    );

    console.log(`📄 documents.json généré pour ${slug}`);
  }
}

// Écriture du fichier biens.json
fs.writeFileSync(
  OUTPUT_FILE,
  JSON.stringify(result, null, 2),
  "utf8"
);

console.log("✅ biens.json généré avec succès");
