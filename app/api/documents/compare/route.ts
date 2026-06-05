import fs from "fs";
import path from "path";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";

const PYTHON_CANDIDATES = [
  "C:\\Users\\Projecta0003\\AppData\\Local\\Microsoft\\WindowsApps\\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0\\python.exe",
  "C:\\Users\\Projecta0003\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe",
  "C:\\Users\\Projecta0003\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe",
  "python",
];
const DIRECT_PDF_PYTHON_CANDIDATES = [
  "C:\\Users\\Projecta0003\\AppData\\Local\\Microsoft\\WindowsApps\\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0\\python.exe",
  "C:\\Users\\Projecta0003\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe",
  "python",
];

const ROOT_DIR = process.cwd();
const SCRIPT_PATH = path.join(/*turbopackIgnore: true*/ ROOT_DIR, "scripts", "compare_documents.py");
const PREVIEW_SCRIPT_PATH = path.join(/*turbopackIgnore: true*/ ROOT_DIR, "scripts", "render_pdf_preview.py");
const PDF_HIGHLIGHT_SCRIPT_PATH = path.join(/*turbopackIgnore: true*/ ROOT_DIR, "scripts", "pdf_highlight_compare.py");
const DATA_DIR = path.join(/*turbopackIgnore: true*/ ROOT_DIR, "data", "document-comparisons");
const PUBLIC_DIR = path.join(/*turbopackIgnore: true*/ ROOT_DIR, "public", "document-diffs");

