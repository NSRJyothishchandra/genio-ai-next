"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import VoiceButton, { type VoiceAction } from "@/app/components/VoiceButton";

interface CLILine {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  message?: string;
  exitCode?: number;
  sessionId?: string;
}

interface Status {
  cli: { path: string; available: boolean };
  desktop: { path: string | null; available: boolean; running?: boolean };
  browser: { url: string; available: boolean };
  blender?: {
    path: string | null;
    available: boolean;
    outputDir: string;
    artifacts: { file: string; path: string; size: number; modifiedAt: string }[];
  };
  runningProcesses?: string[];
}

interface PrecisionFormState {
  enabled: boolean;
  partType: "auto" | "gear" | "geartrain" | "bolt" | "shaft" | "coupling" | "planetary" | "belt" | "custom";
  units: "mm" | "inch";
  qualityPreset: "draft" | "balanced" | "high";
  materialPreset: "steel" | "aluminum" | "brass" | "dark";
  symmetry: "auto" | "radial" | "bilateral";
  centerOrigin: boolean;
  smoothShading: boolean;
  primaryToothCount: string;
  additionalToothCounts: string;
  planetCount: string;
  shaftSpacing: string;
  stageCount: string;
  outerDiameter: string;
  innerDiameter: string;
  thickness: string;
  length: string;
  shaftDiameter: string;
  headDiameter: string;
  headHeight: string;
  tolerance: string;
}

type WorkspaceTab = "cli" | "desktop" | "browser" | "blender";

const CLI_PROMPTS = [
  "Create a simple todo list website in the current folder",
  "Create a landing page with HTML, CSS, and JavaScript in this folder",
  "Generate a README for the current project",
  "Check if there are any build errors",
  "Show git status and recent commits",
  "Review this project and tell me the main issues",
];

const DESKTOP_PROMPTS = [
  "Open https://github.com/login, email is demo@example.com password is hunter2, and login",
  "Play Ghost from Amazon Music",
  "Send this prompt into Claude Desktop: summarize the onboarding flow",
  "Open Notepad and write a short project summary",
  "Open Calculator and calculate 275 multiplied by 48",
];

const BROWSER_PROMPTS = [
  "Open https://example.com in Chrome and keep it open",
  "Open github login, email is demo@example.com password is hunter2",
  "Open Bonfiglioli website and keep it open",
  "Open LinkedIn and search for industrial automation",
  "Open Gmail and wait on the inbox page",
];

const BLENDER_PROMPTS = [
  "Use Blender CLI to create 3 gears with 5 teeth, 12 teeth, and 18 teeth, and export OBJ files only.",
  "Use Blender CLI to create a clean mechanical bolt model and export OBJ only.",
  "Create a centered drive shaft with keyway and export OBJ only.",
  "Create a flexible coupling for two aligned shafts and export OBJ only.",
  "Create a planetary gear set with sun gear, 3 planet gears, ring gear, and carrier, then export OBJ only.",
  "Create a two pulley belt drive assembly and export OBJ only.",
  "Create a stylized industrial part from this reference image and export an OBJ mesh only.",
  "Create a metallic gear assembly in Blender and save OBJ output for NX import.",
];

const MECHANICAL_COMPONENT_GROUPS = [
  {
    title: "Drive Train",
    items: [
      "Shafts",
      "Connected gears and shafted gear trains",
      "Planetary sets",
      "Belt and pulley drives",
      "Couplings",
      "Sun, planet, and ring gears",
    ],
  },
  {
    title: "Transmission Parts",
    items: [
      "Input, intermediate, and output shafts",
      "Spur and helical gear stages",
      "Keyways and splines",
      "Bolts, nuts, washers, and pins",
    ],
  },
  {
    title: "Prompt Guided Add-ons",
    items: [
      "Bearings and bearing seats",
      "Housing shells and covers",
      "Seals and O-rings",
      "Cooling fins and sensor placeholders",
    ],
  },
];

const BLENDER_ASSETS = [
  {
    name: "3 Gear Set Mesh",
    file: "gears_5_12_18.obj",
    path: "C:\\Users\\Projecta0003\\Downloads\\blender-output\\gears_5_12_18.obj",
    type: "OBJ Mesh",
  },
  {
    name: "3 Gear Set Material",
    file: "gears_5_12_18.mtl",
    path: "C:\\Users\\Projecta0003\\Downloads\\blender-output\\gears_5_12_18.mtl",
    type: "Material File",
  },
  {
    name: "Bolt Mesh",
    file: "bolt_4in_6threads.obj",
    path: "C:\\Users\\Projecta0003\\Downloads\\blender-output\\bolt_4in_6threads.obj",
    type: "OBJ Mesh",
  },
  {
    name: "Bolt Material",
    file: "bolt_4in_6threads.mtl",
    path: "C:\\Users\\Projecta0003\\Downloads\\blender-output\\bolt_4in_6threads.mtl",
    type: "Material File",
  },
];

const TARGET_INFO = {
  cli: {
    label: "CLI Agent",
    desc: "Runs the full Claude Code CLI locally in the selected folder",
  },
  desktop: {
    label: "Desktop Agent",
    desc: "Uses Claude planning plus local Windows automation for desktop apps",
  },
  browser: {
    label: "Browser Agent",
    desc: "Uses Claude planning plus real browser automation in local Chrome or Edge",
  },
  blender: {
    label: "NX Agent",
    desc: "Generates local 3D build scripts from your prompt, runs Blender locally, and exports OBJ files for NX import",
  },
  all: {
    label: "All Agents",
    desc: "Runs desktop and browser actions first, then also executes the full Claude CLI",
  },
} as const;

