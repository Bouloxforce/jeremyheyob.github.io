import fs from "fs";

// --------------------------------------------------
// Transforme un texte en slug
// Exemple :
// "Résidence Les Érables"
// devient
// "residence-les-erables"
// --------------------------------------------------
export function slugify(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// --------------------------------------------------
// Lit un fichier JSON
// --------------------------------------------------
export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

// --------------------------------------------------
// Écrit un fichier JSON joliment formaté
// --------------------------------------------------
export function writeJson(filePath, data) {
  fs.writeFileSync(
    filePath,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

// --------------------------------------------------
// Vérifie qu'un dossier existe
// Sinon il le crée automatiquement
// --------------------------------------------------
export function ensureDirectory(dirPath) {

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

}

// --------------------------------------------------
// Vérifie qu'un fichier ou dossier existe
// --------------------------------------------------
export function exists(path) {
  return fs.existsSync(path);
}
