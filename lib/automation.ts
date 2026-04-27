import fs from "fs";
import path from "path";
import { getEmployees, getOnboardingRecords } from "./employees";
import { getRequests } from "./requests";
import { getAttendanceRecords } from "./timesheet";

export type AutomationAction =
  | "missed_checkin_followup"
  | "absence_summary"
  | "work_anniversary"
  | "day_zero_onboarding"
  | "document_chase"
  | "attendance_correction"
  | "monthly_hr_report"
  | "festival_mailer"
  | "probation_reminder"
  | "exit_process";

export interface AutomationLog {
  id: string;
  action: AutomationAction;
  title: string;
  summary: string;
  status: "completed" | "attention";
  details: string[];
  createdAt: string;
}

type AutomationResult = {
  title: string;
  summary: string;
  status: "completed" | "attention";
  details: string[];
  count: number;
};

const AUTOMATION_FILE = path.join(process.cwd(), "data", "automation-log.json");

function ensureAutomationFile() {
  const dir = path.dirname(AUTOMATION_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(AUTOMATION_FILE)) fs.writeFileSync(AUTOMATION_FILE, "[]");
}

function readLogs(): AutomationLog[] {
  ensureAutomationFile();
  try {
    return JSON.parse(fs.readFileSync(AUTOMATION_FILE, "utf-8")) as AutomationLog[];
  } catch {
    return [];
  }
}

function writeLogs(logs: AutomationLog[]) {
  ensureAutomationFile();
  fs.writeFileSync(AUTOMATION_FILE, JSON.stringify(logs, null, 2));
}

function todayDateText(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function monthDay(iso: string) {
  const [, month, day] = iso.split("-");
  return `${month}-${day}`;
}

function daysBetween(a: string, b: string) {
  const aDate = new Date(a);
  const bDate = new Date(b);
  aDate.setHours(0, 0, 0, 0);
  bDate.setHours(0, 0, 0, 0);
  return Math.round((bDate.getTime() - aDate.getTime()) / 86400000);
}

function isDateWithinRange(date: string, start: string, end: string) {
  return date >= start && date <= end;
}

function getDeliverableEmployees() {
  return getEmployees().filter((employee) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employee.email));
}

function getApprovedLeaveEmployees(today = todayDateText()) {
  return getRequests().filter(
    (request) =>
      request.kind === "leave" &&
      request.status === "approved" &&
      request.startDate &&
      request.endDate &&
      isDateWithinRange(today, request.startDate, request.endDate)
  );
}

function getActiveApprovedLeaveEmployees(today = todayDateText()) {
  const attendanceIds = new Set(getAttendanceRecords(today).map((record) => record.employeeId));
  return getApprovedLeaveEmployees(today).filter((request) => !attendanceIds.has(request.employeeId));
}

function buildMissedCheckInAutomation() {
  const today = todayDateText();
  const employees = getEmployees();
  const attendance = getAttendanceRecords(today);
  const approvedLeave = getApprovedLeaveEmployees(today);
  const attendanceIds = new Set(attendance.map((record) => record.employeeId));
  const leaveIds = new Set(approvedLeave.map((request) => request.employeeId));
  const missed = employees.filter((employee) => !attendanceIds.has(employee.id) && !leaveIds.has(employee.id));
  const late = attendance.filter((record) => record.onTimeCheckIn === false);

  return {
    title: "Missed Check-In Follow-up",
    status: missed.length > 0 || late.length > 0 ? "attention" : "completed" as const,
    summary:
      missed.length > 0 || late.length > 0
        ? `${missed.length} employees missed check-in, ${late.length} checked in late`
        : "All employees are checked in on time today",
    details: [
      ...missed.map((employee) => `${employee.name} has not checked in and is not on approved leave.`),
      ...late.map((record) => `${record.employeeName} checked in late today.`),
      ...(missed.length === 0 && late.length === 0 ? ["No follow-up required today."] : []),
    ],
    count: missed.length + late.length,
  } satisfies AutomationResult;
}

