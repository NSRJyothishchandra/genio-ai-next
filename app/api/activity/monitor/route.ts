import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const LOG_FILE = path.join(process.cwd(), "data", "activity-raw.jsonl");

// ── App catalogue ─────────────────────────────────────────────────────────────
const APP_MAP: Record<string, { icon: string; category: string; label: string }> = {
  code:              { icon: "💻", category: "Development",   label: "VS Code" },
  devenv:            { icon: "💻", category: "Development",   label: "Visual Studio" },
  rider:             { icon: "💻", category: "Development",   label: "Rider" },
  pycharm64:         { icon: "🐍", category: "Development",   label: "PyCharm" },
  webstorm64:        { icon: "🟡", category: "Development",   label: "WebStorm" },
  cursor:            { icon: "🖱️", category: "Development",   label: "Cursor" },
  "android studio":  { icon: "🤖", category: "Development",   label: "Android Studio" },
  studio64:          { icon: "🤖", category: "Development",   label: "Android Studio" },
  postman:           { icon: "🔧", category: "Development",   label: "Postman" },
  insomnia:          { icon: "🔧", category: "Development",   label: "Insomnia" },
  dbeaver:           { icon: "🗄️", category: "Development",   label: "DBeaver" },
  chrome:            { icon: "🌐", category: "Browsing",      label: "Chrome" },
  msedge:            { icon: "🌐", category: "Browsing",      label: "Edge" },
  firefox:           { icon: "🦊", category: "Browsing",      label: "Firefox" },
  brave:             { icon: "🦁", category: "Browsing",      label: "Brave" },
  iexplore:          { icon: "🌐", category: "Browsing",      label: "Internet Explorer" },
  excel:             { icon: "📊", category: "Spreadsheets",  label: "Excel" },
  winword:           { icon: "📝", category: "Documentation", label: "Word" },
  powerpnt:          { icon: "📊", category: "Documentation", label: "PowerPoint" },
  onenote:           { icon: "📓", category: "Documentation", label: "OneNote" },
  notepad:           { icon: "📄", category: "Documentation", label: "Notepad" },
  "notepad++":       { icon: "📄", category: "Documentation", label: "Notepad++" },
  obsidian:          { icon: "🗒️", category: "Documentation", label: "Obsidian" },
  outlook:           { icon: "📧", category: "Email",         label: "Outlook" },
  thunderbird:       { icon: "📧", category: "Email",         label: "Thunderbird" },
  teams:             { icon: "💬", category: "Communication", label: "Teams" },
  "ms-teams":        { icon: "💬", category: "Communication", label: "Teams" },
  slack:             { icon: "💬", category: "Communication", label: "Slack" },
  zoom:              { icon: "📹", category: "Communication", label: "Zoom" },
  discord:           { icon: "🎮", category: "Communication", label: "Discord" },
  skype:             { icon: "💬", category: "Communication", label: "Skype" },
  powershell:        { icon: "⚡", category: "Terminal",      label: "PowerShell" },
  powershell_ise:    { icon: "⚡", category: "Terminal",      label: "PowerShell ISE" },
  cmd:               { icon: "⬛", category: "Terminal",      label: "Command Prompt" },
  windowsterminal:   { icon: "⬛", category: "Terminal",      label: "Windows Terminal" },
  wt:                { icon: "⬛", category: "Terminal",      label: "Windows Terminal" },
  wsl:               { icon: "🐧", category: "Terminal",      label: "WSL" },
  git:               { icon: "🔀", category: "Development",   label: "Git" },
  "git-bash":        { icon: "🔀", category: "Terminal",      label: "Git Bash" },
  gitkraken:         { icon: "🔀", category: "Development",   label: "GitKraken" },
  claude:            { icon: "🤖", category: "AI Assistant",  label: "Claude Desktop" },
  explorer:          { icon: "📁", category: "System",        label: "File Explorer" },
  taskmgr:           { icon: "📊", category: "System",        label: "Task Manager" },
  figma:             { icon: "🎨", category: "Design",        label: "Figma" },
  photoshop:         { icon: "🖼️", category: "Design",        label: "Photoshop" },
  vlc:               { icon: "🎬", category: "Media",         label: "VLC" },
  spotify:           { icon: "🎵", category: "Media",         label: "Spotify" },
  node:              { icon: "🟢", category: "Development",   label: "Node.js" },
  "node.exe":        { icon: "🟢", category: "Development",   label: "Node.js" },
  python:            { icon: "🐍", category: "Development",   label: "Python" },
  "python.exe":      { icon: "🐍", category: "Development",   label: "Python" },
  java:              { icon: "☕", category: "Development",   label: "Java" },
};

