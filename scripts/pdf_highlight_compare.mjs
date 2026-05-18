import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createCanvas } from "canvas";
import pixelmatch from "pixelmatch";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument, rgb } from "pdf-lib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workerPath = path.resolve(__dirname, "..", "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs");
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).toString();

function buildDiffRects(diffPixels, width, height) {
  const active = Array.from({ length: height }, () => new Uint8Array(width));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (diffPixels[offset + 3] > 0 || diffPixels[offset] > 0 || diffPixels[offset + 1] > 0 || diffPixels[offset + 2] > 0) {
        active[y][x] = 1;
      }
    }
  }

  const expanded = Array.from({ length: height }, () => new Uint8Array(width));
  const growX = 6;
  const growY = 3;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!active[y][x]) continue;
      const minY = Math.max(0, y - growY);
      const maxY = Math.min(height - 1, y + growY);
      const minX = Math.max(0, x - growX);
      const maxX = Math.min(width - 1, x + growX);
      for (let yy = minY; yy <= maxY; yy++) {
        expanded[yy].fill(1, minX, maxX + 1);
      }
    }
  }

  const visited = Array.from({ length: height }, () => new Uint8Array(width));
  const rects = [];
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!expanded[y][x] || visited[y][x]) continue;
      let minY = y;
      let maxY = y;
      let minX = x;
      let maxX = x;
      let pixelCount = 0;
      const stack = [[y, x]];
      visited[y][x] = 1;

      while (stack.length) {
        const [currentY, currentX] = stack.pop();
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);
        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        pixelCount++;

        for (const [dr, dc] of directions) {
          const nextY = currentY + dr;
          const nextX = currentX + dc;
          if (nextY < 0 || nextX < 0 || nextY >= height || nextX >= width) continue;
          if (!expanded[nextY][nextX] || visited[nextY][nextX]) continue;
          visited[nextY][nextX] = 1;
          stack.push([nextY, nextX]);
        }
      }

      if (pixelCount < 18) continue;
      const paddingX = 3;
      const paddingY = 2;
      rects.push({
        x: Math.max(0, minX - paddingX),
        y: Math.max(0, minY - paddingY),
        width: Math.min(width, maxX + 1 + paddingX) - Math.max(0, minX - paddingX),
        height: Math.min(height, maxY + 1 + paddingY) - Math.max(0, minY - paddingY),
      });
    }
  }

  rects.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const merged = [];
  for (const rect of rects) {
    const last = merged[merged.length - 1];
    if (
      last &&
      Math.abs(rect.y - last.y) < 18 &&
      rect.x <= last.x + last.width + 20 &&
      rect.y <= last.y + last.height + 10
    ) {
      const right = Math.max(last.x + last.width, rect.x + rect.width);
      const bottom = Math.max(last.y + last.height, rect.y + rect.height);
      last.x = Math.min(last.x, rect.x);
      last.y = Math.min(last.y, rect.y);
      last.width = right - last.x;
      last.height = bottom - last.y;
    } else {
      merged.push({ ...rect });
    }
  }

  return merged.filter((rect) => rect.width > 8 && rect.height > 8);
}

async function renderPdfPage(page, scale) {
  const viewport = page.getViewport({ scale });
  const renderWidth = Math.max(1, Math.ceil(viewport.width));
  const renderHeight = Math.max(1, Math.ceil(viewport.height));
  const canvas = createCanvas(renderWidth, renderHeight);
  const ctx = canvas.getContext("2d");
  await page.render({
    canvasContext: ctx,
    viewport,
    canvas,
  }).promise;
  return { canvas, ctx, viewport, renderWidth, renderHeight };
}

async function main() {
  const [originalPdfPath, updatedPdfPath, outputPdfPath] = process.argv.slice(2, 5);
  if (!originalPdfPath || !updatedPdfPath || !outputPdfPath) {
    throw new Error("Usage: node pdf_highlight_compare.mjs <original_pdf> <updated_pdf> <output_pdf>");
  }

  const originalBuffer = fs.readFileSync(originalPdfPath);
  const updatedBuffer = fs.readFileSync(updatedPdfPath);
  const originalDoc = await pdfjs.getDocument({ data: new Uint8Array(originalBuffer) }).promise;
  const updatedDoc = await pdfjs.getDocument({ data: new Uint8Array(updatedBuffer) }).promise;
  const outputDoc = await PDFDocument.load(updatedBuffer);
  const pageCount = updatedDoc.numPages;
  const scale = 2;

  for (let pageIndex = 1; pageIndex <= pageCount; pageIndex++) {
    const updatedPage = await updatedDoc.getPage(pageIndex);
    const updatedRender = await renderPdfPage(updatedPage, scale);
    const { canvas: updatedCanvas, ctx: updatedCtx, viewport: updatedViewport, renderWidth, renderHeight } = updatedRender;
    const outputPage = outputDoc.getPage(pageIndex - 1);
    const outputPageWidth = outputPage.getWidth();
    const outputPageHeight = outputPage.getHeight();

    let rects = [];
    if (pageIndex <= originalDoc.numPages) {
      const originalPage = await originalDoc.getPage(pageIndex);
      const originalRender = await renderPdfPage(originalPage, scale);
      const originalData = originalRender.ctx.getImageData(0, 0, renderWidth, renderHeight);
      const updatedData = updatedCtx.getImageData(0, 0, renderWidth, renderHeight);
      const diffData = updatedCtx.createImageData(renderWidth, renderHeight);
      pixelmatch(
        originalData.data,
        updatedData.data,
        diffData.data,
        renderWidth,
        renderHeight,
        { threshold: 0.18, includeAA: false }
      );
      rects = buildDiffRects(diffData.data, renderWidth, renderHeight);
    } else {
      rects = [{ x: 20, y: 20, width: renderWidth - 40, height: renderHeight - 40 }];
    }

    updatedCtx.save();
    updatedCtx.lineWidth = 3;
    updatedCtx.strokeStyle = "rgba(220, 38, 38, 0.92)";
    updatedCtx.fillStyle = "rgba(253, 224, 71, 0.35)";
    for (const rect of rects) {
      updatedCtx.fillRect(rect.x, rect.y, rect.width, rect.height);
      updatedCtx.strokeRect(rect.x, rect.y, rect.width, rect.height);

      const scaleX = outputPageWidth / renderWidth;
      const scaleY = outputPageHeight / renderHeight;
      const pdfRectX = rect.x * scaleX;
      const pdfRectWidth = rect.width * scaleX;
      const pdfRectHeight = rect.height * scaleY;
      const pdfRectY = outputPageHeight - ((rect.y + rect.height) * scaleY);

      outputPage.drawRectangle({
        x: pdfRectX,
        y: pdfRectY,
        width: pdfRectWidth,
        height: pdfRectHeight,
        color: rgb(0.992, 0.878, 0.278),
        opacity: 0.35,
        borderColor: rgb(0.863, 0.149, 0.149),
        borderWidth: Math.max(0.8, Math.min(outputPageWidth, outputPageHeight) * 0.0018),
      });
    }
    updatedCtx.restore();
  }

  const saved = await outputDoc.save();
  fs.writeFileSync(outputPdfPath, saved);
  console.log(JSON.stringify({ outputPdfPath }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
