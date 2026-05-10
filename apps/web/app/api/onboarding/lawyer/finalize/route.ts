import { NextRequest, NextResponse } from "next/server";
import { parseAbi, parseEventLogs } from "viem";

import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
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
  const t = Date.parse(date + "T00:00:00Z");
  if (Number.isNaN(t)) throw new Error(`invalid date string ${date}`);
  return Math.floor(t / 1000);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const address = session?.user?.walletAddress?.toLowerCase();
  if (!address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { state } = (await req.json().catch(() => ({}))) as { state?: string };
  if (!state) {
    return NextResponse.json({ error: "missing state" }, { status: 400 });
  }

  const row = await readState(state);
  if (!row) return NextResponse.json({ error: "unknown state" }, { status: 404 });
  if (row.kind !== "bar") {
    return NextResponse.json({ error: "state is not a bar presentation" }, { status: 400 });
  }
  if (row.status !== "verified") {
    return NextResponse.json(
      { error: `presentation not verified (status=${row.status})` },
      { status: 400 },
    );
  }

  const disclosed = (row.verified_attrs ? JSON.parse(row.verified_attrs) : {}) as Record<
    string,
    unknown
  >;

  for (const k of Object.keys(disclosed)) {
    if (!ALLOWED_BAR_KEYS.has(k)) {
      return NextResponse.json(
        { error: `unexpected claim ${k} in bar disclosure — refusing to persist` },
        { status: 400 },
      );
    }
  }
  const required = ["jurisdiction", "bar_admission_date", "bar_admission_number", "valid_until"] as const;
  for (const k of required) {
    if (!(k in disclosed)) {
      return NextResponse.json({ error: `missing required claim ${k}` }, { status: 400 });
    }
  }

  const admittedAtUnix = isoDateToUnix(String(disclosed.bar_admission_date));
  const validUntilUnix = isoDateToUnix(String(disclosed.valid_until));

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
        address as `0x${string}`,
        String(disclosed.jurisdiction),
        String(disclosed.bar_admission_number),
        BigInt(admittedAtUnix),
        BigInt(validUntilUnix),
      ],
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
    return NextResponse.json(
      { error: `attestation failed: ${(e as Error).message}` },
      { status: 500 },
    );
  }

  // Update User. Then upsert a LawyerProfile so the lawyer can immediately
  // use /lawyer/dashboard and /lawyer/profile/edit without falling back to
  // the legacy /verify-lawyer manual form. Bar-credential-derived fields are
  // populated from the disclosure; marketplace-only fields (bio, hourly rate,
  // headline, languages, specialties) get sensible placeholders that the
  // lawyer can edit later via the profile editor.
  // Upsert: same self-healing rationale as client/finalize — a stale JWT
  // after a DB wipe shouldn't 500 the second-stage attestation.
  const fullName =
    disclosed.given_name && disclosed.family_name
      ? `${String(disclosed.given_name)} ${String(disclosed.family_name)}`
      : undefined;
  const updated = await prisma.user.upsert({
    where: { walletAddress: address },
    update: {
      role: "LAWYER",
      lawyerAttestationUid: attestationUid,
      attestedAt: new Date(),
      name: fullName,
    },
    create: {
      walletAddress: address,
      role: "LAWYER",
      lawyerAttestationUid: attestationUid,
      attestedAt: new Date(),
      name: fullName,
    },
  });

  await prisma.lawyerProfile.upsert({
    where: { userId: updated.id },
    update: {
      verificationStatus: "VERIFIED",
      barRegistrationNum: String(disclosed.bar_admission_number),
      barJurisdiction: String(disclosed.jurisdiction),
      admissionDate: new Date(admittedAtUnix * 1000),
    },
    create: {
      userId: updated.id,
      city: "—",
      headline: "Licensed legal professional",
      bio: "Profile pending — edit to add specialties, languages, and hourly rate.",
      specialties: "[]",
      languages: "[]",
      jurisdictions: JSON.stringify([String(disclosed.jurisdiction)]),
      pricingKind: "HOURLY",
      pricingHeadline: "0.06 ETH / hr",
      hourlyRateEUR: 0.06,
      consultationRate30: 0.03,
      consultationRate60: 0.06,
      yearsExperience: 0,
      verificationStatus: "VERIFIED",
      barRegistrationNum: String(disclosed.bar_admission_number),
      barJurisdiction: String(disclosed.jurisdiction),
      admissionDate: new Date(admittedAtUnix * 1000),
    },
  });

  await redactVerifiedAttrs(state);

  return NextResponse.json({ ok: true, txHash, attestationUid, name: updated.name });
}
