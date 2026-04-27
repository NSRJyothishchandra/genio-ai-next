import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "./Sidebar";
import ScheduleHeartbeat from "./ScheduleHeartbeat";

export const metadata: Metadata = {
  title: "Genio AI",
  description: "Genio AI by Bonfiglioli",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ScheduleHeartbeat />
        <div className="layout">
          <Sidebar />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
