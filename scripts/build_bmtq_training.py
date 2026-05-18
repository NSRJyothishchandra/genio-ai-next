from __future__ import annotations

import argparse
import base64
import http.client
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any

from PIL import Image
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PDF = Path(r"C:\Users\Projecta0003\Desktop\genio-ai-next\BONFIGLIOLI TECHNICAL QUALITY HANDBOOK BMTQ.pdf")
DEFAULT_OUTPUT = ROOT / "data" / "nx-agent-training" / "bmtq"
DEFAULT_ENV_FILE = ROOT / ".env.local"
NODE_RENDER_SCRIPT = ROOT / "scripts" / "render_bmtq_pages.js"


def load_env_file(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not env_path.exists():
        return values

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def ensure_dirs(output_root: Path) -> dict[str, Path]:
    paths = {
        "raw": output_root / "raw-pages",
        "cropped": output_root / "cropped-pages",
        "analyses": output_root / "page-analyses",
        "knowledge": output_root / "knowledge",
    }
    for path in paths.values():
        path.mkdir(parents=True, exist_ok=True)
    return paths


def render_pages(pdf_path: Path, raw_dir: Path, start_page: int, end_page: int) -> None:
    subprocess.run(
        [
            "node",
            str(NODE_RENDER_SCRIPT),
            str(pdf_path),
            str(raw_dir),
            str(start_page),
            str(end_page),
        ],
        check=True,
        cwd=str(ROOT),
    )


def crop_pdf_viewer_image(source_path: Path, dest_path: Path) -> None:
    image = Image.open(source_path).convert("RGB")
    width, height = image.size

    left = min(320, width // 4)
    top = min(70, height // 10)
    cropped = image.crop((left, top, width, height))

    gray = cropped.convert("L")
    bbox = gray.point(lambda value: 255 if value > 210 else 0).getbbox()
    if bbox:
        page_region = cropped.crop(bbox)
    else:
        page_region = cropped

    page_region.save(dest_path)


def page_text(reader: PdfReader, page_number: int) -> str:
    try:
        return (reader.pages[page_number - 1].extract_text() or "").strip()
    except Exception:
        return ""


def make_extraction_prompt(page_number: int, extracted_text: str) -> str:
    return f"""
You are building a training-grade engineering knowledge base for an NX-style 3D modeling agent.

Analyze this page from the Bonfiglioli Technical Quality Handbook and return STRICT JSON only.

Page number: {page_number}

Goals:
1. Extract the actual engineering rule or standard shown on the page.
2. Identify the component families affected, such as gear, shaft, spline, keyway, bearing seat, seal seat, thread, chamfer, housing, assembly drawing, or inspection rule.
3. Capture tolerances, dimensional guidance, drawing conventions, manufacturing constraints, finishing constraints, and inspection expectations whenever visible.
4. Produce training-ready guidance that can help an NX agent generate or validate mechanical parts.

If the page is mostly an index/table-of-contents page, return the listed entries as structured topics instead of inventing geometry rules.

Fallback extracted text from the PDF layer, if any:
{extracted_text[:3000] if extracted_text else "[no reliable embedded text available]"}

Return JSON with this schema:
{{
  "page_number": <int>,
  "document_code": "<string or empty>",
  "title": "<short title>",
  "page_kind": "index|rule|drawing|table|reference|unknown",
  "topics": ["..."],
  "components": ["..."],
  "rules": ["..."],
  "dimensions": ["..."],
  "tolerances": ["..."],
  "surface_finish": ["..."],
  "inspection": ["..."],
  "manufacturing_notes": ["..."],
  "training_guidance": ["..."],
  "summary": "<2-4 sentence summary>"
}}
""".strip()


def parse_json_payload(raw_text: str) -> dict[str, Any]:
    candidate = raw_text.strip()
    if candidate.startswith("```"):
        candidate = re.sub(r"^```(?:json)?\s*", "", candidate)
        candidate = re.sub(r"\s*```$", "", candidate)

    start = candidate.find("{")
    end = candidate.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("No JSON object found in model response.")

    return json.loads(candidate[start : end + 1])


def normalize_result(page_number: int, result: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {
        "page_number": page_number,
        "document_code": str(result.get("document_code", "") or ""),
        "title": str(result.get("title", "") or f"Page {page_number}"),
        "page_kind": str(result.get("page_kind", "unknown") or "unknown"),
        "topics": list(result.get("topics", []) or []),
        "components": list(result.get("components", []) or []),
        "rules": list(result.get("rules", []) or []),
        "dimensions": list(result.get("dimensions", []) or []),
        "tolerances": list(result.get("tolerances", []) or []),
        "surface_finish": list(result.get("surface_finish", []) or []),
        "inspection": list(result.get("inspection", []) or []),
        "manufacturing_notes": list(result.get("manufacturing_notes", []) or []),
        "training_guidance": list(result.get("training_guidance", []) or []),
        "summary": str(result.get("summary", "") or ""),
    }
    return normalized


def anthropic_extract(image_path: Path, prompt: str, api_key: str, model: str) -> dict[str, Any]:
    image_bytes = image_path.read_bytes()
    payload = {
        "model": model,
        "max_tokens": 2200,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": base64.b64encode(image_bytes).decode("utf-8"),
                        },
                    },
                ],
            }
        ],
    }
    request = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        body = json.loads(response.read().decode("utf-8"))
    text = "\n".join(block.get("text", "") for block in body.get("content", []) if block.get("type") == "text").strip()
    return parse_json_payload(text)


