"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button type="button" className="nav-item logout-button" onClick={handleLogout}>
      <span className="nav-icon">L</span>
      Admin Logout
    </button>
  );
}

