#!/usr/bin/env python3
"""Conservative PDF sanitizer. Any uncertain or failed check aborts publication."""
import io, re, sys, os, subprocess
from pathlib import Path
import fitz
import pytesseract
from PIL import Image, ImageDraw
from pytesseract import Output

ROOT = Path("espace-visite/biens")
DPI = 300
MIN_WORDS_PER_PAGE = 3

PATTERNS = [
    re.compile(r"\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b", re.I),
    re.compile(r"(?<!\\d)(?:\\+33|0)[1-9](?:[ .-]?\\d{2}){4}(?!\\d)"),
    re.compile(r"\\bFR\\s?\\d{2}(?:[ .-]?\\d{4}){4,6}\\b", re.I),
    re.compile(r"\\b\\d{14}\\b"),
    re.compile(r"\\b\\d{15}\\b"),
    re.compile(r"\\b\\d{5}\\s+[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÿ' -]{2,}"),
]
LABELS = re.compile(
    r"\\b(nom|prénom|prenom|propriétaire|proprietaire|vendeur|acquéreur|acquereur|"
    r"adresse personnelle|domicile|téléphone|telephone|mobile|courriel|email|"
    r"date de naissance|né le|nee le|signature|signé|signe|cachet)\\b", re.I
)

def line_groups(data):
    groups = {}
    for i, txt in enumerate(data["text"]):
        txt = txt.strip()
        if not txt:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        groups.setdefault(key, []).append(i)
    return groups

def redact_page(image):
    data = pytesseract.image_to_data(image, lang="fra+eng", output_type=Output.DICT, config="--psm 6")
    groups = line_groups(data)
    if sum(len(v) for v in groups.values()) < MIN_WORDS_PER_PAGE:
        raise RuntimeError("OCR insuffisant : page non vérifiable")
    draw = ImageDraw.Draw(image)
    redacted = 0
    for indexes in groups.values():
        line = " ".join(data["text"][i] for i in indexes)
        sensitive = bool(LABELS.search(line) or any(p.search(line) for p in PATTERNS))
        if not sensitive:
            continue
        x0 = min(data["left"][i] for i in indexes)
        y0 = min(data["top"][i] for i in indexes)
        x1 = max(data["left"][i] + data["width"][i] for i in indexes)
        y1 = max(data["top"][i] + data["height"][i] for i in indexes)
        pad = max(8, int(image.width * 0.004))
        draw.rectangle((max(0,x0-pad), max(0,y0-pad), min(image.width,x1+pad), min(image.height,y1+pad)), fill="black")
        redacted += 1
        if re.search(r"signature|signé|signe|cachet", line, re.I):
            # Conservatively cover the remaining signature/stamp area below the label.
            draw.rectangle((0, max(0,y1), image.width, image.height), fill="black")
    return redacted

def verify_image(image):
    text = pytesseract.image_to_string(image, lang="fra+eng", config="--psm 6")
    if any(p.search(text) for p in PATTERNS):
        raise RuntimeError("Donnée personnelle détectée après anonymisation")
    if LABELS.search(text):
        raise RuntimeError("Libellé nominatif/signature encore détecté après anonymisation")

def main():
    before = os.environ.get("GITHUB_EVENT_BEFORE", "")\n    current = os.environ.get("GITHUB_SHA", "HEAD")\n    if not before or set(before) == {"0"}:\n        print("Déclenchement manuel : aucun PDF nouveau à traiter.")\n        return\n    changed = subprocess.check_output(["git", "diff", "--name-only", before, current], text=True).splitlines()\n    pdfs = [Path(name) for name in changed if name.lower().endswith(".pdf") and name.startswith(str(ROOT) + "/") and "/documents/" in name]\n    pdfs = [p for p in pdfs if p.exists()]
    failures = []
    for path in pdfs:
        tmp = path.with_name(path.stem + ".sanitized.tmp.pdf")
        try:
            src = fitz.open(path)
            if src.is_encrypted or len(src) == 0:
                raise RuntimeError("PDF chiffré ou vide")
            out = fitz.open()
            for page in src:
                pix = page.get_pixmap(dpi=DPI, alpha=False)
                image = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
                redact_page(image)
                verify_image(image)
                buf = io.BytesIO()
                image.save(buf, format="JPEG", quality=92, optimize=True)
                new_page = out.new_page(width=page.rect.width, height=page.rect.height)
                new_page.insert_image(new_page.rect, stream=buf.getvalue())
            out.set_metadata({})
            out.save(tmp, garbage=4, deflate=True, clean=True)
            out.close()
            src.close()
            check = fitz.open(tmp)
            if len(check) != len(pdfs_page_count(path)):
                raise RuntimeError("Nombre de pages modifié")
            if check.get_toc() or check.embfile_count():
                raise RuntimeError("Contenu actif ou pièce jointe détecté")
            check.close()
            tmp.replace(path)
            print("ANONYMISÉ :", path)
        except Exception as exc:
            if tmp.exists():
                tmp.unlink()
            failures.append(f"{path}: {exc}")
    if failures:
        print("\\n".join(failures), file=sys.stderr)
        sys.exit(1)

def pdfs_page_count(path):
    doc = fitz.open(path)
    count = len(doc)
    doc.close()
    return range(count)

if __name__ == "__main__":
    main()
