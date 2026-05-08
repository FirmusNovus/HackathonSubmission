import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAddress, parseAbi, type Address } from "viem";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { publicClient } from "@/lib/chain/clients";
import { getAddresses } from "@/lib/chain/addresses";
import { emitForRequest } from "@/lib/messaging/event-bus";

export const runtime = "nodejs";

/**
 * Engagement request (T055 / FR-010).
 *
 * The client picks a verified lawyer and a previously-posted matter, and sends
 * a request. No amount: pricing is the lawyer's response (recorded later in
 * `engagement_proposals`), never part of the request itself. `.strict()` means
 * any `amount`/`amount_wei`/etc. field gets rejected with 400.
 */
const RequestSchema = z
  .object({
    matter_id: z.number().int().positive(),
    lawyer_address: z
      .string()
      .refine((s) => isAddress(s), { message: "not a valid Ethereum address" }),
  })
  .strict();

const ATTESTATION_MANAGER_ABI = parseAbi([
  "function hasCapability(address subject, bytes32 schemaId) view returns (bool)",
]);

interface MatterRow {
  id: number;
  client_address: string;
  status: "open" | "engaged" | "withdrawn";
}

export async function POST(req: NextRequest) {
  const address = getSessionAddress();
  if (!address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // Caller must be a verified client. Same check as POST /api/matters.
  const isClient = getDb()
    .prepare(
      `SELECT 1 FROM verified_users WHERE lower(eth_address) = lower(?) AND attested_role = 'client'`
    )
    .get(address);
  if (!isClient) {
    return NextResponse.json(
      { error: "must complete client onboarding before sending engagement requests" },
      { status: 403 }
    );
  }

  let parsed: z.infer<typeof RequestSchema>;
  try {
    const raw = (await req.json()) as unknown;
    parsed = RequestSchema.parse(raw);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid_body", issues: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }

  // Matter must exist, belong to the caller, and be open. Engaged or withdrawn
  // matters can't accept new requests.
  const matter = getDb()
    .prepare(`SELECT id, client_address, status FROM matters WHERE id = ?`)
    .get(parsed.matter_id) as MatterRow | undefined;
  if (!matter) {
    return NextResponse.json({ error: "matter not found" }, { status: 404 });
  }
  if (matter.client_address.toLowerCase() !== address.toLowerCase()) {
    return NextResponse.json({ error: "not your matter" }, { status: 403 });
  }
  if (matter.status !== "open") {
    return NextResponse.json(
      { error: `matter is ${matter.status}, cannot request a new engagement` },
      { status: 409 }
    );
  }

  // Lawyer must hold verified_lawyer ON CHAIN. The platform's verified_users
  // mirror is good enough for most reads but the engagement contract gates on
  // the chain state, and we want the request to fail at the same instant that
  // a freshly-revoked lawyer becomes ineligible — without waiting on the
  // indexer to notice. One read per request is cheap.
  const addrs = getAddresses();
  let lawyerHasCapability: boolean;
  try {
    lawyerHasCapability = (await publicClient.readContract({
      address: addrs.ATTESTATION_MANAGER_ADDRESS,
      abi: ATTESTATION_MANAGER_ABI,
      functionName: "hasCapability",
      args: [parsed.lawyer_address as Address, addrs.SCHEMA_LAWYER],
    })) as boolean;
  } catch (e) {
    return NextResponse.json(
      { error: `chain read failed: ${(e as Error).message}` },
      { status: 502 }
    );
  }
  if (!lawyerHasCapability) {
    return NextResponse.json(
      { error: "target address does not hold verified_lawyer capability" },
      { status: 400 }
    );
  }

  // Defense-in-depth: refuse a request from a wallet to itself. The contract
  // would reject the engagement open later anyway, but failing here avoids a
  // confusing pending-request that can never resolve.
  if (parsed.lawyer_address.toLowerCase() === address.toLowerCase()) {
    return NextResponse.json(
      { error: "cannot request engagement with yourself" },
      { status: 400 }
    );
  }

  let result;
  try {
    result = getDb()
      .prepare(
        `INSERT INTO engagement_requests
           (matter_id, client_address, lawyer_address, status, created_at)
         VALUES (?, ?, ?, 'pending', ?)`
      )
      .run(
        parsed.matter_id,
        address,
        parsed.lawyer_address,
        Math.floor(Date.now() / 1000)
      );
  } catch (e) {
    // The partial unique index on (matter_id, lawyer_address) WHERE status IN
    // ('pending','accepted') triggers SQLITE_CONSTRAINT if the client already
    // has an active request to this lawyer for this matter.
    const msg = (e as Error).message;
    if (msg.includes("UNIQUE") || msg.includes("constraint")) {
      return NextResponse.json(
        { error: "an active request from you to this lawyer for this matter already exists" },
        { status: 409 }
      );
    }
    throw e;
  }

  const requestId = Number(result.lastInsertRowid);

  // Fan out on both parties' wallet channels so the lawyer's inbox shows
  // the new row without a reload (and the client's /matters page stays
  // in sync). No request channel subscriber exists yet — the engagement
  // page only subscribes once the client navigates there.
  emitForRequest(
    {
      kind: "engagement",
      request_id: requestId,
      engagement_id: null,
      detail: { state: "pending" },
    },
    { client_address: address, lawyer_address: parsed.lawyer_address }
  );

  return NextResponse.json({
    ok: true,
    request: {
      id: requestId,
      matter_id: parsed.matter_id,
      client_address: address,
      lawyer_address: parsed.lawyer_address,
      status: "pending",
    },
  });
}
