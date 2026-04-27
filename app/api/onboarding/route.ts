import { NextRequest } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import {
  addEmployee,
  generateNextEmployeeId,
  getEmployee,
  getOnboardingRecord,
  getOnboardingRecords,
  updateEmployee,
  upsertOnboardingRecord,
} from "@/lib/employees";
import { sendDocumentRequestEmail, sendOnboardingEmail } from "@/lib/email";

function getDesktopOnboardingDir(employeeName: string) {
  const safeName = employeeName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").trim() || "Employee";
  return path.join(os.homedir(), "Desktop", "Bonfiglioli Onboarding Files", safeName);
}

async function saveUploadedFile(employeeName: string, file: File, preferredName?: string) {
  const targetDir = getDesktopOnboardingDir(employeeName);
  fs.mkdirSync(targetDir, { recursive: true });
  const ext = path.extname(file.name) || path.extname(preferredName ?? "");
  const baseName = path.basename(preferredName ?? file.name, ext) || "document";
  const sanitizedBase = baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").trim() || "document";
  const finalName = `${sanitizedBase}${ext}`;
  const finalPath = path.join(targetDir, finalName);
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(finalPath, buffer);
  return { finalName, finalPath };
}

async function saveEmployeePhotoForApp(employeeId: string, file: File) {
  const extension = path.extname(file.name) || ".png";
  const photoDir = path.join(process.cwd(), "public", "employee-photos");
  fs.mkdirSync(photoDir, { recursive: true });
  const finalName = `${employeeId}${extension}`;
  const finalPath = path.join(photoDir, finalName);
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(finalPath, buffer);
  return `/employee-photos/${finalName}`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");

  if (id) {
    const record = getOnboardingRecord(id);
    if (!record) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(record);
  }

  const records = getOnboardingRecords();
  return Response.json({
    records,
    stats: {
      total: records.length,
      pending: records.filter((record) => record.status === "pending").length,
      inProgress: records.filter((record) => record.status === "in_progress").length,
      completed: records.filter((record) => record.status === "completed").length,
    },
  });
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const action = String(formData.get("action") ?? "");
    const employeeId = String(formData.get("employeeId") ?? "");
    const file = formData.get("file") as File | null;
    const employee = getOnboardingRecord(employeeId);

    if (!employeeId || !employee) {
      return Response.json({ error: "Onboarding record not found" }, { status: 404 });
    }

    if (!file || file.size === 0) {
      return Response.json({ error: "File is required" }, { status: 400 });
    }

    if (action === "set_photo") {
      const ext = path.extname(file.name) || ".png";
      const preferredName = `photo${ext}`;
      const saved = await saveUploadedFile(employee.name, file, preferredName);
      const appPhotoUrl = await saveEmployeePhotoForApp(employeeId, file);
      const record = upsertOnboardingRecord({
        employeeId,
        photoUrl: appPhotoUrl,
        checklist: { photo: true } as never,
      });

      updateEmployee(employeeId, { photoUrl: appPhotoUrl });
      return Response.json({ record, savedPath: saved.finalPath });
    }

    if (action === "add_document") {
      const docType = String(formData.get("docType") ?? "");
      const saved = await saveUploadedFile(employee.name, file);
      const existing = getOnboardingRecord(employeeId);
      const record = upsertOnboardingRecord({
        employeeId,
        documents: [...(existing?.documents ?? []), saved.finalName],
        checklist: docType ? ({ [docType]: true } as never) : undefined,
      });

      return Response.json({ record, savedPath: saved.finalPath });
    }

    return Response.json({ error: "Unknown upload action" }, { status: 400 });
  }

  const body = await request.json();
  const { action, ...data } = body;

  if (action === "start") {
    const employeeId = data.employeeId?.trim() || generateNextEmployeeId();
    const existingEmployee = getEmployee(employeeId);

    if (existingEmployee) {
      updateEmployee(employeeId, {
        name: data.name,
        email: data.email,
        dob: data.dob,
        position: data.position,
        dateOfJoining: data.dateOfJoining,
      });
    } else {
      addEmployee({
        id: employeeId,
        name: data.name,
        dob: data.dob,
        gender: data.gender || "Other",
        email: data.email,
        phone: data.phone || "",
        position: data.position,
        dateOfJoining: data.dateOfJoining,
        address: data.address || "",
      });
    }

    fs.mkdirSync(getDesktopOnboardingDir(data.name), { recursive: true });

    const record = upsertOnboardingRecord({
      employeeId,
      name: data.name,
      email: data.email,
      dob: data.dob,
      position: data.position,
      dateOfJoining: data.dateOfJoining,
      status: "in_progress",
      checklist: { welcomeEmailSent: true } as never,
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    await sendOnboardingEmail(data.email, data.name, `${appUrl}/onboarding/${employeeId}`);

    if (process.env.N8N_ONBOARDING_STARTED_WEBHOOK ?? process.env.N8N_ONBOARDING_WEBHOOK) {
      fetch(process.env.N8N_ONBOARDING_STARTED_WEBHOOK ?? process.env.N8N_ONBOARDING_WEBHOOK!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "onboarding_started", employee: record }),
      }).catch(console.error);
    }

    return Response.json({ record, emailSent: true });
  }

  if (action === "update_checklist") {
    const record = upsertOnboardingRecord({
      employeeId: data.employeeId,
      checklist: data.checklist,
    });

    const allDone = Object.values(record.checklist).every(Boolean);
    const finalized = allDone
      ? upsertOnboardingRecord({ employeeId: data.employeeId, status: "completed" })
      : record;

    return Response.json({ record: finalized });
  }

  if (action === "request_documents") {
    const record = getOnboardingRecord(data.employeeId);
    if (!record) return Response.json({ error: "Record not found" }, { status: 404 });

    const docNames: Record<string, string> = {
      aadhaar: "Aadhaar Card",
      pan: "PAN Card",
      bankDetails: "Bank Account Details",
      offerLetterSigned: "Signed Offer Letter",
      ndaSigned: "Signed NDA",
      photo: "Professional Photo",
    };

    const missing = Object.entries(record.checklist)
      .filter(([, value]) => !value)
      .map(([key]) => docNames[key] ?? key);

    if (missing.length === 0) {
      return Response.json({ message: "All documents already submitted" });
    }

    await sendDocumentRequestEmail(record.email, record.name, missing);
    return Response.json({ sent: true, missing });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
