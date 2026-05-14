"use client";

import Link from "next/link";

const softwareLinks = [
  { href: "/employees", label: "Employees", summary: "View and manage the employee directory." },
  { href: "/timesheet", label: "Timesheets", summary: "Attendance, leave requests, and work-hour tracking." },
  { href: "/finance", label: "Finance", summary: "Raise bill approvals and review finance workflows." },
  { href: "/assistant", label: "AI Assistant", summary: "Ask internal workflow and HR support questions." },
  { href: "/integrations", label: "n8n / Integrations", summary: "Review automation connections and webhook flows." },
];

const mechLinks = [
  { href: "/documents", label: "Documents", summary: "Compare PDFs and download highlighted updated files." },
  { href: "/cad", label: "CAD", summary: "Upload engineering files and generate drawing reports." },
  { href: "/cowork?workspace=agents&target=blender", label: "NX Agent", summary: "Generate OBJ-ready mechanical parts for NX workflows." },
  { href: "/cowork?workspace=blender&target=blender", label: "NX Lab", summary: "Use the precision mechanical workspace and component library." },
  { href: "/cowork?workspace=agents&target=cli", label: "CLI Agent", summary: "Open Claude CLI locally and run the exact prompt in terminal." },
  { href: "/cowork?workspace=agents&target=desktop", label: "Desktop Agent", summary: "Run local desktop automation tasks on Windows apps." },
  { href: "/cowork?workspace=agents&target=browser", label: "Browser Agent", summary: "Run browser automation in local Chrome or Edge." },
];

function Section({
  title,
  subtitle,
  links,
}: {
  title: string;
  subtitle: string;
  links: { href: string; label: string; summary: string }[];
}) {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">{title}</div>
          <div className="card-subtitle">{subtitle}</div>
        </div>
      </div>
      <div className="card-body">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              style={{
                display: "grid",
                gap: 8,
                border: "1px solid var(--border)",
                borderRadius: 16,
                padding: 18,
                background: "var(--bg-secondary)",
                color: "inherit",
                textDecoration: "none",
                minHeight: 140,
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 16 }}>{link.label}</div>
              <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>{link.summary}</div>
              <div style={{ color: "var(--primary)", fontSize: 12, fontWeight: 700, marginTop: "auto" }}>
                Open
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function HomeLauncher() {
  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Genio AI Workspace</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Software operations and mechanical workflows in one launcher.
          </div>
        </div>
      </div>

      <div className="page-content" style={{ display: "grid", gap: 20 }}>
        <div
          className="card"
          style={{
            background:
              "linear-gradient(135deg, rgba(37,99,235,.12) 0%, rgba(79,70,229,.12) 50%, rgba(14,165,233,.12) 100%)",
          }}
        >
          <div className="card-body" style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 28, fontWeight: 900 }}>Choose Your Workspace</div>
            <div style={{ color: "var(--text-muted)", maxWidth: 760, lineHeight: 1.7 }}>
              Use the Software section for employee operations, timesheets, and finance. Use the Mech section for
              document comparison, CAD drawing generation, and NX-linked mechanical modeling agents. Admin sign-in at
              the bottom of the sidebar unlocks birthdays, onboarding, approvals, and timesheet reports.
            </div>
          </div>
        </div>

        <Section
          title="Software"
          subtitle="Operational tools for employees, finance, and internal automation."
          links={softwareLinks}
        />

        <Section
          title="Mech"
          subtitle="Engineering document, CAD, and NX-agent workflows."
          links={mechLinks}
        />
      </div>
    </>
  );
}
