import path from "path";
import * as XLSX from "xlsx";
import fs from "fs";

export interface Employee {
  id: string;
  name: string;
  dob: string; // ISO date string
  gender: string;
  email: string;
  phone: string;
  position: string;
  dateOfJoining: string; // ISO date string
  address: string;
  photoUrl?: string; // relative path e.g. /employee-photos/EMP001.jpg
}

export interface OnboardingRecord {
  employeeId: string;
  name: string;
  email: string;
  dob: string;
  position: string;
  dateOfJoining: string;
  status: "pending" | "in_progress" | "completed";
  checklist: {
    photo: boolean;
    aadhaar: boolean;
    pan: boolean;
    bankDetails: boolean;
    offerLetterSigned: boolean;
    ndaSigned: boolean;
    backgroundVerification: boolean;
    itSetup: boolean;
    welcomeEmailSent: boolean;
  };
  documents: string[]; // file names
  photoUrl: string | null;
  createdAt: string;
  updatedAt: string;
  notes: string;
}

function excelDateToISO(serial: number): string {
  // Excel dates are days since 1900-01-00 (with leap year bug)
  const date = new Date(Math.round((serial - 25569) * 86400000));
  return date.toISOString().split("T")[0];
}

let _employeeCache: Employee[] | null = null;

export function getEmployees(): Employee[] {
  const filePath = path.join(process.cwd(), "data", "employees.json");
  const xlsxPath = path.join(process.cwd(), "data", "Book.xlsx");

  // Once employees.json exists, treat it as the writable source of truth so
  // new hires created from the app don't disappear behind the Excel import.
  if (_employeeCache && fs.existsSync(filePath)) {
    return _employeeCache;
  }

  if (!_employeeCache && fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, "utf-8");
    _employeeCache = JSON.parse(raw);
    return _employeeCache!;
  }

  // Fall back to Excel (cache is stale or missing)
  if (!fs.existsSync(xlsxPath)) return getSeedEmployees();

  const wb = XLSX.readFile(xlsxPath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

  const employees: Employee[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row[0]) continue;
    employees.push({
      id: String(row[0]),
      name: String(row[1]),
      dob: typeof row[2] === "number" ? excelDateToISO(row[2]) : String(row[2]),
      gender: String(row[3]),
      email: String(row[4]),
      phone: String(row[5]),
      position: String(row[6]),
      dateOfJoining: typeof row[7] === "number" ? excelDateToISO(row[7]) : String(row[7]),
      address: String(row[8]),
    });
  }

  // Persist as JSON for fast future reads
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(employees, null, 2));

  _employeeCache = employees;
  return employees;
}

export function getEmployee(id: string): Employee | undefined {
  return getEmployees().find((e) => e.id === id);
}

export function clearEmployeeCache(): void {
  _employeeCache = null;
}

export function addEmployee(employee: Employee): void {
  const all = getEmployees(); // loads into cache
  all.push(employee);
  const filePath = path.join(process.cwd(), "data", "employees.json");
  fs.writeFileSync(filePath, JSON.stringify(all, null, 2));
  _employeeCache = all;
}

export function updateEmployee(id: string, updates: Partial<Employee>): Employee | null {
  const all = getEmployees();
  const idx = all.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...updates };
  const filePath = path.join(process.cwd(), "data", "employees.json");
  fs.writeFileSync(filePath, JSON.stringify(all, null, 2));
  _employeeCache = all;
  return all[idx];
}

export function deleteEmployee(id: string): boolean {
  const all = getEmployees();
  const idx = all.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  all.splice(idx, 1);
  const filePath = path.join(process.cwd(), "data", "employees.json");
  fs.writeFileSync(filePath, JSON.stringify(all, null, 2));
  _employeeCache = all;
  return true;
}

export function generateNextEmployeeId(): string {
  const employees = getEmployees();
  const nums = employees
    .map((e) => {
      const m = e.id.match(/^EMP(\d+)$/i);
      return m ? parseInt(m[1], 10) : 0;
    })
    .filter((n) => n > 0);
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `EMP${String(next).padStart(3, "0")}`;
}

