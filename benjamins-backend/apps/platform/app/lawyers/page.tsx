import { getDb } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
    <div className="space-y-6 py-8">
      <div>
        <h1 className="text-3xl font-bold">Lawyers</h1>
        <p className="mt-2 text-muted-foreground">
          {rows.length === 0
            ? "No lawyers have onboarded yet. Visit /onboarding/lawyer to onboard yours."
            : "Verified pseudonymous EU lawyers, in order of attestation. Click a card to view their profile."}
        </p>
      </div>

      {rows.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => {
            const disclosed = JSON.parse(row.disclosed_attrs) as Record<string, string>;
            const display = disclosed.given_name && disclosed.family_name
              ? `${disclosed.given_name} ${disclosed.family_name}`
              : `${row.eth_address.slice(0, 8)}…`;
            return (
              <a key={row.eth_address} href={`/lawyers/${row.eth_address}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardHeader>
                    <CardTitle>{display}</CardTitle>
                    <CardDescription className="font-mono text-xs">
                      {row.eth_address.slice(0, 10)}…{row.eth_address.slice(-6)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {disclosed.jurisdiction && (
                      <Badge variant="outline">{disclosed.jurisdiction}</Badge>
                    )}
                    {disclosed.bar_admission_number && (
                      <p className="font-mono text-xs text-muted-foreground">
                        {disclosed.bar_admission_number}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
