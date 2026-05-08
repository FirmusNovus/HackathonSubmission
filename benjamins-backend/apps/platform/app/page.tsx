import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="space-y-12 py-8">
      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight">Lex Nova</h1>
        <p className="max-w-prose text-muted-foreground">
          Pan-EU pseudonymous legal advice. Lawyers prove their bar admission cryptographically;
          clients prove EU residency without revealing more than they have to.
        </p>
      </div>

      <div>
        <h2 className="mb-4 text-lg font-semibold">Get started</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link href="/onboarding/lawyer">
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle>Onboard as a lawyer</CardTitle>
                <CardDescription>
                  Present a bar credential from your wallet to receive an on-chain
                  <code className="mx-1 text-xs">verified_lawyer</code> attestation.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                /onboarding/lawyer
              </CardContent>
            </Card>
          </Link>
          <Link href="/onboarding/client">
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle>Onboard as a client</CardTitle>
                <CardDescription>
                  Present an EU resident credential (PID). Only your country of residence and an
                  age-over-18 boolean are disclosed — name, birth date, document number, and full
                  address never leave your wallet.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                /onboarding/client
              </CardContent>
            </Card>
          </Link>
          <Link href="/lawyers">
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle>Browse the directory</CardTitle>
                <CardDescription>
                  See lawyers who have completed onboarding. Empty until at least one lawyer has
                  presented their credential.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">/lawyers</CardContent>
            </Card>
          </Link>
          <Link href="/matters">
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle>Post a matter</CardTitle>
                <CardDescription>
                  Describe what you need help with. No price — pricing is the lawyer's response,
                  not part of the matter. Requires completed client onboarding.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">/matters</CardContent>
            </Card>
          </Link>
          <Link href="/inbox">
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle>Lawyer inbox</CardTitle>
                <CardDescription>
                  Engagement requests addressed to your wallet. Decline or respond with a
                  signed first-milestone proposal. Requires completed lawyer onboarding.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">/inbox</CardContent>
            </Card>
          </Link>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Phase 4 in progress — Groups A (client onboarding), B (matters), C (engagement
        request), D1 (lawyer handshake) done. D2 (client funding), E (messaging),
        F (milestones) follow, then disputes (Phase 5), ZK conflict-of-interest (Phase 6),
        operator admin (Phase 7).
      </div>
    </div>
  );
}
