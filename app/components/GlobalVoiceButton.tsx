"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import VoiceButton, { type VoiceAction } from "./VoiceButton";
import { dispatchVoiceAction } from "@/app/hooks/useVoiceCommand";

/** Map the current pathname (+ optional workspace query param) → voice context key */
function resolveContext(pathname: string, workspace: string | null): string {
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
    if (workspace === "blender") return "nx-agent";
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
  "desktop-agent": "/cowork?workspace=desktop&target=desktop",
  "browser-agent": "/cowork?workspace=browser&target=browser",
};

export default function GlobalVoiceButton() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const workspace = searchParams.get("workspace");
  const context = resolveContext(pathname, workspace);
  const hint = HINTS[context] ?? HINTS.general;

  function handleResult(_transcript: string, action: VoiceAction) {
    // Navigation actions — handled globally, no page event needed
    if (action.action === "navigate") {
      const dest = String(action.params.path ?? action.params.page ?? "").trim().toLowerCase();
      const mapped = PATH_MAP[dest] ?? dest;
      if (mapped.startsWith("/")) { router.push(mapped); return; }
    }
    // Everything else → dispatch to the currently mounted page
    dispatchVoiceAction(action);
  }

  return (
    <VoiceButton
      context={context}
      variant="inline"
      size="md"
      hint={hint}
      onResult={handleResult}
    />
  );
}
