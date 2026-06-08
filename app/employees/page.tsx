"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { requestVoiceControl } from "@/app/components/VoiceButton";
import { useVoiceCommand } from "@/app/hooks/useVoiceCommand";

interface Employee {
  id: string; name: string; dob: string; gender: string;
  email: string; phone: string; position: string;
  dateOfJoining: string; address: string; photoUrl?: string;
}

const EMPTY_FORM = {
  id: "", name: "", dob: "", gender: "Male", email: "",
  phone: "", position: "", dateOfJoining: "", address: "",
};

function age(dob: string) {
  const d = new Date(dob);
  const today = new Date();
  let a = today.getFullYear() - d.getFullYear();
  if (today.getMonth() < d.getMonth() || (today.getMonth() === d.getMonth() && today.getDate() < d.getDate())) a--;
  return a;
}

const positionColors: Record<string, string> = {
  "Software Engineer": "badge-blue", "HR Executive": "badge-purple", "Project Manager": "badge-green",
  "UI Designer": "badge-yellow", "QA Engineer": "badge-gray", "Business Analyst": "badge-blue",
  "DevOps Engineer": "badge-red", "Backend Developer": "badge-blue", "Data Analyst": "badge-purple",
  "HR Manager": "badge-green",
};

function PhotoPicker({ preview, onPick, onRemove, fileRef }: {
  preview: string | null;
  onPick: (f: File) => void;
  onRemove: () => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, padding: "12px 16px", background: "var(--bg-secondary)", borderRadius: 10 }}>
      <div
        onClick={() => fileRef.current?.click()}
        style={{
          width: 72, height: 72, borderRadius: "50%", cursor: "pointer",
          border: "2px dashed var(--border)", display: "flex", alignItems: "center",
          justifyContent: "center", overflow: "hidden", flexShrink: 0,
          background: preview ? "transparent" : "var(--bg)",
        }}
      >
        {preview
          ? <img src={preview} alt="preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <span style={{ fontSize: 24 }}>📷</span>
        }
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Employee Photo</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>Used in birthday cards. JPG, PNG or WebP.</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>
            {preview ? "Change" : "Upload"}
          </button>
          {preview && (
            <button type="button" className="btn btn-outline btn-sm" onClick={onRemove}>Remove</button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); }}
        />
      </div>
    </div>
  );
}

