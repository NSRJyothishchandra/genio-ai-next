const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

function findBrowserExecutable() {
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function toFileUrl(filePath) {
  return `file:///${filePath.replace(/\\/g, "/").replace(/ /g, "%20")}`;
}

async function main() {
  const [, , pdfPath, outDir, startPageArg, endPageArg] = process.argv;
  if (!pdfPath || !outDir || !startPageArg || !endPageArg) {
    throw new Error("Usage: node scripts/render_bmtq_pages.js <pdfPath> <outDir> <startPage> <endPage>");
  }

  const startPage = Number(startPageArg);
  const endPage = Number(endPageArg);
  if (!Number.isFinite(startPage) || !Number.isFinite(endPage) || startPage < 1 || endPage < startPage) {
    throw new Error("Invalid page range.");
  }

  const browserExecutable = findBrowserExecutable();
  if (!browserExecutable) {
    throw new Error("No local Chrome or Edge executable found.");
  }

  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: browserExecutable,
    headless: true,
  });

  const page = await browser.newPage({
    viewport: { width: 1600, height: 2200 },
    deviceScaleFactor: 1,
  });

  const baseUrl = toFileUrl(path.resolve(pdfPath));

  for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
    const targetUrl = `${baseUrl}#page=${pageNumber}`;
    await page.goto(targetUrl, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(2200);

    const outputPath = path.join(outDir, `page_${String(pageNumber).padStart(4, "0")}.png`);
    await page.screenshot({
      path: outputPath,
      fullPage: false,
    });
    console.log(outputPath);
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
