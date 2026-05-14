import type { Metadata } from "next";
import "./globals.css";
import ScheduleHeartbeat from "./ScheduleHeartbeat";
import AppShell from "./AppShell";

export const metadata: Metadata = {
  title: "Genio AI",
  description: "Genio AI by Bonfiglioli",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ScheduleHeartbeat />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
