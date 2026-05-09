import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { ConnectWallet } from "@/components/ConnectWallet";

export const metadata: Metadata = {
  title: "Lex Nova",
  description: "Verified-pseudonymous legal engagement on EUDI + EAS",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>
          <header className="flex items-center justify-between border-b px-6 py-3">
            <a href="/" className="text-lg font-semibold tracking-tight">
              Lex Nova
            </a>
            <ConnectWallet />
          </header>
          <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
