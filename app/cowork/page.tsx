"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  partType: "auto" | "gear" | "bolt" | "custom";
  units: "mm" | "inch";
  primaryToothCount: string;
  additionalToothCounts: string;
  outerDiameter: string;
  innerDiameter: string;
  thickness: string;
  length: string;
  shaftDiameter: string;
  headDiameter: string;
  headHeight: string;
  tolerance: string;
}

const QUICK_PROMPTS = [
  "Create a simple todo list website in the current folder",
  "Review this project and tell me the main issues",
  "Open https://example.com in Chrome and keep it open",
  "Open https://github.com/login, email is demo@example.com password is hunter2, and login",
  "Play Ghost from Amazon Music",
  "Send this prompt into Claude Desktop: summarize the onboarding flow",
  "Show git status and recent commits",
  "Check if there are any build errors",
];

const BLENDER_PROMPTS = [
  "Use Blender CLI to create 3 gears with 5 teeth, 12 teeth, and 18 teeth, and export OBJ files only.",
  "Use Blender CLI to create a clean mechanical bolt model and export OBJ only.",
  "Create a stylized industrial part from this reference image and export an OBJ mesh only.",
  "Create a metallic gear assembly in Blender and save OBJ output for NX import.",
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

export default function CoworkPage() {
  const [workspaceTab, setWorkspaceTab] = useState<"agents" | "blender">("agents");
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
    primaryToothCount: "",
    additionalToothCounts: "",
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
      primaryToothCount: parseField(precision.primaryToothCount),
      additionalToothCounts: extraCounts,
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

  async function send(targetOverride?: "cli" | "desktop" | "browser" | "blender" | "all") {
    if (!prompt.trim() || running) return;

    const selectedTarget = targetOverride ?? target;
    const trimmedPrompt = prompt.trim();
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
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      send();
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
  const info = TARGET_INFO[target];

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
              onClick={() => setWorkspaceTab("agents")}
              className={`btn btn-sm ${workspaceTab === "agents" ? "btn-primary" : "btn-outline"}`}
            >
              Agent Console
            </button>
            <button
              onClick={() => setWorkspaceTab("blender")}
              className={`btn btn-sm ${workspaceTab === "blender" ? "btn-primary" : "btn-outline"}`}
            >
              NX Lab
            </button>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {workspaceTab === "agents"
                ? "Run Claude CLI, desktop automation, and browser tasks"
                : "Use Cowork for local NX-style workflows, generated scenes, and 3D prompt presets"}
            </div>
          </div>
        </div>

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
                            <option value="bolt">Bolt</option>
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

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => {
                      void send("blender");
                    }}
                    disabled={!prompt.trim() || running}
                    className="btn btn-primary"
                  >
                    {running && target === "blender" ? "Generating 3D Model..." : "Generate 3D Model"}
                  </button>
                  <button
                    onClick={() => setTarget("blender")}
                    className={`btn ${target === "blender" ? "btn-primary" : "btn-outline"} btn-sm`}
                  >
                    Use NX Agent
                  </button>
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
                Mode:
              </span>
              {(Object.entries(TARGET_INFO) as [keyof typeof TARGET_INFO, typeof TARGET_INFO[keyof typeof TARGET_INFO]][]).map(([id, meta]) => (
                <button
                  key={id}
                  onClick={() => setTarget(id)}
                  className={`btn btn-sm ${target === id ? "btn-primary" : "btn-outline"}`}
                  title={meta.desc}
                >
                  {meta.label}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <input
                className="form-input"
                style={{ maxWidth: 280, fontSize: 12 }}
                placeholder="Working directory for CLI tasks (optional)"
                value={workdir}
                onChange={(event) => setWorkdir(event.target.value)}
              />
            </div>
            <div style={{ fontSize: 12, color: "var(--primary)", marginTop: 8, fontWeight: 600 }}>
              {info.desc}
              {target !== "cli" && status?.browser.url ? ` | Browser path: ${status.browser.url}` : ""}
            </div>
          </div>
        </div>

        <div className="grid-2" style={{ flex: 1, minHeight: 0, gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card" style={{ flex: 1 }}>
              <div className="card-header">
                <div className="card-title">Task / Prompt</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Ctrl+Enter send | Escape stop | Up and down arrows for history
                </div>
              </div>
              <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12, height: "calc(100% - 57px)" }}>
                <textarea
                  className="form-textarea"
                  style={{ flex: 1, minHeight: 180, fontFamily: "monospace", fontSize: 14, resize: "none" }}
                  placeholder={`Type a task for Cowork...\n\nExamples:\n- Create a simple todo list website in this folder\n- Play Ghost from Amazon Music\n- Open https://example.com in Chrome\n- Open a link, login, and complete a browser task`}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={running}
                />
                <div style={{ display: "flex", gap: 8 }}>
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
                      `Run ${info.label}`
                    )}
                  </button>
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
                <div className="card-title">Quick Prompts</div>
              </div>
              <div className="card-body" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {QUICK_PROMPTS.map((quickPrompt) => (
                  <button
                    key={quickPrompt}
                    onClick={() => setPrompt(quickPrompt)}
                    className="btn btn-outline btn-sm"
                    style={{ fontSize: 12 }}
                  >
                    {quickPrompt}
                  </button>
                ))}
              </div>
            </div>
          </div>

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
                  <div style={{ marginTop: 6, fontSize: 12 }}>CLI mode runs Claude Code locally</div>
                  <div style={{ marginTop: 4, fontSize: 12 }}>Desktop and Browser modes run local automation plans</div>
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
