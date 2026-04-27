"use client";
import { useState, useEffect, use } from "react";

interface OnboardingRecord {
  employeeId: string;
  name: string;
  email: string;
  dob: string;
  position: string;
  dateOfJoining: string;
  status: string;
  checklist: Record<string, boolean>;
  documents: string[];
  photoUrl: string | null;
  notes: string;
}

const checklistItems = [
  { key: "photo", label: "Professional Photo", desc: "Upload a passport-size professional photo" },
  { key: "aadhaar", label: "Aadhaar Card", desc: "Government-issued ID proof" },
  { key: "pan", label: "PAN Card", desc: "Permanent Account Number for payroll" },
  { key: "bankDetails", label: "Bank Account Details", desc: "Account number, IFSC, and bank name" },
  { key: "offerLetterSigned", label: "Signed Offer Letter", desc: "Countersigned offer letter" },
  { key: "ndaSigned", label: "Signed NDA", desc: "Non-disclosure agreement" },
  { key: "backgroundVerification", label: "Background Verification", desc: "BGV completed and cleared" },
  { key: "itSetup", label: "IT Setup", desc: "Email, laptop, system access configured" },
  { key: "welcomeEmailSent", label: "Welcome Email", desc: "Welcome email sent to employee" },
];

export default function OnboardingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [record, setRecord] = useState<OnboardingRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/onboarding?id=${id}`).then((response) => response.json()).then((data) => {
      if (!data.error) setRecord(data);
      setLoading(false);
    });
  }, [id]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }

  async function toggleCheck(key: string) {
    if (!record) return;
    const updated = { ...record.checklist, [key]: !record.checklist[key] };
    setSaving(true);
    const response = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_checklist", employeeId: id, checklist: updated }),
    });
    const data = await response.json();
    setRecord(data.record);
    setSaving(false);
    showToast("Checklist updated");
  }

  async function uploadFile(key: string, file: File) {
    setUploading(key);
    const formData = new FormData();
    formData.append("action", "add_document");
    formData.append("employeeId", id);
    formData.append("docType", key);
    formData.append("file", file);

    const response = await fetch("/api/onboarding", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    setRecord(data.record);
    setUploading(null);
    showToast(`${file.name} saved to Desktop onboarding folder`);
  }

  async function uploadPhoto(file: File) {
    setUploading("photo");
    const localPreview = URL.createObjectURL(file);
    setPhotoPreview(localPreview);

    const formData = new FormData();
    formData.append("action", "set_photo");
    formData.append("employeeId", id);
    formData.append("file", file);

    const response = await fetch("/api/onboarding", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    setRecord(data.record);
    setUploading(null);
    showToast("Photo uploaded and saved to Desktop onboarding folder");
  }

  async function requestDocuments() {
    const response = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "request_documents", employeeId: id }),
    });
    const data = await response.json();
    showToast(data.message ?? `Document request sent for ${data.missing?.length ?? 0} items`);
  }

  if (loading) {
    return (
      <>
        <div className="topbar"><div className="topbar-title">Onboarding</div></div>
        <div className="page-content text-center" style={{ paddingTop: 80 }}>Loading...</div>
      </>
    );
  }

  if (!record) {
    return (
      <>
        <div className="topbar"><div className="topbar-title">Onboarding</div></div>
        <div className="page-content">
          <div className="alert alert-warning">No onboarding record found for ID: {id}. <a href="/onboarding" style={{ fontWeight: 700 }}>Go back</a></div>
        </div>
      </>
    );
  }

  const done = Object.values(record.checklist).filter(Boolean).length;
  const total = Object.values(record.checklist).length;
  const pct = Math.round((done / total) * 100);
  const desktopFolder = `C:\\Users\\Projecta0003\\Desktop\\Bonfiglioli Onboarding Files\\${record.name}`;

  return (
    <>
      {toast ? (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 999, background: "var(--success)", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, boxShadow: "0 4px 12px rgba(0,0,0,.15)" }}>
          {toast}
        </div>
      ) : null}

      <div className="topbar">
        <div>
          <div className="topbar-title">Onboarding - {record.name}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{record.position} | {id}</div>
        </div>
        <div className="topbar-right">
          <button className="btn btn-outline btn-sm" onClick={requestDocuments}>Request Missing Docs</button>
          <span className={`badge ${record.status === "completed" ? "badge-green" : record.status === "in_progress" ? "badge-blue" : "badge-yellow"}`}>
            {record.status === "in_progress" ? "In Progress" : record.status.charAt(0).toUpperCase() + record.status.slice(1)}
          </span>
        </div>
      </div>

      <div className="page-content">
        <div className="card mb-6">
          <div className="card-body">
            <div className="flex-between mb-4">
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{done}/{total} tasks completed</div>
                <div className="text-muted">All files are saved automatically in the employee folder on Desktop.</div>
              </div>
              <div style={{ fontSize: 36, fontWeight: 900, color: pct === 100 ? "var(--success)" : "var(--primary)" }}>{pct}%</div>
            </div>
            <div className="progress" style={{ height: 10 }}>
              <div className={`progress-bar${pct === 100 ? " success" : ""}`} style={{ width: `${pct}%` }} />
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>
              Folder: <code>{desktopFolder}</code>
            </div>
          </div>
        </div>

        <div className="grid-2">
          <div className="card">
            <div className="card-header">
              <div className="card-title">Onboarding Checklist</div>
              {saving ? <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Saving...</span> : null}
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              {checklistItems.map((item) => {
                const isDone = record.checklist[item.key];
                return (
                  <div key={item.key} className="checklist-item" style={{ padding: "12px 20px" }}>
                    <button
                      onClick={() => toggleCheck(item.key)}
                      className={`check-box${isDone ? " done" : ""}`}
                      title={isDone ? "Mark incomplete" : "Mark complete"}
                    >
                      {isDone ? "✓" : ""}
                    </button>
                    <div style={{ flex: 1 }}>
                      <div className={`check-label${isDone ? " done" : ""}`}>{item.label}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.desc}</div>
                    </div>
                    <label className="btn btn-outline btn-sm" style={{ cursor: "pointer" }}>
                      {uploading === item.key ? "Uploading..." : "Upload File"}
                      <input
                        type="file"
                        accept={item.key === "photo" ? "image/*" : undefined}
                        hidden
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          if (item.key === "photo") {
                            void uploadPhoto(file);
                          } else {
                            void uploadFile(item.key, file);
                          }
                        }}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="card">
              <div className="card-header"><div className="card-title">Employee Photo</div></div>
              <div className="card-body" style={{ textAlign: "center" }}>
                {photoPreview || record.photoUrl ? (
                  <img src={photoPreview ?? record.photoUrl!} alt="Employee" style={{ width: 120, height: 120, borderRadius: "50%", objectFit: "cover", border: "3px solid var(--primary)" }} />
                ) : (
                  <label className="upload-zone" style={{ cursor: "pointer" }}>
                    <div className="upload-zone-icon">📸</div>
                    <div style={{ fontWeight: 600 }}>Upload Photo</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>Passport-size, professional</div>
                    <input type="file" accept="image/*" hidden onChange={(event) => event.target.files?.[0] && uploadPhoto(event.target.files[0])} />
                  </label>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header"><div className="card-title">Uploaded Documents</div></div>
              <div className="card-body">
                {record.documents.length === 0 ? (
                  <div className="text-muted text-center" style={{ padding: "16px 0" }}>No documents uploaded yet</div>
                ) : (
                  record.documents.map((doc, index) => (
                    <div key={index} className="flex-center" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                      <span>📄</span>
                      <span style={{ flex: 1 }}>{doc}</span>
                      <span className="badge badge-green">Saved</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header"><div className="card-title">Employee Details</div></div>
              <div className="card-body">
                {[
                  ["Name", record.name],
                  ["Email", record.email],
                  ["Position", record.position],
                  ["Date of Birth", record.dob ? new Date(record.dob).toLocaleDateString("en-IN") : "-"],
                  ["DOJ", record.dateOfJoining ? new Date(record.dateOfJoining).toLocaleDateString("en-IN") : "-"],
                ].map(([label, value]) => (
                  <div key={label} className="flex-between" style={{ fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>{label}</span>
                    <span>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
