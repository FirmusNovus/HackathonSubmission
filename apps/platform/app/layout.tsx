import type { Metadata } from 'next';
import { Inter, Fraunces } from 'next/font/google';
import { DevModeBanner } from '@/components/firmus/dev-mode-banner';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap' });

export const metadata: Metadata = {
  title: 'Verified Legal Counsel, On-Chain.',
  description: 'A verified-pseudonymous legal-engagement marketplace.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="font-sans antialiased">
        {process.env.DEV_BYPASS_EUDI === '1' ? <DevModeBanner /> : null}
        {children}
      </body>
    </html>
  );
}