function buildAbsenceSummaryAutomation() {
  const today = todayDateText();
  const employees = getEmployees();
  const attendance = getAttendanceRecords(today);
  const approvedLeave = getActiveApprovedLeaveEmployees(today);
  const attendanceIds = new Set(attendance.map((record) => record.employeeId));
  const leaveIds = new Set(approvedLeave.map((request) => request.employeeId));
  const absent = employees.filter((employee) => !attendanceIds.has(employee.id) && !leaveIds.has(employee.id));

  return {
    title: "Auto Absence Summary",
    status: "completed" as const,
    summary: `${attendance.length} checked in, ${approvedLeave.length} on leave, ${absent.length} absent`,
    details: [
      `Checked in: ${attendance.length}`,
      `Approved leave: ${approvedLeave.length}`,
      `Absent without approved leave: ${absent.length}`,
      ...absent.slice(0, 5).map((employee) => `${employee.name} is absent and needs follow-up.`),
    ],
    count: absent.length,
  } satisfies AutomationResult;
}

function buildWorkAnniversaryAutomation() {
  const today = todayDateText();
  const currentYear = new Date(today).getFullYear();
  const anniversaries = getEmployees()
    .filter((employee) => monthDay(employee.dateOfJoining) === monthDay(today))
    .map((employee) => ({
      ...employee,
      years: Math.max(1, currentYear - new Date(employee.dateOfJoining).getFullYear()),
    }));

  return {
    title: "Work Anniversary Automation",
    status: "completed" as const,
    summary: anniversaries.length > 0 ? `${anniversaries.length} work anniversaries today` : "No work anniversaries today",
    details:
      anniversaries.length > 0
        ? anniversaries.map((employee) => `${employee.name} completes ${employee.years} year(s) at Bonfiglioli today.`)
        : ["No anniversary wishes required today."],
    count: anniversaries.length,
  } satisfies AutomationResult;
}

function buildDayZeroOnboardingAutomation() {
  const today = todayDateText();
  const records = getOnboardingRecords().filter((record) => record.dateOfJoining === today);
  return {
    title: "Day-Zero Onboarding",
    status: records.length > 0 ? "attention" as const : "completed" as const,
    summary: records.length > 0 ? `${records.length} new joiners need day-zero actions` : "No day-zero onboarding actions today",
    details:
      records.length > 0
        ? records.map((record) => `${record.name}: welcome mail, document pack, IT setup, and buddy assignment should be active.`)
        : ["No new joiners scheduled for today."],
    count: records.length,
  } satisfies AutomationResult;
}

function buildDocumentChaseAutomation() {
  const today = todayDateText();
  const records = getOnboardingRecords().filter((record) => {
    const missing = Object.values(record.checklist).filter((value) => !value).length;
    return record.status !== "completed" && missing > 0 && daysBetween(record.createdAt, today) >= 2;
  });

  return {
    title: "Document Chase Automation",
    status: records.length > 0 ? "attention" as const : "completed" as const,
    summary: records.length > 0 ? `${records.length} onboarding records need document reminders` : "No overdue onboarding documents",
    details:
      records.length > 0
        ? records.map((record) => {
            const missing = Object.entries(record.checklist)
              .filter(([, value]) => !value)
              .map(([key]) => key)
              .join(", ");
            return `${record.name} is missing: ${missing}`;
          })
        : ["All current onboarding records are within SLA."],
    count: records.length,
  } satisfies AutomationResult;
}

function buildAttendanceCorrectionAutomation() {
  const requests = getRequests().filter((request) => request.kind === "attendance_correction");
  const pending = requests.filter((request) => request.status !== "approved" && request.status !== "rejected");
  return {
    title: "Attendance Correction Automation",
    status: pending.length > 0 ? "attention" as const : "completed" as const,
    summary: pending.length > 0 ? `${pending.length} attendance corrections need review` : "No pending attendance corrections",
    details:
      pending.length > 0
        ? pending.map((request) => `${request.employeeName}: ${request.reason}`)
        : ["No attendance correction backlog."],
    count: pending.length,
  } satisfies AutomationResult;
}

function buildMonthlyHrReportAutomation() {
  const monthPrefix = todayDateText().slice(0, 7);
  const requests = getRequests().filter((request) => request.createdAt.startsWith(monthPrefix));
  const onboarding = getOnboardingRecords().filter((record) => record.createdAt.startsWith(monthPrefix));
  const employees = getEmployees();

  return {
    title: "Monthly HR Report",
    status: "completed" as const,
    summary: `${requests.length} requests, ${onboarding.length} onboarding cases, ${employees.length} active employees`,
    details: [
      `Requests this month: ${requests.length}`,
      `Approved requests: ${requests.filter((request) => request.status === "approved").length}`,
      `Rejected requests: ${requests.filter((request) => request.status === "rejected").length}`,
      `Onboarding cases started this month: ${onboarding.length}`,
      `Total employees tracked: ${employees.length}`,
    ],
    count: requests.length,
  } satisfies AutomationResult;
}

