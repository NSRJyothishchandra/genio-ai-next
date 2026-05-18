from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_KNOWLEDGE_DIR = ROOT / "data" / "nx-agent-training" / "bmtq" / "knowledge"


def tokenize(text: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9]+", text.lower()) if len(token) > 2}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def score_component(component: str, prompt_tokens: set[str]) -> int:
    return len(tokenize(component) & prompt_tokens)


def score_row(row: dict[str, Any], prompt_tokens: set[str]) -> int:
    text_parts = [
        row.get("component", ""),
        row.get("title", ""),
        row.get("summary", ""),
        " ".join(row.get("rules", [])),
        " ".join(row.get("dimensions", [])),
        " ".join(row.get("tolerances", [])),
        " ".join(row.get("training_guidance", [])),
    ]
    row_tokens = tokenize(" ".join(text_parts))
    return len(row_tokens & prompt_tokens)


def build_context(prompt: str, knowledge_dir: Path, top_components: int, top_examples: int) -> dict[str, Any]:
    knowledge = load_json(knowledge_dir / "knowledge_base.json")
    component_rules = load_json(knowledge_dir / "component_rules.json")
    training_rows = knowledge.get("training_rows", [])
    document_map = knowledge.get("document_map", {})

    prompt_tokens = tokenize(prompt)
    component_scores = [
        (component, score_component(component, prompt_tokens))
        for component in component_rules.keys()
    ]
    ranked_components = [component for component, score in sorted(component_scores, key=lambda item: (-item[1], item[0])) if score > 0]
    if not ranked_components:
        ranked_components = list(component_rules.keys())[:top_components]
    else:
        ranked_components = ranked_components[:top_components]

    relevant_rows = []
    for row in training_rows:
        if row.get("component") not in ranked_components:
            continue
        row_score = score_row(row, prompt_tokens)
        if row_score <= 0:
            continue
        row_copy = dict(row)
        row_copy["_score"] = row_score
        relevant_rows.append(row_copy)

    relevant_rows.sort(key=lambda item: (-item["_score"], item.get("page_number", 0), item.get("component", "")))

    component_examples: dict[str, list[dict[str, Any]]] = {component: [] for component in ranked_components}
    for row in relevant_rows:
        component = row["component"]
        if len(component_examples[component]) >= top_examples:
            continue
        component_examples[component].append(row)

    recommended_rules = []
    seen_rules = set()
    for component in ranked_components:
        for rule in component_rules.get(component, []):
            if rule in seen_rules:
                continue
            recommended_rules.append({"component": component, "rule": rule})
            seen_rules.add(rule)
            if len(recommended_rules) >= 20:
                break
        if len(recommended_rules) >= 20:
            break

    coverage_counter = Counter(row.get("component", "") for row in training_rows)

    return {
        "prompt": prompt,
        "ranked_components": ranked_components,
        "recommended_rules": recommended_rules,
        "document_navigation": {component: document_map.get(component, []) for component in ranked_components},
        "examples": component_examples,
        "coverage": {component: coverage_counter.get(component, 0) for component in ranked_components},
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Query the Bonfiglioli NX agent training model.")
    parser.add_argument("prompt", help="Prompt or part description to retrieve handbook guidance for.")
    parser.add_argument("--knowledge-dir", type=Path, default=DEFAULT_KNOWLEDGE_DIR)
    parser.add_argument("--top-components", type=int, default=5)
    parser.add_argument("--top-examples", type=int, default=3)
    parser.add_argument("--format", choices=["json", "markdown"], default="markdown")
    return parser.parse_args()


def to_markdown(context: dict[str, Any]) -> str:
    lines = [
        "# NX Training Context",
        "",
        f"Prompt: {context['prompt']}",
        "",
        "## Ranked Components",
    ]
    for component in context["ranked_components"]:
        lines.append(f"- {component} ({context['coverage'].get(component, 0)} examples)")

    lines.extend(["", "## Recommended Rules"])
    for item in context["recommended_rules"]:
        lines.append(f"- [{item['component']}] {item['rule']}")

    lines.extend(["", "## Document Navigation"])
    for component, references in context["document_navigation"].items():
        if not references:
            continue
        lines.append(f"### {component}")
        for reference in references[:8]:
            lines.append(f"- {reference}")

    lines.extend(["", "## Example Training Rows"])
    for component, rows in context["examples"].items():
        if not rows:
            continue
        lines.append(f"### {component}")
        for row in rows:
            lines.append(f"- Page {row['page_number']}: {row.get('title', '')}")
            for rule in row.get("rules", [])[:4]:
                lines.append(f"  - Rule: {rule}")
            for dimension in row.get("dimensions", [])[:3]:
                lines.append(f"  - Dimension: {dimension}")
            for tolerance in row.get("tolerances", [])[:3]:
                lines.append(f"  - Tolerance: {tolerance}")
    return "\n".join(lines)


def main() -> int:
    try:
        import sys

        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    args = parse_args()
    context = build_context(args.prompt, args.knowledge_dir, args.top_components, args.top_examples)
    if args.format == "json":
        print(json.dumps(context, indent=2, ensure_ascii=False))
    else:
        print(to_markdown(context))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
