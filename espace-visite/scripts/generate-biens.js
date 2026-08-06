import fs from "fs";
import path from "path";

// Dossiers
const BIENS_DIR = "espace-visite/biens";
const OUTPUT_FILE = "espace-visite/biens.json";
const CLIENT_DIR = "espace-client/biens";

// Structure finale
const result = {
  disponibles: [],
  sous_compromis: []
};

function readJson(filePath) {
  return JSON.parse(
    fs.readFileSync(filePath, "utf8")
  );
}

function readJson(filePath) {
  return JSON.parse(
    fs.readFileSync(filePath, "utf8")
  );
}

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

if (!fs.existsSync(dataPath)) {
  console.warn(`⚠️ JSON visite introuvable : ${slug}`);
  continue;
}

const data = readJson(dataPath);

const clientPath = path.join(CLIENT_DIR, `${slug}_data.json`);

if (!fs.existsSync(clientPath)) {
  console.warn(`⚠️ JSON client introuvable : ${slug}`);
  continue;
}

const clientData = readJson(clientPath);

const photosDir = path.join(bienDir, "photos");

const photos = fs.existsSync(photosDir)
  ? fs.readdirSync(photosDir).filter(file => {

      const lower = file.toLowerCase();

      if (lower === "photo-accueil.webp") {
        return false;
      }

      return /\.(webp|jpg|jpeg|png)$/i.test(file);

    })
  : [];

if (!clientData?.bien?.nom || !data.ville || photos.length === 0) {

  console.warn(`⚠️ Bien ignoré : ${slug}`);

} else {

  const bien = {

    nom: clientData.bien.nom,

    slug,

    ville: data.infos?.Secteur
      ? `${data.ville} - Secteur ${data.infos.Secteur}`
      : data.ville,

    bien_type: data.bien_type,
    type: data.type || "",
    surface: data.surface || null,
    exterieur: data.exterieur || null,
    annee: data.annee || null,
    etage: data.etage || null

  };

  if (data.statut === "sous_compromis") {
    result.sous_compromis.push(bien);
  } else {
    result.disponibles.push(bien);
  }

}
    const data = readJson(dataPath);

const clientPath = path.join(CLIENT_DIR, `${slug}_data.json`);

if (!fs.existsSync(clientPath)) {
  console.warn(`⚠️ JSON client introuvable : ${slug}`);
  continue;
}

const clientData = readJson(clientPath);

const photosDir = path.join(bienDir, "photos");

const photos = fs.existsSync(photosDir)
  ? fs.readdirSync(photosDir).filter(file => {

      const lower = file.toLowerCase();

      if (lower === "photo-accueil.webp") {
        return false;
      }

      return /\.(webp|jpg|jpeg|png)$/i.test(file);

    })
  : [];

if (!clientData?.bien?.nom || !data.ville || photos.length === 0) {

  console.warn(`⚠️ Bien ignoré : ${slug}`);

} else {

  const bien = {

    nom: clientData.bien.nom,
    slug,

    ville: data.infos?.Secteur
      ? `${data.ville} - Secteur ${data.infos.Secteur}`
      : data.ville,

    bien_type: data.bien_type,
    type: data.type || "",
    surface: data.surface || null,
    exterieur: data.exterieur || null,
    annee: data.annee || null,
    etage: data.etage || null

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

result.disponibles.sort((a, b) =>
  a.nom.localeCompare(b.nom, "fr")
);

result.sous_compromis.sort((a, b) =>
  a.nom.localeCompare(b.nom, "fr")
);

// Écriture du fichier biens.json
fs.writeFileSync(
  OUTPUT_FILE,
  JSON.stringify(result, null, 2),
  "utf8"
);

console.log("✅ biens.json généré avec succès");