function ensureDirectory(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const pythonCapabilityCache = new Map<string, boolean>();

function pythonSupportsPdfHighlight(candidate: string) {
  if (pythonCapabilityCache.has(candidate)) {
    return pythonCapabilityCache.get(candidate)!;
  }

  try {
    const probe = spawn(candidate, ["-c", "import fitz, docx, reportlab; print('ok')"], {
      cwd: ROOT_DIR,
      shell: candidate === "python",
      windowsHide: true,
    });

    let stdout = "";
    probe.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    return new Promise<boolean>((resolve) => {
      probe.on("error", () => {
        pythonCapabilityCache.set(candidate, false);
        resolve(false);
      });
      probe.on("close", (code) => {
        const ok = code === 0 && stdout.includes("ok");
        pythonCapabilityCache.set(candidate, ok);
        resolve(ok);
      });
    });
  } catch {
    pythonCapabilityCache.set(candidate, false);
    return Promise.resolve(false);
  }
}

async function resolvePythonExecutable(preferPdfHighlight = false) {
  if (preferPdfHighlight) {
    for (const candidate of PYTHON_CANDIDATES) {
      if (candidate !== "python" && !fs.existsSync(candidate)) continue;
      if (await pythonSupportsPdfHighlight(candidate)) return candidate;
    }
  }

  for (const candidate of PYTHON_CANDIDATES) {
    if (candidate === "python") return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }
  return "python";
}

function resolveDirectPdfPythonExecutable() {
  for (const candidate of DIRECT_PDF_PYTHON_CANDIDATES) {
    if (candidate === "python") return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }
  return "python";
}

function slugifyName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function collectPreviewImages(publicJobDir: string) {
  if (!fs.existsSync(publicJobDir)) {
    return [];
  }

  return fs
    .readdirSync(publicJobDir)
    .filter((fileName) => /^preview-page-\d+\.png$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((fileName) => `/document-diffs/${path.basename(publicJobDir)}/${fileName}`);
}

async function runCompareScript(leftPath: string, rightPath: string, outputJson: string, outputPdf: string) {
  const preferPdfHighlight = leftPath.toLowerCase().endsWith(".pdf") && rightPath.toLowerCase().endsWith(".pdf");
  const python = await resolvePythonExecutable(preferPdfHighlight);
  return new Promise<string>((resolve, reject) => {
    const child = spawn(python, [SCRIPT_PATH, leftPath, rightPath, outputJson, outputPdf], {
      cwd: ROOT_DIR,
      shell: python === "python",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Compare script failed with exit code ${code}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function runPdfHighlightScript(leftPath: string, rightPath: string, outputPdf: string) {
  const python = resolveDirectPdfPythonExecutable();
  return new Promise<void>((resolve, reject) => {
    const child = spawn(python, [PDF_HIGHLIGHT_SCRIPT_PATH, leftPath, rightPath, outputPdf], {
      cwd: ROOT_DIR,
      shell: python === "python",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `PDF highlight script failed with exit code ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function runPreviewScript(pdfPath: string, outputDir: string, publicJobDir: string) {
  const python = resolveDirectPdfPythonExecutable();
  return new Promise<{ previewImages: string[]; pageCount: number; previewPageCount: number }>((resolve, reject) => {
    const child = spawn(python, [PREVIEW_SCRIPT_PATH, pdfPath, outputDir, "6"], {
      cwd: ROOT_DIR,
      shell: python === "python",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Preview script failed with exit code ${code}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim()) as {
          files: string[];
          pageCount: number;
          previewPageCount: number;
        };

        resolve({
          previewImages: parsed.files.map((fileName) => `/document-diffs/${path.basename(publicJobDir)}/${fileName}`),
          pageCount: parsed.pageCount,
          previewPageCount: parsed.previewPageCount,
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function POST(request: Request) {
  try {
    ensureDirectory(DATA_DIR);
    ensureDirectory(PUBLIC_DIR);

    const formData = await request.formData();
    const leftFile = formData.get("leftFile");
    const rightFile = formData.get("rightFile");

    if (!(leftFile instanceof File) || !(rightFile instanceof File)) {
      return Response.json({ error: "Two files are required for comparison." }, { status: 400 });
    }

    if (!leftFile.name || !rightFile.name) {
      return Response.json({ error: "Uploaded files must have valid names." }, { status: 400 });
    }

    const jobId = `diff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const jobDataDir = path.join(DATA_DIR, jobId);
    const inputDir = path.join(jobDataDir, "input");
    const outputDir = path.join(jobDataDir, "output");
    const publicJobDir = path.join(PUBLIC_DIR, jobId);
    ensureDirectory(inputDir);
    ensureDirectory(outputDir);
    ensureDirectory(publicJobDir);

    const leftPath = path.join(inputDir, slugifyName(leftFile.name));
    const rightPath = path.join(inputDir, slugifyName(rightFile.name));
    fs.writeFileSync(leftPath, Buffer.from(await leftFile.arrayBuffer()));
    fs.writeFileSync(rightPath, Buffer.from(await rightFile.arrayBuffer()));

    const outputJson = path.join(outputDir, "comparison.json");
    const outputPdf = path.join(publicJobDir, "comparison-report.pdf");

    const bothPdf = leftPath.toLowerCase().endsWith(".pdf") && rightPath.toLowerCase().endsWith(".pdf");

    await runCompareScript(leftPath, rightPath, outputJson, outputPdf);

    if (bothPdf) {
      try {
        await runPdfHighlightScript(leftPath, rightPath, outputPdf);
      } catch {
        // Keep the compare output PDF as a fallback if the direct highlighter cannot run.
      }
    }

    let preview = {
      previewImages: [] as string[],
      pageCount: 0,
      previewPageCount: 0,
    };

    try {
      preview = await runPreviewScript(outputPdf, publicJobDir, publicJobDir);
    } catch {
      preview = {
        previewImages: [],
        pageCount: 0,
        previewPageCount: 0,
      };
    }

    if (!preview.previewImages.length) {
      const previewImages = collectPreviewImages(publicJobDir);
      if (previewImages.length) {
        preview = {
          previewImages,
          pageCount: preview.pageCount || previewImages.length,
          previewPageCount: previewImages.length,
        };
      }
    }

    const report = JSON.parse(fs.readFileSync(outputJson, "utf8")) as {
      summary: Record<string, number>;
      entries: Array<{
        kind: string;
        leftLineNumber: number | null;
        rightLineNumber: number | null;
        leftParts: Array<{ text: string; type: string }>;
        rightParts: Array<{ text: string; type: string }>;
      }>;
      leftFileName: string;
      rightFileName: string;
      generatedAt: string;
    };

    return Response.json({
      jobId,
      leftFileName: report.leftFileName,
      rightFileName: report.rightFileName,
      generatedAt: report.generatedAt,
      summary: report.summary,
      entries: report.entries,
      pdfUrl: `/document-diffs/${jobId}/comparison-report.pdf`,
      previewImages: preview.previewImages,
      pdfPageCount: preview.pageCount,
      previewPageCount: preview.previewPageCount,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to compare documents." },
      { status: 500 }
    );
  }
}
