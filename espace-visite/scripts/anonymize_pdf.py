#!/usr/bin/env python3
"""Fail-closed PDF raster anonymizer. Uncertain documents are rejected."""
import io
import os
import re
import subprocess
import sys
from pathlib import Path

import fitz
import cv2
import numpy as np
import pytesseract
from PIL import Image, ImageDraw
from pytesseract import Output

ROOT = Path("espace-visite/biens")
DPI = 300
MIN_WORDS_PER_PAGE = 8

# Sensitive identifiers that can occur in French property diagnostics.
PATTERNS = [
    re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I),
    re.compile(r"(?<!\d)(?:\+33|0)[1-9](?:[ .-]?\d{2}){4}(?!\d)"),
    re.compile(r"\bFR\s?\d{2}(?:[ .-]?\d{4}){4,6}\b", re.I),
    re.compile(r"\b\d{14,15}\b"),
    re.compile(r"\b\d{5}\s+[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ' -]{2,}"),
    re.compile(r"\b\d{1,4}\s+(?:RUE|AVENUE|IMPASSE|BOULEVARD|CHEMIN|ALLEE|ALLÉE|PLACE|ROUTE|SQUARE|PASSAGE)\b", re.I),
]
LABEL = re.compile(
    r"\b(nom et prénom|nom|prénom|prenom|propriétaire|proprietaire|vendeur|"
    r"acquéreur|acquereur|adresse|domicile|téléphone|telephone|mobile|"
    r"courriel|email|signature|signé|signe|cachet|référence cadastrale|"
    r"référence du dpe|n°ademe|n° ademe|numéro de dossier)\b", re.I
)
ADDRESS_WORDS = re.compile(r"\b(rue|avenue|impasse|boulevard|chemin|allée|allee|place|route|square|passage)\b", re.I)
OWNER_LABEL = re.compile(r"(?:nom et prénom|propriétaire)\s*:?\s*(.*)", re.I)
DOSSIER = re.compile(r"\b\d{2}/\d{2}/\d{2}/[A-Z]{2,}/\d{3,}\b", re.I)
ADEME = re.compile(r"\b\d{13,15}[A-Z]?\b", re.I)

def ocr_lines(image):
    data = pytesseract.image_to_data(image, lang="fra+eng", output_type=Output.DICT, config="--psm 6")
    grouped = {}
    for i, token in enumerate(data["text"]):
        token = token.strip()
        if not token or int(data["conf"][i]) < 20:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        grouped.setdefault(key, []).append(i)
    lines = []
    for indexes in grouped.values():
        text = " ".join(data["text"][i].strip() for i in indexes)
        x0 = min(data["left"][i] for i in indexes)
        y0 = min(data["top"][i] for i in indexes)
        x1 = max(data["left"][i] + data["width"][i] for i in indexes)
        y1 = max(data["top"][i] + data["height"][i] for i in indexes)
        lines.append({"text": text, "box": (x0, y0, x1, y1)})
    lines.sort(key=lambda item: (item["box"][1], item["box"][0]))
    return lines

def boxes_to_redact(image, lines, known_values):
    boxes = []
    pad = max(12, int(image.width * 0.006))
    for index, line in enumerate(lines):
        text = line["text"]
        x0, y0, x1, y1 = line["box"]
        sensitive = any(p.search(text) for p in PATTERNS)
        if ADDRESS_WORDS.search(text) and re.search(r"\d", text):
            sensitive = True
        if any(value and value.casefold() in text.casefold() for value in known_values):
            sensitive = True
        if DOSSIER.search(text) or ADEME.search(text):
            sensitive = True
        if sensitive:
            boxes.append((max(0, x0-pad), max(0, y0-pad), min(image.width, x1+pad), min(image.height, y1+pad)))

        # When a field label has no value on the same line, redact the next nearby line.
        if re.search(r"\b(adresse|nom et prénom|propriétaire|nom)\b", text, re.I):
            if index + 1 < len(lines):
                nxt = lines[index + 1]
                nx0, ny0, nx1, ny1 = nxt["box"]
                if 0 <= ny0 - y1 < int(image.height * 0.055):
                    boxes.append((max(0, nx0-pad), max(0, ny0-pad), min(image.width, nx1+pad), min(image.height, ny1+pad)))

        # A signature heading makes the lower signature panel untrusted.
        if re.search(r"signature|signé par|signe par|cachet", text, re.I):
            boxes.append((0, max(0, y0-int(image.height*0.018)), image.width, image.height))

    return boxes

