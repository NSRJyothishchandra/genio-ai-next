from __future__ import annotations

import sys
import re
from difflib import SequenceMatcher
from pathlib import Path

try:
    import fitz
    _HAS_FITZ = True
except Exception:
    fitz = None
    _HAS_FITZ = False

import numpy as np
from PIL import Image, ImageChops, ImageFilter

try:
    from rapidfuzz import fuzz
except Exception:
    fuzz = None

try:
    from rapidocr_onnxruntime import RapidOCR
except Exception:
    RapidOCR = None

OCR_ENGINE = None


def similarity_ratio(left: str, right: str) -> float:
    if fuzz is not None:
        return float(fuzz.ratio(left, right))
    return SequenceMatcher(None, left, right).ratio() * 100.0


def pixmap_to_image(pix: fitz.Pixmap) -> Image.Image:
    mode = "RGBA" if pix.alpha else "RGB"
    return Image.frombytes(mode, [pix.width, pix.height], pix.samples)


def get_ocr_engine():
    global OCR_ENGINE
    if OCR_ENGINE is None and RapidOCR is not None:
        OCR_ENGINE = RapidOCR()
    return OCR_ENGINE


def normalize_ocr_text(text: str) -> str:
    text = text.upper().strip()
    text = text.replace(" ", "")
    text = text.replace("Ø", "O")
    text = text.replace("×", "X")
    text = text.replace("，", ",")
    text = text.replace("。", ".")
    text = text.replace("—", "-")
    text = text.replace("–", "-")
    return text


def is_value_like(text: str) -> bool:
    normalized = normalize_ocr_text(text)
    if not normalized:
        return False
    if any(ch.isdigit() for ch in normalized):
        return True
    patterns = [
        r"^M\d+",
        r"^[RØO]?\d+([.,]\d+)?$",
        r"^\d+([.,]\d+)?(MM|NM|KG|KW|V|HZ|BAR|MPA|N)$",
        r"^\d+([.,]\d+)?°$",
        r"^[A-Z]{1,3}\d+([X/._-]\d+)*$",
    ]
    return any(re.match(pattern, normalized) for pattern in patterns)


def bbox_metrics(box: list[list[float]]) -> dict:
    xs = [pt[0] for pt in box]
    ys = [pt[1] for pt in box]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    return {
        "rect": (int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))),
        "center_x": (x0 + x1) / 2.0,
        "center_y": (y0 + y1) / 2.0,
        "width": max(1.0, x1 - x0),
        "height": max(1.0, y1 - y0),
    }


def proportional_subrect(rect: tuple[int, int, int, int], text: str, start: int, end: int) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = rect
    text_len = max(1, len(text))
    start = max(0, min(text_len, start))
    end = max(start + 1, min(text_len, end))
    width = max(1, x1 - x0)
    char_start = x0 + int(round(width * (start / text_len)))
    char_end = x0 + int(round(width * (end / text_len)))
    char_end = max(char_start + 1, min(x1, char_end))
    pad_x = 2
    pad_y = 1
    return (
        max(0, char_start - pad_x),
        max(0, y0 - pad_y),
        max(char_start + 1, min(x1, char_end + pad_x)),
        y1 + pad_y,
    )


def ocr_items(image: Image.Image) -> list[dict]:
    engine = get_ocr_engine()
    if engine is None:
        return []
    image_array = np.array(image.convert("RGB"))
    result, _ = engine(image_array)
    items: list[dict] = []
    for entry in result or []:
        if len(entry) < 3:
            continue
        box, text, score = entry
        if not text or float(score) < 0.45:
            continue
        metrics = bbox_metrics(box)
        items.append({
            "text": text.strip(),
            "normalized": normalize_ocr_text(text),
            "score": float(score),
            "kind": "value" if is_value_like(text) else "text",
            **metrics,
        })
    return items


