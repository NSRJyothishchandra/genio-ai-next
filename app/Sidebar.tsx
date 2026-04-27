"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { group: "Main", items: [{ href: "/", icon: "🏠", label: "Dashboard" }] },
  {
    group: "HR",
    items: [
      { href: "/employees", icon: "👥", label: "Employees" },
      { href: "/onboarding", icon: "🚀", label: "Onboarding" },
      { href: "/birthday", icon: "🎂", label: "Birthdays" },
    ],
  },
  {
    group: "Work",
    items: [
      { href: "/timesheet", icon: "⏰", label: "Timesheets" },
      { href: "/timesheet/review", icon: "🔄", label: "Auto Timesheet" },
    ],
  },
  {
    group: "AI & Automation",
    items: [
      { href: "/cowork", icon: "🤝", label: "Cowork" },
      { href: "/assistant", icon: "🤖", label: "AI Assistant" },
      { href: "/integrations", icon: "🔗", label: "n8n / Integrations" },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <img
          src="/genio-ai-logo.png"
          alt="Genio AI logo"
          className="sidebar-logo-image"
        />
        <div>
          <div className="sidebar-logo-text">Genio AI</div>
          <div className="sidebar-logo-sub">By Bonfiglioli</div>
        </div>
      </div>

      <div className="sidebar-nav">
        {navItems.map((group) => (
          <div key={group.group} className="nav-group">
            <div className="nav-group-label">{group.group}</div>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item${pathname === item.href ? " active" : ""}`}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <div className="nav-item" style={{ color: "var(--text-muted)", fontSize: 12 }}>
          <span className="nav-icon">⚙️</span>
          Settings
        </div>
      </div>
    </nav>
  );
}
