import importlib.util
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "sync", Path("espace-visite/scripts/sync_client_to_visite.py")
)
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class SyncTests(unittest.TestCase):
    def test_template_example_values_are_cleared(self):
        template = {
            "slug": "x", "nom": "Example", "prix": 123, "surface": 55,
            "dpe": {"energie": "D", "ges": "D"}, "points_forts": ["x"],
            "photos_count": 9, "video": "url", "annonce": "url",
        }
        data = M.blank_template(template, "new")
        self.assertEqual(data["nom"], "")
        self.assertIsNone(data["prix"])
        self.assertEqual(data["dpe"], {"energie": "", "ges": ""})
        self.assertEqual(data["photos_count"], 0)
        self.assertEqual(data["points_forts"], [])

    def test_pdf_extracts_surface_and_construction_year_read_only(self):
        import fitz
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            docs = folder / "documents"
            docs.mkdir()
            pdf_path = docs / "diagnostic.pdf"
            document = fitz.open()
            page = document.new_page()
            page.insert_text((72, 72), "Surface habitable : 62,5 m²")
            page.insert_text((72, 100), "Année de construction : 1982")
            document.save(pdf_path)
            document.close()
            before = pdf_path.read_bytes()
            self.assertEqual(M.pdf_values(folder), {"surface": 62.5, "annee": 1982})
            self.assertEqual(pdf_path.read_bytes(), before)

    def test_source_does_not_import_client_price_or_tracking_data(self):
        client = {
            "bien": {"nom": "Bien test", "adresse_complete": "1 rue test 69330 Pusignan"},
            "prix": 200000,
            "stats": {"appels": 4},
            "statut_bien": "en_ligne",
        }
        candidates = {}
        name = M.get(client, ("bien", "nom"))
        if name not in (None, ""):
            candidates["nom"] = name
        address = M.get(client, ("bien", "adresse_complete"))
        import re
        match = re.search(r"\b\d{5}\s+(.+?)\s*$", address)
        if match:
            candidates["ville"] = match.group(1).strip()
        self.assertNotIn("prix", candidates)
        self.assertNotIn("stats", candidates)
        self.assertEqual(candidates["ville"], "Pusignan")


if __name__ == "__main__":
    unittest.main()
