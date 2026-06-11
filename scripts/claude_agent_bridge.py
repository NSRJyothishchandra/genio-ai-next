import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
from typing import Optional


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def find_claude_executable() -> Optional[str]:
    candidates = [
        shutil.which("claude"),
        shutil.which("claude.cmd"),
        shutil.which("claude.exe"),
    ]
    for candidate in candidates:
        if candidate:
            return candidate
    return None


def build_prompt(target: str, user_prompt: str) -> str:
    base = user_prompt.strip()
    if target == "desktop":
        return (
            "You are the Genio AI Desktop Agent running through Claude CLI. "
            "Interpret the user's request as a desktop or local-machine task. "
            "If the request involves files, apps, folders, commands, or machine actions, "
            "reason carefully and execute or explain the exact steps using available tools. "
            "Be concise, practical, and completion-oriented.\n\n"
            f"User task:\n{base}"
        )
    if target == "cli":
        return (
            "You are the Genio AI CLI Agent running through Claude CLI. "
            "Treat the user's request as a local development or terminal workflow. "
            "Use the exact working directory provided by the caller. "
            "Prefer completing the task instead of just describing it.\n\n"
            f"User task:\n{base}"
        )
    return base


def resolve_workdir(raw_workdir: str) -> str:
    value = (raw_workdir or "").strip().strip('"').strip("'")
    if not value:
        return os.getcwd()

    value = os.path.expandvars(os.path.expanduser(value.replace("/", os.sep)))
    path_obj = Path(value)

    if not path_obj.is_absolute():
      home = Path.home()
      alias_roots = {
          "desktop": home / "Desktop",
          "documents": home / "Documents",
          "downloads": home / "Downloads",
          "pictures": home / "Pictures",
          "videos": home / "Videos",
          "music": home / "Music",
      }
      parts = path_obj.parts
      if parts:
          alias = parts[0].lower()
          if alias in alias_roots:
              path_obj = alias_roots[alias].joinpath(*parts[1:])
          else:
              path_obj = Path(os.getcwd()) / path_obj
      else:
          path_obj = Path(os.getcwd())

    normalized = path_obj.resolve(strict=False)

    if normalized.exists() and not normalized.is_dir():
        raise NotADirectoryError(f"{normalized} exists but is not a directory.")

    if not normalized.exists():
        normalized.mkdir(parents=True, exist_ok=True)

    return str(normalized)


def relay_stderr(stderr) -> None:
    for raw in iter(stderr.readline, ""):
        text = raw.strip()
        if text:
            emit({"type": "stderr", "text": text})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--target", default="cli")
    parser.add_argument("--workdir", default="")
    args = parser.parse_args()

    claude_executable = find_claude_executable()
    if not claude_executable:
        emit({"type": "error", "message": "Claude CLI was not found in PATH."})
        return 1

    workdir = resolve_workdir(args.workdir)
    prompt = build_prompt(args.target.strip().lower(), args.prompt)

    emit(
        {
            "type": "info",
            "text": f"Starting Claude CLI bridge for {args.target} in {workdir}",
        }
    )

    process = subprocess.Popen(
        [
            claude_executable,
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--permission-mode",
            "bypassPermissions",
            "--dangerously-skip-permissions",
            "--add-dir",
            workdir,
            "--",
            prompt,
        ],
        cwd=workdir,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=False,
        env={**os.environ},
    )

    stderr_thread = threading.Thread(target=relay_stderr, args=(process.stderr,), daemon=True)
    stderr_thread.start()

    try:
        for raw in iter(process.stdout.readline, ""):
            line = raw.strip()
            if not line:
                continue

            try:
                parsed = json.loads(line)
            except json.JSONDecodeError:
                emit({"type": "text", "text": line})
                continue

            event_type = parsed.get("type")
            if event_type in {"system", "rate_limit_event"}:
                continue
            if event_type == "assistant" and parsed.get("message"):
                content = parsed["message"].get("content")
                if isinstance(content, list):
                    text = "".join(
                        item.get("text", "")
                        for item in content
                        if isinstance(item, dict) and item.get("type") == "text"
                    )
                    if text:
                        emit({"type": "text", "text": text})
                elif isinstance(content, str) and content:
                    emit({"type": "text", "text": content})
            elif event_type == "result" and parsed.get("result"):
                emit({"type": "text", "text": f"Result: {parsed['result']}"})
            elif event_type == "tool_use":
                emit(
                    {
                        "type": "tool",
                        "name": parsed.get("name"),
                        "input": parsed.get("input"),
                    }
                )
            else:
                emit({"type": "data", "payload": parsed})
    finally:
        return_code = process.wait()
        emit({"type": "done", "exitCode": return_code})

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
