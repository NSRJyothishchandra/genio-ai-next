import path from "path";
import * as XLSX from "xlsx";
import fs from "fs";
import { getEmployees } from "./employees";

export interface TimesheetEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  taskNo: string;
  description: string;
  status: string;
  estimatedHours: number;
  actualHours: number;
  date: string;
  month: string;
  year: number;
  projectNo?: string;
}

export interface TimesheetSummary {
  employeeId: string;
  employeeName: string;
  month: string;
  year: number;
  totalEstimated: number;
  totalActual: number;
  entries: TimesheetEntry[];
}

export type AttendanceAction = "check_in" | "lunch_start" | "lunch_end" | "check_out";

export interface AttendanceEvent {
  action: AttendanceAction;
  timestamp: string;
  label: string;
}

export interface AttendanceRecord {
  employeeId: string;
  employeeName: string;
  date: string;
  checkInAt: string | null;
  lunchStartAt: string | null;
  lunchEndAt: string | null;
  checkOutAt: string | null;
  officeHours: number;
  onTimeCheckIn: boolean | null;
  completedDay: boolean;
  status: "not_started" | "checked_in" | "at_lunch" | "checked_out";
  notifications: AttendanceEvent[];
}

const TIMESHEET_FILE = path.join(process.cwd(), "data", "timesheets.json");
const ATTENDANCE_FILE = path.join(process.cwd(), "data", "attendance.json");
const TIMEZONE = "Asia/Kolkata";
const REQUIRED_OFFICE_HOURS = 9.5;
const LATEST_CHECK_IN_HOUR = 11;
const LATEST_CHECK_IN_MINUTE = 30;
const INDIA_OFFSET = "+05:30";

function ensureDataFile(filePath: string, emptyValue: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, emptyValue);
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  ensureDataFile(filePath, JSON.stringify(fallback, null, 2));
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile<T>(filePath: string, value: T) {
  ensureDataFile(filePath, JSON.stringify(value, null, 2));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function getNowParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  ) as Record<string, string>;

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    hour: Number(parts.hour ?? "0"),
    minute: Number(parts.minute ?? "0"),
  };
}

function formatStamp(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIMEZONE,
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(iso));
}

function createIsoForDateTime(date: string, hour: number, minute: number) {
  return new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${INDIA_OFFSET}`).toISOString();
}

function hashText(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function randomMinutesInRange(seed: number, min: number, max: number) {
  const span = max - min + 1;
  return min + (seed % span);
}

function toHours(start: string | null, end: string | null) {
  if (!start || !end) return 0;
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(0, Number((diffMs / (1000 * 60 * 60)).toFixed(2)));
}

function readTimesheetEntries(): TimesheetEntry[] {
  return readJsonFile<TimesheetEntry[]>(TIMESHEET_FILE, []);
}

function writeTimesheetEntries(entries: TimesheetEntry[]) {
  writeJsonFile(TIMESHEET_FILE, entries);
}

function readAttendanceRecords(): AttendanceRecord[] {
  return readJsonFile<AttendanceRecord[]>(ATTENDANCE_FILE, []);
}

function writeAttendanceRecords(records: AttendanceRecord[]) {
  writeJsonFile(ATTENDANCE_FILE, records);
}

function isOnTimeCheckIn(now: ReturnType<typeof getNowParts>) {
  const currentMinuteOfDay = now.hour * 60 + now.minute;
  const deadlineMinuteOfDay = LATEST_CHECK_IN_HOUR * 60 + LATEST_CHECK_IN_MINUTE;
  return currentMinuteOfDay <= deadlineMinuteOfDay;
}

function getAttendanceStatus(record: AttendanceRecord): AttendanceRecord["status"] {
  if (record.checkOutAt) return "checked_out";
  if (record.lunchStartAt && !record.lunchEndAt) return "at_lunch";
  if (record.checkInAt) return "checked_in";
  return "not_started";
}

function createAttendanceNotification(action: AttendanceAction, employeeName: string, isoTimestamp: string) {
  const labelByAction: Record<AttendanceAction, string> = {
    check_in: `${employeeName} checked in at ${formatStamp(isoTimestamp)}`,
    lunch_start: `${employeeName} started lunch break at ${formatStamp(isoTimestamp)}`,
    lunch_end: `${employeeName} returned from lunch at ${formatStamp(isoTimestamp)}`,
    check_out: `${employeeName} checked out at ${formatStamp(isoTimestamp)}`,
  };

  return {
    action,
    timestamp: isoTimestamp,
    label: labelByAction[action],
  };
}

function baseAttendanceRecord(employeeId: string, employeeName: string, date: string): AttendanceRecord {
  return {
    employeeId,
    employeeName,
    date,
    checkInAt: null,
    lunchStartAt: null,
    lunchEndAt: null,
    checkOutAt: null,
    officeHours: 0,
    onTimeCheckIn: null,
    completedDay: false,
    status: "not_started",
    notifications: [],
  };
}

export function addTimesheetEntry(entry: Omit<TimesheetEntry, "id">): TimesheetEntry {
  const entries = readTimesheetEntries();
  const newEntry = { ...entry, id: `TS-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
  entries.push(newEntry);
  writeTimesheetEntries(entries);
  return newEntry;
}

