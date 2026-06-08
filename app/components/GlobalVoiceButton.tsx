"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import VoiceButton, { requestVoiceControl, type VoiceAction } from "./VoiceButton";
import { dispatchVoiceAction } from "@/app/hooks/useVoiceCommand";

const VOICE_NAV_TASK_KEY = "genio:voice-navigation-task";

interface VoiceNavigationTask {
  path: string;
  prompt?: string;
  followupAction?: VoiceAction;
  createdAt: number;
}

/** Map the current pathname (+ optional workspace query param) → voice context key */
function resolveContext(pathname: string, workspace: string | null, view: string | null): string {
  if (pathname.startsWith("/mail")) return "mail";
  if (pathname.startsWith("/birthday")) return "birthday";
  if (pathname.startsWith("/timesheet/review")) return "timesheet-review";
  if (pathname.startsWith("/timesheet")) return "timesheet";
  if (pathname.startsWith("/employees")) return "employees";
  if (pathname.startsWith("/finance")) return "finance";
  if (pathname.startsWith("/documents")) return "documents";
  if (pathname.startsWith("/assistant")) return "assistant";
  if (pathname.startsWith("/cad")) return "cad";
  if (pathname.startsWith("/onboarding")) return "onboarding";
  if (pathname.startsWith("/cowork")) {
    if (workspace === "blender") return view === "lab" ? "nx-lab" : "nx-agent";
    if (workspace === "desktop") return "desktop-agent";
    if (workspace === "browser") return "browser-agent";
    return "cli-agent";
  }
  return "general";
}

const HINTS: Record<string, string> = {
  mail:               'Try: "Compose email to John" · "Schedule a meeting"',
  birthday:           'Try: "Send birthday emails today" · "Set theme to galaxy"',
  "timesheet-review": 'Try: "Switch to timer tab" · "Start timer for task X"',
  timesheet:          'Try: "Show attendance" · "Filter employee Ravi"',
  employees:          'Try: "Search engineers" · "Show John Smith"',
  finance:            'Try: "Show pending invoices" · "Approve all"',
  documents:          'Try: "Compare documents" · "Show changes only"',
  assistant:          'Try: "How many employees are on leave?" · "Ask about attendance"',
  cad:                'Try: "Analyze CAD file" · "Show tolerance report"',
  onboarding:         'Try: "Show pending onboarding" · "Search new hires"',
  "cli-agent":        'Try: "Create a todo list in this folder"',
  "nx-agent":         'Try: "Create 3 gears with 18 teeth and export OBJ"',
  "nx-lab":           'Try: "Create a gear with 48 teeth and export OBJ"',
  "desktop-agent":    'Try: "Open Amazon Music and play Ghost"',
  "browser-agent":    'Try: "Open GitHub and search repositories"',
  general:            'Try: "Go to timesheets" · "Open mail"',
};

const PATH_MAP: Record<string, string> = {
  mail: "/mail",
  birthday: "/birthday",
  employees: "/employees",
  timesheet: "/timesheet",
  "timesheet-review": "/timesheet/review",
  finance: "/finance",
  documents: "/documents",
  assistant: "/assistant",
  cad: "/cad",
  onboarding: "/onboarding",
  cowork: "/cowork",
  "cli-agent": "/cowork?workspace=cli&target=cli",
  "nx-agent": "/cowork?workspace=blender&target=blender",
  "nx-lab": "/cowork?workspace=blender&target=blender&view=lab",
  "desktop-agent": "/cowork?workspace=desktop&target=desktop",
  "browser-agent": "/cowork?workspace=browser&target=browser",
};

const PAGE_PROMPTS: Record<string, string> = {
  mail: "Mail is open. You can compose an email, reply, draft an acknowledgement, or schedule a meeting. What would you like to do?",
  employees: "Employees is open. You can view the staff list, add a new employee, search by name, and filter by role or department. What would you like to do?",
  birthday: "Birthdays is open. You can send today's birthday emails, send a test email, change the card theme, or schedule the automation. What would you like to do?",
  timesheet: "Timesheet is open. You can view attendance, check employees in or out, filter by employee, apply for leave, or import from Excel. What would you like to do?",
  "timesheet-review": "Timesheet review is open. You can view the activity log, start or stop a timer, infer tasks from activity, and submit the timesheet. What would you like to do?",
  finance: "Finance is open. You can raise a bill request, review pending approvals, or approve and reject requests by ID. What would you like to do?",
  documents: "Documents is open. You can compare the original and updated files and toggle the changed-lines view. What would you like to do?",
  assistant: "The assistant is open. You can ask about employees, attendance, or leave, start a new conversation, or open the leave request form. What would you like to know?",
  cad: "CAD is open. You can make a drawing of a 3D component or analyze an uploaded file. What would you like to do?",
  onboarding: "Onboarding is open. You can search new hires and filter by pending, in progress, or completed status. What would you like to do?",
  "nx-lab": "NX Lab is open. You can create gears, shafts, couplings, planetary sets, and other parts, or enable Precision Mode for exact dimensions. What would you like to build?",
  "nx-agent": "NX Agent is open. You can create gears, shafts, couplings, and other mechanical parts, or enable Precision Mode for exact dimensions. What would you like to build?",
  "cli-agent": "CLI Agent is open. Tell me what local task to run.",
  "desktop-agent": "Desktop Agent is open. Tell me what desktop task to execute.",
  "browser-agent": "Browser Agent is open. Tell me what web task to execute.",
};

