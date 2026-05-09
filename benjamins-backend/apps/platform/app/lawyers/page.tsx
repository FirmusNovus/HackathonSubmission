import Link from "next/link";
import { getDb } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, PageShell } from "@/components/layout/page-shell";
import { AvatarBubble } from "@/components/firmus/avatar-bubble";
import { FirmusBadge } from "@/components/firmus/firmus-badge";
import { EmptyState } from "@/components/firmus/empty-state";
import { EBSIBadge } from "@/components/firmus/ebsi-badge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface LawyerRow {
  eth_address: string;
  attested_at: number;
  disclosed_attrs: string;
}

export default function LawyersPage() {
  const rows = getDb()
    .prepare(
      `SELECT eth_address, attested_at, disclosed_attrs
       FROM verified_users
       WHERE attested_role = 'lawyer'
       ORDER BY attested_at DESC`
    )
    .all() as LawyerRow[];

  return (
    <PageShell width="full">
      <PageHeader
        eyebrow="Directory"
        title="Verified counsel."
        description={
          rows.length === 0
            ? "No lawyers have onboarded yet. Visit /onboarding/lawyer to onboard yours."
            : "Verified pseudonymous EU lawyers, in order of attestation. Click a card to view their profile."
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="The directory is quiet."
          body="Lex Nova waits for the first verified lawyer. Onboarding is one bar credential away."
          ctaLabel="Onboard a lawyer"
          ctaHref="/onboarding/lawyer"
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => {
            const disclosed = JSON.parse(row.disclosed_attrs) as Record<string, string>;
            const display =
              disclosed.given_name && disclosed.family_name
                ? `${disclosed.given_name} ${disclosed.family_name}`
                : `${row.eth_address.slice(0, 8)}…`;
            return (
              <Link key={row.eth_address} href={`/lawyers/${row.eth_address}`} className="group block">
                <Card className="h-full border-slate-100 bg-white shadow-none transition-all hover:border-slate-200 hover:shadow-firmus">
                  <CardHeader className="flex flex-row items-start gap-4 space-y-0">
                    <AvatarBubble name={display} size={56} verified />
                    <div className="min-w-0 flex-1">
                      <CardTitle className="font-display text-[18px] text-navy-900">
                        {display}
                      </CardTitle>
                      <p className="mt-0.5 truncate font-mono text-[12px] text-slate-300">
                        {row.eth_address.slice(0, 10)}…{row.eth_address.slice(-6)}
                      </p>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {disclosed.jurisdiction && (
                        <FirmusBadge kind="info">{disclosed.jurisdiction}</FirmusBadge>
                      )}
                      <EBSIBadge variant="small" />
                    </div>
                    {disclosed.bar_admission_number && (
                      <p className="font-mono text-[12px] text-slate-500">
                        Bar no. {disclosed.bar_admission_number}
                      </p>
                    )}
                    <span className="text-[13px] font-medium text-teal-600 group-hover:underline">
                      View profile →
                    </span>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
