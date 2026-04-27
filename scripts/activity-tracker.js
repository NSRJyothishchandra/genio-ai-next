#!/usr/bin/env node
/**
 * Projecta HR — Windows Activity Tracker
 * Polls the foreground window every 10 seconds and logs activity.
 * Run with:  node scripts/activity-tracker.js
 * Stops at:  Ctrl+C
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const LOG_FILE = path.join(__dirname, "..", "data", "activity-raw.jsonl");
const POLL_MS = 10_000; // 10 seconds
const APP_URL = "http://localhost:3001"; // notify browser via API

// PowerShell script to get the foreground window (uses Win32 API)
const PS_SCRIPT = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll",CharSet=CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
}
'@
$h = [FW]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder(256)
[FW]::GetWindowText($h,$sb,256) | Out-Null
$pid2 = 0
[FW]::GetWindowThreadProcessId($h,[ref]$pid2) | Out-Null
$proc = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
@{
  title = $sb.ToString()
  app   = if ($proc) { $proc.Name } else { "Unknown" }
  pid   = $pid2
  ts    = (Get-Date -Format "o")
} | ConvertTo-Json -Compress
`.trim();

// Write PS script to temp file (bypasses execution policy cleanly)
const PS_FILE = path.join(require("os").tmpdir(), "get_fw.ps1");
fs.writeFileSync(PS_FILE, PS_SCRIPT, "utf8");

let lastTitle = "";
let lastApp = "";
let sessionStart = null;

function getForegroundWindow() {
  try {
    const out = execSync(
      `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${PS_FILE}"`,
      { timeout: 3000, encoding: "utf8", windowsHide: true }
    ).trim();
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function categorize(app, title) {
  const t = (title + " " + app).toLowerCase();
  if (t.includes("visual studio code") || t.includes("code")) return "Development";
  if (t.includes("visual studio")) return "Development";
  if (t.includes("chrome") || t.includes("edge") || t.includes("firefox")) return "Browsing";
  if (t.includes("excel") || t.includes("sheets")) return "Spreadsheets";
  if (t.includes("outlook") || t.includes("gmail") || t.includes("mail")) return "Email";
  if (t.includes("teams") || t.includes("slack") || t.includes("meet")) return "Communication";
  if (t.includes("word") || t.includes("docs")) return "Documentation";
  if (t.includes("claude")) return "AI Assistant";
  if (t.includes("postman") || t.includes("insomnia")) return "API Testing";
  if (t.includes("figma") || t.includes("canva") || t.includes("photoshop")) return "Design";
  if (t.includes("terminal") || t.includes("cmd") || t.includes("powershell")) return "Terminal";
  return "Other";
}

function poll() {
  const win = getForegroundWindow();
  if (!win || !win.title) return;

  const now = new Date().toISOString();
  const { title, app } = win;

  if (title !== lastTitle || app !== lastApp) {
    // Window changed — close previous session
    if (lastTitle && sessionStart) {
      const duration = Math.round((Date.now() - new Date(sessionStart).getTime()) / 1000);
      if (duration >= 10) {
        const entry = {
          title: lastTitle,
          app: lastApp,
          category: categorize(lastApp, lastTitle),
          start: sessionStart,
          end: now,
          durationSec: duration,
        };
        fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
      }
    }
    lastTitle = title;
    lastApp = app;
    sessionStart = now;
    process.stdout.write(`\r[${new Date().toLocaleTimeString()}] Active: ${app} — ${title.slice(0, 60)}`);
  }
}

// Ensure data dir exists
const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

console.log("🕐 Projecta Activity Tracker started (polls every 10s)");
console.log("📁 Writing to:", LOG_FILE);
console.log("Press Ctrl+C to stop.\n");

poll();
const interval = setInterval(poll, POLL_MS);

process.on("SIGINT", () => {
  clearInterval(interval);
  console.log("\n\n✅ Activity tracker stopped. Log saved to:", LOG_FILE);
  process.exit(0);
});
