import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { operatorAddress } from "@/lib/chain/clients";

export const runtime = "nodejs";

/**
 * Operator's published P-256 public key for dispute-bundle encryption.
 * Mirrors the per-engagement messaging-key pattern (see
 * `engagement_messaging_keys`) but lives once globally — the operator
 * generates the keypair in their browser at first visit to
 * `/operator/disputes`, persists the private half in IndexedDB, and POSTs
 * the public half here.
 *
 * GET is public (the disputer's browser fetches it before encrypting a
 * bundle); POST is operator-only.
 */
const PostSchema = z
  .object({
    public_key_jwk: z.record(z.string(), z.unknown()),
  })
  .strict();

interface KeyRow {
  operator_address: string;
  public_key_jwk: string;
  created_at: number;
}

export async function GET() {
  const db = getDb();
  const opAddr = operatorAddress();
  const row = db
    .prepare(
      `SELECT operator_address, public_key_jwk, created_at
       FROM operator_messaging_key
       WHERE lower(operator_address) = lower(?)`
    )
    .get(opAddr) as KeyRow | undefined;
  if (!row) {
    return NextResponse.json(
      { error: "operator messaging key not yet registered" },
      { status: 404 }
    );
  }
  return NextResponse.json({
    operator_address: row.operator_address,
    public_key_jwk: JSON.parse(row.public_key_jwk),
    created_at: row.created_at,
  });
}

export async function POST(req: NextRequest) {
  const address = getSessionAddress();
  if (!address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  if (address.toLowerCase() !== operatorAddress().toLowerCase()) {
    return NextResponse.json({ error: "operator only" }, { status: 403 });
  }

  let parsed: z.infer<typeof PostSchema>;
  try {
    parsed = PostSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid_body", issues: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO operator_messaging_key (operator_address, public_key_jwk, created_at)
     VALUES (lower(?), ?, ?)
     ON CONFLICT(operator_address) DO UPDATE SET
       public_key_jwk = excluded.public_key_jwk,
       created_at = excluded.created_at`
  ).run(address, JSON.stringify(parsed.public_key_jwk), Math.floor(Date.now() / 1000));

  return NextResponse.json({ ok: true });
}
