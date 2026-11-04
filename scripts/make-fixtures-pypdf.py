"""
Adds the fixtures pdf-lib cannot produce: password protected PDFs, outlines and
annotations. Run with the bundled pypdf interpreter, e.g.

    /Users/admin/Downloads/PDFJoiner/.venv/bin/python scripts/make-fixtures-pypdf.py

Any Python 3.10+ environment with pypdf >= 4 installed works as well.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from pypdf import PdfReader, PdfWriter

# pypdf renamed AnnotationBuilder in 6.x; support both spellings.
try:  # pragma: no cover - depends on the installed pypdf version
    from pypdf.generic import AnnotationBuilder as _AnnotationBuilder
except ImportError:  # pragma: no cover
    _AnnotationBuilder = None

try:  # pragma: no cover
    from pypdf.annotations import Link as _Link
except ImportError:  # pragma: no cover
    _Link = None

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures"
SOURCE = FIXTURES / "report-a.pdf"


def write_encrypted() -> dict:
    reader = PdfReader(SOURCE)
    writer = PdfWriter()
    writer.append(reader)
    # AES-128 with a user password: pdf-lib cannot open this, which is exactly
    # the case the UI must reject with a clear message.
    writer.encrypt(user_password="secret", owner_password="owner-secret", algorithm="AES-128")
    target = FIXTURES / "encrypted.pdf"
    with target.open("wb") as handle:
        writer.write(handle)
    return {"file": target.name, "pageCount": 3, "note": "AES-128, user password 'secret'"}


def write_annotated() -> dict:
    reader = PdfReader(SOURCE)
    writer = PdfWriter()
    writer.append(reader)
    writer.add_outline_item("Chapter 1", 0)
    writer.add_outline_item("Chapter 2", 2)

    rect = (48, 700, 260, 730)
    if _AnnotationBuilder is not None:
        annotation = _AnnotationBuilder.link(rect=rect, url="https://example.com/pdfjoiner")
    elif _Link is not None:
        annotation = _Link(rect=rect, url="https://example.com/pdfjoiner")
    else:  # pragma: no cover
        raise RuntimeError("no annotation API available in this pypdf build")
    writer.add_annotation(page_number=0, annotation=annotation)
    target = FIXTURES / "outlined-annotated.pdf"
    with target.open("wb") as handle:
        writer.write(handle)
    return {
        "file": target.name,
        "pageCount": 3,
        "note": "2 outline items + 1 link annotation on page 1",
    }


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"missing {SOURCE}; run `npm run fixtures` first")

    entries = [write_encrypted(), write_annotated()]

    manifest_path = FIXTURES / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    known = {item["file"] for item in manifest["files"]}
    for entry in entries:
        if entry["file"] not in known:
            manifest["files"].append(entry)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print("pypdf fixtures:", ", ".join(entry["file"] for entry in entries))


if __name__ == "__main__":
    main()