function buildFestivalMailerAutomation() {
  const today = new Date(todayDateText());
  const festivals = [
    { date: `${today.getFullYear()}-05-01`, name: "May Day" },
    { date: `${today.getFullYear()}-08-15`, name: "Independence Day" },
    { date: `${today.getFullYear()}-10-20`, name: "Diwali Celebration" },
    { date: `${today.getFullYear()}-12-25`, name: "Christmas Wishes" },
  ];
  const upcoming = festivals.find((festival) => festival.date >= todayDateText()) ?? festivals[0];
  const recipients = getDeliverableEmployees();

  return {
    title: "Festival / Event Mailer",
    status: "completed" as const,
    summary: `${upcoming.name} draft ready for ${recipients.length} employees`,
    details: [
      `Upcoming event: ${upcoming.name}`,
      `Planned send date: ${upcoming.date}`,
      `Recipient count: ${recipients.length}`,
    ],
    count: recipients.length,
  } satisfies AutomationResult;
}

function buildProbationReminderAutomation() {
  const today = todayDateText();
  const checkpoints = [30, 60, 90];
  const reminders = getEmployees().flatMap((employee) => {
    const days = daysBetween(employee.dateOfJoining, today);
    if (!checkpoints.includes(days)) return [];
    return [`${employee.name} hits ${days}-day probation checkpoint today.`];
  });

  return {
    title: "Probation Reminder",
    status: reminders.length > 0 ? "attention" as const : "completed" as const,
    summary: reminders.length > 0 ? `${reminders.length} probation checkpoints due today` : "No probation reminders today",
    details: reminders.length > 0 ? reminders : ["No 30/60/90-day probation milestones today."],
    count: reminders.length,
  } satisfies AutomationResult;
}

function buildExitProcessAutomation() {
  const exitRequests = getRequests().filter(
    (request) =>
      request.kind === "other" &&
      `${request.title} ${request.reason}`.toLowerCase().match(/resign|exit|offboard|relieve/)
  );

  return {
    title: "Exit Process Automation",
    status: exitRequests.length > 0 ? "attention" as const : "completed" as const,
    summary: exitRequests.length > 0 ? `${exitRequests.length} exit cases need offboarding checklist` : "No active exit cases",
    details:
      exitRequests.length > 0
        ? exitRequests.map((request) => `${request.employeeName}: revoke access, asset return, final HR clearance.`)
        : ["Exit checklist is idle until a resignation or offboarding request appears."],
    count: exitRequests.length,
  } satisfies AutomationResult;
}

export function getAutomationSnapshot() {
  const cards = {
    missedCheckins: buildMissedCheckInAutomation(),
    absenceSummary: buildAbsenceSummaryAutomation(),
    anniversaries: buildWorkAnniversaryAutomation(),
    onboarding: buildDayZeroOnboardingAutomation(),
    documentChase: buildDocumentChaseAutomation(),
    attendanceCorrections: buildAttendanceCorrectionAutomation(),
    monthlyReport: buildMonthlyHrReportAutomation(),
    festivalMailer: buildFestivalMailerAutomation(),
    probation: buildProbationReminderAutomation(),
    exitProcess: buildExitProcessAutomation(),
  };

  return {
    cards,
    logs: readLogs().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12),
  };
}

export function runAutomation(action: AutomationAction) {
  const builders: Record<AutomationAction, () => AutomationResult> = {
    missed_checkin_followup: buildMissedCheckInAutomation,
    absence_summary: buildAbsenceSummaryAutomation,
    work_anniversary: buildWorkAnniversaryAutomation,
    day_zero_onboarding: buildDayZeroOnboardingAutomation,
    document_chase: buildDocumentChaseAutomation,
    attendance_correction: buildAttendanceCorrectionAutomation,
    monthly_hr_report: buildMonthlyHrReportAutomation,
    festival_mailer: buildFestivalMailerAutomation,
    probation_reminder: buildProbationReminderAutomation,
    exit_process: buildExitProcessAutomation,
  };

  const result = builders[action]();
  const log: AutomationLog = {
    id: `AUTO-${Date.now()}`,
    action,
    title: result.title,
    summary: result.summary,
    status: result.status,
    details: result.details,
    createdAt: new Date().toISOString(),
  };
  const logs = readLogs();
  logs.unshift(log);
  writeLogs(logs.slice(0, 50));
  return log;
}
