import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { FirmusLogo } from "@/components/firmus/firmus-logo";
import { EBSIBadge } from "@/components/firmus/ebsi-badge";
import { requireLawyerRoleOnly } from "@/lib/auth/session";
import { VerifyLawyerForm } from "./verify-lawyer-form";

export default async function VerifyLawyerPage() {
  // F2: deliberately use the role-only gate here — `requireLawyer()` would
  // bounce us back to /verify-lawyer in an infinite loop because lawyers on
  // this page have NOT yet been issued a SCHEMA_LAWYER capability.
  await requireLawyerRoleOnly();
  return (
    <div className="min-h-screen bg-white-50">
      <header className="flex items-center justify-between border-b border-slate-100 bg-white-0 px-6 py-5 lg:px-12">
        <Link href="/"><FirmusLogo /></Link>
        <a className="text-[13px] font-medium text-slate-500 hover:text-navy-900" href="/lawyer/dashboard">
          Save &amp; finish later
        </a>
      </header>

      <ProgressRail />

      <main className="mx-auto max-w-[1080px] px-6 py-12 lg:px-12">
        <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
          <div>
            <h1 className="font-display text-3xl text-navy-900 sm:text-4xl">Verify your credentials.</h1>
            <p className="mt-2.5 text-[15px] text-slate-500">
              This information will be cross-checked against EBSI and your bar association, then issued back to your identity wallet as verifiable credentials.
            </p>
            <Link href="/connect" className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-navy-900">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to wallet connection
            </Link>
            <div className="mt-8">
              <VerifyLawyerForm />
            </div>
          </div>

          <aside>
            <div className="sticky top-6 rounded-2xl border border-slate-100 bg-white-0 p-6">
              <EBSIBadge variant="seal" size={40} />
              <h3 className="mt-4 text-base font-semibold text-navy-900">Verified through EBSI</h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-slate-500">
                Your credentials will be cross-checked against the European Blockchain Services Infrastructure within{" "}
                <strong className="text-navy-900">48 hours</strong>, then issued as verifiable credentials to your identity wallet. Verification is permanent and portable across all 27 EU jurisdictions.
              </p>
              <hr className="my-5 border-t border-slate-100" />
              <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                What we verify
              </div>
              <ul className="space-y-2.5 text-[13px] leading-[1.5] text-slate-700">
                {[
                  "Bar admission with the issuing authority",
                  "Identity match against ID document",
                  "Specialization certificates with their issuers",
                  "Conflict-of-interest disclosures",
                ].map((t) => (
                  <li key={t} className="flex gap-2.5">
                    <span aria-hidden className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full bg-teal-50" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function ProgressRail() {
  const steps = [
    { n: 1, label: "Identity", state: "done" as const },
    { n: 2, label: "Credentials", state: "active" as const },
    { n: 3, label: "Review", state: "todo" as const },
  ];
  return (
    <div className="border-b border-slate-100 bg-white-0 px-6 py-5 lg:px-12">
      <div className="mx-auto flex max-w-[1080px] items-center">
        {steps.map((s, i) => (
          <div key={s.n} className="flex flex-1 items-center gap-2.5">
            <div
              className={
                s.state === "done"
                  ? "flex h-7 w-7 items-center justify-center rounded-full border-2 border-teal-500 bg-teal-500 text-[12px] font-medium text-white"
                  : s.state === "active"
                    ? "flex h-7 w-7 items-center justify-center rounded-full border-2 border-teal-500 bg-white-0 text-[12px] font-medium text-teal-700"
                    : "flex h-7 w-7 items-center justify-center rounded-full border-2 border-slate-200 bg-white-0 text-[12px] font-medium text-slate-300"
              }
            >
              {s.n}
            </div>
            <div className="hidden sm:block">
              <div className={s.state === "active" ? "text-[13px] font-medium text-navy-900" : "text-[13px] font-medium text-slate-500"}>
                {s.label}
              </div>
              <div className="text-[11px] text-slate-300">Step {s.n} of 3</div>
            </div>
            {i < steps.length - 1 && (
              <div className={s.state === "done" ? "h-0.5 flex-1 bg-teal-500" : "h-0.5 flex-1 bg-slate-100"} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