function FieldGrid({ form, onChange, positions, readonlyId }: {
  form: typeof EMPTY_FORM;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  positions: string[];
  readonlyId?: boolean;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>
          Employee ID {!readonlyId && <span style={{ fontWeight: 400 }}>(auto if blank)</span>}
        </label>
        <input className="form-input" name="id" placeholder="EMP051" value={form.id} onChange={onChange} readOnly={readonlyId} style={readonlyId ? { opacity: 0.6 } : {}} />
      </div>
      {[
        { name: "name", label: "Full Name", placeholder: "Full name", required: true },
        { name: "email", label: "Email", placeholder: "email@company.com", required: true, type: "email" },
        { name: "phone", label: "Phone", placeholder: "9876543210", required: true },
        { name: "address", label: "Address", placeholder: "City / Address", required: true },
      ].map(({ name, label, placeholder, required, type }) => (
        <div key={name}>
          <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>
            {label} {required && <span style={{ color: "red" }}>*</span>}
          </label>
          <input type={type ?? "text"} className="form-input" name={name} placeholder={placeholder}
            value={(form as Record<string, string>)[name]} onChange={onChange} required={required} />
        </div>
      ))}
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>
          Date of Birth <span style={{ color: "red" }}>*</span>
        </label>
        <input type="date" className="form-input" name="dob" value={form.dob} onChange={onChange} required />
      </div>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>
          Gender <span style={{ color: "red" }}>*</span>
        </label>
        <select className="form-select" name="gender" value={form.gender} onChange={onChange} required>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>
          Position <span style={{ color: "red" }}>*</span>
        </label>
        <input className="form-input" name="position" placeholder="e.g. Software Engineer"
          value={form.position} onChange={onChange} list="pos-list" required />
        <datalist id="pos-list">{positions.map((p) => <option key={p} value={p} />)}</datalist>
      </div>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>
          Date of Joining <span style={{ color: "red" }}>*</span>
        </label>
        <input type="date" className="form-input" name="dateOfJoining" value={form.dateOfJoining} onChange={onChange} required />
      </div>
    </div>
  );
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [positions, setPositions] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [filterPosition, setFilterPosition] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({ ...EMPTY_FORM });
  const [editPhotoPreview, setEditPhotoPreview] = useState<string | null>(null);
  const [editPhotoFile, setEditPhotoFile] = useState<File | null>(null);
  const [editRemovePhoto, setEditRemovePhoto] = useState(false);
  const editFileRef = useRef<HTMLInputElement>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  async function createEmployeeFromVoice(payload: Record<string, unknown>) {
    const fd = new FormData();
    for (const field of ["id", "name", "dob", "gender", "email", "phone", "position", "dateOfJoining", "address"]) {
      const value = String(payload[field] ?? "").trim();
      if (value) fd.append(field, value);
    }

    try {
      const res = await fetch("/api/employees", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        requestVoiceControl({
          channel: "global",
          type: "speak",
          message: data.error ?? "I couldn't create the employee.",
        });
        if (data.error) setFormError(data.error);
        return;
      }

      setShowAddForm(false);
      resetAddForm();
      loadEmployees();
      showToast(`${data.employee.name} added successfully`);
      requestVoiceControl({
        channel: "global",
        type: "speak",
        message: `${data.employee.name} was added successfully.`,
      });
    } catch {
      requestVoiceControl({
        channel: "global",
        type: "speak",
        message: "I couldn't create the employee right now.",
      });
    }
  }

  function loadEmployees() {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (filterPosition) params.set("position", filterPosition);
    fetch(`/api/employees?${params}`).then((r) => r.json()).then((d) => {
      setEmployees(d.employees ?? []);
      setPositions(d.positions ?? []);
      setLoading(false);
    });
  }

  useEffect(() => { loadEmployees(); }, [search, filterPosition]);

  useVoiceCommand(useCallback((action) => {
    const p = action.params;
    switch (action.action) {
      case "search":
        setSearch(String(p.query ?? ""));
        break;
      case "filter_position":
        setFilterPosition(String(p.position ?? ""));
        break;
      case "show_employee":
        setSearch(String(p.name ?? ""));
        break;
      case "add_employee":
        setShowAddForm(true);
        break;
      case "create_employee":
        setShowAddForm(true);
        setForm((previous) => ({
          ...previous,
          id: String(p.id ?? previous.id ?? ""),
          name: String(p.name ?? previous.name ?? ""),
          dob: String(p.dob ?? previous.dob ?? ""),
          gender: String(p.gender ?? previous.gender ?? "Male"),
          email: String(p.email ?? previous.email ?? ""),
          phone: String(p.phone ?? previous.phone ?? ""),
          position: String(p.position ?? previous.position ?? ""),
          dateOfJoining: String(p.dateOfJoining ?? previous.dateOfJoining ?? ""),
          address: String(p.address ?? previous.address ?? ""),
        }));
        void createEmployeeFromVoice(p as Record<string, unknown>);
        break;
      case "clear_filter":
        setSearch("");
        setFilterPosition("");
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  function resetAddForm() {
    setForm({ ...EMPTY_FORM });
    setPhotoFile(null);
    setPhotoPreview(null);
    setFormError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function enterEditMode(emp: Employee) {
    setEditForm({
      id: emp.id, name: emp.name, dob: emp.dob, gender: emp.gender,
      email: emp.email, phone: emp.phone, position: emp.position,
      dateOfJoining: emp.dateOfJoining, address: emp.address,
    });
    setEditPhotoPreview(emp.photoUrl ? emp.photoUrl : null);
    setEditPhotoFile(null);
    setEditRemovePhoto(false);
    setFormError(null);
    setEditMode(true);
  }

  function selectEmployee(emp: Employee) {
    setSelected(emp);
    setEditMode(false);
    setConfirmDelete(false);
    setFormError(null);
  }

  async function handleAddEmployee(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (photoFile) fd.append("photo", photoFile);
      const res = await fetch("/api/employees", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error ?? "Failed to add employee"); setSaving(false); return; }
      resetAddForm();
      setShowAddForm(false);
      showToast(`${data.employee.name} added successfully`);
      loadEmployees();
    } catch { setFormError("Network error, please try again"); }
    setSaving(false);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    setFormError(null);
    try {
      const fd = new FormData();
      Object.entries(editForm).forEach(([k, v]) => { if (k !== "id") fd.append(k, v); });
      if (editPhotoFile) fd.append("photo", editPhotoFile);
      if (editRemovePhoto) fd.append("removePhoto", "true");
      const res = await fetch(`/api/employees?id=${selected.id}`, { method: "PUT", body: fd });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error ?? "Failed to save"); setSaving(false); return; }
      setSelected(data.employee);
      setEditMode(false);
      showToast(`${data.employee.name} updated`);
      loadEmployees();
    } catch { setFormError("Network error, please try again"); }
    setSaving(false);
  }

  async function handleDelete() {
    if (!selected) return;
    setSaving(true);
    try {
      await fetch(`/api/employees?id=${selected.id}`, { method: "DELETE" });
      showToast(`${selected.name} deleted`);
      setSelected(null);
      setEditMode(false);
      setConfirmDelete(false);
      loadEmployees();
    } catch { showToast("Delete failed"); }
    setSaving(false);
  }

  return (
    <>
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 999,
          background: "var(--success)", color: "#fff",
          padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          {toast}
          <button onClick={() => setToast(null)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>
      )}

      <div className="topbar">
        <div>
          <div className="topbar-title">Employees</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Manage your workforce</div>
        </div>
        <div className="topbar-right">
          <span className="badge badge-purple">{employees.length} employees</span>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setShowAddForm((v) => !v); setSelected(null); setEditMode(false); resetAddForm(); }}
          >
            {showAddForm ? "✕ Cancel" : "+ Add Employee"}
          </button>
        </div>
      </div>

      <div className="page-content">
        {/* Add Employee Form */}
        {showAddForm && (
          <div className="card mb-4">
            <div className="card-header">
              <div className="card-title">Add Existing Employee</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>ID is auto-generated if left blank</div>
            </div>
            <div className="card-body">
              <form onSubmit={handleAddEmployee}>
                <PhotoPicker
                  preview={photoPreview}
                  fileRef={fileInputRef}
                  onPick={(f) => { setPhotoFile(f); setPhotoPreview(URL.createObjectURL(f)); }}
                  onRemove={() => { setPhotoFile(null); setPhotoPreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                />
                <FieldGrid form={form} onChange={(e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }))} positions={positions} />
                {formError && <div style={{ marginTop: 10, color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{formError}</div>}
                <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
                  <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Add Employee"}</button>
                  <button type="button" className="btn btn-outline" onClick={() => { setShowAddForm(false); resetAddForm(); }}>Cancel</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Search + Filter */}
        <div className="card mb-4">
          <div className="card-body" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <input
              className="form-input" style={{ maxWidth: 320 }}
              placeholder="🔍 Search by name, email, position, ID..."
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
            <select className="form-select" style={{ maxWidth: 200 }} value={filterPosition} onChange={(e) => setFilterPosition(e.target.value)}>
              <option value="">All Positions</option>
              {positions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            {(search || filterPosition) && (
              <button className="btn btn-outline btn-sm" onClick={() => { setSearch(""); setFilterPosition(""); }}>Clear</button>
            )}
          </div>
        </div>

        <div style={{ display: selected ? "grid" : undefined, gridTemplateColumns: selected ? "1fr 360px" : undefined, gap: 20, alignItems: "start" }}>
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th><th>Position</th><th>Gender</th><th>Age</th><th>Address</th><th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>Loading...</td></tr>
                  ) : employees.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>No employees found</td></tr>
                  ) : (
                    employees.map((emp) => (
                      <tr key={emp.id} style={{ cursor: "pointer", background: selected?.id === emp.id ? "var(--bg-secondary)" : undefined }}
                        onClick={() => selectEmployee(emp)}>
                        <td>
                          <div className="flex-center">
                            {emp.photoUrl
                              ? <img src={emp.photoUrl} alt={emp.name} style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", marginRight: 8, flexShrink: 0 }} />
                              : <div className="avatar">{emp.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}</div>
                            }
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 14 }}>{emp.name}</div>
                              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{emp.id} · {emp.email}</div>
                            </div>
                          </div>
                        </td>
                        <td><span className={`badge ${positionColors[emp.position] ?? "badge-gray"}`}>{emp.position}</span></td>
                        <td style={{ fontSize: 13, color: "var(--text-muted)" }}>{emp.gender}</td>
                        <td style={{ fontSize: 13 }}>{age(emp.dob)}</td>
                        <td style={{ fontSize: 13, color: "var(--text-muted)" }}>{emp.address}</td>
                        <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{new Date(emp.dateOfJoining).toLocaleDateString("en-IN")}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selected && (
            <div className="card" style={{ position: "sticky", top: 80 }}>
              <div className="card-header">
                <div className="card-title">{editMode ? "Edit Employee" : "Employee Profile"}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {!editMode && (
                    <>
                      <button className="btn btn-outline btn-sm" onClick={() => enterEditMode(selected)}>Edit</button>
                      <button className="btn btn-sm" style={{ background: "var(--danger)", color: "#fff" }}
                        onClick={() => setConfirmDelete(true)}>Delete</button>
                    </>
                  )}
                  <button className="btn btn-outline btn-sm" onClick={() => { setSelected(null); setEditMode(false); setConfirmDelete(false); }}>✕</button>
                </div>
              </div>

              {/* Delete confirmation */}
              {confirmDelete && !editMode && (
                <div style={{ margin: "0 16px 0", padding: "12px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "var(--danger)", marginBottom: 8 }}>
                    Delete {selected.name}?
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>This cannot be undone.</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-sm" style={{ background: "var(--danger)", color: "#fff" }}
                      disabled={saving} onClick={handleDelete}>{saving ? "Deleting..." : "Yes, Delete"}</button>
                    <button className="btn btn-outline btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
                  </div>
                </div>
              )}

              {editMode ? (
                <div className="card-body">
                  <form onSubmit={handleSaveEdit}>
                    <PhotoPicker
                      preview={editPhotoPreview}
                      fileRef={editFileRef}
                      onPick={(f) => { setEditPhotoFile(f); setEditPhotoPreview(URL.createObjectURL(f)); setEditRemovePhoto(false); }}
                      onRemove={() => { setEditPhotoFile(null); setEditPhotoPreview(null); setEditRemovePhoto(true); if (editFileRef.current) editFileRef.current.value = ""; }}
                    />
                    <FieldGrid
                      form={editForm}
                      onChange={(e) => setEditForm((p) => ({ ...p, [e.target.name]: e.target.value }))}
                      positions={positions}
                      readonlyId
                    />
                    {formError && <div style={{ marginTop: 10, color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{formError}</div>}
                    <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
                      <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? "Saving..." : "Save Changes"}</button>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => { setEditMode(false); setFormError(null); }}>Cancel</button>
                    </div>
                  </form>
                </div>
              ) : (
                <div className="card-body">
                  <div style={{ textAlign: "center", marginBottom: 16 }}>
                    {selected.photoUrl
                      ? <img src={selected.photoUrl} alt={selected.name} style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", margin: "0 auto 10px", display: "block", border: "3px solid var(--border)" }} />
                      : <div className="avatar avatar-lg" style={{ margin: "0 auto 10px" }}>{selected.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}</div>
                    }
                    <div style={{ fontWeight: 800, fontSize: 18 }}>{selected.name}</div>
                    <span className={`badge ${positionColors[selected.position] ?? "badge-gray"}`} style={{ marginTop: 6 }}>{selected.position}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {[
                      ["Employee ID", selected.id],
                      ["Email", selected.email],
                      ["Phone", selected.phone],
                      ["Gender", selected.gender],
                      ["Date of Birth", new Date(selected.dob).toLocaleDateString("en-IN")],
                      ["Age", `${age(selected.dob)} years`],
                      ["Date of Joining", new Date(selected.dateOfJoining).toLocaleDateString("en-IN")],
                      ["Address", selected.address],
                    ].map(([label, value]) => (
                      <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, borderBottom: "1px solid var(--border)", paddingBottom: 7 }}>
                        <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>{label}</span>
                        <span style={{ fontWeight: 500, textAlign: "right", maxWidth: 160 }}>{value}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <a href={`/onboarding/${selected.id}`} className="btn btn-primary btn-sm w-full" style={{ justifyContent: "center" }}>View Onboarding</a>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
