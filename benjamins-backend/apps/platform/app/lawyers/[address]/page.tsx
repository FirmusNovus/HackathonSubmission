import { notFound } from "next/navigation";
import { isAddress } from "viem";

import { getDb } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EngageLawyer } from "@/components/EngageLawyer";

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
    <div className="mx-auto max-w-3xl space-y-6 py-8">
      <div>
        <h1 className="text-3xl font-bold">{fullName}</h1>
        <p className="mt-2 text-muted-foreground">Verified pseudonymous EU lawyer · Lex Nova</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Practising attributes</CardTitle>
          <CardDescription>
            Disclosed at onboarding via OID4VP. The platform never sees the underlying credential
            payload — only what the lawyer chose to disclose.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {disclosed.jurisdiction && (
            <div className="flex items-baseline justify-between border-b pb-2">
              <span className="text-sm text-muted-foreground">Jurisdiction</span>
              <Badge variant="outline">{disclosed.jurisdiction}</Badge>
            </div>
          )}
          {disclosed.bar_admission_number && (
            <div className="flex items-baseline justify-between border-b pb-2">
              <span className="text-sm text-muted-foreground">Bar admission no.</span>
              <span className="font-mono text-sm">{disclosed.bar_admission_number}</span>
            </div>
          )}
          {disclosed.bar_admission_date && (
            <div className="flex items-baseline justify-between border-b pb-2">
              <span className="text-sm text-muted-foreground">Admitted to bar</span>
              <span className="text-sm">{disclosed.bar_admission_date}</span>
            </div>
          )}
          {disclosed.valid_until && (
            <div className="flex items-baseline justify-between border-b pb-2">
              <span className="text-sm text-muted-foreground">Credential valid until</span>
              <span className="text-sm">{disclosed.valid_until}</span>
            </div>
          )}
          <div className="flex items-baseline justify-between pb-2">
            <span className="text-sm text-muted-foreground">Attested at</span>
            <span className="text-sm">{new Date(row.attested_at * 1000).toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>On-chain attestation</CardTitle>
          <CardDescription>
            EAS attestation written by the platform operator after credential verification.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 font-mono text-xs">
            <div>
              <span className="text-muted-foreground">Wallet: </span>
              {row.eth_address}
            </div>
            <div className="break-all">
              <span className="text-muted-foreground">Attestation UID: </span>
              {row.attestation_uid}
            </div>
          </div>
        </CardContent>
      </Card>

      <EngageLawyer lawyerAddress={row.eth_address} />
    </div>
  );
}
