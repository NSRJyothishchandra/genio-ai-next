import { NextRequest } from "next/server";
import path from "path";
import fs from "fs";
import { getEmployees, getEmployee, addEmployee, generateNextEmployeeId, updateEmployee, deleteEmployee } from "@/lib/employees";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  const search = searchParams.get("search")?.toLowerCase();
  const position = searchParams.get("position");

  if (id) {
    const emp = getEmployee(id);
    if (!emp) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(emp);
  }

  let employees = getEmployees();

  if (search) {
    employees = employees.filter(
      (e) =>
        e.name.toLowerCase().includes(search) ||
        e.email.toLowerCase().includes(search) ||
        e.position.toLowerCase().includes(search) ||
        e.id.toLowerCase().includes(search)
    );
  }

  if (position) {
    employees = employees.filter((e) => e.position === position);
  }

  const positions = [...new Set(getEmployees().map((e) => e.position))];

  return Response.json({
    employees,
    total: employees.length,
    positions,
    stats: {
      total: getEmployees().length,
      byGender: {
        Male: getEmployees().filter((e) => e.gender === "Male").length,
        Female: getEmployees().filter((e) => e.gender === "Female").length,
      },
      byPosition: positions.reduce(
        (acc, p) => ({ ...acc, [p]: getEmployees().filter((e) => e.position === p).length }),
        {} as Record<string, number>
      ),
    },
  });
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();

  const get = (key: string) => (formData.get(key) as string | null)?.trim() ?? "";

  const required = ["name", "dob", "gender", "email", "phone", "position", "dateOfJoining", "address"];
  for (const field of required) {
    if (!get(field)) {
      return Response.json({ error: `Missing required field: ${field}` }, { status: 400 });
    }
  }

  const id = get("id") || generateNextEmployeeId();

  if (getEmployees().find((e) => e.id === id)) {
    return Response.json({ error: `Employee ID ${id} already exists` }, { status: 409 });
  }

  // Handle photo upload
  let photoUrl: string | undefined;
  const photoFile = formData.get("photo") as File | null;
  if (photoFile && photoFile.size > 0) {
    const ext = (photoFile.name.split(".").pop() ?? "jpg").toLowerCase();
    const allowed = ["jpg", "jpeg", "png", "webp", "gif"];
    if (allowed.includes(ext)) {
      const photoDir = path.join(process.cwd(), "public", "employee-photos");
      fs.mkdirSync(photoDir, { recursive: true });
      const buffer = Buffer.from(await photoFile.arrayBuffer());
      fs.writeFileSync(path.join(photoDir, `${id}.${ext}`), buffer);
      photoUrl = `/employee-photos/${id}.${ext}`;
    }
  }

  const employee = {
    id,
    name: get("name"),
    dob: get("dob"),
    gender: get("gender"),
    email: get("email"),
    phone: get("phone"),
    position: get("position"),
    dateOfJoining: get("dateOfJoining"),
    address: get("address"),
    ...(photoUrl ? { photoUrl } : {}),
  };

  addEmployee(employee);
  return Response.json({ success: true, employee }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  if (!getEmployee(id)) return Response.json({ error: "Employee not found" }, { status: 404 });

  const formData = await request.formData();
  const get = (key: string) => (formData.get(key) as string | null)?.trim() ?? "";

  const updates: Record<string, string> = {};
  for (const field of ["name", "dob", "gender", "email", "phone", "position", "dateOfJoining", "address"]) {
    const val = get(field);
    if (val) updates[field] = val;
  }

  // Handle photo replacement
  const photoFile = formData.get("photo") as File | null;
  if (photoFile && photoFile.size > 0) {
    const ext = (photoFile.name.split(".").pop() ?? "jpg").toLowerCase();
    const allowed = ["jpg", "jpeg", "png", "webp", "gif"];
    if (allowed.includes(ext)) {
      const photoDir = path.join(process.cwd(), "public", "employee-photos");
      fs.mkdirSync(photoDir, { recursive: true });
      // Remove old photo files with any extension
      for (const e of allowed) {
        const old = path.join(photoDir, `${id}.${e}`);
        if (fs.existsSync(old)) fs.unlinkSync(old);
      }
      const buffer = Buffer.from(await photoFile.arrayBuffer());
      fs.writeFileSync(path.join(photoDir, `${id}.${ext}`), buffer);
      updates.photoUrl = `/employee-photos/${id}.${ext}`;
    }
  }

  // Handle photo removal
  if (formData.get("removePhoto") === "true") {
    const photoDir = path.join(process.cwd(), "public", "employee-photos");
    for (const e of ["jpg", "jpeg", "png", "webp", "gif"]) {
      const old = path.join(photoDir, `${id}.${e}`);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }
    updates.photoUrl = "";
  }

  const updated = updateEmployee(id, updates);
  return Response.json({ success: true, employee: updated });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const emp = getEmployee(id);
  if (!emp) return Response.json({ error: "Employee not found" }, { status: 404 });

  // Delete photo file if exists
  if (emp.photoUrl) {
    const filePath = path.join(process.cwd(), "public", emp.photoUrl.replace(/^\//, ""));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  deleteEmployee(id);
  return Response.json({ success: true });
}