const AGENT_WORKSPACE_CONFIG = {
  cli: {
    title: "CLI Agent",
    subtitle: "Visible terminal execution through Claude CLI in the selected local folder.",
    description:
      "Use this when you want the exact prompt to be sent to Claude CLI in a real terminal window. Best for coding, file generation, and local command workflows.",
    placeholder:
      "Describe the local CLI task...\n\nExamples:\n- Create a simple todo list website in this folder\n- Review this project and tell me the main issues\n- Generate a README for the current project",
    prompts: CLI_PROMPTS,
    actionLabel: "Run CLI Agent",
    tip: "Enter sends immediately. Shift+Enter adds a new line.",
  },
  desktop: {
    title: "Desktop Agent",
    subtitle: "Windows desktop actions for local applications such as Claude Desktop, Amazon Music, Notepad, and more.",
    description:
      "Use this when the task has to happen inside a local desktop app instead of a browser. Include the app name and the exact task you want completed.",
    placeholder:
      "Describe the desktop task...\n\nExamples:\n- Play Ghost from Amazon Music\n- Open Notepad and write a project summary\n- Send this prompt into Claude Desktop: summarize the onboarding flow",
    prompts: DESKTOP_PROMPTS,
    actionLabel: "Run Desktop Agent",
    tip: "Name the desktop app in the prompt so the planner can route it correctly.",
  },
  browser: {
    title: "Browser Agent",
    subtitle: "Chrome or Edge automation for URLs, logins, clicks, typing, and browser-side workflows.",
    description:
      "Use this when the task belongs in a website. You can provide a full URL, a bare domain, or even a well-known site name like GitHub or Gmail.",
    placeholder:
      "Describe the browser task...\n\nExamples:\n- Open github login, email is demo@example.com password is hunter2\n- Open Bonfiglioli website and keep it open\n- Open a link, login, and complete a browser task",
    prompts: BROWSER_PROMPTS,
    actionLabel: "Run Browser Agent",
    tip: "Ctrl+Enter sends. The agent can infer URLs from common site names and domains.",
  },
} as const;

const CLI_AGENT_CAPABILITIES = [
  "Opens a visible PowerShell window on the local machine",
  "Runs the exact prompt through Claude CLI with claude -p",
  "Uses the selected local folder as the working directory",
  "Best for coding, file generation, debugging, and local reviews",
];

const CLI_AGENT_FLOW = [
  "Choose or paste the local working directory",
  "Write the exact task you want Claude CLI to perform",
  "Press Enter or click Run CLI Agent",
  "Review the visible terminal and the streamed execution log here",
];

