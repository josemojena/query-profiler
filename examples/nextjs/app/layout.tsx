import type { ReactNode } from "react";
import { ProfilerToolbar } from "query-profiler/next";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui", margin: 32 }}>
        {children}
        <ProfilerToolbar />
      </body>
    </html>
  );
}
