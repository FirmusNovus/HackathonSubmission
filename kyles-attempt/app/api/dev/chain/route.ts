import { NextResponse } from "next/server";
import { chainErrorToHttp, isChainError } from "@/lib/chain/errors";
import { __resetClock, __skipTime } from "@/lib/chain/clock";
import {
  anchorTranscript,
  attestOperator,
  attestVerifiedClient,
  attestVerifiedLawyer,
  closeEngagement,
  disputeProposal,
  escalateProposal,
  fundProposal,
  getLatestCapability,
  hasCapability,
  markDelivered,
  mutualRefundProposal,
  openEngagementAndFundFirstProposal,
  openFreeEngagement,
  releaseProposal,
  resolveDispute,
  revokeCapability,
  setConflictRoot,
  type SchemaId,
} from "@/lib/chain/escrow";
import { prisma } from "@/lib/db/client";

// =============================================================================
// Dev-only mock-chain RPC.
// -----------------------------------------------------------------------------
// Mirrors the existing /dev/sign-in pattern: 404 unless we're outside production
// or `ENABLE_MOCK_AUTH === "true"`. Used by the F1 audit Playwright suite to
// drive every entry point on `lib/chain/escrow.ts` end-to-end.
//
// POST { method, args } → dispatch into a whitelisted set of mutating methods.
// GET  ?method=...      → dispatch into a whitelisted set of read methods.
//
// BigInt round-trip: incoming wei amounts are decimal strings (the chain layer
// accepts string|bigint via `weiToBigInt`), and outgoing payloads are run
// through `safeStringify` which converts bigints to strings.
// =============================================================================

function devGuard(): NextResponse | null {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_MOCK_AUTH !== "true") {
    return NextResponse.json({ ok: false, code: "NotFound", message: "Not found" }, { status: 404 });
  }
  return null;
}

function safeStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === "bigint") return v.toString(10);
    if (v instanceof Date) return v.toISOString();
    return v;
  });
}