export default function CoworkPage() {
  const router = useRouter();
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("cli");
  const [prompt, setPrompt] = useState("");
  const [blenderImageDataUrl, setBlenderImageDataUrl] = useState<string | null>(null);
  const [blenderImageName, setBlenderImageName] = useState<string | null>(null);
  const [cliOutput, setCliOutput] = useState<CLILine[]>([]);
  const [running, setRunning] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [workdir, setWorkdir] = useState("");
  const [target, setTarget] = useState<"cli" | "desktop" | "browser" | "blender" | "all">("cli");
  const [precision, setPrecision] = useState<PrecisionFormState>({
    enabled: false,
    partType: "auto",
    units: "mm",
    qualityPreset: "high",
    materialPreset: "steel",
    symmetry: "auto",
    centerOrigin: true,
    smoothShading: true,
    primaryToothCount: "",
    additionalToothCounts: "",
    planetCount: "",
    shaftSpacing: "",
    stageCount: "",
    outerDiameter: "",
    innerDiameter: "",
    thickness: "",
    length: "",
    shaftDiameter: "",
    headDiameter: "",
    headHeight: "",
    tolerance: "",
  });
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  function activateWorkspace(next: WorkspaceTab, syncUrl = true) {
    setWorkspaceTab(next);
    setTarget(next === "blender" ? "blender" : next);
    if (syncUrl && typeof window !== "undefined") {
      const view = next === "blender" ? "lab" : undefined;
      const params = new URLSearchParams();
      params.set("workspace", next);
      params.set("target", next === "blender" ? "blender" : next);
      if (view) params.set("view", view);
      router.replace(`/cowork?${params.toString()}`, { scroll: false });
    }
  }

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  const refreshStatus = useCallback(() => {
    fetch("/api/cowork").then((response) => response.json()).then(setStatus).catch(() => null);
  }, []);

  function buildPrecisionPayload() {
    if (!precision.enabled) return undefined;
    const parseField = (value: string) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    };
    const extraCounts = precision.additionalToothCounts
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);

    return {
      enabled: true,
      partType: precision.partType,
      units: precision.units,
      qualityPreset: precision.qualityPreset,
      materialPreset: precision.materialPreset,
      symmetry: precision.symmetry,
      centerOrigin: precision.centerOrigin,
      smoothShading: precision.smoothShading,
      primaryToothCount: parseField(precision.primaryToothCount),
      additionalToothCounts: extraCounts,
      planetCount: parseField(precision.planetCount),
      shaftSpacing: parseField(precision.shaftSpacing),
      stageCount: parseField(precision.stageCount),
      outerDiameter: parseField(precision.outerDiameter),
      innerDiameter: parseField(precision.innerDiameter),
      thickness: parseField(precision.thickness),
      length: parseField(precision.length),
      shaftDiameter: parseField(precision.shaftDiameter),
      headDiameter: parseField(precision.headDiameter),
      headHeight: parseField(precision.headHeight),
      tolerance: parseField(precision.tolerance),
    };
  }

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 10_000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const workspace = params.get("workspace");
    const requestedTarget = params.get("target");

    if (
      workspace === "cli" ||
      workspace === "desktop" ||
      workspace === "browser" ||
      workspace === "blender"
    ) {
      activateWorkspace(workspace, false);
      return;
    }

    if (requestedTarget === "cli" || requestedTarget === "desktop" || requestedTarget === "browser" || requestedTarget === "blender") {
      activateWorkspace(requestedTarget, false);
      return;
    }

    if (requestedTarget === "all") {
      setTarget("all");
    }
  }, []);

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: "smooth" });
  }, [cliOutput]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && running) {
        event.preventDefault();
        stopExecution();
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [running, currentSessionId]);

  async function stopExecution() {
    abortRef.current?.abort();
    if (currentSessionId) {
      try {
        await fetch(`/api/cowork?id=${encodeURIComponent(currentSessionId)}`, { method: "DELETE" });
      } catch {}
    }
    setRunning(false);
    setCurrentSessionId(null);
    setCliOutput((previous) => [...previous, { type: "info", text: "Stopped by user" }]);
    refreshStatus();
  }

  async function killAll() {
    try {
      const response = await fetch("/api/cowork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kill_all" }),
      });
      const data = await response.json();
      abortRef.current?.abort();
      setRunning(false);
      setCurrentSessionId(null);
      showToast(`Kill switch: ${data.message}`);
      setCliOutput((previous) => [...previous, { type: "info", text: `Kill switch: ${data.message}` }]);
      refreshStatus();
    } catch {
      showToast("Failed to kill processes", "error");
    }
  }

  async function send(targetOverride?: "cli" | "desktop" | "browser" | "blender" | "all", promptOverride?: string) {
    const trimmedPrompt = (promptOverride ?? prompt).trim();
    if (!trimmedPrompt || running) return;
    if (promptOverride) setPrompt(promptOverride);

    const selectedTarget = targetOverride ?? target;
    setPromptHistory((history) => [trimmedPrompt, ...history.slice(0, 49)]);
    setHistoryIdx(-1);
    setCliOutput([
      {
        type: "info",
        text: `$ cowork ${selectedTarget} "${trimmedPrompt.slice(0, 80)}${trimmedPrompt.length > 80 ? "..." : ""}"`,
      },
    ]);
    setRunning(true);
    setCurrentSessionId(null);
    setTarget(selectedTarget);
    abortRef.current = new AbortController();

    try {
      const response = await fetch("/api/cowork", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          workdir: workdir || undefined,
          target: selectedTarget,
          imageDataUrl: selectedTarget === "blender" ? blenderImageDataUrl : undefined,
          precisionSpec: selectedTarget === "blender" ? buildPrecisionPayload() : undefined,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        setCliOutput((previous) => [
          ...previous,
          { type: "error", message: `HTTP ${response.status}: ${errorText}` },
        ]);
        setRunning(false);
        return;
      }

      const sessionId = response.headers.get("X-Session-Id");
      if (sessionId) {
        setCurrentSessionId(sessionId);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          if (!chunk.startsWith("data: ")) continue;
          try {
            const parsed: CLILine = JSON.parse(chunk.slice(6));
            setCliOutput((previous) => [...previous, parsed]);
          } catch {}
        }
      }
    } catch (error: unknown) {
      if ((error as Error).name !== "AbortError") {
        setCliOutput((previous) => [
          ...previous,
          { type: "error", message: String(error) },
        ]);
      }
    }

    setRunning(false);
    setCurrentSessionId(null);
    refreshStatus();
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && target === "cli" && !event.shiftKey) {
      event.preventDefault();
      void send();
      return;
    }

    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void send();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (running) stopExecution();
      return;
    }

    if (event.key === "ArrowUp" && !event.shiftKey) {
      event.preventDefault();
      const idx = Math.min(historyIdx + 1, promptHistory.length - 1);
      setHistoryIdx(idx);
      setPrompt(promptHistory[idx] ?? "");
    }

    if (event.key === "ArrowDown" && !event.shiftKey) {
      event.preventDefault();
      const idx = Math.max(historyIdx - 1, -1);
      setHistoryIdx(idx);
      setPrompt(idx === -1 ? "" : promptHistory[idx] ?? "");
    }
  }

  async function handleBlenderImageUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setBlenderImageDataUrl(reader.result);
        setBlenderImageName(file.name);
        showToast(`Loaded reference image: ${file.name}`);
      }
    };
    reader.readAsDataURL(file);
  }

  function renderLine(line: CLILine, index: number) {
    switch (line.type) {
      case "info":
        return (
          <div key={index} style={{ color: "#94a3b8", fontFamily: "monospace", fontSize: 13, padding: "2px 0" }}>
            {line.text}
          </div>
        );
      case "start":
        return (
          <div key={index} style={{ color: "#60a5fa", fontFamily: "monospace", fontSize: 13 }}>
            {line.message}
          </div>
        );
      case "done":
        return (
          <div
            key={index}
            style={{
              color: line.exitCode === 0 ? "#4ade80" : "#f87171",
              fontFamily: "monospace",
              fontSize: 13,
              marginTop: 8,
            }}
          >
            Exit code: {line.exitCode}
          </div>
        );
      case "error":
        return (
          <div key={index} style={{ color: "#f87171", fontFamily: "monospace", fontSize: 13 }}>
            {line.message}
          </div>
        );
      case "timeout":
        return (
          <div key={index} style={{ color: "#fbbf24", fontFamily: "monospace", fontSize: 13 }}>
            {line.message}
          </div>
        );
      case "stderr":
        return (
          <div key={index} style={{ color: "#fbbf24", fontFamily: "monospace", fontSize: 12, opacity: 0.8 }}>
            {line.text}
          </div>
        );
      case "text":
        return (
          <div
            key={index}
            style={{
              color: "#e2e8f0",
              fontFamily: "monospace",
              fontSize: 13,
              whiteSpace: "pre-wrap",
              lineHeight: 1.6,
              borderLeft: "3px solid #6366f1",
              paddingLeft: 12,
              margin: "4px 0",
            }}
          >
            {line.text}
          </div>
        );
      case "tool":
        return (
          <div key={index} style={{ color: "#a78bfa", fontFamily: "monospace", fontSize: 12, padding: "2px 0 2px 4px" }}>
            Tool: <strong>{line.name}</strong>
            {line.input && Object.keys(line.input).length > 0 ? (
              <span style={{ opacity: 0.7 }}> ({JSON.stringify(line.input).slice(0, 80)})</span>
            ) : null}
          </div>
        );
      case "artifact":
        return (
          <div key={index} style={{ color: "#34d399", fontFamily: "monospace", fontSize: 12, padding: "2px 0" }}>
            Artifact: {line.text}
          </div>
        );
      case "data":
        if (line.payload) {
          const payloadType = (line.payload as Record<string, unknown>).type as string;
          if (payloadType === "tool_use") {
            return (
              <div key={index} style={{ color: "#a78bfa", fontFamily: "monospace", fontSize: 12 }}>
                Tool: {String((line.payload as Record<string, unknown>).name ?? "")}
              </div>
            );
          }
          if (payloadType === "tool_result") {
            return (
              <div key={index} style={{ color: "#34d399", fontFamily: "monospace", fontSize: 12 }}>
                Tool result received
              </div>
            );
          }
        }
        return null;
      default:
        return null;
    }
  }

  const runningCount = status?.runningProcesses?.length ?? 0;
  const activeTarget = workspaceTab === "blender" ? "blender" : workspaceTab;
  const info = TARGET_INFO[activeTarget];
  const workspaceConfig = workspaceTab === "blender" ? null : AGENT_WORKSPACE_CONFIG[workspaceTab];
  const recentCliPrompts = promptHistory.slice(0, 6);

  // Voice context per workspace tab
  const voiceContext =
    workspaceTab === "blender" ? "nx-agent"
    : workspaceTab === "cli" ? "cli-agent"
    : workspaceTab === "desktop" ? "desktop-agent"
    : "browser-agent";

  function handleVoiceResult(_transcript: string, action: VoiceAction) {
    if (action.action === "run_command") {
      const cmd = String(action.params.command ?? "").trim();
      if (cmd) void send(activeTarget as "cli" | "desktop" | "browser" | "blender", cmd);
    }
  }

  return (
    <>
      {toast ? (
        <div
          style={{
            position: "fixed",
            top: 20,
            right: 20,
            zIndex: 999,
            background: toast.type === "error" ? "#ef4444" : "#22c55e",
            color: "#fff",
            padding: "12px 20px",
            borderRadius: 10,
            fontWeight: 600,
            fontSize: 14,
            boxShadow: "0 4px 20px rgba(0,0,0,.3)",
          }}
        >
          {toast.msg}
        </div>
      ) : null}

      <div className="topbar">
        <div>
          <div className="topbar-title">Cowork - Local Agent Execution</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            CLI builds locally, Desktop controls local apps, Browser completes local Chrome or Edge tasks
          </div>
        </div>
        <div className="topbar-right">
          {status ? (
            <div className="flex-center" style={{ gap: 6 }}>
              <span className={`badge ${status.cli.available ? "badge-green" : "badge-red"}`}>
                CLI {status.cli.available ? "Ready" : "Missing"}
              </span>
              <span className={`badge ${status.desktop.running ? "badge-green" : "badge-yellow"}`}>
                Desktop {status.desktop.running ? "Running" : "Idle"}
              </span>
              <span className={`badge ${status.browser.available ? "badge-green" : "badge-red"}`}>
                Browser {status.browser.available ? "Ready" : "Missing"}
              </span>
              <span className={`badge ${status.blender?.available ? "badge-green" : "badge-red"}`}>
              NX {status.blender?.available ? "Ready" : "Missing"}
              </span>
              {runningCount > 0 ? (
                <span className="badge badge-red" style={{ animation: "pulse 1s infinite" }}>
                  {runningCount} running
                </span>
              ) : null}
            </div>
          ) : null}
          <VoiceButton
            context={voiceContext}
            variant="inline"
            size="md"
            hint={`Voice command for ${info.label}`}
            onResult={handleVoiceResult}
            disabled={running}
          />
          {(running || runningCount > 0) ? (
            <button onClick={killAll} className="btn btn-danger btn-sm" title="Kill all processes (Escape)">
              Kill All
            </button>
          ) : null}
        </div>
      </div>

      <div className="page-content" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 64px)" }}>
        <div className="card mb-4">
          <div className="card-body" style={{ padding: "10px 20px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)" }}>Workspace:</span>
            <button
              onClick={() => activateWorkspace("cli")}
              className={`btn btn-sm ${workspaceTab === "cli" ? "btn-primary" : "btn-outline"}`}
            >
              CLI Agent
            </button>
            <button
              onClick={() => activateWorkspace("desktop")}
              className={`btn btn-sm ${workspaceTab === "desktop" ? "btn-primary" : "btn-outline"}`}
            >
              Desktop Agent
            </button>
            <button
              onClick={() => activateWorkspace("browser")}
              className={`btn btn-sm ${workspaceTab === "browser" ? "btn-primary" : "btn-outline"}`}
            >
              Browser Agent
            </button>
            <button
              onClick={() => activateWorkspace("blender")}
              className={`btn btn-sm ${workspaceTab === "blender" ? "btn-primary" : "btn-outline"}`}
            >
              NX Lab
            </button>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {workspaceTab === "blender"
                ? "Use Cowork for local NX-style workflows, generated scenes, and 3D prompt presets"
                : `${workspaceConfig?.title ?? "Agent"} workspace with dedicated prompts, status, and execution flow`}
            </div>
          </div>
        </div>

        {workspaceTab === "cli" && workspaceConfig ? (
          <div className="grid-2" style={{ gap: 20, marginBottom: 20 }}>
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">{workspaceConfig.title}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{workspaceConfig.subtitle}</div>
                </div>
              </div>
              <div className="card-body" style={{ display: "grid", gap: 14 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className={`badge ${status?.cli.available ? "badge-green" : "badge-red"}`}>
                    {status?.cli.available ? "Claude CLI ready" : "Claude CLI missing"}
                  </span>
                  <span className="badge badge-blue">Visible terminal mode</span>
                  <span className="badge badge-gray">
                    {workdir.trim() ? "Custom workdir selected" : "Uses current local folder if blank"}
                  </span>
                </div>

                <div style={{ fontSize: 13, color: "var(--text)" }}>{workspaceConfig.description}</div>

                <div style={{ display: "grid", gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>Working directory</label>
                  <input
                    className="form-input"
                    placeholder="Optional local folder for Claude CLI"
                    value={workdir}
                    onChange={(event) => setWorkdir(event.target.value)}
                  />
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Claude CLI path: <strong>{status?.cli.path ?? "Not detected yet"}</strong>
                  </div>
                </div>

                <textarea
                  className="form-textarea"
                  style={{ minHeight: 180, fontFamily: "monospace", fontSize: 14, resize: "vertical" }}
                  placeholder={workspaceConfig.placeholder}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={running}
                />

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    onClick={() => {
                      void send("cli");
                    }}
                    disabled={!prompt.trim() || running}
                    className="btn btn-primary"
                  >
                    {running && target === "cli" ? "Running CLI Agent..." : workspaceConfig.actionLabel}
                  </button>
                  <VoiceButton
                    context="cli-agent"
                    variant="inline"
                    size="sm"
                    hint='Try: "Create a todo list in this folder"'
                    onResult={handleVoiceResult}
                    disabled={running}
                  />
                  {cliOutput.length > 0 && !running ? (
                    <button onClick={() => setCliOutput([])} className="btn btn-outline btn-sm">
                      Clear Output
                    </button>
                  ) : null}
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>CLI Prompt Presets</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {workspaceConfig.prompts.map((quickPrompt) => (
                      <button
                        key={quickPrompt}
                        onClick={() => {
                          setPrompt(quickPrompt);
                          setTarget("cli");
                        }}
                        className="btn btn-outline btn-sm"
                        style={{ justifyContent: "flex-start", textAlign: "left", fontSize: 12 }}
                      >
                        {quickPrompt}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ fontSize: 12, color: "var(--primary)", fontWeight: 600 }}>
                  {workspaceConfig.tip}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">CLI Session Guide</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    The CLI workspace now mirrors the dedicated agent-style flow instead of the old shared runner.
                  </div>
                </div>
              </div>
              <div className="card-body" style={{ display: "grid", gap: 14 }}>
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>What this agent does</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {CLI_AGENT_CAPABILITIES.map((item) => (
                      <div key={item} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <span className="badge badge-blue" style={{ minWidth: 28, justifyContent: "center" }}>CLI</span>
                        <div style={{ fontSize: 12, color: "var(--text)" }}>{item}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>Execution flow</div>
                  {CLI_AGENT_FLOW.map((step, index) => (
                    <div key={step} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span className="badge badge-gray" style={{ minWidth: 28, justifyContent: "center" }}>{index + 1}</span>
                      <div style={{ fontSize: 12, color: "var(--text)" }}>{step}</div>
                    </div>
                  ))}
                </div>

                <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
                  <div className="flex-between" style={{ gap: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>Recent CLI prompts</div>
                    <span className="badge badge-gray">{recentCliPrompts.length} saved</span>
                  </div>
                  {recentCliPrompts.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Your recent CLI prompts will appear here after the first run.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {recentCliPrompts.map((entry, index) => (
                        <button
                          key={`${entry}-${index}`}
                          onClick={() => {
                            setPrompt(entry);
                            setTarget("cli");
                          }}
                          className="btn btn-outline btn-sm"
                          style={{ justifyContent: "flex-start", textAlign: "left", fontSize: 12 }}
                        >
                          {entry}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {workspaceTab !== "blender" && workspaceTab !== "cli" && workspaceConfig ? (
          <div className="card mb-4">
            <div className="card-header">
              <div>
                <div className="card-title">{workspaceConfig.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{workspaceConfig.subtitle}</div>
              </div>
            </div>
            <div className="card-body" style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {workspaceTab === "desktop" ? (
                  <>
                    <span className={`badge ${status?.desktop.available ? "badge-green" : "badge-red"}`}>
                      {status?.desktop.available ? "Desktop automation ready" : "Desktop automation missing"}
                    </span>
                    <span className={`badge ${status?.desktop.running ? "badge-green" : "badge-yellow"}`}>
                      {status?.desktop.running ? "Desktop app running" : "Desktop app idle"}
                    </span>
                  </>
                ) : null}
                {workspaceTab === "browser" ? (
                  <>
                    <span className={`badge ${status?.browser.available ? "badge-green" : "badge-red"}`}>
                      {status?.browser.available ? "Browser automation ready" : "Browser executable missing"}
                    </span>
                    <span className="badge badge-blue">{status?.browser.url ?? "Local browser path pending"}</span>
                  </>
                ) : null}
              </div>

              <div style={{ fontSize: 13, color: "var(--text)" }}>{workspaceConfig.description}</div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {workspaceConfig.prompts.map((quickPrompt) => (
                  <button
                    key={quickPrompt}
                    onClick={() => {
                      setPrompt(quickPrompt);
                      setTarget(activeTarget);
                    }}
                    className="btn btn-outline btn-sm"
                    style={{ fontSize: 12 }}
                  >
                    {quickPrompt}
                  </button>
                ))}
              </div>

              <div style={{ fontSize: 12, color: "var(--primary)", fontWeight: 600 }}>
                {workspaceConfig.tip}
              </div>
            </div>
          </div>
        ) : null}

        {workspaceTab === "blender" ? (
          <div className="grid-2" style={{ gap: 20, marginBottom: 20 }}>
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">NX Lab</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Prompt and image guided 3D generation with OBJ output for the NX workspace
                  </div>
                </div>
              </div>
              <div className="card-body" style={{ display: "grid", gap: 14 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className={`badge ${status?.blender?.available ? "badge-green" : "badge-red"}`}>
                    {status?.blender?.available ? "NX ready" : "NX missing"}
                  </span>
                  <span className="badge badge-green">3D add-on installed</span>
                  <span className="badge badge-blue">Output folder ready</span>
                </div>

                <div style={{ fontSize: 13, color: "var(--text)" }}>
                  Type a 3D task here and Cowork will generate the model script, run Blender locally, and export OBJ output for NX import.
                </div>

                <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 14, display: "grid", gap: 12 }}>
                  <div className="flex-between" style={{ gap: 12, alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>Precision Mode</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        Lock the model closer to exact dimensions instead of pure prompt interpretation.
                      </div>
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={precision.enabled}
                        onChange={(event) => setPrecision((current) => ({ ...current, enabled: event.target.checked }))}
                      />
                      Enable
                    </label>
                  </div>

                  {precision.enabled ? (
                    <div style={{ display: "grid", gap: 12 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                          <span>Part type</span>
                          <select
                            className="form-input"
                            value={precision.partType}
                            onChange={(event) =>
                              setPrecision((current) => ({
                                ...current,
                                partType: event.target.value as PrecisionFormState["partType"],
                              }))
                            }
                          >
                            <option value="auto">Auto detect</option>
                            <option value="gear">Gear</option>
                             <option value="geartrain">Gear train assembly</option>
                             <option value="bolt">Bolt</option>
                            <option value="shaft">Shaft</option>
                            <option value="coupling">Coupling</option>
                            <option value="planetary">Planetary set</option>
                            <option value="belt">Belt drive</option>
                            <option value="custom">Custom part</option>
                          </select>
                        </label>
                        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                          <span>Units</span>
                          <select
                            className="form-input"
                            value={precision.units}
                            onChange={(event) =>
                              setPrecision((current) => ({
                                ...current,
                                units: event.target.value as PrecisionFormState["units"],
                              }))
                            }
                          >
                            <option value="mm">mm</option>
                            <option value="inch">inch</option>
                          </select>
                        </label>
                        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                          <span>Quality</span>
                          <select
                            className="form-input"
                            value={precision.qualityPreset}
                            onChange={(event) =>
                              setPrecision((current) => ({
                                ...current,
                                qualityPreset: event.target.value as PrecisionFormState["qualityPreset"],
                              }))
                            }
                          >
                            <option value="draft">Draft</option>
                            <option value="balanced">Balanced</option>
                            <option value="high">High</option>
                          </select>
                        </label>
                        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                          <span>Material</span>
                          <select
                            className="form-input"
                            value={precision.materialPreset}
                            onChange={(event) =>
                              setPrecision((current) => ({
                                ...current,
                                materialPreset: event.target.value as PrecisionFormState["materialPreset"],
                              }))
                            }
                          >
                            <option value="steel">Steel</option>
                            <option value="aluminum">Aluminum</option>
                            <option value="brass">Brass</option>
                            <option value="dark">Dark metal</option>
                          </select>
                        </label>
                        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                          <span>Tooth count</span>
                          <input
                            className="form-input"
                            value={precision.primaryToothCount}
                            onChange={(event) => setPrecision((current) => ({ ...current, primaryToothCount: event.target.value }))}
                            placeholder="18"
                          />
                        </label>
                        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                          <span>Extra tooth counts</span>
                          <input
                            className="form-input"
                            value={precision.additionalToothCounts}
                            onChange={(event) => setPrecision((current) => ({ ...current, additionalToothCounts: event.target.value }))}
                            placeholder="5, 12"
                          />
                        </label>
                        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                          <span>Planet count</span>
                          <input
                            className="form-input"
                            value={precision.planetCount}
                            onChange={(event) => setPrecision((current) => ({ ...current, planetCount: event.target.value }))}
                            placeholder="3"
                          />
                        </label>
                        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                          <span>Stage count</span>
                          <input
                            className="form-input"
                            value={precision.stageCount}
                            onChange={(event) => setPrecision((current) => ({ ...current, stageCount: event.target.value }))}
                            placeholder="2"
                          />
                        </label>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                          <span>Symmetry</span>
                          <select
                            className="form-input"
                            value={precision.symmetry}
                            onChange={(event) =>
                              setPrecision((current) => ({
                                ...current,
                                symmetry: event.target.value as PrecisionFormState["symmetry"],
                              }))
                            }
                          >
                            <option value="auto">Auto</option>
                            <option value="radial">Radial</option>
                            <option value="bilateral">Bilateral</option>
                          </select>
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, paddingTop: 24 }}>
                          <input
                            type="checkbox"
                            checked={precision.centerOrigin}
                            onChange={(event) => setPrecision((current) => ({ ...current, centerOrigin: event.target.checked }))}
                          />
                          Center at origin
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, paddingTop: 24 }}>
                          <input
                            type="checkbox"
                            checked={precision.smoothShading}
                            onChange={(event) => setPrecision((current) => ({ ...current, smoothShading: event.target.checked }))}
                          />
                          Smooth shading
                        </label>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                          <span>Outer diameter</span>
                          <input
                            className="form-input"
                            value={precision.outerDiameter}
                            onChange={(event) => setPrecision((current) => ({ ...current, outerDiameter: event.target.value }))}
                            placeholder={precision.units === "mm" ? "40" : "1.57"}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                          <span>Bore / inner diameter</span>
                          <input
                            className="form-input"
                            value={precision.innerDiameter}
                            onChange={(event) => setPrecision((current) => ({ ...current, innerDiameter: event.target.value }))}
                            placeholder={precision.units === "mm" ? "10" : "0.39"}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                          <span>Thickness</span>
                          <input
                            className="form-input"
                            value={precision.thickness}
                            onChange={(event) => setPrecision((current) => ({ ...current, thickness: event.target.value }))}
                            placeholder={precision.units === "mm" ? "8" : "0.31"}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                          <span>Length</span>
                          <input
                            className="form-input"
                            value={precision.length}
                            onChange={(event) => setPrecision((current) => ({ ...current, length: event.target.value }))}
                            placeholder={precision.units === "mm" ? "100" : "4"}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                          <span>Shaft spacing</span>
                          <input
                            className="form-input"
                            value={precision.shaftSpacing}
                            onChange={(event) => setPrecision((current) => ({ ...current, shaftSpacing: event.target.value }))}
                            placeholder={precision.units === "mm" ? "120" : "4.72"}
                          />
                        </label>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                          <span>Shaft diameter</span>
                          <input
                            className="form-input"
                            value={precision.shaftDiameter}
                            onChange={(event) => setPrecision((current) => ({ ...current, shaftDiameter: event.target.value }))}
                            placeholder={precision.units === "mm" ? "8" : "0.315"}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                          <span>Head diameter</span>
                          <input
                            className="form-input"
                            value={precision.headDiameter}
                            onChange={(event) => setPrecision((current) => ({ ...current, headDiameter: event.target.value }))}
                            placeholder={precision.units === "mm" ? "16" : "0.63"}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                          <span>Head height</span>
                          <input
                            className="form-input"
                            value={precision.headHeight}
                            onChange={(event) => setPrecision((current) => ({ ...current, headHeight: event.target.value }))}
                            placeholder={precision.units === "mm" ? "6" : "0.25"}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                          <span>Tolerance</span>
                          <input
                            className="form-input"
                            value={precision.tolerance}
                            onChange={(event) => setPrecision((current) => ({ ...current, tolerance: event.target.value }))}
                            placeholder={precision.units === "mm" ? "0.2" : "0.01"}
                          />
                        </label>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <label className="btn btn-outline btn-sm" style={{ width: "fit-content", cursor: "pointer" }}>
                    Upload Reference Image
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleBlenderImageUpload}
                      style={{ display: "none" }}
                    />
                  </label>
                  {blenderImageName ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        Reference image: <strong>{blenderImageName}</strong>
                      </div>
                      {blenderImageDataUrl ? (
                        <img
                          src={blenderImageDataUrl}
                          alt={blenderImageName}
                          style={{ width: "100%", maxWidth: 320, borderRadius: 12, border: "1px solid var(--border)" }}
                        />
                      ) : null}
                      <button
                        onClick={() => {
                          setBlenderImageDataUrl(null);
                          setBlenderImageName(null);
                        }}
                        className="btn btn-outline btn-sm"
                        style={{ width: "fit-content" }}
                      >
                        Remove Image
                      </button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Optional: add a reference image and Cowork will try to match the shape in the generated 3D mesh.
                    </div>
                  )}
                </div>

                <textarea
                  className="form-textarea"
                  style={{ minHeight: 160, fontFamily: "monospace", fontSize: 14, resize: "vertical" }}
                  placeholder={`Describe the 3D model you want...\n\nExamples:\n- Create 3 gears with 5 teeth, 12 teeth, and 18 teeth and export OBJ only\n- Make a stylized robot head with metallic materials as an OBJ mesh\n- Use this reference image to build a mechanical housing and export OBJ`}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  disabled={running}
                />

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    onClick={() => {
                      void send("blender");
                    }}
                    disabled={!prompt.trim() || running}
                    className="btn btn-primary"
                  >
                    {running && target === "blender" ? "Generating 3D Model..." : "Generate 3D Model"}
                  </button>
                  <VoiceButton
                    context="nx-agent"
                    variant="inline"
                    size="sm"
                    hint='Try: "Create 3 gears with 18 teeth and export OBJ"'
                    onResult={handleVoiceResult}
                    disabled={running}
                  />
                  <button
                    onClick={() => setTarget("blender")}
                    className={`btn ${target === "blender" ? "btn-primary" : "btn-outline"} btn-sm`}
                  >
                    Use NX Agent
                  </button>
                </div>

                <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 14, display: "grid", gap: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Mechanical Component Library</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Procedural support is strongest for gears, shafts, couplings, planetary sets, and belt drives. The rest can still be guided by prompt and image reference.
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                    {MECHANICAL_COMPONENT_GROUPS.map((group) => (
                      <div key={group.title} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{group.title}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {group.items.map((item) => (
                            <span key={item} className="badge badge-gray">{item}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {BLENDER_PROMPTS.map((blenderPrompt) => (
                    <button
                      key={blenderPrompt}
                      onClick={() => {
                        setPrompt(blenderPrompt);
                        setTarget("blender");
                      }}
                      className="btn btn-outline btn-sm"
                      style={{ justifyContent: "flex-start", textAlign: "left", fontSize: 12 }}
                    >
                      {blenderPrompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Generated NX Assets</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Latest OBJ outputs stored in {status?.blender?.outputDir ?? "the local output folder"}
                  </div>
                </div>
              </div>
              <div className="card-body" style={{ display: "grid", gap: 12 }}>
                {(status?.blender?.artifacts?.length ? status.blender.artifacts : BLENDER_ASSETS).map((asset) => (
                  <div key={asset.path} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
                    <div className="flex-between" style={{ gap: 12, alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{"name" in asset ? asset.name : asset.file}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{"type" in asset ? asset.type : "Generated Artifact"}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, fontFamily: "monospace", wordBreak: "break-all" }}>
                          {asset.path}
                        </div>
                      </div>
                      <span className="badge badge-gray">{asset.file}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div className="card mb-4">
          <div className="card-body" style={{ padding: "12px 20px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                Active Agent:
              </span>
              <span className="badge badge-blue">{info.label}</span>
              {target === "all" ? <span className="badge badge-yellow">All Agents mode enabled</span> : null}
              <div style={{ flex: 1 }} />
              {workspaceTab !== "blender" && workspaceTab !== "cli" ? (
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Current browser path: {status?.browser.url ?? "pending"}
                </span>
              ) : null}
            </div>
            <div style={{ fontSize: 12, color: "var(--primary)", marginTop: 8, fontWeight: 600 }}>
              {info.desc}
              {target !== "cli" && status?.browser.url ? ` | Browser path: ${status.browser.url}` : ""}
            </div>
          </div>
        </div>

        <div
          className={workspaceTab === "cli" ? "" : "grid-2"}
          style={{ flex: 1, minHeight: 0, gap: 20, display: workspaceTab === "cli" ? "block" : undefined }}
        >
          {workspaceTab === "cli" ? null : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="card" style={{ flex: 1 }}>
                <div className="card-header">
                  <div className="card-title">
                    {workspaceTab === "blender" ? "NX Prompt" : `${workspaceConfig?.title ?? "Agent"} Prompt`}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {workspaceTab === "blender"
                      ? "Ctrl+Enter send | Escape stop | Up and down arrows for history"
                      : "Ctrl+Enter send | Escape stop | Up and down arrows for history"}
                  </div>
                </div>
                <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12, height: "calc(100% - 57px)" }}>
                  <textarea
                    className="form-textarea"
                    style={{ flex: 1, minHeight: 180, fontFamily: "monospace", fontSize: 14, resize: "none" }}
                    placeholder={
                      workspaceTab === "blender"
                        ? `Describe the NX-style 3D model you want...\n\nExamples:\n- Create 2 connected gears with 18 teeth and 36 teeth and export OBJ only\n- Build a coupling for two aligned shafts and export OBJ only`
                        : workspaceConfig?.placeholder ?? "Type a task for this agent..."
                    }
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={running}
                  />
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button
                      onClick={() => {
                        void send();
                      }}
                      disabled={!prompt.trim() || running}
                      className="btn btn-primary"
                      style={{ flex: 1, justifyContent: "center" }}
                    >
                      {running ? (
                        <>
                          <span className="spinner" />&nbsp;Executing...
                        </>
                      ) : (
                        workspaceTab === "blender"
                          ? "Run NX Agent"
                          : (workspaceConfig?.actionLabel ?? `Run ${info.label}`)
                      )}
                    </button>
                    <VoiceButton
                      context={voiceContext}
                      variant="inline"
                      size="sm"
                      hint={`Voice command for ${info.label}`}
                      onResult={handleVoiceResult}
                      disabled={running}
                    />
                    {running ? (
                      <button onClick={stopExecution} className="btn btn-danger" title="Stop (Escape)">
                        Stop
                      </button>
                    ) : null}
                    {cliOutput.length > 0 && !running ? (
                      <button onClick={() => setCliOutput([])} className="btn btn-outline btn-sm" title="Clear">
                        Clear
                      </button>
                    ) : null}
                  </div>
                  {running && currentSessionId ? (
                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
                      Session {currentSessionId.slice(-10)} | Press Escape to stop
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <div className="card-title">
                    {workspaceTab === "blender" ? "NX Prompt Presets" : `${workspaceConfig?.title ?? "Agent"} Prompt Presets`}
                  </div>
                </div>
                <div className="card-body" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {(workspaceTab === "blender" ? BLENDER_PROMPTS : workspaceConfig?.prompts ?? []).map((quickPrompt) => (
                    <button
                      key={quickPrompt}
                      onClick={() => {
                        setPrompt(quickPrompt);
                        setTarget(activeTarget);
                      }}
                      className="btn btn-outline btn-sm"
                      style={{ fontSize: 12 }}
                    >
                      {quickPrompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div className="card-header" style={{ flexShrink: 0 }}>
              <div className="card-title">Execution Output</div>
              <div className="flex-center" style={{ gap: 8 }}>
                {running ? (
                  <span className="badge badge-yellow" style={{ animation: "pulse 1s infinite" }}>
                    Executing
                  </span>
                ) : null}
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{cliOutput.length} lines</span>
                {cliOutput.length > 0 ? (
                  <button onClick={() => setCliOutput([])} className="btn btn-outline btn-sm" style={{ padding: "2px 8px", fontSize: 11 }}>
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
            <div
              ref={outputRef}
              style={{
                flex: 1,
                overflowY: "auto",
                background: "#0f172a",
                padding: 16,
                minHeight: 0,
                borderRadius: "0 0 12px 12px",
              }}
            >
              {cliOutput.length === 0 ? (
                <div style={{ color: "#475569", fontFamily: "monospace", fontSize: 13, textAlign: "center", paddingTop: 60 }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>AI</div>
                  <div>Execution results appear here</div>
                  <div style={{ marginTop: 6, fontSize: 12 }}>
                    {workspaceTab === "cli"
                      ? "CLI Agent opens a visible terminal and runs the exact prompt in Claude CLI."
                      : workspaceTab === "desktop"
                        ? "Desktop Agent plans and executes local Windows app tasks."
                        : workspaceTab === "browser"
                          ? "Browser Agent plans and completes website automation in Chrome or Edge."
                          : "NX Lab generates OBJ-ready mechanical assets for NX workflows."}
                  </div>
                </div>
              ) : (
                cliOutput.map((line, index) => renderLine(line, index))
              )}
              {running ? (
                <div style={{ color: "#6366f1", fontFamily: "monospace", animation: "pulse 1s infinite" }}>|</div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="card mt-4" style={{ flexShrink: 0 }}>
          <div className="card-body" style={{ display: "flex", gap: 20, flexWrap: "wrap", padding: "12px 20px" }}>
            {[
              { icon: "CLI", title: "CLI Agent", desc: "Creates code, runs commands, and works inside local folders." },
              { icon: "APP", title: "Desktop Agent", desc: "Handles Claude Desktop and Amazon Music on the local machine." },
              { icon: "WEB", title: "Browser Agent", desc: "Automates real tasks in local Chrome or Edge." },
              { icon: "KEY", title: "Hotkeys", desc: "Ctrl+Enter execute | Escape stop | Up and down arrows history | Kill All" },
            ].map((item) => (
              <div key={item.title} style={{ display: "flex", gap: 10, minWidth: 180, flex: 1 }}>
                <span style={{ fontSize: 18 }}>{item.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{item.title}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }`}</style>
    </>
  );
}