def find_best_original_match(updated_item: dict, original_items: list[dict]) -> dict | None:
    best_item = None
    best_score = -1.0
    for original_item in original_items:
        height_limit = max(updated_item["height"], original_item["height"]) * 1.6 + 10
        if abs(updated_item["center_y"] - original_item["center_y"]) > height_limit:
            continue
        x_gap = abs(updated_item["center_x"] - original_item["center_x"])
        width_limit = max(updated_item["width"], original_item["width"]) * 2.2 + 24
        if x_gap > width_limit:
            continue
        similarity = similarity_ratio(updated_item["normalized"], original_item["normalized"])
        if similarity > best_score:
            best_score = similarity
            best_item = original_item | {"match_score": similarity}
    return best_item


def changed_spans(updated_text: str, original_text: str | None) -> list[tuple[int, int]]:
    if not updated_text:
        return []
    if not original_text:
        return [(0, len(updated_text))]

    matcher = SequenceMatcher(None, original_text, updated_text)
    spans: list[tuple[int, int]] = []
    for tag, _i1, _i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        if j2 > j1:
            spans.append((j1, j2))
    if not spans and updated_text != original_text:
        spans.append((0, len(updated_text)))
    return spans


def detect_changed_ocr_items(original_items: list[dict], updated_items: list[dict]) -> list[dict]:
    changed: list[dict] = []
    for updated_item in updated_items:
        best = find_best_original_match(updated_item, original_items)
        normalized = updated_item["normalized"]
        similarity = best["match_score"] if best else 0
        if best and normalized == best["normalized"]:
            continue
        if updated_item["kind"] == "value":
            if not best or similarity < 96:
                spans = changed_spans(updated_item["text"], best["text"] if best else None)
                if spans:
                    for start, end in spans:
                        changed.append(updated_item | {
                            "kind": "value",
                            "rect": proportional_subrect(updated_item["rect"], updated_item["text"], start, end),
                        })
                else:
                    changed.append(updated_item | {"kind": "value"})
        else:
            if best and similarity >= 92:
                continue
            if len(normalized) >= 4 and (not best or similarity < 82):
                spans = changed_spans(updated_item["text"], best["text"] if best else None)
                if spans:
                    for start, end in spans:
                        changed.append(updated_item | {
                            "kind": "text",
                            "rect": proportional_subrect(updated_item["rect"], updated_item["text"], start, end),
                        })
                else:
                    changed.append(updated_item | {"kind": "text"})
    return changed


def suppress_ocr_regions(mask: np.ndarray, items: list[dict]) -> np.ndarray:
    refined_mask = mask.copy()
    height, width = refined_mask.shape
    for item in items:
        x0, y0, x1, y1 = item["rect"]
        pad_x = 4
        pad_y = 3
        left = max(0, x0 - pad_x)
        top = max(0, y0 - pad_y)
        right = min(width, x1 + pad_x)
        bottom = min(height, y1 + pad_y)
        refined_mask[top:bottom, left:right] = False
    return refined_mask


def estimate_translation(original_image: Image.Image, updated_image: Image.Image, max_shift: int = 120) -> tuple[int, int]:
    sample_size = (640, 640)
    original_small = original_image.convert("L").resize(sample_size)
    updated_small = updated_image.convert("L").resize(sample_size)

    original_array = np.asarray(original_small, dtype=np.float32)
    updated_array = np.asarray(updated_small, dtype=np.float32)
    original_array -= original_array.mean()
    updated_array -= updated_array.mean()

    eps = 1e-9
    fft_original = np.fft.fft2(original_array)
    fft_updated = np.fft.fft2(updated_array)
    cross_power = fft_original * np.conj(fft_updated)
    cross_power /= np.maximum(np.abs(cross_power), eps)
    correlation = np.fft.ifft2(cross_power)
    correlation = np.abs(correlation)

    peak_y, peak_x = np.unravel_index(np.argmax(correlation), correlation.shape)
    shift_y = int(peak_y)
    shift_x = int(peak_x)

    if shift_x > correlation.shape[1] // 2:
        shift_x -= correlation.shape[1]
    if shift_y > correlation.shape[0] // 2:
        shift_y -= correlation.shape[0]

    scale_x = original_image.size[0] / sample_size[0]
    scale_y = original_image.size[1] / sample_size[1]
    full_x = int(round(shift_x * scale_x))
    full_y = int(round(shift_y * scale_y))
    full_x = max(-max_shift, min(max_shift, full_x))
    full_y = max(-max_shift, min(max_shift, full_y))
    return full_x, full_y


