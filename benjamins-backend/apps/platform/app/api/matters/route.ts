import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";

export const runtime = "nodejs";

/**
 * Matter posting (T052 / FR-008).
 *
 * `.strict()` is load-bearing: zod will REJECT any request body that includes
 * an `amount`, `amount_wei`, `price`, or any other unrecognised field. Pricing
 * is the lawyer's response to an engagement request, never part of the matter
 * itself, and we want a 400 (rather than silent acceptance) if a UI bug ever
 * tries to send one.
 */
const PostMatterSchema = z
  .object({
    description: z.string().trim().min(20).max(5000),
    target_jurisdiction: z
      .string()
      .trim()
      .regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2 (e.g. DE, ES, IT, CZ)"),
    target_practice_area: z.string().trim().min(2).max(120),
  })
  .strict();

export async function POST(req: NextRequest) {
  const address = getSessionAddress();
  if (!address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // Defense-in-depth: confirm the SIWE-bound address has a verified_client row.
  // The only path into that table is the OID4VP client onboarding flow, so
  // this is equivalent to checking on-chain `hasCapability(SCHEMA_CLIENT)`
  // without the RPC roundtrip — and the indexer keeps the table in sync.
  const isClient = getDb()
    .prepare(
      `SELECT 1 FROM verified_users WHERE lower(eth_address) = lower(?) AND attested_role = 'client'`
    )
    .get(address);
  if (!isClient) {
    return NextResponse.json(
      { error: "must complete client onboarding before posting a matter" },
      { status: 403 }
    );
  }

  let parsed: z.infer<typeof PostMatterSchema>;
  try {
    const raw = (await req.json()) as unknown;
    parsed = PostMatterSchema.parse(raw);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid_body", issues: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }

  const result = getDb()
    .prepare(
      `INSERT INTO matters
         (client_address, description, target_jurisdiction, target_practice_area, created_at, status)
       VALUES (?, ?, ?, ?, ?, 'open')`
    )
    .run(
      address,
      parsed.description,
      parsed.target_jurisdiction,
      parsed.target_practice_area,
      Math.floor(Date.now() / 1000)
    );

  return NextResponse.json({
    ok: true,
    matter: {
      id: Number(result.lastInsertRowid),
      client_address: address,
      description: parsed.description,
      target_jurisdiction: parsed.target_jurisdiction,
      target_practice_area: parsed.target_practice_area,
      status: "open",
    },
  });
}
