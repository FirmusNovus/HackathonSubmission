export const metadata = {
  title: "Lex Nova — Test Issuer",
  description: "Stand-in credential issuer (PID + bar accreditation).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#f8fafc" }}>
        {children}
      </body>
    </html>
  );
}