function resolveApp(procName: string): { icon: string; category: string; label: string } {
  const key = procName.toLowerCase().replace(/\.exe$/, "");
  return APP_MAP[key] ?? { icon: "🔲", category: "Other", label: procName };
}

// ── Process snapshot from Task Manager via PowerShell ─────────────────────────
interface ProcInfo {
  pid:        number;
  name:       string;
  title:      string;
  cpuSec:     number;
  memMB:      number;
  startTime:  string;
  icon:       string;
  category:   string;
  label:      string;
}

function runPs(script: string, timeoutMs = 8000): string {
  // Use Windows %TEMP% so powershell.exe -File can resolve the path from both WSL and native contexts
  const winTemp = process.env.TEMP || process.env.TMP || os.tmpdir();
  const fileName = `hr_monitor_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`;
  const tmpFile = path.join(winTemp, fileName);
  try {
    fs.writeFileSync(tmpFile, script, "utf-8");
    const raw = execSync(
      `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmpFile}"`,
      { encoding: "utf8", timeout: timeoutMs, windowsHide: true }
    ).trim();
    return raw;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

function getSnapshot(): Map<number, ProcInfo> {
  const ps = `$ErrorActionPreference='SilentlyContinue'
$procs = Get-Process | Where-Object { $_.MainWindowTitle -ne '' }
$procs | Select-Object Id,ProcessName,MainWindowTitle,
    @{N='CPU';E={[Math]::Round($_.CPU,1)}},
    @{N='MemMB';E={[Math]::Round($_.WorkingSet64/1MB,1)}},
    @{N='StartTime';E={ if($_.StartTime){ $_.StartTime.ToString('yyyy-MM-ddTHH:mm:ss') } else { '' } }} |
  ConvertTo-Json -Compress`;

  try {
    const raw = runPs(ps, 6000);

    if (!raw) return new Map();
    const arr = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [JSON.parse(raw)];
    const map = new Map<number, ProcInfo>();

    for (const p of arr) {
      if (!p || !p.Id) continue;
      const meta = resolveApp(p.ProcessName ?? "");
      map.set(Number(p.Id), {
        pid:       Number(p.Id),
        name:      p.ProcessName ?? "",
        title:     p.MainWindowTitle ?? "",
        cpuSec:    p.CPU ?? 0,
        memMB:     p.MemMB ?? 0,
        startTime: p.StartTime ?? "",
        ...meta,
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

// ── Full process list (like full Task Manager) ────────────────────────────────
function getAllProcesses(): object[] {
  const ps = `$ErrorActionPreference='SilentlyContinue'
Get-Process |
  Select-Object Id,ProcessName,
    @{N='CPU';E={[Math]::Round($_.CPU,1)}},
    @{N='MemMB';E={[Math]::Round($_.WorkingSet64/1MB,1)}},
    @{N='Threads';E={$_.Threads.Count}},
    @{N='StartTime';E={ if($_.StartTime){ $_.StartTime.ToString('yyyy-MM-ddTHH:mm:ss') } else { '' } }},
    MainWindowTitle |
  Sort-Object MemMB -Descending |
  ConvertTo-Json -Compress`;

  try {
    const raw = runPs(ps, 10000);
    if (!raw) return [];
    const arr = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [JSON.parse(raw)];
    return arr.map((p: Record<string, unknown>) => ({
      ...p,
      ...resolveApp(String(p.ProcessName ?? "")),
    }));
  } catch {
    return [];
  }
}

// ── Diff two snapshots → events ───────────────────────────────────────────────
interface MonitorEvent {
  type:     "opened" | "closed" | "title_changed" | "snapshot";
  icon:     string;
  label:    string;
  category: string;
  title?:   string;
  prevTitle?: string;
  pid:      number;
  memMB?:   number;
  cpuSec?:  number;
  ts:       string;
}

function diffSnapshots(prev: Map<number, ProcInfo>, curr: Map<number, ProcInfo>): MonitorEvent[] {
  const ts = new Date().toISOString();
  const events: MonitorEvent[] = [];

  // Newly opened
  for (const [pid, info] of curr) {
    if (!prev.has(pid)) {
      events.push({ type: "opened", icon: info.icon, label: info.label, category: info.category, title: info.title, pid, memMB: info.memMB, cpuSec: info.cpuSec, ts });
    } else {
      // Title changed
      const prevInfo = prev.get(pid)!;
      if (prevInfo.title !== info.title && info.title) {
        events.push({ type: "title_changed", icon: info.icon, label: info.label, category: info.category, title: info.title, prevTitle: prevInfo.title, pid, ts });
      }
    }
  }

  // Closed
  for (const [pid, info] of prev) {
    if (!curr.has(pid)) {
      events.push({ type: "closed", icon: info.icon, label: info.label, category: info.category, title: info.title, pid, ts });
    }
  }

  return events;
}

// ── Log an event to the activity JSONL ───────────────────────────────────────
function logEvent(evt: MonitorEvent) {
  if (evt.type === "closed" || evt.type === "snapshot") return; // only log open/title_changed
  try {
    const entry = {
      title: evt.title ?? evt.label,
      app:   evt.label,
      category: evt.category,
      start: evt.ts,
      end:   evt.ts,
      durationSec: 0,
    };
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
  } catch {}
}

// ── SSE Monitor stream ────────────────────────────────────────────────────────
export async function GET() {
  const encoder = new TextEncoder();
  let prevSnapshot = new Map<number, ProcInfo>();
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: object) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };

      function poll() {
        if (closed) return;
        try {
          const curr = getSnapshot();
          const events = diffSnapshots(prevSnapshot, curr);

          // On first poll, send full snapshot
          if (prevSnapshot.size === 0 && curr.size > 0) {
            send({
              type: "snapshot",
              processes: Array.from(curr.values()),
              count: curr.size,
              ts: new Date().toISOString(),
            });
          } else {
            events.forEach(e => { send(e); logEvent(e); });
          }

          prevSnapshot = curr;
        } catch (err) {
          send({ type: "error", message: String(err), ts: new Date().toISOString() });
        }
      }

      // First poll immediately, then every 5 seconds
      poll();
      intervalId = setInterval(poll, 5000);
    },

    cancel() {
      closed = true;
      if (intervalId) clearInterval(intervalId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection:      "keep-alive",
    },
  });
}

// ── POST: import snapshot or get full process list ────────────────────────────
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = body.action as string;

  if (action === "import_snapshot") {
    // Take a full Task Manager snapshot and return it
    const processes = getAllProcesses();
    // Log all visible-window processes as activity
    const ts = new Date().toISOString();
    let logged = 0;
    for (const p of processes as Record<string, unknown>[]) {
      if (p.MainWindowTitle) {
        const entry = {
          title:       String(p.MainWindowTitle),
          app:         String(p.label ?? p.ProcessName),
          category:    String(p.category ?? "Other"),
          start:       ts,
          end:         ts,
          durationSec: 0,
        };
        try { fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf8"); logged++; } catch {}
      }
    }
    return Response.json({ processes, total: processes.length, logged });
  }

  if (action === "get_processes") {
    const processes = getAllProcesses();
    return Response.json({ processes, total: processes.length, ts: new Date().toISOString() });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