def ollama_extract(image_path: Path, prompt: str, host: str, model: str) -> dict[str, Any]:
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "images": [base64.b64encode(image_path.read_bytes()).decode("utf-8")],
    }
    request = urllib.request.Request(
        f"{host.rstrip('/')}/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        body = json.loads(response.read().decode("utf-8"))
    response_text = body.get("response", "{}").strip()
    return parse_json_payload(response_text)


def extract_with_retries(
    provider: str,
    image_path: Path,
    prompt: str,
    args: argparse.Namespace,
    env_values: dict[str, str],
) -> dict[str, Any]:
    attempts = max(1, args.retries)
    last_error: Exception | None = None

    for attempt in range(1, attempts + 1):
        try:
            if provider == "anthropic":
                api_key = env_values.get("ANTHROPIC_API_KEY", "")
                if not api_key:
                    raise RuntimeError("ANTHROPIC_API_KEY not found in .env.local")
                return anthropic_extract(image_path, prompt, api_key, args.anthropic_model)

            if provider == "ollama":
                host = env_values.get("OLLAMA_HOST") or os.environ.get("OLLAMA_HOST") or "http://localhost:11434"
                return ollama_extract(image_path, prompt, host, args.ollama_model)

            raise RuntimeError(f"Unsupported provider for retry extraction: {provider}")
        except (urllib.error.URLError, TimeoutError, http.client.RemoteDisconnected, json.JSONDecodeError, ValueError) as error:
            last_error = error
            if attempt == attempts:
                break
            wait_seconds = attempt * 3
            print(
                f"Retrying page extraction after error on attempt {attempt}/{attempts}: {error}",
                file=sys.stderr,
            )
            time.sleep(wait_seconds)

    if last_error is None:
        raise RuntimeError("Extraction failed without an explicit error.")
    raise last_error


def resolve_provider(args: argparse.Namespace, env_values: dict[str, str]) -> tuple[str, dict[str, str]]:
    if args.provider != "auto":
        return args.provider, env_values
    if env_values.get("ANTHROPIC_API_KEY"):
        return "anthropic", env_values
    if env_values.get("OLLAMA_HOST") or os.environ.get("OLLAMA_HOST"):
        return "ollama", env_values
    return "none", env_values


def combine_knowledge(page_results: list[dict[str, Any]]) -> dict[str, Any]:
    component_rules: dict[str, list[str]] = defaultdict(list)
    topic_pages: dict[str, list[int]] = defaultdict(list)
    document_map: dict[str, list[str]] = defaultdict(list)
    training_rows: list[dict[str, Any]] = []

    for result in page_results:
        page_number = result.get("page_number")
        page_kind = result.get("page_kind", "unknown")
        for topic in result.get("topics", []):
            topic_pages[topic].append(page_number)

        if page_kind == "index":
            for component in result.get("components", []):
                guidance = result.get("training_guidance", [])
                for item in guidance:
                    if item not in document_map[component]:
                        document_map[component].append(item)

        for component in result.get("components", []):
            if page_kind != "index":
                for rule in result.get("rules", []):
                    if rule not in component_rules[component]:
                        component_rules[component].append(rule)

            training_rows.append(
                {
                    "component": component,
                    "page_number": page_number,
                    "document_code": result.get("document_code", ""),
                    "title": result.get("title", ""),
                    "rules": result.get("rules", []),
                    "dimensions": result.get("dimensions", []),
                    "tolerances": result.get("tolerances", []),
                    "surface_finish": result.get("surface_finish", []),
                    "inspection": result.get("inspection", []),
                    "manufacturing_notes": result.get("manufacturing_notes", []),
                    "training_guidance": result.get("training_guidance", []),
                    "summary": result.get("summary", ""),
                }
            )

    return {
        "page_count": len(page_results),
        "topics": dict(sorted(topic_pages.items(), key=lambda item: item[0])),
        "document_map": dict(sorted(document_map.items(), key=lambda item: item[0])),
        "component_rules": dict(sorted(component_rules.items(), key=lambda item: item[0])),
        "training_rows": training_rows,
        "pages": page_results,
    }


def collect_existing_results(analyses_dir: Path, start_page: int, end_page: int) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for analysis_file in sorted(analyses_dir.glob("page_*.json")):
        match = re.search(r"page_(\d+)\.json$", analysis_file.name)
        if not match:
            continue
        page_number = int(match.group(1))
        if page_number < start_page or page_number > end_page:
            continue
        try:
            payload = json.loads(analysis_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        results.append(normalize_result(page_number, payload))
    return results


def write_outputs(output_root: Path, knowledge: dict[str, Any]) -> None:
    knowledge_dir = output_root / "knowledge"
    knowledge_dir.mkdir(parents=True, exist_ok=True)

    (knowledge_dir / "knowledge_base.json").write_text(
        json.dumps(knowledge, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    (knowledge_dir / "component_rules.json").write_text(
        json.dumps(knowledge["component_rules"], indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    manifest = {
        "source_document": str(DEFAULT_PDF),
        "page_count": knowledge["page_count"],
        "component_count": len(knowledge["component_rules"]),
        "topic_count": len(knowledge["topics"]),
        "components": sorted(knowledge["component_rules"].keys()),
    }
    (knowledge_dir / "training_model_manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    with (knowledge_dir / "training_corpus.jsonl").open("w", encoding="utf-8") as handle:
        for row in knowledge["training_rows"]:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    per_component_dir = knowledge_dir / "components"
    per_component_dir.mkdir(parents=True, exist_ok=True)
    for component, rules in knowledge["component_rules"].items():
        component_rows = [row for row in knowledge["training_rows"] if row["component"] == component]
        slug = re.sub(r"[^a-z0-9]+", "-", component.lower()).strip("-") or "component"
        (per_component_dir / f"{slug}.json").write_text(
            json.dumps(
                {
                    "component": component,
                    "rules": rules,
                    "examples": component_rows,
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

    prompt_lines = [
        "# NX Agent System Prompt",
        "",
        "Use the following Bonfiglioli handbook-derived rules when creating or validating mechanical parts.",
        "",
    ]
    if knowledge["document_map"]:
        prompt_lines.extend(
            [
                "## Document Navigation",
                "Use these component-to-handbook notes to choose the right standard before generating geometry.",
                "",
            ]
        )
        for component, references in knowledge["document_map"].items():
            prompt_lines.append(f"### {component}")
            for reference in references:
                prompt_lines.append(f"- {reference}")
            prompt_lines.append("")

    for component, rules in knowledge["component_rules"].items():
        prompt_lines.append(f"## {component}")
        for rule in rules:
            prompt_lines.append(f"- {rule}")
        prompt_lines.append("")

    (knowledge_dir / "nx_agent_system_prompt.md").write_text("\n".join(prompt_lines), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a handbook-based training corpus for the NX agent.")
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--provider", choices=["auto", "anthropic", "ollama", "none"], default="auto")
    parser.add_argument("--anthropic-model", default="claude-sonnet-4-5")
    parser.add_argument("--ollama-model", default="llava:latest")
    parser.add_argument("--start-page", type=int, default=1)
    parser.add_argument("--end-page", type=int, default=8)
    parser.add_argument("--skip-render", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--continue-on-error", action="store_true")
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--sleep", type=float, default=0.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    env_values = load_env_file(args.env_file)
    provider, env_values = resolve_provider(args, env_values)
    paths = ensure_dirs(args.output_root)
    reader = PdfReader(str(args.pdf))
    start_page = max(1, args.start_page)
    end_page = min(len(reader.pages), args.end_page)

    if not args.skip_render:
        render_pages(args.pdf, paths["raw"], start_page, end_page)

    results: list[dict[str, Any]] = []
    for page_number in range(start_page, end_page + 1):
        raw_image = paths["raw"] / f"page_{page_number:04d}.png"
        cropped_image = paths["cropped"] / f"page_{page_number:04d}.png"
        analysis_file = paths["analyses"] / f"page_{page_number:04d}.json"

        if args.resume and analysis_file.exists():
            try:
                cached = json.loads(analysis_file.read_text(encoding="utf-8"))
                results.append(normalize_result(page_number, cached))
                print(f"Reused page {page_number}")
                continue
            except json.JSONDecodeError:
                print(f"Rebuilding page {page_number}: cached analysis is invalid", file=sys.stderr)

        if not raw_image.exists():
            print(f"Skipping page {page_number}: raw screenshot missing", file=sys.stderr)
            continue

        crop_pdf_viewer_image(raw_image, cropped_image)
        fallback_text = page_text(reader, page_number)
        prompt = make_extraction_prompt(page_number, fallback_text)

        try:
            if provider in {"anthropic", "ollama"}:
                result = extract_with_retries(provider, cropped_image, prompt, args, env_values)
            else:
                result = {
                    "page_number": page_number,
                    "document_code": "",
                    "title": f"Page {page_number}",
                    "page_kind": "unknown",
                    "topics": [],
                    "components": [],
                    "rules": [],
                    "dimensions": [],
                    "tolerances": [],
                    "surface_finish": [],
                    "inspection": [],
                    "manufacturing_notes": [],
                    "training_guidance": [],
                    "summary": fallback_text[:600] or "Rendering complete. AI extraction not run.",
                }
        except Exception as error:
            if not args.continue_on_error:
                raise
            print(f"Failed page {page_number}: {error}", file=sys.stderr)
            result = {
                "page_number": page_number,
                "document_code": "",
                "title": f"Page {page_number}",
                "page_kind": "unknown",
                "topics": [],
                "components": [],
                "rules": [],
                "dimensions": [],
                "tolerances": [],
                "surface_finish": [],
                "inspection": [],
                "manufacturing_notes": [],
                "training_guidance": [f"Extraction failed: {error}"],
                "summary": fallback_text[:600] or f"Extraction failed for page {page_number}.",
            }

        result = normalize_result(page_number, result)
        analysis_file.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
        results.append(result)
        print(f"Processed page {page_number}")
        if args.sleep:
            time.sleep(args.sleep)

    all_results = collect_existing_results(paths["analyses"], start_page, end_page)
    knowledge = combine_knowledge(all_results)
    write_outputs(args.output_root, knowledge)
    print(f"Training data written to: {args.output_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
