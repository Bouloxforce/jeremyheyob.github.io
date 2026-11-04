import fs from "node:fs";
import path from "node:path";

const sourceDir = "espace-client/biens";
const destDir = "espace-visite/biens";
const templatePath = "espace-visite/archives/template_data.json";
const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));
let created = 0;

for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith("_data.json")) continue;
  const slug = entry.name.slice(0, -10);
  const bienDir = path.join(destDir, slug);
  const outputPath = path.join(bienDir, entry.name);
  if (fs.existsSync(outputPath)) continue;

  const source = JSON.parse(fs.readFileSync(path.join(sourceDir, entry.name), "utf8"));
  const data = JSON.parse(JSON.stringify(template));
  data.slug = slug;
  data.nom = source.bien && source.bien.nom ? source.bien.nom : "";
  data.statut = source.statut_bien === "sous_compromis" ? "sous_compromis" : "disponible";

  const address = source.bien && source.bien.adresse_complete ? source.bien.adresse_complete : "";
  const postalStart = address.search(/[0-9]{5}/);
  data.ville = postalStart >= 0 ? address.slice(postalStart + 5).trim() : "";

  fs.mkdirSync(path.join(bienDir, "photos"), { recursive: true });
  fs.mkdirSync(path.join(bienDir, "documents"), { recursive: true });
  fs.writeFileSync(path.join(bienDir, "photos", "invalid"), "");
  fs.writeFileSync(path.join(bienDir, "documents", "invalid"), "");
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2) + String.fromCharCode(10), "utf8");
  created++;
  console.log("Dossier espace-visite créé : " + slug);
}

console.log("Création terminée : " + created + " nouveau(x) dossier(s).");
