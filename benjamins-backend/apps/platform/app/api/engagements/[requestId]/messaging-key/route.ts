import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import {
  getEngagementByRequest,
  upsertMessagingKey,
} from "@/lib/messaging/engagement-keys";

export const runtime = "nodejs";

/**
 * POST: a party publishes their own P-256 messaging public key for an
 * engagement. The platform stores it for the counterparty to fetch and
 * derive an ECDH shared secret from. We never see the matching private key
 * (Constitution invariant 1).
 *
 * The JWK is validated as P-256, public-only — `.strict()` rejects any
 * unknown JWK fields (including the `d` private component) so a buggy
 * client can't accidentally upload a private key.
 */
const PublicJwkSchema = z
  .object({
    kty: z.literal("EC"),
    crv: z.literal("P-256"),
    x: z.string().min(1),
    y: z.string().min(1),
    use: z.string().optional(),
    alg: z.string().optional(),
    kid: z.string().optional(),
    ext: z.boolean().optional(),
    key_ops: z.array(z.string()).optional(),
  })
  .strict();

const BodySchema = z.object({ public_key_jwk: PublicJwkSchema }).strict();

export async function POST(
  req: NextRequest,
  { params }: { params: { requestId: string } }
) {
  const address = getSessionAddress();
  if (!address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const requestId = Number(params.requestId);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: "invalid request id" }, { status: 400 });
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid_body", issues: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }

  const eng = getEngagementByRequest(getDb(), requestId);
  if (!eng) {
    return NextResponse.json(
      { error: "no engagement opened for this request yet" },
      { status: 404 }
    );
  }
  const isParty =
    eng.client_address.toLowerCase() === address.toLowerCase() ||
    eng.lawyer_address.toLowerCase() === address.toLowerCase();
  if (!isParty) {
    return NextResponse.json({ error: "not a party to this engagement" }, { status: 403 });
  }

  upsertMessagingKey(eng.engagement_id, address, JSON.stringify(parsed.public_key_jwk));

  return NextResponse.json({
    ok: true,
    engagement_id: eng.engagement_id,
    party_address: address.toLowerCase(),
  });
}
