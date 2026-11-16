import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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

    def test_new_pdf_triggers_sync_for_its_matching_client_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            client_dir = Path(tmp)
            source = client_dir / "villa_data.json"
            source.write_text("{}", encoding="utf-8")
            changed_pdf = "espace-visite/biens/villa/documents/diagnostic.pdf"
            with patch.object(M, "CLIENT", client_dir), patch.object(
                M.subprocess, "check_output", return_value=changed_pdf + "\n"
            ):
                result = M.changed_sources()
            self.assertEqual(result, [source])

    def test_sync_creates_listing_from_client_and_pdf_and_preserves_manual_edits(self):
        import fitz
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            client_dir = root / "client"
            visit_dir = root / "visit"
            client_dir.mkdir()
            visit_dir.mkdir()
            source = client_dir / "villa_data.json"
            source.write_text(json.dumps({
                "bien": {
                    "nom": "Villa test",
                    "adresse_complete": "1 rue test 69330 Pusignan",
                },
                "statut_bien": "en_ligne",
                "prix": 999999,
                "stats": {"appels": 12},
            }), encoding="utf-8")
            folder = visit_dir / "villa"
            docs = folder / "documents"
            photos = folder / "photos"
            docs.mkdir(parents=True)
            photos.mkdir()
            pdf_path = docs / "diagnostic.pdf"
            pdf = fitz.open()
            page = pdf.new_page()
            page.insert_text((72, 72), "Surface habitable : 62,5 m²")
            page.insert_text((72, 100), "Année de construction : 1982")
            pdf.save(pdf_path)
            pdf.close()
            pdf_before = pdf_path.read_bytes()
            template = {
                "slug": "", "statut": "", "nom": "", "bien_type": "", "type": "",
                "surface": None, "exterieur": None, "annee": None, "etage": "",
                "prix": None, "charges": "", "taxe_fonciere": "", "ville": "",
                "secteur": "", "dpe": {"energie": "", "ges": ""},
                "stationnement": "", "chauffage": "", "proximite": "",
                "points_forts": [], "photos_count": 0, "video": "", "annonce": "",
            }
            with patch.object(M, "VISIT", visit_dir):
                M.sync(source, template)
                public_path = folder / "villa_data.json"
                public = json.loads(public_path.read_text(encoding="utf-8"))
                self.assertEqual(public["nom"], "Villa test")
                self.assertEqual(public["ville"], "Pusignan")
                self.assertEqual(public["surface"], 62.5)
                self.assertEqual(public["annee"], 1982)
                self.assertIsNone(public["prix"])
                self.assertEqual(public["photos_count"], 0)

                public["surface"] = 70
                public["prix"] = 245000
                public_path.write_text(json.dumps(public), encoding="utf-8")
                source.write_text(json.dumps({
                    "bien": {"nom": "Villa test modifiée"},
                    "statut_bien": "en_ligne",
                }), encoding="utf-8")
                M.sync(source, template)
                updated = json.loads(public_path.read_text(encoding="utf-8"))
                self.assertEqual(updated["surface"], 70)
                self.assertEqual(updated["prix"], 245000)
                self.assertEqual(updated["nom"], "Villa test modifiée")
                self.assertEqual(pdf_path.read_bytes(), pdf_before)

    def test_source_does_not_import_client_price_or_tracking_data(self):
        client = {
            "bien": {"nom": "Bien test", "adresse_complete": "1 rue test 69330 Pusignan"},
            "prix": 200000,
            "stats": {"appels": 4},
            "statut_bien": "en_ligne",
        }
        name = M.get(client, ("bien", "nom"))
        address = M.get(client, ("bien", "adresse_complete"))
        import re
        candidates = {}
        if name:
            candidates["nom"] = name
        match = re.search(r"\b\d{5}\s+(.+?)\s*$", address)
        if match:
            candidates["ville"] = match.group(1).strip()
        self.assertNotIn("prix", candidates)
        self.assertNotIn("stats", candidates)
        self.assertEqual(candidates["ville"], "Pusignan")


if __name__ == "__main__":
    unittest.main()
