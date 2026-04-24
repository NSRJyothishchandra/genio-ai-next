// Run: node generate-icons.mjs
// Generates simple PWA icon PNGs without any external deps using pure Node.js

import { createCanvas } from "canvas";
import { writeFileSync } from "fs";

function generateIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // Background gradient (purple to teal)
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "#6c47ff");
  grad.addColorStop(1, "#00c2a8");

  const r = size * 0.2;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // "AI" text
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${size * 0.35}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("AI", size / 2, size / 2);

  return canvas.toBuffer("image/png");
}

writeFileSync("public/icon-192.png", generateIcon(192));
writeFileSync("public/icon-512.png", generateIcon(512));
console.log("Icons generated.");
