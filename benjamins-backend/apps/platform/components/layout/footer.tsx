import { FirmusLogo } from "@/components/firmus/firmus-logo";

const COLUMNS: Array<{ title: string; items: string[] }> = [
  { title: "Platform", items: ["Lawyers", "How It Works", "Pricing", "Security"] },
  { title: "For Lawyers", items: ["Apply", "Verification", "Earnings", "Bar Partnerships"] },
  { title: "Company", items: ["About", "Press", "Privacy", "Terms"] },
];

export function Footer() {
  return (
    <footer className="bg-navy-900 px-6 pb-10 pt-16 text-[#E8EDF4] lg:px-12">
      <div className="mx-auto grid max-w-[1180px] grid-cols-2 gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div className="col-span-2 md:col-span-1">
          <FirmusLogo light />
          <p className="mt-5 max-w-[280px] text-[13px] leading-[1.6] text-[#93A0B5]">
            Verified legal counsel, on-chain. Built on EBSI for trust that travels with you across Europe.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <div className="mb-4 text-[11px] font-medium uppercase tracking-[0.12em] text-[#93A0B5]">
              {col.title}
            </div>
            {col.items.map((it) => (
              <div key={it} className="text-[14px] leading-[2] text-[#E8EDF4]">
                {it}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mx-auto mt-10 flex max-w-[1180px] flex-col gap-2 border-t border-white/10 pt-6 text-[12px] text-[#93A0B5] sm:flex-row sm:justify-between">
        <span>© {new Date().getFullYear()} Lex Nova · Pan-EU pseudonymous legal advice</span>
        <span>
          Built on <span className="font-mono">EUDI · EAS</span>
        </span>
      </div>
    </footer>
  );
}