def align_original_image(original_image: Image.Image, updated_image: Image.Image) -> Image.Image:
    shift_x, shift_y = estimate_translation(original_image, updated_image)
    aligned = ImageChops.offset(original_image, -shift_x, -shift_y)
    if shift_x > 0:
        aligned.paste((255, 255, 255), (aligned.width - shift_x, 0, aligned.width, aligned.height))
    elif shift_x < 0:
        aligned.paste((255, 255, 255), (0, 0, -shift_x, aligned.height))
    if shift_y > 0:
        aligned.paste((255, 255, 255), (0, aligned.height - shift_y, aligned.width, aligned.height))
    elif shift_y < 0:
        aligned.paste((255, 255, 255), (0, 0, aligned.width, -shift_y))
    return aligned


def build_diff_rects(mask: np.ndarray) -> list[tuple[int, int, int, int]]:
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    rects: list[tuple[int, int, int, int]] = []
    directions = ((1, 0), (-1, 0), (0, 1), (0, -1))

    for y in range(height):
        for x in range(width):
            if not mask[y, x] or visited[y, x]:
                continue

            stack = [(y, x)]
            visited[y, x] = True
            min_y = max_y = y
            min_x = max_x = x
            pixel_count = 0

            while stack:
                current_y, current_x = stack.pop()
                pixel_count += 1
                min_y = min(min_y, current_y)
                max_y = max(max_y, current_y)
                min_x = min(min_x, current_x)
                max_x = max(max_x, current_x)

                for dy, dx in directions:
                    next_y = current_y + dy
                    next_x = current_x + dx
                    if next_y < 0 or next_x < 0 or next_y >= height or next_x >= width:
                        continue
                    if visited[next_y, next_x] or not mask[next_y, next_x]:
                        continue
                    visited[next_y, next_x] = True
                    stack.append((next_y, next_x))

            if pixel_count < 10:
                continue

            padding_x = 3
            padding_y = 2
            rects.append((
                max(0, min_x - padding_x),
                max(0, min_y - padding_y),
                min(width, max_x + 1 + padding_x),
                min(height, max_y + 1 + padding_y),
            ))

    return rects


def contiguous_segments(values: np.ndarray, bridge_gap: int) -> list[tuple[int, int]]:
    segments: list[tuple[int, int]] = []
    start = None
    gap = 0
    for index, value in enumerate(values):
        if value > 0:
            if start is None:
                start = index
            gap = 0
        elif start is not None:
            gap += 1
            if gap > bridge_gap:
                segments.append((start, index - gap + 1))
                start = None
                gap = 0
    if start is not None:
        segments.append((start, len(values)))
    return segments


def classify_rect(width: int, height: int, density: float, page_width: int, page_height: int) -> str:
    page_area = max(1, page_width * page_height)
    rect_area = width * height
    aspect = width / max(1, height)
    text_like = (
        width <= page_width * 0.55
        and height <= page_height * 0.18
        and aspect >= 0.7
        and density >= 0.07
    )
    if text_like:
        return "value"
    if rect_area <= page_area * 0.015 and density >= 0.05:
        return "value"
    return "geometry"


