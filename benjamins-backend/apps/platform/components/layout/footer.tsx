/** Minimal footer — only what the backend actually backs. */
export function Footer() {
  return (
    <footer className="border-t border-slate-100 bg-white px-6 py-6 text-[12px] text-slate-500 lg:px-12">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-1 sm:flex-row sm:justify-between">
        <span>Lex Nova · Pan-EU pseudonymous legal advice</span>
        <span className="font-mono text-slate-300">EUDI · EAS · anvil:31337</span>
      </div>
    </footer>
  );
}
