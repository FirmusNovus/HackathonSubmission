import { NextRequest, NextResponse } from "next/server";
import { parseAbi, parseEventLogs } from "viem";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { readState, redactVerifiedAttrs } from "@/lib/verifier/state";
import { operatorWalletClient, publicClient } from "@/lib/chain/clients";
import { getAddresses } from "@/lib/chain/addresses";

export const runtime = "nodejs";

const ATTESTATION_MANAGER_ABI = parseAbi([
  "function attestVerifiedClient(address subject, string countryOfResidence, bool ageOver18) returns (bytes32)",
  "event Attested(address indexed subject, bytes32 indexed schemaId, bytes32 attestationUid)",
]);

// Defense-in-depth: even though our DCQL only requests
// (address.country, age_equal_or_over.18), reject anything else that might
// nevertheless appear in the disclosed payload. The platform persists nothing
// beyond the country + age-over-18 booleans — see FR-003 below.
const ALLOWED_PID_KEYS = new Set([
  "age_equal_or_over",
  "address",
  // JWT envelope claims (not user data)
  "vct",
  "iss",
  "iat",
  "exp",
]);

const ALLOWED_AGE_KEYS = new Set(["18"]);
const ALLOWED_ADDRESS_KEYS = new Set(["country"]);

export async function POST(req: NextRequest) {
  const address = getSessionAddress();
  if (!address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { state } = (await req.json()) as { state?: string };
  if (!state) {
    return NextResponse.json({ error: "missing state" }, { status: 400 });
  }

  const row = readState(state);
  if (!row) return NextResponse.json({ error: "unknown state" }, { status: 404 });
  if (row.kind !== "pid") {
    return NextResponse.json({ error: "state is not a PID presentation" }, { status: 400 });
  }
  if (row.status !== "verified") {
    return NextResponse.json({ error: `presentation not verified (status=${row.status})` }, { status: 400 });
  }

  const disclosed = row.verified_attrs ? JSON.parse(row.verified_attrs) : {};

  // Disclosed-attribute filter: top level
  for (const k of Object.keys(disclosed)) {
    if (!ALLOWED_PID_KEYS.has(k)) {
      return NextResponse.json(
        { error: `unexpected claim ${k} in PID disclosure — refusing to persist` },
        { status: 400 }
      );
    }
  }

  // Same filter on the nested age_equal_or_over and address objects: only
  // the specific keys we asked for in the DCQL query may pass through.
  if (disclosed.age_equal_or_over && typeof disclosed.age_equal_or_over === "object") {
    for (const k of Object.keys(disclosed.age_equal_or_over)) {
      if (!ALLOWED_AGE_KEYS.has(k)) {
        return NextResponse.json(
          { error: `unexpected age_equal_or_over.${k} — refusing to persist` },
          { status: 400 }
        );
      }
    }
  }
  if (disclosed.address && typeof disclosed.address === "object") {
    for (const k of Object.keys(disclosed.address)) {
      if (!ALLOWED_ADDRESS_KEYS.has(k)) {
        return NextResponse.json(
          { error: `unexpected address.${k} — refusing to persist` },
          { status: 400 }
        );
      }
    }
  }

  const country = disclosed.address?.country as string | undefined;
  const ageOver18 = disclosed.age_equal_or_over?.["18"] as boolean | undefined;
  if (typeof country !== "string") {
    return NextResponse.json({ error: "missing address.country" }, { status: 400 });
  }
  if (typeof ageOver18 !== "boolean") {
    return NextResponse.json({ error: "missing age_equal_or_over.18" }, { status: 400 });
  }

  // Write the on-chain attestation
  const addrs = getAddresses();
  const operator = operatorWalletClient();

  let txHash: `0x${string}`;
  let attestationUid: `0x${string}`;
  try {
    txHash = await operator.writeContract({
      address: addrs.ATTESTATION_MANAGER_ADDRESS,
      abi: ATTESTATION_MANAGER_ABI,
      functionName: "attestVerifiedClient",
      args: [address, country, ageOver18],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    const events = parseEventLogs({
      abi: ATTESTATION_MANAGER_ABI,
      eventName: "Attested",
      logs: receipt.logs,
    });
    if (events.length === 0) {
      throw new Error("no Attested event in receipt — attestation may not have succeeded");
    }
    attestationUid = events[0].args.attestationUid;
  } catch (e) {
    return NextResponse.json({ error: `attestation failed: ${(e as Error).message}` }, { status: 500 });
  }

  // FR-003 (tight): the platform persists ONLY the country + age-over-18
  // booleans for clients. No name, no family_name, no nationalities. The
  // wallet address (`eth_address`) is the only identifier; the engagement
  // page renders clients as `0xE01f…A611 · ES · 18+`, and the lawyer learns
  // a name (if at all) through E2EE messaging — never from the platform DB.
  getDb()
    .prepare(
      `INSERT INTO verified_users (eth_address, attested_role, attested_at, attestation_uid, disclosed_attrs)
       VALUES (?, 'client', ?, ?, ?)
       ON CONFLICT(eth_address, attested_role) DO UPDATE SET
         attested_at = excluded.attested_at,
         attestation_uid = excluded.attestation_uid,
         disclosed_attrs = excluded.disclosed_attrs`
    )
    .run(
      address,
      Math.floor(Date.now() / 1000),
      attestationUid,
      JSON.stringify({
        country_of_residence: country,
        age_equal_or_over_18: ageOver18,
      })
    );

  // Drop the cleartext disclosed attrs from verifier_states now that we've
  // consumed them. The state row stays (audit), the data doesn't.
  redactVerifiedAttrs(state);

  return NextResponse.json({ ok: true, txHash });
}
