import fs from "fs";
import path from "path";

export type RequestKind = "leave" | "attendance_correction" | "other";
export type RequestStatus = "pending_manager" | "pending_admin" | "approved" | "rejected";

export interface EmployeeRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  kind: RequestKind;
  leaveType?: "sick" | "casual" | "annual";
  title: string;
  reason: string;
  startDate: string | null;
  endDate: string | null;
  status: RequestStatus;
  managerDecisionAt: string | null;
  adminDecisionAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const REQUESTS_FILE = path.join(process.cwd(), "data", "requests.json");

function ensureRequestsFile() {
  const dir = path.dirname(REQUESTS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(REQUESTS_FILE)) fs.writeFileSync(REQUESTS_FILE, "[]");
}

function readRequests(): EmployeeRequest[] {
  ensureRequestsFile();
  try {
    return JSON.parse(fs.readFileSync(REQUESTS_FILE, "utf-8")) as EmployeeRequest[];
  } catch {
    return [];
  }
}

function writeRequests(requests: EmployeeRequest[]) {
  ensureRequestsFile();
  fs.writeFileSync(REQUESTS_FILE, JSON.stringify(requests, null, 2));
}

export function getRequests(): EmployeeRequest[] {
  return readRequests().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createRequest(
  input: Omit<EmployeeRequest, "id" | "status" | "managerDecisionAt" | "adminDecisionAt" | "createdAt" | "updatedAt"> & {
    initialStatus?: RequestStatus;
  }
) {
  const requests = readRequests();
  const now = new Date().toISOString();
  const status = input.initialStatus ?? "pending_manager";
  const record: EmployeeRequest = {
    id: `REQ-${Date.now()}`,
    ...input,
    status,
    managerDecisionAt: status === "approved" ? now : null,
    adminDecisionAt: status === "approved" ? now : null,
    createdAt: now,
    updatedAt: now,
  };
  requests.push(record);
  writeRequests(requests);
  return record;
}

export function updateRequestStatus(id: string, actor: "manager" | "admin", decision: "approve" | "reject") {
  const requests = readRequests();
  const index = requests.findIndex((request) => request.id === id);
  if (index === -1) return null;

  const now = new Date().toISOString();
  const current = requests[index];

  if (actor === "manager") {
    current.status = decision === "approve" ? "pending_admin" : "rejected";
    current.managerDecisionAt = now;
  } else {
    current.status = decision === "approve" ? "approved" : "rejected";
    current.adminDecisionAt = now;
  }

  current.updatedAt = now;
  requests[index] = current;
  writeRequests(requests);
  return current;
}
