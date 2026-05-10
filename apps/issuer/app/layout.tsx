import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Firmus Novus — Test credential issuer",
  description: "Stand-in OID4VCI issuer for PID and lawyer credentials. Test data only.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif",
          background: "#fafafa",
          color: "#0f172a",
        }}
      >
        {children}
      </body>
    </html>
  );
}
