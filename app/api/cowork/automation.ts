import { execSync, spawn, spawnSync } from "child_process";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

export type CoworkTarget = "cli" | "desktop" | "browser" | "blender" | "all";

export interface StreamLine {
  type: string;
  text?: string;
  message?: string;
  exitCode?: number | null;
  name?: string;
  input?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

type SendFn = (data: StreamLine) => void;

interface BrowserCredentials {
  username?: string;
  email?: string;
  password?: string;
}

interface BrowserAction {
  type: "goto" | "fill" | "click" | "press" | "wait" | "login";
  target?: string;
  value?: string;
  url?: string;
  key?: string;
  milliseconds?: number;
}

interface BrowserPlan {
  goal: string;
  url?: string;
  keepOpen?: boolean;
  credentials?: BrowserCredentials;
  actions: BrowserAction[];
}

interface DesktopPlan {
  appName: string;       // human-readable app name, e.g. "Amazon Music", "Notepad", "Spotify"
  task: string;          // what to do inside the app, e.g. "play the song Mercy"
  originalPrompt: string;
}

interface AutomationPlan {
  planner: "heuristic" | "claude";
  summary: string;
  browser?: BrowserPlan;
  desktop?: DesktopPlan;
}

const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const DESKTOP_APP_IDS = {
  claude_desktop: "shell:appsFolder\\AnthropicPBC.Claude_pzs8sxrjxfjjc!App",
  amazon_music: "shell:appsFolder\\AmazonMobileLLC.AmazonMusic_kc6t79cpj4tp0!AmazonMobileLLC.AmazonMusic",
} as const;

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quotePowerShell(text: string) {
  return text.replace(/'/g, "''").replace(/`/g, "``");
}

function resolveBrowserExecutable(): string | null {
  for (const candidate of CHROME_PATHS) {
    try {
      execSync(`if exist "${candidate}" (echo ok)`, { shell: "cmd.exe", windowsHide: true });
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

export function checkCliAvailable(): boolean {
  try {
    execSync("claude --version", { timeout: 4000, windowsHide: true, shell: "cmd.exe" });
    return true;
  } catch {
    return false;
  }
}

export function checkDesktopRunning(): boolean {
  try {
    const result = execSync('tasklist /FI "IMAGENAME eq Claude.exe" /NH 2>nul', {
      encoding: "utf8",
      windowsHide: true,
    });
    return result.toLowerCase().includes("claude.exe");
  } catch {
    return false;
  }
}

export function getBrowserStatus() {
  const executablePath = resolveBrowserExecutable();
  return {
    url: executablePath ? executablePath : "No local browser found",
    available: Boolean(executablePath),
    executablePath,
  };
}

function runDetachedPowerShell(script: string) {
  const child = spawn("powershell.exe", ["-ExecutionPolicy", "Bypass", "-NoProfile", "-Command", script], {
    detached: true,
    windowsHide: false,
  });
  child.unref();
}

export function openDesktopApp(app: "claude_desktop" | "amazon_music") {
  const target = DESKTOP_APP_IDS[app];
  spawn("cmd", ["/c", "start", "", "explorer", target], {
    detached: true,
    windowsHide: false,
    shell: false,
  }).unref();
}

export function executeInDesktop(promptText: string) {
  const safePrompt = quotePowerShell(promptText);
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Set-Clipboard -Value '${safePrompt}'
Start-Process "explorer" "${DESKTOP_APP_IDS.claude_desktop}"
Start-Sleep -Seconds 2
$maxWait = 20
$waited = 0
$win = $null
while ($waited -lt $maxWait) {
  Start-Sleep -Milliseconds 500
  $waited++
  $procs = Get-Process -Name "Claude" -ErrorAction SilentlyContinue
  if ($procs -and $procs[0].MainWindowHandle -ne [IntPtr]::Zero) {
    $win = $procs[0]
    break
  }
}
if ($null -ne $win) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinHelper {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
  [WinHelper]::ShowWindow($win.MainWindowHandle, 9)
  Start-Sleep -Milliseconds 600
  [WinHelper]::SetForegroundWindow($win.MainWindowHandle)
  Start-Sleep -Milliseconds 800
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Milliseconds 400
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
}
`;
  runDetachedPowerShell(script);
}

function playSongInAmazonMusic(songQuery: string) {
  const safeQuery = quotePowerShell(songQuery);
  const appId = DESKTOP_APP_IDS.amazon_music;
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Set-Clipboard -Value '${safeQuery}'

# Helper: find Amazon Music window by title (most reliable — works regardless of process name)
function Find-AmazonMusicWindow {
  Get-Process | Where-Object {
    ($_.MainWindowTitle -like '*Amazon Music*') -and ($_.MainWindowHandle -ne [IntPtr]::Zero)
  } | Select-Object -First 1
}

# Only launch if no window is visible already
$existing = Find-AmazonMusicWindow
if (-not $existing) {
  Start-Process "explorer" "${appId}"
  Start-Sleep -Seconds 7
}

# Wait up to 25 seconds for the window
$deadline = (Get-Date).AddSeconds(25)
$win = $null
while ((Get-Date) -lt $deadline) {
  $win = Find-AmazonMusicWindow
  if ($win) { break }
  Start-Sleep -Milliseconds 600
}

if ($null -eq $win) {
  Write-Host "Amazon Music window not found after waiting"
  exit 1
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinHelper {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
[WinHelper]::ShowWindow($win.MainWindowHandle, 9)
Start-Sleep -Milliseconds 800
[WinHelper]::SetForegroundWindow($win.MainWindowHandle)
Start-Sleep -Milliseconds 1200

Add-Type -AssemblyName System.Windows.Forms

# Open search bar with Ctrl+F (standard Amazon Music search shortcut)
[System.Windows.Forms.SendKeys]::SendWait("^f")
Start-Sleep -Milliseconds 1500

# Clear any previous query and paste song name
[System.Windows.Forms.SendKeys]::SendWait("^a")
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 800

# Submit search
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 3000

# Navigate to first result and press Enter to play
[System.Windows.Forms.SendKeys]::SendWait("{TAB}")
Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait("{TAB}")
Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
`;
  runDetachedPowerShell(script);
}

function extractFirstUrl(prompt: string) {
  const match = prompt.match(/https?:\/\/[^\s)]+/i);
  return match?.[0];
}

function inferBrowserUrl(prompt: string) {
  const explicit = extractFirstUrl(prompt);
  if (explicit) return explicit;

  const bareDomain = prompt.match(/\b((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?)/i);
  if (bareDomain?.[1]) {
    return `https://${bareDomain[1]}`;
  }

  const normalized = prompt.toLowerCase();
  const knownSites: Array<{ pattern: RegExp; url: string }> = [
    { pattern: /\bgithub\b/, url: normalized.includes("login") ? "https://github.com/login" : "https://github.com/" },
    { pattern: /\bgmail\b/, url: "https://mail.google.com/" },
    { pattern: /\bgoogle\b/, url: "https://www.google.com/" },
    { pattern: /\bamazon music\b/, url: "https://music.amazon.com/" },
    { pattern: /\bamazon\b/, url: "https://www.amazon.com/" },
    { pattern: /\bbonfiglioli\b/, url: "https://www.bonfiglioli.com/" },
    { pattern: /\blinkedin\b/, url: "https://www.linkedin.com/" },
    { pattern: /\byoutube\b/, url: "https://www.youtube.com/" },
    { pattern: /\bchatgpt\b/, url: "https://chatgpt.com/" },
    { pattern: /\bclaude\b/, url: "https://claude.ai/" },
  ];

  for (const site of knownSites) {
    if (site.pattern.test(normalized)) {
      return site.url;
    }
  }

  return null;
}

function extractBrowserCredentials(prompt: string): BrowserCredentials {
  const creds: BrowserCredentials = {};

  const email = prompt.match(/(?:email|username)\s*(?:is|:)\s*([^\s,;]+@[^\s,;]+)/i);
  if (email) {
    creds.email = email[1];
  }

  const username = prompt.match(/username\s*(?:is|:)\s*([^\n,;]+)/i);
  if (username && !creds.email) {
    creds.username = username[1].trim();
  }

  const password = prompt.match(/password\s*(?:is|:)\s*([^\n,;]+)/i);
  if (password) {
    creds.password = password[1].trim();
  }

  return creds;
}

// Common app name aliases → canonical display name
const APP_ALIASES: [RegExp, string][] = [
  [/amazon\s*music/i,       "Amazon Music"],
  [/spotify/i,              "Spotify"],
  [/youtube\s*music/i,      "YouTube Music"],
  [/apple\s*music/i,        "Apple Music"],
  [/vlc/i,                  "VLC media player"],
  [/notepad\+\+/i,          "Notepad++"],
  [/notepad/i,              "Notepad"],
  [/word|ms\s*word/i,       "Microsoft Word"],
  [/excel/i,                "Microsoft Excel"],
  [/powerpoint/i,           "Microsoft PowerPoint"],
  [/outlook/i,              "Microsoft Outlook"],
  [/teams/i,                "Microsoft Teams"],
  [/whatsapp/i,             "WhatsApp"],
  [/telegram/i,             "Telegram"],
  [/chrome/i,               "Google Chrome"],
  [/firefox/i,              "Mozilla Firefox"],
  [/edge/i,                 "Microsoft Edge"],
  [/calculator/i,           "Calculator"],
  [/paint/i,                "Microsoft Paint"],
  [/snipping\s*tool/i,      "Snipping Tool"],
  [/task\s*manager/i,       "Task Manager"],
  [/file\s*explorer/i,      "File Explorer"],
  [/vs\s*code|visual\s*studio\s*code/i, "Visual Studio Code"],
  [/photoshop/i,            "Adobe Photoshop"],
  [/zoom/i,                 "Zoom"],
  [/discord/i,              "Discord"],
  [/slack/i,                "Slack"],
  [/claude\s*desktop/i,     "Claude Desktop"],
];

function detectAppFromPrompt(prompt: string): { appName: string; task: string } | null {
  for (const [pattern, appName] of APP_ALIASES) {
    if (pattern.test(prompt)) {
      // Strip the app name mention to get the remaining task
      const task = prompt.replace(pattern, "").replace(/\s*(on|in|using|with|from|via)\s*$/i, "").trim();
      return { appName, task: task || prompt };
    }
  }
  return null;
}

function parseHeuristicPlan(prompt: string, target: CoworkTarget): AutomationPlan {
  const url = inferBrowserUrl(prompt);
  const credentials = extractBrowserCredentials(prompt);
  const desktopRequested = target === "desktop" || target === "all";
  const browserRequested = target === "browser" || target === "all";

  if (desktopRequested) {
    const detected = detectAppFromPrompt(prompt);
    if (detected) {
      return {
        planner: "heuristic",
        summary: `${detected.task} in ${detected.appName} via Claude Desktop computer use`,
        desktop: {
          appName: detected.appName,
          task: detected.task,
          originalPrompt: prompt,
        },
      };
    }
  }

  if (browserRequested && url) {
    const actions: BrowserAction[] = [{ type: "goto", url }];
    if (credentials.password && (credentials.email || credentials.username)) {
      actions.push({ type: "login" });
    }
    return {
      planner: "heuristic",
      summary: `Open ${url} in the local browser`,
      browser: {
        goal: prompt,
        url,
        credentials,
        actions,
        keepOpen: true,
      },
    };
  }

  return {
    planner: "heuristic",
    summary: "No deterministic desktop/browser automation inferred from the prompt",
  };
}

function parseJsonBlock(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function extractPlannerPayload(text: string) {
  const outer = parseJsonBlock(text);
  if (outer && typeof outer.result === "string") {
    return outer.result;
  }
  return text;
}

function buildClaudePlannerPrompt(prompt: string, target: CoworkTarget) {
  return `
You are a local automation planner for a Windows 11 machine.
Return JSON only — no markdown, no explanation.

Allowed output shape:
{
  "summary": "one-line summary of what will happen",
  "browser": {
    "url": "absolute url if browser is needed",
    "keepOpen": true,
    "credentials": { "email": "optional", "username": "optional", "password": "optional" },
    "actions": [
      { "type": "goto", "url": "https://..." },
      { "type": "login" },
      { "type": "fill", "target": "field label or placeholder", "value": "text" },
      { "type": "click", "target": "button or link text" },
      { "type": "press", "key": "Enter" },
      { "type": "wait", "milliseconds": 1500 }
    ]
  },
  "desktop": {
    "appName": "exact Windows app display name, e.g. 'Amazon Music', 'Notepad', 'Spotify'",
    "task": "what to do inside the app, e.g. 'play the song Mercy', 'write Hello World and save'"
  }
}

Rules:
- If the user mentions a specific desktop app by name, set desktop.appName to that app's display name and desktop.task to everything else the user wants to do.
- If the task involves a URL or a web-only service, use browser instead of desktop.
- For browser tasks, produce practical text-based actions executable in Chrome/Edge.
- Omit keys that do not apply.
- The requested target is "${target}".

User prompt:
${prompt}
`;
}

function normalizePlan(raw: Record<string, unknown>, fallback: AutomationPlan): AutomationPlan {
  const plan: AutomationPlan = {
    planner: "claude",
    summary:
      typeof raw.summary === "string" && raw.summary.trim()
        ? raw.summary.trim()
        : fallback.summary,
  };

  const browserRaw = raw.browser as Record<string, unknown> | undefined;
  if (browserRaw) {
    const actionsRaw = Array.isArray(browserRaw.actions) ? browserRaw.actions : [];
    const actions: BrowserAction[] = actionsRaw
      .map((step) => {
        const candidate = step as Record<string, unknown>;
        if (typeof candidate.type !== "string") return null;
        const actionType = candidate.type as BrowserAction["type"];
        if (!["goto", "fill", "click", "press", "wait", "login"].includes(actionType)) {
          return null;
        }
        return {
          type: actionType,
          target: typeof candidate.target === "string" ? candidate.target : undefined,
          value: typeof candidate.value === "string" ? candidate.value : undefined,
          url: typeof candidate.url === "string" ? candidate.url : undefined,
          key: typeof candidate.key === "string" ? candidate.key : undefined,
          milliseconds:
            typeof candidate.milliseconds === "number" ? candidate.milliseconds : undefined,
        } satisfies BrowserAction;
      })
      .filter(Boolean) as BrowserAction[];

    plan.browser = {
      goal: plan.summary,
      url: typeof browserRaw.url === "string" ? browserRaw.url : undefined,
      keepOpen: browserRaw.keepOpen !== false,
      credentials:
        typeof browserRaw.credentials === "object" && browserRaw.credentials
          ? (browserRaw.credentials as BrowserCredentials)
          : undefined,
      actions,
    };
  }

  const desktopRaw = raw.desktop as Record<string, unknown> | undefined;
  if (desktopRaw && typeof desktopRaw.appName === "string" && desktopRaw.appName.trim()) {
    plan.desktop = {
      appName: desktopRaw.appName.trim(),
      task: typeof desktopRaw.task === "string" ? desktopRaw.task.trim() : fallback.desktop?.task ?? "",
      originalPrompt: fallback.desktop?.originalPrompt ?? "",
    };
  }

  return plan;
}

export function createAutomationPlan(prompt: string, target: CoworkTarget, send: SendFn): AutomationPlan {
  const fallback = parseHeuristicPlan(prompt, target);

  if (target === "cli") {
    return fallback;
  }

  try {
    const planned = spawnSync("claude", [
      "-p",
      "--output-format",
      "json",
      "--append-system-prompt",
      "Do not call tools. Return strict JSON only with no explanation or markdown.",
      buildClaudePlannerPrompt(prompt, target),
    ], {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 45000,
    });

    if (planned.error) {
      send({ type: "stderr", text: `Planner failed: ${planned.error.message}` });
      return fallback;
    }

    const parsed = parseJsonBlock(extractPlannerPayload(planned.stdout || ""));
    if (!parsed) {
      send({ type: "stderr", text: "Planner returned no JSON plan, using heuristic automation" });
      return fallback;
    }

    const normalized = normalizePlan(parsed, fallback);
    if (!normalized.browser && !normalized.desktop) {
      return fallback;
    }
    return normalized;
  } catch (error) {
    send({ type: "stderr", text: `Planner fallback: ${String(error)}` });
    return fallback;
  }
}

async function resolveTextLocator(page: Page, target: string) {
  const safeTarget = new RegExp(escapeRegExp(target), "i");

  const strategies = [
    () => page.getByRole("button", { name: safeTarget }).first(),
    () => page.getByRole("link", { name: safeTarget }).first(),
    () => page.getByLabel(safeTarget).first(),
    () => page.getByPlaceholder(safeTarget).first(),
    () => page.getByRole("textbox", { name: safeTarget }).first(),
    () => page.getByText(safeTarget).first(),
    () => page.locator(`text=${target}`).first(),
  ];

  for (const makeLocator of strategies) {
    const locator = makeLocator();
    try {
      if (await locator.count()) {
        return locator;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function resolveFillLocator(page: Page, target: string) {
  const safeTarget = new RegExp(escapeRegExp(target), "i");
  const lower = target.toLowerCase();

  const strategies = [];
  if (lower.includes("password")) {
    strategies.push(() => page.locator('input[type="password"]').first());
    strategies.push(() => page.locator('input[name*="pass" i]').first());
  }
  if (lower.includes("email")) {
    strategies.push(() => page.locator('input[type="email"]').first());
    strategies.push(() => page.locator('input[name*="email" i]').first());
  }
  if (lower.includes("user") || lower.includes("login")) {
    strategies.push(() => page.locator('input[name*="user" i]').first());
    strategies.push(() => page.locator('input[autocomplete="username"]').first());
  }

  strategies.push(
    () => page.getByLabel(safeTarget).first(),
    () => page.getByPlaceholder(safeTarget).first(),
    () => page.getByRole("textbox", { name: safeTarget }).first(),
    () => page.locator(`input[aria-label*="${target}" i]`).first(),
    () => page.locator(`input[placeholder*="${target}" i]`).first(),
    () => page.locator(`textarea[placeholder*="${target}" i]`).first(),
    () => page.locator(`input[name*="${target}" i]`).first()
  );

  for (const makeLocator of strategies) {
    const locator = makeLocator();
    try {
      if (await locator.count()) {
        return locator;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function performBrowserLogin(page: Page, credentials: BrowserCredentials, send: SendFn) {
  const emailValue = credentials.email || credentials.username;
  const passwordValue = credentials.password;

  if (!emailValue || !passwordValue) {
    throw new Error("Login requested but email/username or password was missing in the prompt");
  }

  const emailCandidates = [
    page.locator('input[type="email"]').first(),
    page.locator('input[name*="email" i]').first(),
    page.locator('input[name*="user" i]').first(),
    page.locator('input[autocomplete="username"]').first(),
  ];

  const passwordCandidates = [
    page.locator('input[type="password"]').first(),
    page.locator('input[name*="pass" i]').first(),
  ];

  let emailFilled = false;
  for (const locator of emailCandidates) {
    try {
      if (await locator.count()) {
        await locator.fill(emailValue);
        emailFilled = true;
        send({ type: "info", text: `🌐 Filled login identity: ${emailValue}` });
        break;
      }
    } catch {
      continue;
    }
  }

  if (!emailFilled) {
    const locator = await resolveTextLocator(page, "email");
    if (locator) {
      await locator.fill(emailValue);
      emailFilled = true;
    }
  }

  let passwordFilled = false;
  for (const locator of passwordCandidates) {
    try {
      if (await locator.count()) {
        await locator.fill(passwordValue);
        passwordFilled = true;
        send({ type: "info", text: "🌐 Filled password field" });
        break;
      }
    } catch {
      continue;
    }
  }

  if (!passwordFilled) {
    throw new Error("Could not find a password field in the browser page");
  }

  const submitTargets = ["Sign in", "Log in", "Login", "Continue", "Submit"];
  for (const target of submitTargets) {
    const locator = await resolveTextLocator(page, target);
    if (locator) {
      try {
        await locator.click({ timeout: 2000 });
        send({ type: "info", text: `🌐 Clicked ${target}` });
        return;
      } catch {
        continue;
      }
    }
  }

  await page.keyboard.press("Enter");
  send({ type: "info", text: "🌐 Submitted login with Enter" });
}

async function runBrowserActions(page: Page, plan: BrowserPlan, send: SendFn) {
  for (const action of plan.actions) {
    if (action.type === "goto" && action.url) {
      await page.goto(action.url, { waitUntil: "domcontentloaded" });
      send({ type: "info", text: `🌐 Opened ${action.url}` });
      continue;
    }

    if (action.type === "login") {
      await performBrowserLogin(page, plan.credentials || {}, send);
      await page.waitForTimeout(1500);
      continue;
    }

    if (action.type === "wait" && action.milliseconds) {
      await page.waitForTimeout(action.milliseconds);
      send({ type: "info", text: `🌐 Waited ${action.milliseconds}ms` });
      continue;
    }

    if (action.type === "press" && action.key) {
      await page.keyboard.press(action.key);
      send({ type: "info", text: `🌐 Pressed ${action.key}` });
      continue;
    }

    if ((action.type === "click" || action.type === "fill") && action.target) {
      const locator =
        action.type === "fill"
          ? await resolveFillLocator(page, action.target)
          : await resolveTextLocator(page, action.target);
      if (!locator) {
        throw new Error(`Could not find page element for "${action.target}"`);
      }

      if (action.type === "click") {
        await locator.click({ timeout: 5000 });
        send({ type: "info", text: `🌐 Clicked ${action.target}` });
      } else {
        await locator.fill(action.value || "");
        send({ type: "info", text: `🌐 Filled ${action.target}` });
      }
    }
  }
}

export async function executeBrowserAutomation(plan: BrowserPlan, send: SendFn) {
  const executablePath = resolveBrowserExecutable();
  if (!executablePath) {
    throw new Error("No local Chrome or Edge executable was found");
  }

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    browser = await chromium.launch({
      headless: false,
      executablePath,
      args: ["--start-maximized"],
    });

    context = await browser.newContext({ viewport: null });
    const page = await context.newPage();

    if (plan.url) {
      await page.goto(plan.url, { waitUntil: "domcontentloaded" });
      send({ type: "info", text: `🌐 Browser ready at ${plan.url}` });
    }

    await runBrowserActions(page, plan, send);
    send({ type: "info", text: "🌐 Browser automation completed" });

    if (!plan.keepOpen) {
      await context.close();
      await browser.close();
    }
  } catch (error) {
    if (context) {
      try {
        await context.close();
      } catch {}
    }
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    throw error;
  }
}

function buildDesktopTaskPrompt(appName: string, task: string, originalPrompt: string): string {
  return `You are controlling a Windows 11 desktop via computer use.

The user wants to: "${originalPrompt}"

Your job:
1. Open "${appName}" — look for it in the Start menu, taskbar, or desktop shortcuts. If it is already open, click its window to bring it into focus.
2. Wait for "${appName}" to fully load before doing anything else.
3. Inside "${appName}", perform this task: ${task}
4. Confirm the task completed successfully by observing the result on screen.

Important rules:
- Use ONLY the "${appName}" desktop application — do not open a browser unless the task explicitly requires it.
- If you cannot find "${appName}", search for it using the Windows Start menu search bar.
- Take each step one at a time and verify before moving to the next.`;
}

export async function executeDesktopAutomation(plan: DesktopPlan, send: SendFn) {
  const refined = buildDesktopTaskPrompt(plan.appName, plan.task, plan.originalPrompt || plan.task);
  send({ type: "info", text: `🤖 Refined prompt for Claude Desktop:\n${refined.slice(0, 120)}...` });
  executeInDesktop(refined);
  send({ type: "info", text: `🖥️ Claude Desktop is executing: "${plan.task}" in ${plan.appName}` });
}

export function describePlan(plan: AutomationPlan) {
  const parts = [plan.summary];
  if (plan.desktop) {
    parts.push(`desktop:${plan.desktop.appName} → "${plan.desktop.task}"`);
  }
  if (plan.browser) {
    parts.push(`browser:${plan.browser.actions.length} steps`);
  }
  return parts.join(" | ");
}