def refine_rects(source_mask: np.ndarray, expanded_rects: list[tuple[int, int, int, int]], page_width: int, page_height: int) -> list[dict]:
    refined: list[dict] = []
    for x0, y0, x1, y1 in expanded_rects:
        submask = source_mask[y0:y1, x0:x1]
        if not submask.any():
            continue

        col_segments = contiguous_segments(submask.sum(axis=0), bridge_gap=6)
        for col_start, col_end in col_segments:
            column_mask = submask[:, col_start:col_end]
            if not column_mask.any():
                continue

            row_segments = contiguous_segments(column_mask.sum(axis=1), bridge_gap=5)
            for row_start, row_end in row_segments:
                block = column_mask[row_start:row_end, :]
                if not block.any():
                    continue

                ys, xs = np.where(block)
                rect_x0 = x0 + col_start + int(xs.min())
                rect_x1 = x0 + col_start + int(xs.max()) + 1
                rect_y0 = y0 + row_start + int(ys.min())
                rect_y1 = y0 + row_start + int(ys.max()) + 1

                width = rect_x1 - rect_x0
                height = rect_y1 - rect_y0
                area = max(1, width * height)
                density = float(block.sum()) / area

                if width < 4 or height < 4:
                    continue
                if area > page_width * page_height * 0.14:
                    continue
                if width > page_width * 0.82 or height > page_height * 0.82:
                    continue
                if width > page_width * 0.70 and density < 0.10:
                    continue
                if height > page_height * 0.30 and density < 0.07:
                    continue

                padding_x = 2 if width < 80 else 3
                padding_y = 1 if height < 36 else 2
                final_x0 = max(0, rect_x0 - padding_x)
                final_y0 = max(0, rect_y0 - padding_y)
                final_x1 = min(page_width, rect_x1 + padding_x)
                final_y1 = min(page_height, rect_y1 + padding_y)
                refined.append({
                    "rect": (final_x0, final_y0, final_x1, final_y1),
                    "kind": classify_rect(final_x1 - final_x0, final_y1 - final_y0, density, page_width, page_height),
                })

    refined.sort(key=lambda item: (item["rect"][1], item["rect"][0]))
    merged: list[dict] = []
    for item in refined:
        x0, y0, x1, y1 = item["rect"]
        if merged:
            last = merged[-1]["rect"]
            overlap_y = min(y1, last[3]) - max(y0, last[1])
            min_height = max(1, min(y1 - y0, last[3] - last[1]))
            same_band = overlap_y / min_height >= 0.40
            close_x = x0 <= last[2] + 12
            merged_width = max(last[2], x1) - min(last[0], x0)
            if same_band and close_x and merged_width <= page_width * 0.50:
                merged[-1]["rect"] = (
                    min(last[0], x0),
                    min(last[1], y0),
                    max(last[2], x1),
                    max(last[3], y1),
                )
                if item["kind"] == "value":
                    merged[-1]["kind"] = "value"
                continue
        merged.append({"rect": (x0, y0, x1, y1), "kind": item["kind"]})

    return [
        item
        for item in merged
        if (
            (item["rect"][2] - item["rect"][0]) >= 4
            and (item["rect"][3] - item["rect"][1]) >= 4
            and (item["rect"][2] - item["rect"][0]) * (item["rect"][3] - item["rect"][1]) <= page_width * page_height * 0.16
        )
    ]


