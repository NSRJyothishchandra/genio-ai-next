import fs from "fs";
import path from "path";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";

const PYTHON_CANDIDATES = [
  "C:\\Users\\Projecta0003\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe",
  "python",
];

const ROOT_DIR = process.cwd();
const SCRIPT_PATH = path.join(ROOT_DIR, "scripts", "cad_drawing_report.py");
const DATA_DIR = path.join(ROOT_DIR, "data", "cad-reports");
const PUBLIC_DIR = path.join(ROOT_DIR, "public", "cad-reports");

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

function runCadScript(meshPath: string, outputJson: string, outputPdf: string, imageDir: string, publicPrefix: string) {
  const python = resolvePythonExecutable();
  return new Promise<string>((resolve, reject) => {
    const child = spawn(python, [SCRIPT_PATH, meshPath, outputJson, outputPdf, imageDir, publicPrefix], {
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
        reject(new Error(stderr.trim() || stdout.trim() || `CAD script failed with exit code ${code}`));
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
    const cadFile = formData.get("cadFile");
    if (!(cadFile instanceof File)) {
      return Response.json({ error: "A CAD file is required." }, { status: 400 });
    }

    const jobId = `cad_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const jobDataDir = path.join(DATA_DIR, jobId);
    const inputDir = path.join(jobDataDir, "input");
    const outputDir = path.join(jobDataDir, "output");
    const publicJobDir = path.join(PUBLIC_DIR, jobId);
    ensureDirectory(inputDir);
    ensureDirectory(outputDir);
    ensureDirectory(publicJobDir);

    const cadPath = path.join(inputDir, slugifyName(cadFile.name));
    fs.writeFileSync(cadPath, Buffer.from(await cadFile.arrayBuffer()));

    const outputJson = path.join(outputDir, "summary.json");
    const outputPdf = path.join(publicJobDir, "drawing-report.pdf");
    const publicPrefix = `cad-reports/${jobId}`;

    await runCadScript(cadPath, outputJson, outputPdf, publicJobDir, publicPrefix);
    const report = JSON.parse(fs.readFileSync(outputJson, "utf8"));
    return Response.json(report);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to analyze the CAD file." },
      { status: 500 }
    );
  }
}
