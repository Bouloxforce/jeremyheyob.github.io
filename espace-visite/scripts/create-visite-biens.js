import fs from "node:fs";
import path from "node:path";

const sourceDir = "espace-client/biens";
const destDir = "espace-visite/biens";
const templatePath = "espace-visite/archives/template_data.json";
const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));

function emptyLike(value) {
  if (Array.isArray(value)) return [];
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).map(key => [key, emptyLike(value[key])]));
  }
  if (typeof value === "number") return null;
  if (typeof value === "boolean") return false;
  return "";
}

function cityFromAddress(address) {
  if (typeof address !== "string") return "";
  const match = address.match(/\b\d{5}\s+(.+)$/);
  return match ? match[1].trim() : "";
}

function assertNoAddressLeak(data) {
  function visit(value, key = "") {
    if (/adresse|address/i.test(key) && typeof value === "string" && value.trim()) {
      throw new Error("Publication bloquée : un champ d'adresse non vide est présent dans les données publiques.");
    }
    if (value && typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey);
    }
  }
  visit(data);
}

if (!fs.existsSync(sourceDir)) {
  console.log("Aucun dossier source de biens : rien à créer.");
  process.exit(0);
}

let created = 0;
let skippedPaused = 0;
for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith("_data.json")) continue;

  const slug = entry.name.slice(0, -10);
  if (!/^[a-z0-9-]+$/i.test(slug)) {
    throw new Error("Slug invalide : " + entry.name);
  }

  const bienDir = path.join(destDir, slug);
  const outputPath = path.join(bienDir, entry.name);
  if (fs.existsSync(outputPath)) continue;

  const source = JSON.parse(fs.readFileSync(path.join(sourceDir, entry.name), "utf8"));
  const sourceStatus = source?.statut_bien;
  if (sourceStatus === "en_pause") {
    skippedPaused++;
    console.log("Bien en pause, aucun dossier public créé : " + slug);
    continue;
  }
  if (!["en_ligne", "sous_compromis"].includes(sourceStatus)) {
    throw new Error("Statut source inconnu ou absent pour " + slug + " : " + String(sourceStatus));
  }

  const data = emptyLike(template);
  const publicName = typeof source?.bien?.nom === "string" ? source.bien.nom.trim() : "";
  const publicCity = cityFromAddress(source?.bien?.adresse_complete);

  data.slug = slug;
  data.nom = publicName;
  if (data.bien && typeof data.bien === "object") data.bien.nom = publicName;
  data.statut = sourceStatus === "sous_compromis" ? "sous_compromis" : "disponible";
  data.ville = publicCity;

  // Aucune adresse (même partielle) ne doit être copiée dans l'espace public.
  assertNoAddressLeak(data);

  fs.mkdirSync(path.join(bienDir, "photos"), { recursive: true });
  fs.mkdirSync(path.join(bienDir, "documents"), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  created++;
  console.log("Dossier espace-visite créé : " + slug);
}

console.log("Création terminée : " + created + " nouveau(x) dossier(s), " + skippedPaused + " bien(s) en pause ignoré(s).");