def qr_boxes(image):
    scale = min(1.0, 1400.0 / max(image.size))
    preview = image if scale == 1.0 else image.resize((int(image.width*scale), int(image.height*scale)))
    rgb = np.array(preview.convert("RGB"))
    detector = cv2.QRCodeDetector()
    boxes = []
    try:
        ok, decoded, points, _ = detector.detectAndDecodeMulti(rgb)
        if ok and points is not None:
            for pts in points:
                x0, y0 = np.min(pts, axis=0)
                x1, y1 = np.max(pts, axis=0)
                margin = max(12, int(max(x1-x0, y1-y0)*0.12))
                boxes.append((max(0,int(x0)-margin), max(0,int(y0)-margin), min(image.width,int(x1)+margin), min(image.height,int(y1)+margin)))
    except cv2.error:
        pass
    if not boxes:
        try:
            value, points, _ = detector.detectAndDecode(rgb)
            if points is not None:
                pts = points[0]
                x0, y0 = np.min(pts, axis=0)
                x1, y1 = np.max(pts, axis=0)
                margin = max(12, int(max(x1-x0, y1-y0)*0.12))
                boxes.append((max(0,int(x0)-margin), max(0,int(y0)-margin), min(image.width,int(x1)+margin), min(image.height,int(y1)+margin)))
        except cv2.error:
            pass
    if scale != 1.0:
        boxes = [(int(x0/scale), int(y0/scale), int(x1/scale), int(y1/scale)) for x0,y0,x1,y1 in boxes]
    return boxes

def discover_values(pages):
    values = set()
    for image in pages[:min(4, len(pages))]:
        for line in ocr_lines(image):
            text = line["text"].strip(" .:-")
            match = OWNER_LABEL.search(text)
            if match and len(match.group(1).strip()) >= 3:
                values.add(match.group(1).strip())
            if ADDRESS_WORDS.search(text) and re.search(r"\d", text):
                values.add(text)
    return sorted(values, key=len, reverse=True)

def verify_page(image):
    text = pytesseract.image_to_string(image, lang="fra+eng", config="--psm 6")
    if any(pattern.search(text) for pattern in PATTERNS):
        raise RuntimeError("Une coordonnée ou une adresse reste détectée après occultation")
    if DOSSIER.search(text) or ADEME.search(text):
        raise RuntimeError("Une référence de dossier/DPE reste détectée après occultation")
    # Any QR code remaining is a hard failure.
    if qr_boxes(image):
        raise RuntimeError("Un QR code reste détecté après occultation")

def changed_pdfs():
    before = os.environ.get("GITHUB_EVENT_BEFORE", "")
    current = os.environ.get("GITHUB_SHA", "HEAD")
    if not before or set(before) == {"0"}:
        return []
    names = subprocess.check_output(["git", "diff", "--name-only", before, current], text=True).splitlines()
    return [Path(name) for name in names if name.lower().endswith(".pdf") and name.startswith(str(ROOT) + "/") and "/documents/" in name and Path(name).exists()]

def main():
    pdfs = changed_pdfs()
    if not pdfs:
        print("Aucun nouveau PDF à traiter.")
        return

    failures = []
    for path in pdfs:
        tmp = path.with_name(path.stem + ".sanitized.tmp.pdf")
        try:
            source = fitz.open(path)
            if source.is_encrypted or len(source) == 0:
                raise RuntimeError("PDF chiffré ou vide")
            images = []
            page_sizes = []
            for page in source:
                pix = page.get_pixmap(dpi=DPI, alpha=False)
                images.append(Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB"))
                page_sizes.append((page.rect.width, page.rect.height))
            known_values = discover_values(images)
            output = fitz.open()
            for number, image in enumerate(images, start=1):
                lines = ocr_lines(image)
                if len(lines) < MIN_WORDS_PER_PAGE:
                    raise RuntimeError(f"OCR insuffisant page {number}")
                draw = ImageDraw.Draw(image)
                for box in boxes_to_redact(image, lines, known_values) + qr_boxes(image):
                    draw.rectangle(box, fill="black")
                verify_page(image)
                buffer = io.BytesIO()
                image.save(buffer, format="PNG", optimize=True)
                page = output.new_page(width=page_sizes[number-1][0], height=page_sizes[number-1][1])
                page.insert_image(page.rect, stream=buffer.getvalue())
            output.set_metadata({})
            output.save(tmp, garbage=4, deflate=True, clean=True)
            output.close()
            source.close()

            check = fitz.open(tmp)
            if len(check) != len(images) or check.metadata.get("author") or check.metadata.get("title"):
                raise RuntimeError("Vérification structure/métadonnées échouée")
            for page in check:
                if page.get_text().strip():
                    raise RuntimeError("Du texte extractible subsiste dans le PDF aplati")
            check.close()
            tmp.replace(path)
            print("PDF anonymisé et contrôlé :", path)
        except Exception as error:
            if tmp.exists():
                tmp.unlink()
            failures.append(f"{path}: {error}")

    if failures:
        print("\n".join(failures), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