export function getTodaysBirthdays(): Employee[] {
  const today = new Date();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return getEmployees().filter((e) => {
    const [, m, d] = e.dob.split("-");
    return m === mm && d === dd;
  });
}

export function getUpcomingBirthdays(days = 7): (Employee & { daysUntil: number })[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const results: (Employee & { daysUntil: number })[] = [];

  for (const emp of getEmployees()) {
    const [, m, d] = emp.dob.split("-");
    const thisYear = new Date(today.getFullYear(), parseInt(m) - 1, parseInt(d));
    let diff = Math.floor((thisYear.getTime() - today.getTime()) / 86400000);
    if (diff < 0) {
      const nextYear = new Date(today.getFullYear() + 1, parseInt(m) - 1, parseInt(d));
      diff = Math.floor((nextYear.getTime() - today.getTime()) / 86400000);
    }
    if (diff <= days) {
      results.push({ ...emp, daysUntil: diff });
    }
  }
  return results.sort((a, b) => a.daysUntil - b.daysUntil);
}

const ONBOARDING_FILE = path.join(process.cwd(), "data", "onboarding-records.json");

function ensureDataDir() {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function readOnboardingStore(): Map<string, OnboardingRecord> {
  ensureDataDir();
  if (!fs.existsSync(ONBOARDING_FILE)) return new Map();

  try {
    const raw = fs.readFileSync(ONBOARDING_FILE, "utf-8");
    const records = JSON.parse(raw) as OnboardingRecord[];
    return new Map(records.map((record) => [record.employeeId, record]));
  } catch {
    return new Map();
  }
}

function writeOnboardingStore(store: Map<string, OnboardingRecord>) {
  ensureDataDir();
  fs.writeFileSync(ONBOARDING_FILE, JSON.stringify(Array.from(store.values()), null, 2));
}

export function getOnboardingRecords(): OnboardingRecord[] {
  return Array.from(readOnboardingStore().values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getOnboardingRecord(employeeId: string): OnboardingRecord | undefined {
  return readOnboardingStore().get(employeeId);
}

export function upsertOnboardingRecord(record: Partial<OnboardingRecord> & { employeeId: string }): OnboardingRecord {
  const store = readOnboardingStore();
  const existing = store.get(record.employeeId);
  const updated: OnboardingRecord = {
    employeeId: record.employeeId,
    name: record.name ?? existing?.name ?? "",
    email: record.email ?? existing?.email ?? "",
    dob: record.dob ?? existing?.dob ?? "",
    position: record.position ?? existing?.position ?? "",
    dateOfJoining: record.dateOfJoining ?? existing?.dateOfJoining ?? "",
    status: record.status ?? existing?.status ?? "pending",
    checklist: { ...(existing?.checklist ?? defaultChecklist()), ...(record.checklist ?? {}) },
    documents: record.documents ?? existing?.documents ?? [],
    photoUrl: record.photoUrl ?? existing?.photoUrl ?? null,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notes: record.notes ?? existing?.notes ?? "",
  };
  store.set(record.employeeId, updated);
  writeOnboardingStore(store);
  return updated;
}

function defaultChecklist() {
  return {
    photo: false,
    aadhaar: false,
    pan: false,
    bankDetails: false,
    offerLetterSigned: false,
    ndaSigned: false,
    backgroundVerification: false,
    itSetup: false,
    welcomeEmailSent: false,
  };
}

function getSeedEmployees(): Employee[] {
  return [
    { id: "EMP001", name: "Aarav Sharma", dob: "1995-03-13", gender: "Male", email: "aarav.sharma1@test.com", phone: "9876543210", position: "Software Engineer", dateOfJoining: "2022-06-01", address: "Chennai" },
    { id: "EMP002", name: "Diya Patel", dob: "1996-07-28", gender: "Female", email: "diya.patel2@test.com", phone: "9876543211", position: "HR Executive", dateOfJoining: "2021-03-15", address: "Mumbai" },
    { id: "EMP003", name: "Rohan Mehta", dob: "1994-12-10", gender: "Male", email: "rohan.mehta3@test.com", phone: "9876543212", position: "Project Manager", dateOfJoining: "2020-01-05", address: "Bangalore" },
  ];
}
