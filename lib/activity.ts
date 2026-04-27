import fs from "fs";
import path from "path";

export interface ActivityEntry {
  title: string;
  app: string;
  category: string;
  start: string;
  end: string;
  durationSec: number;
}

export interface TimerSession {
  id: string;
  task: string;
  project: string;
  start: string;
  end: string | null;
  durationSec: number;
  running: boolean;
}

export interface InferredTask {
  task: string;
  category: string;
  totalSec: number;
  apps: string[];
  windows: string[];
  entries: ActivityEntry[];
}

const LOG_FILE = path.join(process.cwd(), "data", "activity-raw.jsonl");
const TIMER_FILE = path.join(process.cwd(), "data", "timers.json");

export function getTodayActivities(): ActivityEntry[] {
  if (!fs.existsSync(LOG_FILE)) return [];
  const today = new Date().toISOString().split("T")[0];
  const lines = fs.readFileSync(LOG_FILE, "utf-8").trim().split("\n").filter(Boolean);
  return lines
    .map((l) => { try { return JSON.parse(l) as ActivityEntry; } catch { return null; } })
    .filter((e): e is ActivityEntry => !!e && e.start.startsWith(today));
}

export function getAllActivities(date?: string): ActivityEntry[] {
  if (!fs.existsSync(LOG_FILE)) return [];
  const target = date ?? new Date().toISOString().split("T")[0];
  const lines = fs.readFileSync(LOG_FILE, "utf-8").trim().split("\n").filter(Boolean);
  return lines
    .map((l) => { try { return JSON.parse(l) as ActivityEntry; } catch { return null; } })
    .filter((e): e is ActivityEntry => !!e && e.start.startsWith(target));
}

export function groupByCategory(entries: ActivityEntry[]): Record<string, { totalSec: number; entries: ActivityEntry[] }> {
  const groups: Record<string, { totalSec: number; entries: ActivityEntry[] }> = {};
  for (const e of entries) {
    if (!groups[e.category]) groups[e.category] = { totalSec: 0, entries: [] };
    groups[e.category].totalSec += e.durationSec;
    groups[e.category].entries.push(e);
  }
  return groups;
}

export function secToHours(sec: number): number {
  return Math.round((sec / 3600) * 10) / 10;
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// In-memory timer store
const timerStore: TimerSession[] = [];

export function startTimer(task: string, project: string): TimerSession {
  // Stop any running timer
  timerStore.filter((t) => t.running).forEach((t) => stopTimer(t.id));
  const session: TimerSession = {
    id: `timer-${Date.now()}`,
    task,
    project,
    start: new Date().toISOString(),
    end: null,
    durationSec: 0,
    running: true,
  };
  timerStore.push(session);
  return session;
}

export function stopTimer(id: string): TimerSession | null {
  const t = timerStore.find((t) => t.id === id);
  if (!t || !t.running) return null;
  t.end = new Date().toISOString();
  t.running = false;
  t.durationSec = Math.round((new Date(t.end).getTime() - new Date(t.start).getTime()) / 1000);
  return t;
}

export function getTimers(): TimerSession[] {
  // Update running timers' duration
  const now = Date.now();
  return timerStore.map((t) => ({
    ...t,
    durationSec: t.running ? Math.round((now - new Date(t.start).getTime()) / 1000) : t.durationSec,
  }));
}

export function addManualActivity(entry: Omit<ActivityEntry, "category">): ActivityEntry {
  const full: ActivityEntry = { ...entry, category: entry.app };
  const line = JSON.stringify(full) + "\n";
  fs.appendFileSync(LOG_FILE, line, "utf8");
  return full;
}