function ok(result: unknown) {
  return new NextResponse(safeStringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fail(err: unknown) {
  if (isChainError(err)) {
    const { status, body } = chainErrorToHttp(err);
    return new NextResponse(safeStringify({ ok: false, ...body }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new NextResponse(safeStringify({ ok: false, code: "InternalError", message }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });
}

// -----------------------------------------------------------------------------
// Mutating dispatch (POST)
// -----------------------------------------------------------------------------

type Args = Record<string, unknown>;

const MUTATIONS: Record<string, (args: Args) => Promise<unknown>> = {
  // Capability surface (AttestationManager).
  attestVerifiedLawyer: (a) =>
    attestVerifiedLawyer({
      subject: String(a.subject),
      claims: (a.claims as Record<string, unknown>) ?? {},
      from: String(a.from),
      expiresAt: a.expiresAt ? new Date(String(a.expiresAt)) : null,
    }),
  attestVerifiedClient: (a) =>
    attestVerifiedClient({
      subject: String(a.subject),
      claims: (a.claims as Record<string, unknown>) ?? {},
      from: String(a.from),
      expiresAt: a.expiresAt ? new Date(String(a.expiresAt)) : null,
    }),
  attestOperator: (a) =>
    attestOperator({
      subject: String(a.subject),
      claims: (a.claims as Record<string, unknown>) ?? {},
      from: String(a.from),
      expiresAt: a.expiresAt ? new Date(String(a.expiresAt)) : null,
    }),
  revokeCapability: (a) => revokeCapability({ uid: String(a.uid), from: String(a.from) }),

  // ZK conflict-root.
  setConflictRoot: (a) =>
    setConflictRoot({
      lawyerAddress: String(a.lawyerAddress),
      root: String(a.root),
      from: String(a.from),
    }),

  // Engagement / proposal lifecycle.
  openFreeEngagement: (a) =>
    openFreeEngagement({
      client: String(a.client),
      lawyer: String(a.lawyer),
      matterRef: String(a.matterRef),
      zkProof: String(a.zkProof),
      zkNullifier: String(a.zkNullifier),
      initialTranscriptRoot: a.initialTranscriptRoot ? String(a.initialTranscriptRoot) : undefined,
    }),
  openEngagementAndFundFirstProposal: (a) =>
    openEngagementAndFundFirstProposal({
      client: String(a.client),
      lawyer: String(a.lawyer),
      matterRef: String(a.matterRef),
      amountWei: String(a.amountWei),
      valueWei: String(a.valueWei ?? a.amountWei),
      zkProof: String(a.zkProof),
      zkNullifier: String(a.zkNullifier),
      initialTranscriptRoot: a.initialTranscriptRoot ? String(a.initialTranscriptRoot) : undefined,
    }),
  fundProposal: (a) =>
    fundProposal({
      engagementId: Number(a.engagementId),
      amountWei: String(a.amountWei),
      valueWei: String(a.valueWei ?? a.amountWei),
      itemsHash: String(a.itemsHash),
      nonce: String(a.nonce),
      lawyerOfferSig: String(a.lawyerOfferSig),
      from: String(a.from),
    }),
  markDelivered: (a) =>
    markDelivered({
      engagementId: Number(a.engagementId),
      proposalIndex: Number(a.proposalIndex),
      from: String(a.from),
    }),
  releaseProposal: (a) =>
    releaseProposal({
      engagementId: Number(a.engagementId),
      proposalIndex: Number(a.proposalIndex),
      from: String(a.from),
    }),
  mutualRefundProposal: (a) =>
    mutualRefundProposal({
      engagementId: Number(a.engagementId),
      proposalIndex: Number(a.proposalIndex),
      // F6: nonce is optional — A's typed-data shape doesn't include one.
      nonce: a.nonce == null ? null : String(a.nonce),
      clientSig: String(a.clientSig ?? ""),
      lawyerSig: String(a.lawyerSig ?? ""),
      from: String(a.from),
    }),
  disputeProposal: (a) =>
    disputeProposal({
      engagementId: Number(a.engagementId),
      proposalIndex: Number(a.proposalIndex),
      transcriptRoot: String(a.transcriptRoot),
      from: String(a.from),
    }),
  escalateProposal: (a) =>
    escalateProposal({
      engagementId: Number(a.engagementId),
      proposalIndex: Number(a.proposalIndex),
      transcriptRoot: String(a.transcriptRoot),
      from: String(a.from),
    }),
  resolveDispute: (a) =>
    resolveDispute({
      engagementId: Number(a.engagementId),
      proposalIndex: Number(a.proposalIndex),
      toLawyerWei: String(a.toLawyerWei),
      toClientWei: String(a.toClientWei),
      from: String(a.from),
    }),
  anchorTranscript: (a) =>
    anchorTranscript({
      engagementId: Number(a.engagementId),
      newRoot: String(a.newRoot),
      from: String(a.from),
    }),
  closeEngagement: (a) =>
    closeEngagement({
      engagementId: Number(a.engagementId),
      finalRoot: String(a.finalRoot),
      from: String(a.from),
    }),

  // Mock-clock helpers.
  __skipTime: async (a) => ({ offsetSeconds: await __skipTime(Number(a.seconds)) }),
  __resetClock: async () => {
    await __resetClock();
    return { offsetSeconds: 0 };
  },
};

export async function POST(request: Request) {
  const guarded = devGuard();
  if (guarded) return guarded;
  let body: { method?: string; args?: Args };
  try {
    body = (await request.json()) as { method?: string; args?: Args };
  } catch {
    return fail(new Error("Invalid JSON body"));
  }
  const method = body.method;
  if (!method || !Object.prototype.hasOwnProperty.call(MUTATIONS, method)) {
    return new NextResponse(safeStringify({ ok: false, code: "UnknownMethod", message: `Unknown method: ${method}` }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  try {
    const result = await MUTATIONS[method](body.args ?? {});
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

// -----------------------------------------------------------------------------
// Read-only dispatch (GET)
// -----------------------------------------------------------------------------

export async function GET(request: Request) {
  const guarded = devGuard();
  if (guarded) return guarded;
  const url = new URL(request.url);
  const method = url.searchParams.get("method");
  try {
    switch (method) {
      case "hasCapability": {
        const subject = url.searchParams.get("subject") ?? "";
        const schemaId = (url.searchParams.get("schemaId") ?? "") as SchemaId;
        return ok({ hasCapability: await hasCapability(subject, schemaId) });
      }
      case "getLatestCapability": {
        const subject = url.searchParams.get("subject") ?? "";
        const schemaId = (url.searchParams.get("schemaId") ?? "") as SchemaId;
        return ok({ capability: await getLatestCapability(subject, schemaId) });
      }
      case "getEngagement": {
        const engagementId = Number(url.searchParams.get("engagementId"));
        const engagement = await prisma.engagement.findUnique({
          where: { engagementId },
          include: { proposals: { orderBy: { proposalIndex: "asc" } } },
        });
        return ok({ engagement });
      }
      case "getEvents": {
        const engagementId = Number(url.searchParams.get("engagementId"));
        const events = await prisma.chainEvent.findMany({
          where: { engagementId },
          orderBy: { blockNumber: "asc" },
        });
        return ok({ events });
      }
      case "getOperator": {
        // Convenience for tests — surfaces the configured operator address.
        const { OPERATOR_ADDRESS } = await import("@/lib/chain/escrow");
        return ok({ operator: OPERATOR_ADDRESS });
      }
      default:
        return new NextResponse(
          safeStringify({ ok: false, code: "UnknownMethod", message: `Unknown read method: ${method}` }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
    }
  } catch (err) {
    return fail(err);
  }
}
