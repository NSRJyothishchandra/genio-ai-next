# Bonfiglioli NX Agent Training

This folder stores the Bonfiglioli handbook-derived training corpus for the NX agent.

## Source

- PDF: `C:\Users\Projecta0003\Desktop\genio-ai-next\BONFIGLIOLI TECHNICAL QUALITY HANDBOOK BMTQ.pdf`

## Pipeline

1. Render PDF pages through the local browser PDF viewer.
2. Crop away browser chrome to isolate the handbook page.
3. Extract structured engineering knowledge with Anthropic vision or Ollama.
4. Aggregate page analyses into a reusable training model.
5. Query the training model to enrich NX-agent prompts.

## Scripts

- Build a slice:
  - `scripts\build_bmtq_training.py`
- Query the model:
  - `scripts\query_nx_training_model.py`
- Run the full handbook in chunks:
  - `scripts\run_full_bmtq_training.ps1`

## Output Structure

- `bmtq\raw-pages`
- `bmtq\cropped-pages`
- `bmtq\page-analyses`
- `bmtq\knowledge\knowledge_base.json`
- `bmtq\knowledge\component_rules.json`
- `bmtq\knowledge\training_corpus.jsonl`
- `bmtq\knowledge\training_model_manifest.json`
- `bmtq\knowledge\nx_agent_system_prompt.md`
- `bmtq\knowledge\components\*.json`

## Typical Commands

Build pages 1-30:

```powershell
C:\Users\Projecta0003\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe scripts\build_bmtq_training.py --start-page 1 --end-page 30 --provider anthropic --resume --continue-on-error
```

Query the training model:

```powershell
C:\Users\Projecta0003\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe scripts\query_nx_training_model.py "Create a shaft with a threaded shoulder, bearing seat, and relief groove for grinding"
```

Run the full handbook in chunks:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\run_full_bmtq_training.ps1
```

## Current Notes

- The PDF behaves like a scanned handbook, so direct text extraction is weak.
- The structured analyses are therefore image-driven.
- The current training slice is designed to be incrementally extended without losing prior page analyses.
