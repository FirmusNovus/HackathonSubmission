import { notFound } from "next/navigation";
import { isAddress } from "viem";

import { getDb } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EngageLawyer } from "@/components/EngageLawyer";
import { PageShell } from "@/components/layout/page-shell";
import { AvatarBubble } from "@/components/firmus/avatar-bubble";
import { FirmusBadge } from "@/components/firmus/firmus-badge";
import { EBSIBadge } from "@/components/firmus/ebsi-badge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function LawyerProfilePage({ params }: { params: { address: string } }) {
  if (!isAddress(params.address)) {
    notFound();
  }
  const row = getDb()
    .prepare(
      `SELECT eth_address, attested_at, attestation_uid, disclosed_attrs
       FROM verified_users
       WHERE attested_role = 'lawyer'
       AND lower(eth_address) = lower(?)`
    )
    .get(params.address) as
    | {
        eth_address: string;
        attested_at: number;
        attestation_uid: string;
        disclosed_attrs: string;
      }
    | undefined;

  if (!row) {
    notFound();
  }

  const disclosed = JSON.parse(row.disclosed_attrs) as Record<string, string>;
  const fullName =
    disclosed.given_name && disclosed.family_name
      ? `${disclosed.given_name} ${disclosed.family_name}`
      : "Pseudonymous lawyer";

  return (
    <PageShell>
      <header className="mb-10 flex items-start gap-5">
        <AvatarBubble name={fullName} size={88} verified sealSize={28} />
        <div className="min-w-0 flex-1">
          <span className="text-[12px] font-medium uppercase tracking-[0.14em] text-teal-600">
            Verified counsel
          </span>
          <h1 className="font-display mt-1 text-[40px] leading-[1.05] text-navy-900">
            {fullName}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <EBSIBadge />
            {disclosed.jurisdiction && <FirmusBadge kind="info">{disclosed.jurisdiction}</FirmusBadge>}
          </div>
        </div>
      </header>

      <div className="space-y-6">
        <Card className="border-slate-100 bg-white shadow-none">
          <CardHeader>
            <CardTitle className="font-display text-2xl text-navy-900">
              Practising attributes
            </CardTitle>
            <CardDescription className="text-[14px] leading-relaxed text-slate-500">
              Disclosed at onboarding via OID4VP. The platform never sees the underlying credential
              payload — only what the lawyer chose to disclose.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-[14px]">
            {disclosed.jurisdiction && (
              <Row label="Jurisdiction">
                <FirmusBadge kind="info">{disclosed.jurisdiction}</FirmusBadge>
              </Row>
            )}
            {disclosed.bar_admission_number && (
              <Row label="Bar admission no.">
                <span className="font-mono text-navy-900">{disclosed.bar_admission_number}</span>
              </Row>
            )}
            {disclosed.bar_admission_date && (
              <Row label="Admitted to bar">
                <span className="text-navy-900">{disclosed.bar_admission_date}</span>
              </Row>
            )}
            {disclosed.valid_until && (
              <Row label="Credential valid until">
                <span className="text-navy-900">{disclosed.valid_until}</span>
              </Row>
            )}
            <Row label="Attested at" last>
              <span className="text-navy-900">
                {new Date(row.attested_at * 1000).toLocaleString()}
              </span>
            </Row>
          </CardContent>
        </Card>

        <Card className="border-slate-100 bg-white shadow-none">
          <CardHeader>
            <CardTitle className="font-display text-2xl text-navy-900">On-chain attestation</CardTitle>
            <CardDescription className="text-[14px] leading-relaxed text-slate-500">
              EAS attestation written by the platform operator after credential verification.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 font-mono text-[12px] text-slate-700">
              <div>
                <span className="text-slate-300">Wallet · </span>
                {row.eth_address}
              </div>
              <div className="break-all">
                <span className="text-slate-300">Attestation UID · </span>
                {row.attestation_uid}
              </div>
            </div>
          </CardContent>
        </Card>

        <EngageLawyer lawyerAddress={row.eth_address} />
      </div>
    </PageShell>
  );
}

function Row({
  label,
  children,
  last,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between ${last ? "" : "border-b border-slate-100 pb-2"}`}
    >
      <span className="text-slate-500">{label}</span>
      {children}
    </div>
  );
}