def page_diff_rects(original_page: fitz.Page | None, updated_page: fitz.Page, zoom: float) -> tuple[list[dict], int, int]:
    matrix = fitz.Matrix(zoom, zoom)
    updated_pix = updated_page.get_pixmap(matrix=matrix, alpha=False)
    updated_image = pixmap_to_image(updated_pix).convert("RGB")
    render_width, render_height = updated_image.size

    if original_page is None:
      return [{"rect": (20, 20, max(21, render_width - 20), max(21, render_height - 20)), "kind": "geometry"}], render_width, render_height

    original_pix = original_page.get_pixmap(matrix=matrix, alpha=False)
    original_image = pixmap_to_image(original_pix).convert("RGB")
    if original_image.size != updated_image.size:
        original_image = original_image.resize(updated_image.size, resample=Image.LANCZOS)
    original_image = align_original_image(original_image, updated_image)
    original_ocr_items = ocr_items(original_image)
    updated_ocr_items = ocr_items(updated_image)
    changed_ocr_items = detect_changed_ocr_items(original_ocr_items, updated_ocr_items)
    all_ocr_regions = updated_ocr_items + original_ocr_items

    # Pre-blur both images with the same kernel to cancel rendering/anti-aliasing artifacts
    # before computing the pixel difference.
    blur_radius = 0.7
    original_blurred = original_image.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    updated_blurred = updated_image.filter(ImageFilter.GaussianBlur(radius=blur_radius))

    diff = ImageChops.difference(original_blurred, updated_blurred).convert("L")
    base_diff = ImageChops.difference(original_image, updated_image).convert("L")
    threshold = diff.point(lambda value: 255 if value > 15 else 0)
    base_mask = np.array(base_diff.point(lambda value: 255 if value > 10 else 0)) > 0
    base_mask = suppress_ocr_regions(base_mask, all_ocr_regions)
    expanded = threshold.filter(ImageFilter.MaxFilter(5))
    expanded_mask = np.array(expanded) > 0
    expanded_mask = suppress_ocr_regions(expanded_mask, all_ocr_regions)
    coarse_rects = build_diff_rects(expanded_mask)
    refined = refine_rects(base_mask, coarse_rects, render_width, render_height)
    filtered = []
    margin = 8
    for item in refined:
        x0, y0, x1, y1 = item["rect"]
        width = x1 - x0
        height = y1 - y0
        if x0 <= margin and y0 <= margin and x1 >= render_width - margin and y1 >= render_height - margin:
            continue
        if (
            item["kind"] == "geometry"
            and (width >= render_width * 0.78 or height >= render_height * 0.78)
        ):
            continue
        filtered.append(item)

    return ([{"rect": item["rect"], "kind": item["kind"]} for item in changed_ocr_items] + filtered), render_width, render_height


def highlight_pdf(original_pdf: Path, updated_pdf: Path, output_pdf: Path):
    if not _HAS_FITZ:
        raise RuntimeError(
            "PyMuPDF (fitz) is required for visual PDF comparison but could not be loaded. "
            "A text-based diff report will be generated instead."
        )
    original_doc = fitz.open(original_pdf)
    updated_doc = fitz.open(updated_pdf)
    zoom = 3.0

    for page_index in range(updated_doc.page_count):
        updated_page = updated_doc[page_index]
        original_page = original_doc[page_index] if page_index < original_doc.page_count else None
        rects, render_width, render_height = page_diff_rects(original_page, updated_page, zoom)
        page_width = updated_page.rect.width
        page_height = updated_page.rect.height
        scale_x = page_width / render_width
        scale_y = page_height / render_height

        for item in rects:
            x0, y0, x1, y1 = item["rect"]
            pdf_rect = fitz.Rect(
                x0 * scale_x,
                page_height - (y1 * scale_y),
                x1 * scale_x,
                page_height - (y0 * scale_y),
            )
            if item["kind"] == "value":
                stroke = (0.047, 0.439, 0.271)
                fill = (0.745, 0.965, 0.816)
            elif item["kind"] == "text":
                stroke = (0.886, 0.447, 0.016)
                fill = (0.992, 0.906, 0.698)
            else:
                stroke = (0.808, 0.333, 0.000)
                fill = (0.992, 0.878, 0.278)
            updated_page.draw_rect(
                pdf_rect,
                color=stroke,
                fill=fill,
                width=max(0.8, min(page_width, page_height) * 0.0018),
                overlay=True,
                stroke_opacity=0.92,
                fill_opacity=0.28 if item["kind"] == "value" else 0.18 if item["kind"] == "text" else 0.10,
            )

    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    updated_doc.save(output_pdf)
    original_doc.close()
    updated_doc.close()


def main():
    if len(sys.argv) != 4:
        print("Usage: pdf_highlight_compare.py <original_pdf> <updated_pdf> <output_pdf>", file=sys.stderr)
        sys.exit(1)

    original_pdf = Path(sys.argv[1])
    updated_pdf = Path(sys.argv[2])
    output_pdf = Path(sys.argv[3])
    highlight_pdf(original_pdf, updated_pdf, output_pdf)
    print(output_pdf)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
