"use client";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import LogoutButton from "./LogoutButton";
import GlobalVoiceButton from "./components/GlobalVoiceButton";

type TabId = "software" | "mech" | "admin";

interface NavItem {
  id: string;
  href: string;
  icon: string;
  label: string;
}

const tabConfig: Record<TabId, { label: string; routes: string[]; items: NavItem[] }> = {
  software: {
    label: "Software",
    routes: ["/cowork"],
    items: [
      { id: "cli-agent",     href: "/cowork?workspace=cli&target=cli",                         icon: "CLI", label: "CLI Agent" },
      { id: "desktop-agent", href: "/cowork?workspace=desktop&target=desktop",                 icon: "APP", label: "Desktop Agent" },
      { id: "browser-agent", href: "/cowork?workspace=browser&target=browser",                 icon: "WEB", label: "Browser Agent" },
    ],
  },
  mech: {
    label: "Mech",
    routes: ["/documents", "/cad"],
    items: [
      { id: "documents", href: "/documents",                                                   icon: "DOC", label: "Documents" },
      { id: "cad",       href: "/cad",                                                         icon: "CAD", label: "CAD" },
      { id: "nx-agent",  href: "/cowork?workspace=blender&target=blender&view=agent",          icon: "NX",  label: "NX Agent" },
      { id: "nx-lab",    href: "/cowork?workspace=blender&target=blender&view=lab",            icon: "LAB", label: "NX Lab" },
    ],
  },
  admin: {
    label: "Admin",
    routes: ["/employees", "/timesheet", "/finance", "/assistant", "/integrations", "/birthday", "/onboarding", "/mail"],
    items: [
      { id: "employees",         href: "/employees",        icon: "EMP", label: "Employees" },
      { id: "timesheets",        href: "/timesheet",        icon: "TS",  label: "Timesheets" },
      { id: "finance",           href: "/finance",          icon: "FIN", label: "Finance" },
      { id: "assistant",         href: "/assistant",        icon: "AI",  label: "AI Assistant" },
      { id: "integrations",      href: "/integrations",     icon: "N8N", label: "n8n / Integrations" },
      { id: "birthdays",         href: "/birthday",         icon: "BD",  label: "Birthdays" },
      { id: "onboarding",        href: "/onboarding",       icon: "ON",  label: "Onboarding" },
      { id: "timesheet-reports", href: "/timesheet/review", icon: "REP", label: "Timesheet Reports" },
      { id: "mail",              href: "/mail",             icon: "ML",  label: "Mail & Meetings" },
    ],
  },
};

function detectTab(pathname: string, workspace?: string | null): TabId {
  // Admin routes take priority
  if (tabConfig.admin.routes.some((route) => pathname.startsWith(route))) return "admin";
  // Mech: documents and cad
  if (tabConfig.mech.routes.some((route) => pathname.startsWith(route))) return "mech";
  // /cowork — blender workspace → Mech, everything else → Software
  if (pathname.startsWith("/cowork")) {
    return workspace === "blender" ? "mech" : "software";
  }
  return "software";
}

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoaded, setAuthLoaded] = useState(false);
  const workspace = searchParams.get("workspace");
  const [activeTab, setActiveTab] = useState<TabId>(() => detectTab(pathname, workspace));

  useEffect(() => {
    setActiveTab(detectTab(pathname, searchParams.get("workspace")));
  }, [pathname, searchParams]);

  useEffect(() => {
    let mounted = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        setIsAdmin(Boolean(data?.authenticated));
        setAuthLoaded(true);
      })
      .catch(() => {
        if (!mounted) return;
        setIsAdmin(false);
        setAuthLoaded(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleTabClick = (tab: TabId) => {
    if (tab === "admin" && !isAdmin) {
      router.push("/login?next=/employees");
      return;
    }
    setActiveTab(tab);
  };

  const currentHref = searchParams.toString()
    ? `${pathname}?${searchParams.toString()}`
    : pathname;

  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <img src="/genio-ai-logo.png" alt="Genio AI logo" className="sidebar-logo-image" />
        <div>
          <div className="sidebar-logo-text">Genio AI</div>
          <div className="sidebar-logo-sub">By Bonfiglioli</div>
        </div>
      </div>

      <div className="sidebar-tabs">
        {(["software", "mech", "admin"] as TabId[]).map((tabId) => (
          <button
            key={tabId}
            className={`sidebar-tab${activeTab === tabId ? " active" : ""}${tabId === "admin" && !isAdmin ? " locked" : ""}`}
            onClick={() => handleTabClick(tabId)}
          >
            {tabConfig[tabId].label}
            {tabId === "admin" && !isAdmin && <span className="tab-lock-icon">🔒</span>}
          </button>
        ))}
      </div>

      <div className="sidebar-nav">
        {tabConfig[activeTab].items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className={`nav-item${currentHref === item.href ? " active" : ""}`}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-voice-bar">
          <div className="sidebar-voice-copy">
            <span className="sidebar-voice-label">Voice</span>
            <span className="sidebar-voice-sub">Say "Genius" to activate</span>
          </div>
          <Suspense fallback={null}>
            <GlobalVoiceButton />
          </Suspense>
        </div>
        {authLoaded && isAdmin ? (
          <LogoutButton />
        ) : (
          authLoaded && (
            <Link href="/login?next=%2Femployees" className="nav-item logout-button">
              <span className="nav-icon">AD</span>
              Admin Login
            </Link>
          )
        )}
      </div>
    </nav>
  );
}
