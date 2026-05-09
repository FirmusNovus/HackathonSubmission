import { NextRequest, NextResponse } from "next/server";
import { parseAbi, parseEventLogs } from "viem";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { readState, redactVerifiedAttrs } from "@/lib/verifier/state";
import { operatorWalletClient, publicClient } from "@/lib/chain/clients";
import { getAddresses } from "@/lib/chain/addresses";

export const runtime = "nodejs";

const ATTESTATION_MANAGER_ABI = parseAbi([
  "function attestVerifiedLawyer(address subject, string jurisdiction, string barAdmissionNumber, uint64 admittedAt, uint64 validUntil) returns (bytes32)",
  "event Attested(address indexed subject, bytes32 indexed schemaId, bytes32 attestationUid)",
]);

const ALLOWED_BAR_KEYS = new Set([
  "given_name",
  "family_name",
  "jurisdiction",
  "bar_admission_date",
  "bar_admission_number",
  "valid_until",
  "vct",
  "iss",
  "iat",
  "exp",
]);

function isoDateToUnix(date: string): number {
  // Accept "YYYY-MM-DD" — interpret as UTC midnight.
  const t = Date.parse(date + "T00:00:00Z");
  if (Number.isNaN(t)) throw new Error(`invalid date string ${date}`);
  return Math.floor(t / 1000);
}

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
  if (row.kind !== "bar") {
    return NextResponse.json({ error: "state is not a bar presentation" }, { status: 400 });
  }
  if (row.status !== "verified") {
    return NextResponse.json({ error: `presentation not verified (status=${row.status})` }, { status: 400 });
  }

  const disclosed = row.verified_attrs ? JSON.parse(row.verified_attrs) : {};

  // FR-003 / FR-029: enforce the disclosed-attribute filter — reject anything
  // not in the allowed set. This is the contract surface that prevents the
  // platform from accidentally persisting more than what was meant to be
  // disclosed (extras would only appear if the issuer included them and the
  // verifier accepted them).
  for (const k of Object.keys(disclosed)) {
    if (!ALLOWED_BAR_KEYS.has(k)) {
      return NextResponse.json(
        { error: `unexpected claim ${k} in bar disclosure — refusing to persist` },
        { status: 400 }
      );
    }
  }

  const required = ["jurisdiction", "bar_admission_date", "bar_admission_number", "valid_until"] as const;
  for (const k of required) {
    if (!(k in disclosed)) {
      return NextResponse.json({ error: `missing required claim ${k}` }, { status: 400 });
    }
  }

  // Translate date strings to unix seconds for the on-chain attestation.
  const admittedAtUnix = isoDateToUnix(String(disclosed.bar_admission_date));
  const validUntilUnix = isoDateToUnix(String(disclosed.valid_until));

  // Write the on-chain attestation (operator wallet)
  const addrs = getAddresses();
  const operator = operatorWalletClient();

  let txHash: `0x${string}`;
  let attestationUid: `0x${string}`;
  try {
    txHash = await operator.writeContract({
      address: addrs.ATTESTATION_MANAGER_ADDRESS,
      abi: ATTESTATION_MANAGER_ABI,
      functionName: "attestVerifiedLawyer",
      args: [
        address,
        String(disclosed.jurisdiction),
        String(disclosed.bar_admission_number),
        BigInt(admittedAtUnix),
        BigInt(validUntilUnix),
      ],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    // The EAS attestation UID isn't the tx hash — it's the third arg of the
    // AttestationManager's `Attested` event. Pull it out of the receipt logs.
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

  // Mirror into verified_users (the indexer will also pick this up but we set
  // it now for the immediate UI redirect)
  getDb()
    .prepare(
      `INSERT INTO verified_users (eth_address, attested_role, attested_at, attestation_uid, disclosed_attrs)
       VALUES (?, 'lawyer', ?, ?, ?)
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
        given_name: disclosed.given_name,
        family_name: disclosed.family_name,
        jurisdiction: disclosed.jurisdiction,
        bar_admission_date: disclosed.bar_admission_date,
        bar_admission_number: disclosed.bar_admission_number,
        valid_until: disclosed.valid_until,
      })
    );

  // Drop the cleartext disclosed attrs from verifier_states now that we've
  // copied what we need into verified_users. Keeps the audit row but stops
  // verifier_states from being a second persistent copy of personal data.
  redactVerifiedAttrs(state);

  return NextResponse.json({ ok: true, txHash });
}
