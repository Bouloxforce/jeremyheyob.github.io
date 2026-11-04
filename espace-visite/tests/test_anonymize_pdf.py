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


if __name__ == "__main__":
    unittest.main()
