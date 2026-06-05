from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    import fitz
except Exception as exc:  # pragma: no cover - runtime dependency check
    print(f"PyMuPDF (fitz) is required to render preview images: {exc}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    if len(sys.argv) not in (3, 4):
        print(
            "Usage: render_pdf_preview.py <input_pdf> <output_dir> [max_pages]",
            file=sys.stderr,
        )
        sys.exit(1)

    input_pdf = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    max_pages = int(sys.argv[3]) if len(sys.argv) == 4 else 6

    output_dir.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(input_pdf)
    page_count = doc.page_count
    files: list[str] = []
    matrix = fitz.Matrix(1.7, 1.7)

    try:
        for page_index in range(min(doc.page_count, max_pages)):
            page = doc[page_index]
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            file_name = f"preview-page-{page_index + 1}.png"
            output_path = output_dir / file_name
            pix.save(output_path)
            files.append(file_name)
    finally:
        doc.close()

    print(
        json.dumps(
            {
                "pageCount": page_count,
                "previewPageCount": len(files),
                "files": files,
            }
        )
    )


if __name__ == "__main__":
    main()
