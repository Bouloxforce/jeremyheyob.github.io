import fs from "node:fs";
import path from "node:path";

const SOURCE_DIR = "espace-client/biens";
const DEST_DIR = "espace-visite/biens";
const TEMPLATE_FILE = "espace-visite/archives/template_data.json";

if (!fs.existsSync(SOURCE_DIR)) {
  console.log("Aucun dossier source espace-client/biens.");
  process.exit(0);
}
if (!fs.existsSync(TEMPLATE_FILE)) {
  throw new Error(`Modèle introuvable : ${TEMPLATE_FILE}`);
}

const template = JSON.parse(fs.readFileSync(TEMPLATE_FILE, "utf8"));
const sources = fs.readdirSync(SOURCE_DIR, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith("_data.json"))
  .map(entry => entry.name)
  .sort();

function blankPublicData(slug) {
  return {
    ...template,
    slug,
    statut: "disponible",
    nom: "",
    bien_type: "",
    type: "",
    surface: null,
    exterieur: null,
    annee: null,
    etage: "",
    prix: null,
    charges: "",
    taxe_fonciere: "",
    ville: "",
    secteur: "",
    dpe: { energie: "", ges: "" },
    stationnement: "",
    chauffage: "",
    proximite: "",
    points_forts: [],
    photos_count: 0,
    video: "",
    annonce: ""
  };
}

let created = 0;

for (const filename of sources) {
  const slug = filename.slice(0, -"_data.json".length);
  const sourcePath = path.join(SOURCE_DIR, filename);
  const bienDir = path.join(DEST_DIR, slug);
  const publicJsonPath = path.join(bienDir, `${slug}_data.json`);

  if (fs.existsSync(publicJsonPath)) continue;

  const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const data = blankPublicData(slug);

  // Seules les informations déjà présentes dans le JSON client et utiles
  // à l'identification du bien sont reprises. Les autres champs restent vides.
  data.nom = source.bien?.nom || "";
  const address = source.bien?.adresse_complete || "";
  const cityMatch = address.match(/\\b\\d{5}\\s+(.+)$/);
  data.ville = cityMatch ? cityMatch[1].trim() : "";

  if (source.statut_bien === "sous_compromis") {
    data.statut = "sous_compromis";
  } else {
    data.statut = "disponible";
  }

  fs.mkdirSync(path.join(bienDir, "photos"), { recursive: true });
  fs.mkdirSync(path.join(bienDir, "documents"), { recursive: true });
  fs.writeFileSync(path.join(bienDir, "photos", "invalid"), "", { flag: "a" });
  fs.writeFileSync(path.join(bienDir, "documents", "invalid"), "", { flag: "a" });
  fs.writeFileSync(publicJsonPath, JSON.stringify(data, null, 2) + "\\n", "utf8");

  created++;
  console.log(`Dossier espace-visite créé : ${slug}`);
}

console.log(`Création terminée : ${created} nouveau(x) dossier(s).`);
