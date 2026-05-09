import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { attestVerifiedClient, OPERATOR_ADDRESS } from "@/lib/chain/escrow";
import { chainErrorToHttp, isChainError } from "@/lib/chain/errors";
import type { ClientClaims } from "@/lib/chain/schemas";

// =============================================================================
// /api/onboarding/attest-client — POST
// -----------------------------------------------------------------------------
// Mints a SCHEMA_CLIENT capability for the signed-in user's wallet. Mirrors
// A's operator-as-attestor pattern from `apps/platform/app/api/onboarding/
// client/finalize/route.ts`: the platform operator wallet attests the
// capability based on the user's Over18 EBSI VC.
//
// In F2 the body is minimal — the connect-flow's age-check is still mocked,
// so we just take `ageOver18: true` on faith. F10 will replace this with a
// real EBSI presentation verification path.
// =============================================================================

const Schema = z.object({
  countryOfResidence: z.string().min(1).max(60).optional(),
});

export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine — we apply defaults.
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  // Country defaults to "EU" — F10 will fill this in from the VC's
  // `country_of_residence` claim. The age-over-18 boolean is hard-true in F2
  // because the connect-flow's age check is currently mocked to always
  // succeed (see `handleAge` in `app/connect/connect-flow.tsx`).
  const claims: ClientClaims = {
    countryOfResidence: parsed.data.countryOfResidence ?? "EU",
    ageOver18: true,
  };

  try {
    const { uid } = await attestVerifiedClient({
      subject: me.walletAddress,
      claims: claims as unknown as Record<string, unknown>,
      from: OPERATOR_ADDRESS,
      expiresAt: null,
    });
    const updated = await prisma.user.update({
      where: { id: me.id },
      data: {
        ageVerifiedAt: new Date(),
        clientCapabilityUid: uid,
      },
    });
    return NextResponse.json({ ok: true, capabilityUid: uid, user: { id: updated.id } });
  } catch (err) {
    if (isChainError(err)) {
      const { status, body } = chainErrorToHttp(err);
      return NextResponse.json(body, { status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
