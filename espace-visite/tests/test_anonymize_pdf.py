import importlib.util
import unittest
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

SCRIPT = Path("espace-visite/scripts/anonymize_pdf.py")
SPEC = importlib.util.spec_from_file_location("anonymize_pdf", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class RedactionTests(unittest.TestCase):
    def test_qr_code_is_detected(self):
        encoder = cv2.QRCodeEncoder_create()
        qr = encoder.encode("https://example.invalid/test-document")
        canvas = np.full((900, 700, 3), 255, dtype=np.uint8)
        qr = cv2.resize(qr, (300, 300), interpolation=cv2.INTER_NEAREST)
        canvas[250:550, 200:500] = cv2.cvtColor(qr, cv2.COLOR_GRAY2RGB)
        boxes = MODULE.qr_boxes(Image.fromarray(canvas))
        self.assertTrue(boxes, "Le QR de test doit être détecté")

    def test_native_pdf_text_is_mapped_to_rendered_coordinates(self):
        import fitz
        document = fitz.open()
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 100), "Telephone : 06 12 34 56 78", fontsize=12)
        image = Image.new("RGB", (1190, 1684), "white")
        lines = MODULE.native_text_lines(page, image)
        self.assertTrue(any("Telephone" in line["text"] for line in lines))
        line = next(line for line in lines if "Telephone" in line["text"])
        self.assertGreaterEqual(line["box"][0], 140)
        self.assertLessEqual(line["box"][0], 150)
        self.assertGreaterEqual(line["box"][1], 170)
        document.close()

    def test_sensitive_values_are_extracted_from_later_pages(self):
        text = "Annexe technique\nPropriétaire : Jean Dupont\n12 rue des Lilas"
        values = MODULE.values_from_text(text)
        self.assertIn("Jean Dupont", values)
        self.assertIn("12 rue des Lilas", values)

    def test_values_on_lines_after_labels_are_extracted(self):
        text = "Identité du propriétaire\nNom et prénom :\nJean Dupont\nAdresse :\n12 rue des Lilas"
        values = MODULE.values_from_text(text)
        self.assertIn("Jean Dupont", values)
        self.assertIn("12 rue des Lilas", values)

    def test_sensitive_patterns(self):
        samples = [
            "contact@example.fr",
            "06 12 34 56 78",
            "12 rue des Lilas",
            "12345678901234",
        ]
        for sample in samples:
            self.assertTrue(any(pattern.search(sample) for pattern in MODULE.PATTERNS), sample)

    def test_personal_data_labels_are_redacted(self):
        image = Image.new("RGB", (1000, 1400), "white")
        lines = [
            {"text": "Téléphone :", "box": (100, 300, 300, 330)},
            {"text": "06 12 34 56 78", "box": (100, 345, 350, 375)},
        ]
        boxes = MODULE.boxes_to_redact(image, lines, [])
        self.assertTrue(any(x0 <= 100 and y0 <= 300 and x1 >= 300 for x0, y0, x1, y1 in boxes))
        self.assertTrue(any(y0 <= 345 and y1 >= 375 for x0, y0, x1, y1 in boxes))

    def test_name_on_following_line_is_redacted(self):
        image = Image.new("RGB", (1000, 1400), "white")
        lines = [
            {"text": "Nom et prénom :", "box": (100, 300, 350, 330)},
            {"text": "Jean Dupont", "box": (100, 345, 280, 375)},
        ]
        boxes = MODULE.boxes_to_redact(image, lines, [])
        self.assertTrue(any(x0 <= 100 and x1 >= 350 and y0 <= 300 for x0, y0, x1, y1 in boxes))
        self.assertTrue(any(x0 <= 100 and x1 >= 280 and y0 <= 345 for x0, y0, x1, y1 in boxes))

    def test_signature_heading_triggers_large_redaction_zone(self):
        image = Image.new("RGB", (1000, 1400), "white")
        lines = [
            {"text": "Signature du propriétaire", "box": (100, 600, 400, 630)}
        ]
        boxes = MODULE.boxes_to_redact(image, lines, [])
        self.assertTrue(any(x0 == 0 and x1 == image.width for x0, y0, x1, y1 in boxes))


    def test_wide_rectangle_is_not_misclassified_as_qr(self):
        image = Image.new("RGB", (900, 700), "white")
        from PIL import ImageDraw
        draw = ImageDraw.Draw(image)
        draw.rectangle((100, 100, 650, 260), outline="black", width=8)
        self.assertEqual(MODULE.qr_boxes(image), [])


    def test_only_newly_added_pdfs_are_selected(self):
        from unittest.mock import patch
        import os

        added = "espace-visite/biens/maison/documents/nouveau.pdf"
        modified = "espace-visite/biens/maison/documents/existant.pdf"
        renamed = "espace-visite/biens/maison/documents/renomme.pdf"

        def fake_check_output(command, text=True):
            self.assertIn("--diff-filter=A", command)
            return added

        with patch.dict(os.environ, {"GITHUB_EVENT_BEFORE": "a" * 40, "GITHUB_SHA": "b" * 40}):
            with patch.object(MODULE.subprocess, "check_output", side_effect=fake_check_output):
                with patch.object(MODULE.Path, "exists", return_value=True):
                    selected = MODULE.changed_pdfs()

        self.assertEqual(selected, [Path(added)])


    def test_scanned_pdf_pipeline_ocr_redacts_later_page(self):
        """Exercise OCR, value discovery, masking and verification on a scanned PDF."""
        import fitz
        import io
        from PIL import ImageDraw, ImageFont

        def scanned_page(lines):
            image = Image.new("RGB", (1800, 2400), "white")
            draw = ImageDraw.Draw(image)
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 54)
            y = 180
            for line in lines:
                draw.text((120, y), line, fill="black", font=font)
                y += 110
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            image.close()
            return buffer.getvalue()

        document = fitz.open()
        page1 = document.new_page(width=595, height=842)
        page1.insert_image(page1.rect, stream=scanned_page([
            "DIAGNOSTIC IMMOBILIER", "Rapport technique de controle",
            "Resultats des verifications", "Informations generales",
            "Mesures et observations", "Synthese du diagnostic",
            "Document de demonstration", "Fin de premiere page"
        ]))
        page2 = document.new_page(width=595, height=842)
        page2.insert_image(page2.rect, stream=scanned_page([
            "ANNEXE IDENTIFICATION", "Nom et prenom :", "Jean Dupont",
            "Adresse :", "12 rue des Lilas", "Telephone : 06 12 34 56 78",
            "Informations complementaires", "Fin du document"
        ]))

        known = MODULE.discover_values(document)
        self.assertTrue(any("Jean Dupont" in value for value in known), known)
        self.assertTrue(any("12 rue des Lilas" in value for value in known), known)
        for page in document:
            image = MODULE.render_page(page)
            try:
                lines = MODULE.ocr_lines(image)
                self.assertGreaterEqual(len(lines), MODULE.MIN_WORDS_PER_PAGE)
                draw = ImageDraw.Draw(image)
                for box in MODULE.boxes_to_redact(image, lines, known):
                    draw.rectangle(box, fill="black")
                MODULE.verify_page(image, known)
            finally:
                image.close()
        document.close()

if __name__ == "__main__":
    unittest.main()
