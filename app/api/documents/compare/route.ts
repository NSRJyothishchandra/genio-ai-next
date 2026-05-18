import fs from "fs";
import path from "path";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";

const PYTHON_CANDIDATES = [
  "C:\\Users\\Projecta0003\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe",
  "python",
];

const ROOT_DIR = process.cwd();
const SCRIPT_PATH = path.join(/*turbopackIgnore: true*/ ROOT_DIR, "scripts", "compare_documents.py");
const DATA_DIR = path.join(/*turbopackIgnore: true*/ ROOT_DIR, "data", "document-comparisons");
const PUBLIC_DIR = path.join(/*turbopackIgnore: true*/ ROOT_DIR, "public", "document-diffs");

function ensureDirectory(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function resolvePythonExecutable() {
  for (const candidate of PYTHON_CANDIDATES) {
    if (candidate === "python") return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }
  return "python";
}

function slugifyName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function runCompareScript(leftPath: string, rightPath: string, outputJson: string, outputPdf: string) {
  const python = resolvePythonExecutable();
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

    await runCompareScript(leftPath, rightPath, outputJson, outputPdf);

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
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to compare documents." },
      { status: 500 }
    );
  }
}