function readPendingTask(): VoiceNavigationTask | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(VOICE_NAV_TASK_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VoiceNavigationTask;
  } catch {
    window.sessionStorage.removeItem(VOICE_NAV_TASK_KEY);
    return null;
  }
}

function writePendingTask(task: VoiceNavigationTask) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(VOICE_NAV_TASK_KEY, JSON.stringify(task));
}

function normalizeVoiceHref(href: string): string {
  if (!href.startsWith("/")) return href;
  const [pathname, query = ""] = href.split("?", 2);
  const params = new URLSearchParams(query);
  params.delete("source");
  const entries = Array.from(params.entries()).sort(([left], [right]) => left.localeCompare(right));
  const normalizedQuery = new URLSearchParams(entries).toString();
  return normalizedQuery ? `${pathname}?${normalizedQuery}` : pathname;
}

export default function GlobalVoiceButton() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const workspace = searchParams.get("workspace");
  const view = searchParams.get("view");
  const context = resolveContext(pathname, workspace, view);
  const hint = HINTS[context] ?? HINTS.general;
  const currentHref = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;

  useEffect(() => {
    const task = readPendingTask();
    if (!task || normalizeVoiceHref(task.path) !== normalizeVoiceHref(currentHref)) return;

    window.sessionStorage.removeItem(VOICE_NAV_TASK_KEY);

    if (task.followupAction) {
      if (task.prompt) {
        requestVoiceControl({
          channel: "global",
          type: "speak",
          message: task.prompt,
        });
      }
      window.setTimeout(() => {
        dispatchVoiceAction(task.followupAction as VoiceAction);
      }, task.prompt ? 1800 : 900);
      return;
    }

    if (task.prompt) {
      requestVoiceControl({
        channel: "global",
        type: "speak_and_listen",
        message: task.prompt,
        silenceMs: 5000,
        maxDurationMs: 60000,
      });
    }
  }, [currentHref]);

  function handleResult(_transcript: string, action: VoiceAction) {
    if (action.action === "navigate" || action.action === "navigate_with_action") {
      const dest = String(action.params.path ?? action.params.page ?? "").trim().toLowerCase();
      const mapped = PATH_MAP[dest] ?? dest;
      if (mapped.startsWith("/")) {
        const prompt = String(action.params.prompt ?? PAGE_PROMPTS[dest] ?? "").trim() || undefined;
        const followupAction = (() => {
          const candidate = action.params.followupAction;
          if (!candidate || typeof candidate !== "object") return undefined;
          const record = candidate as Record<string, unknown>;
          if (typeof record.action !== "string" || typeof record.humanReadable !== "string" || typeof record.params !== "object" || !record.params) {
            return undefined;
          }
          return {
            action: record.action,
            humanReadable: record.humanReadable,
            params: record.params as Record<string, unknown>,
          } satisfies VoiceAction;
        })();

        if (normalizeVoiceHref(mapped) === normalizeVoiceHref(currentHref)) {
          if (followupAction) {
            if (prompt) {
              requestVoiceControl({
                channel: "global",
                type: "speak",
                message: prompt,
              });
            }
            window.setTimeout(() => {
              dispatchVoiceAction(followupAction);
            }, prompt ? 1200 : 0);
            return;
          }

          if (prompt) {
            requestVoiceControl({
              channel: "global",
              type: "speak_and_listen",
              message: prompt,
              silenceMs: 5000,
              maxDurationMs: 60000,
            });
            return;
          }
        }

        writePendingTask({
          path: mapped,
          prompt,
          followupAction,
          createdAt: Date.now(),
        });
        router.push(mapped);
        return;
      }
    }
    // Everything else → dispatch to the currently mounted page
    dispatchVoiceAction(action);
  }

  return (
    <VoiceButton
      context={context}
      variant="inline"
      size="md"
      hint={`${hint} • Wake phrase: "Genius"`}
      enableWakeWord
      wakePhrases={["genius", "hey genius", "hey genio ai"]}
      wakeReply="Yes master"
      wakeSilenceMs={60000}
      wakeCommandSilenceMs={5000}
      controlChannel="global"
      onResult={handleResult}
    />
  );
}
