import { NextRequest, NextResponse } from "next/server";
import { parseAbi, parseEventLogs } from "viem";

import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { readState, redactVerifiedAttrs } from "@/lib/verifier/state";
import { operatorWalletClient, publicClient } from "@/lib/chain/clients";
import { getAddresses } from "@/lib/chain/addresses";

export const runtime = "nodejs";

const ATTESTATION_MANAGER_ABI = parseAbi([
  "function attestVerifiedClient(address subject, string countryOfResidence, bool ageOver18) returns (bytes32)",
  "event Attested(address indexed subject, bytes32 indexed schemaId, bytes32 attestationUid)",
]);

// Defense-in-depth: even though the DCQL only requests
// (given_name, family_name, address.country, age_equal_or_over.18), reject
// anything else that might nonetheless appear in the disclosed payload. The
// name pair seeds the user's display name on the platform (so their lawyer
// can see who they're talking to + the avatar shows initials); the country
// + age claims become the on-chain verified-client attestation.
const ALLOWED_PID_KEYS = new Set([
  "given_name",
  "family_name",
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
  if (row.kind !== "pid") {
    return NextResponse.json({ error: "state is not a PID presentation" }, { status: 400 });
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
    if (!ALLOWED_PID_KEYS.has(k)) {
      return NextResponse.json(
        { error: `unexpected claim ${k} in PID disclosure — refusing to persist` },
        { status: 400 },
      );
    }
  }
  if (disclosed.age_equal_or_over && typeof disclosed.age_equal_or_over === "object") {
    for (const k of Object.keys(disclosed.age_equal_or_over)) {
      if (!ALLOWED_AGE_KEYS.has(k)) {
        return NextResponse.json(
          { error: `unexpected age_equal_or_over.${k} — refusing to persist` },
          { status: 400 },
        );
      }
    }
  }
  if (disclosed.address && typeof disclosed.address === "object") {
    for (const k of Object.keys(disclosed.address)) {
      if (!ALLOWED_ADDRESS_KEYS.has(k)) {
        return NextResponse.json(
          { error: `unexpected address.${k} — refusing to persist` },
          { status: 400 },
        );
      }
    }
  }

  const country = (disclosed.address as { country?: unknown } | undefined)?.country;
  const ageOver18 = (disclosed.age_equal_or_over as { "18"?: unknown } | undefined)?.["18"];
  const givenName = typeof disclosed.given_name === "string" ? disclosed.given_name : null;
  const familyName = typeof disclosed.family_name === "string" ? disclosed.family_name : null;
  if (typeof country !== "string") {
    return NextResponse.json({ error: "missing address.country" }, { status: 400 });
  }
  if (typeof ageOver18 !== "boolean") {
    return NextResponse.json({ error: "missing age_equal_or_over.18" }, { status: 400 });
  }
  if (!givenName || !familyName) {
    return NextResponse.json(
      { error: "PID disclosure must include given_name + family_name" },
      { status: 400 },
    );
  }

  const addrs = getAddresses();
  const operator = operatorWalletClient();

  let txHash: `0x${string}`;
  let attestationUid: `0x${string}`;
  try {
    txHash = await operator.writeContract({
      address: addrs.ATTESTATION_MANAGER_ADDRESS,
      abi: ATTESTATION_MANAGER_ABI,
      functionName: "attestVerifiedClient",
      args: [address as `0x${string}`, country, ageOver18],
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

  // Set User.name from the PID's given_name + family_name. The name flows
  // through the SIWE session into every <AvatarBubble name=… /> on the
  // platform, so the user's icon shows their actual initials right after
  // the PID step.
  const fullName = `${givenName} ${familyName}`.trim();
  // Upsert (not update) so a stale JWT after a DB wipe self-heals: the SIWE-
  // verified `address` is authoritative, and any prior User row for it was
  // either wiped or didn't exist yet.
  const updated = await prisma.user.upsert({
    where: { walletAddress: address },
    update: {
      clientAttestationUid: attestationUid,
      attestedAt: new Date(),
      name: fullName,
    },
    create: {
      walletAddress: address,
      role: "CLIENT",
      clientAttestationUid: attestationUid,
      attestedAt: new Date(),
      name: fullName,
    },
  });

  // Drop the cleartext disclosed attrs from verifier_states now that we've
  // consumed them. The state row stays for audit; the data doesn't.
  await redactVerifiedAttrs(state);

  return NextResponse.json({ ok: true, txHash, attestationUid, name: updated.name });
}