export function getTimesheetEntries(employeeId?: string, month?: string, year?: number): TimesheetEntry[] {
  return readTimesheetEntries().filter((entry) => {
    if (employeeId && entry.employeeId !== employeeId) return false;
    if (month && entry.month !== month) return false;
    if (year && entry.year !== year) return false;
    return true;
  });
}

export function getAttendanceRecords(date?: string): AttendanceRecord[] {
  const targetDate = date ?? getNowParts().date;
  return readAttendanceRecords()
    .filter((record) => record.date === targetDate)
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

export function markAttendanceEvent(employeeId: string, employeeName: string, action: AttendanceAction) {
  const records = readAttendanceRecords();
  const nowIso = new Date().toISOString();
  const nowParts = getNowParts();
  const recordDate = nowParts.date;
  const index = records.findIndex((record) => record.employeeId === employeeId && record.date === recordDate);
  const record = index >= 0 ? records[index] : baseAttendanceRecord(employeeId, employeeName, recordDate);

  if (action === "check_in") {
    if (record.checkInAt) throw new Error("Employee already checked in today");
    record.checkInAt = nowIso;
    record.onTimeCheckIn = isOnTimeCheckIn(nowParts);
  }

  if (action === "lunch_start") {
    if (!record.checkInAt) throw new Error("Employee must check in before starting lunch");
    if (record.lunchStartAt) throw new Error("Lunch break already started");
    if (record.checkOutAt) throw new Error("Employee already checked out");
    record.lunchStartAt = nowIso;
  }

  if (action === "lunch_end") {
    if (!record.lunchStartAt) throw new Error("Lunch break has not started yet");
    if (record.lunchEndAt) throw new Error("Lunch break already ended");
    if (record.checkOutAt) throw new Error("Employee already checked out");
    record.lunchEndAt = nowIso;
  }

  if (action === "check_out") {
    if (!record.checkInAt) throw new Error("Employee must check in before checking out");
    if (record.checkOutAt) throw new Error("Employee already checked out today");
    if (record.lunchStartAt && !record.lunchEndAt) throw new Error("Employee must end lunch before checking out");
    record.checkOutAt = nowIso;
  }

  record.officeHours = toHours(record.checkInAt, record.checkOutAt);
  record.completedDay = record.officeHours >= REQUIRED_OFFICE_HOURS;
  record.status = getAttendanceStatus(record);
  record.notifications = [createAttendanceNotification(action, employeeName, nowIso), ...record.notifications];

  if (index >= 0) {
    records[index] = record;
  } else {
    records.push(record);
  }

  writeAttendanceRecords(records);
  return record;
}

export function getAttendanceSummary(date?: string) {
  const records = getAttendanceRecords(date);
  return {
    totalTracked: records.length,
    checkedIn: records.filter((record) => Boolean(record.checkInAt)).length,
    lateCheckIns: records.filter((record) => record.onTimeCheckIn === false).length,
    checkedOut: records.filter((record) => Boolean(record.checkOutAt)).length,
    completedOfficeHours: records.filter((record) => record.completedDay).length,
    requiredOfficeHours: REQUIRED_OFFICE_HOURS,
    latestCheckIn: "11:30",
    lunchBreakHours: 1,
  };
}

export function generateDemoAttendance(date?: string) {
  const targetDate = date ?? getNowParts().date;
  const employees = getEmployees();
  const records = readAttendanceRecords().filter((record) => record.date !== targetDate);
  const generated: AttendanceRecord[] = [];

  for (const employee of employees) {
    const seed = hashText(`${targetDate}-${employee.id}`);
    const checkInMinutes = randomMinutesInRange(seed, 8 * 60 + 45, 11 * 60 + 20);
    const lunchStartMinutes = Math.max(checkInMinutes + 180, randomMinutesInRange(seed >> 1, 13 * 60, 14 * 60 + 15));
    const lunchEndMinutes = lunchStartMinutes + 60;
    const checkOutMinutes = checkInMinutes + 570;

    const checkInAt = createIsoForDateTime(targetDate, Math.floor(checkInMinutes / 60), checkInMinutes % 60);
    const lunchStartAt = createIsoForDateTime(targetDate, Math.floor(lunchStartMinutes / 60), lunchStartMinutes % 60);
    const lunchEndAt = createIsoForDateTime(targetDate, Math.floor(lunchEndMinutes / 60), lunchEndMinutes % 60);
    const checkOutAt = createIsoForDateTime(targetDate, Math.floor(checkOutMinutes / 60), checkOutMinutes % 60);

    const record: AttendanceRecord = {
      employeeId: employee.id,
      employeeName: employee.name,
      date: targetDate,
      checkInAt,
      lunchStartAt,
      lunchEndAt,
      checkOutAt,
      officeHours: REQUIRED_OFFICE_HOURS,
      onTimeCheckIn: true,
      completedDay: true,
      status: "checked_out",
      notifications: [
        createAttendanceNotification("check_out", employee.name, checkOutAt),
        createAttendanceNotification("lunch_end", employee.name, lunchEndAt),
        createAttendanceNotification("lunch_start", employee.name, lunchStartAt),
        createAttendanceNotification("check_in", employee.name, checkInAt),
      ],
    };

    generated.push(record);
  }

  writeAttendanceRecords([...records, ...generated]);
  return generated.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

export function getTimesheetFromExcel(): TimesheetSummary[] {
  const xlsxPath = path.join(process.cwd(), "data", "Project Tracker_2026_Projecta V0.1.xlsm");
  if (!fs.existsSync(xlsxPath)) return [];

  const wb = XLSX.readFile(xlsxPath);
  const employeeSheets = ["Mounika Chitrala", "Jyothish Chandra", "Aslam Khan"];
  const summaries: TimesheetSummary[] = [];

  for (const sheetName of employeeSheets) {
    if (!wb.SheetNames.includes(sheetName)) continue;
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 }) as unknown[][];
    const entries: TimesheetEntry[] = [];

    for (let i = 3; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      if (!row[1] || row[1] === null) continue;
      entries.push({
        id: `${sheetName}-${i}`,
        employeeId: sheetName,
        employeeName: sheetName,
        taskNo: String(row[1] ?? ""),
        description: String(row[2] ?? ""),
        status: String(row[3] ?? ""),
        estimatedHours: Number(row[4]) || 0,
        actualHours: Number(row[5]) || 0,
        date: new Date().toISOString().split("T")[0],
        month: new Date().toLocaleString("default", { month: "long" }),
        year: new Date().getFullYear(),
      });
    }

    summaries.push({
      employeeId: sheetName,
      employeeName: sheetName,
      month: new Date().toLocaleString("default", { month: "long" }),
      year: new Date().getFullYear(),
      totalEstimated: entries.reduce((sum, entry) => sum + entry.estimatedHours, 0),
      totalActual: entries.reduce((sum, entry) => sum + entry.actualHours, 0),
      entries,
    });
  }

  return summaries;
}

export function exportTimesheetToExcel(entries: TimesheetEntry[], employeeName: string): Buffer {
  const wb = XLSX.utils.book_new();
  const header = ["S.No", "Task No", "Description", "Status", "Estimated Hours", "Actual Hours", "Date", "Month", "Year"];
  const data = [
    header,
    ...entries.map((entry, index) => [
      index + 1,
      entry.taskNo,
      entry.description,
      entry.status,
      entry.estimatedHours,
      entry.actualHours,
      entry.date,
      entry.month,
      entry.year,
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 6 }, { wch: 14 }, { wch: 40 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 6 }];
  XLSX.utils.book_append_sheet(wb, ws, employeeName.slice(0, 30));
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
