"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  if (isLoginPage) {
    return <main className="main main-login">{children}</main>;
  }

  return (
    <div className="layout">
      <Suspense fallback={<div className="sidebar" />}>
        <Sidebar />
      </Suspense>
      <main className="main">{children}</main>
    </div>
  );
}
