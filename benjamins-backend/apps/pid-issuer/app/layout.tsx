/**
 * PID issuer is a stand-alone backend — it serves its own JSON endpoints and a
 * minimal landing page only because Next.js requires an `app/layout.tsx` to
 * boot. The real surface is `/api/issuer/pid/*`.
 */
export const metadata = {
  title: "Lex Nova — EU PID Issuer",
  description: "Stand-in EUDI Person Identification Data issuer.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: "2rem" }}>{children}</body>
    </html>
  );
}
