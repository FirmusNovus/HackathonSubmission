import { expect, test, type APIRequestContext } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount, signTypedData } from "viem/accounts";
import { keccak256, toHex } from "viem";
import { reseedDatabase } from "./_helpers";

// F6: derive the deterministic dev-signer private key for an arbitrary
// wallet address. Mirrors `devPrivateKeyForWallet` from `lib/chain/dev-signer.ts`
// but inlined here so the test file stays edge-bundle-safe.
function devPrivateKeyForWallet(walletAddress: string): `0x${string}` {
  const seed = `firmus-novus/dev-key/${walletAddress.toLowerCase()}`;
  return keccak256(toHex(seed)) as `0x${string}`;
}

async function signMutualRefundFor(args: {
  walletAddress: string;
  engagementId: number;
  proposalIndex: number;
}): Promise<`0x${string}`> {
  const pk = devPrivateKeyForWallet(args.walletAddress);
  // Domain mirrors `escrowDomain()` in `lib/chain/eip712.ts` — production
  // would resolve the verifying contract from on-chain state, but the
  // mock chain has a stable singleton.
  const sig = await signTypedData({
    privateKey: pk,
    domain: {
      name: "FirmusNovusEscrow",
      version: "1",
      chainId: 1,
      verifyingContract: "0xe5c70011111111111111111111111111111e5c70", // mock escrow addr (lib/chain/addresses.ts)
    },
    types: {
      MutualRefundAuthorization: [
        { name: "engagementId", type: "uint256" },
        { name: "proposalIndex", type: "uint256" },
      ],
    },
    primaryType: "MutualRefundAuthorization",
    message: {
      engagementId: BigInt(args.engagementId),
      proposalIndex: BigInt(args.proposalIndex),
    },
  });
  return sig;
}

// =============================================================================
// Feature 1 — mock-chain foundation parity tests.
//
// Drives every entry point in `lib/chain/escrow.ts` through the dev-only
// `/api/dev/chain` RPC and asserts each one matches the corresponding revert
// behaviour from `LegalEngagementEscrow.sol`. Each scenario is the moral twin
// of one Foundry test from System A.
//
// The whole spec re-seeds the DB at the top so the engagementId sequence is
// predictable across runs (the seed wipes `MockChainCounter`). Inside each
// describe-block we mint fresh capabilities + addresses so two scenarios don't
// stomp on the same nullifier / nonce.
// =============================================================================

const OPERATOR = "0x09e8a70811111111111111111111111111111bbb";

// 65-byte (r||s||v) hex shape — the mock checks shape only (TODO(F4): real EIP-712).
const VALID_SIG_SHAPE = "0x" + "ab".repeat(65);
const ROOT_A = "0x" + "11".repeat(32);
const ROOT_B = "0x" + "22".repeat(32);
const ROOT_C = "0x" + "33".repeat(32);
const MATTER_REF = "0x" + "ff".repeat(32);
const ZK_PROOF = "0x" + "cd".repeat(64);

let suiteCounter = 0;
function uniqueAddr(prefix: string): string {
  suiteCounter += 1;
  // Pad to 40 hex chars (20 bytes). `suiteCounter` is small — pad-front w/ zeros.
  const tail = suiteCounter.toString(16).padStart(8, "0");
  // Keep it lowercase, deterministic, and clearly distinct from the seeded
  // wallet address ranges (0x1111…, 0x2222…).
  return `0x${prefix}${"0".repeat(40 - prefix.length - tail.length)}${tail}`.toLowerCase();
}

function uniqueHex32(label: string): string {
  // Build a deterministic 32-byte hex string seeded by label + counter.
  suiteCounter += 1;
  const tail = (label + suiteCounter.toString()).slice(-8).padEnd(8, "x");
  let out = "0x";
  for (const ch of tail) {
    out += ch.charCodeAt(0).toString(16).padStart(2, "0");
  }
  while (out.length < 66) out += "0";
  return out.slice(0, 66);
}

type ChainResp<T = unknown> = {
  ok: boolean;
  result?: T;
  code?: string;
  message?: string;
  unlockAt?: string;
};

async function rpc<T = unknown>(
  request: APIRequestContext,
  method: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: ChainResp<T> }> {
  const r = await request.post("/api/dev/chain", { data: { method, args } });
  let body: ChainResp<T>;
  try {
    body = (await r.json()) as ChainResp<T>;
  } catch {
    body = { ok: false, code: "ParseError", message: await r.text() };
  }
  return { status: r.status(), body };
}

async function rpcGet<T = unknown>(
  request: APIRequestContext,
  method: string,
  params: Record<string, string | number>,
): Promise<{ status: number; body: ChainResp<T> }> {
  const qs = new URLSearchParams({ method });
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const r = await request.get(`/api/dev/chain?${qs.toString()}`);
  let body: ChainResp<T>;
  try {
    body = (await r.json()) as ChainResp<T>;
  } catch {
    body = { ok: false, code: "ParseError", message: await r.text() };
  }
  return { status: r.status(), body };
}

/**
 * Mint a verified-client + verified-lawyer pair via the operator. Returns the
 * fresh addresses so the caller can use them in subsequent escrow calls.
 */
async function mintPair(request: APIRequestContext) {
  const client = uniqueAddr("c1");
  const lawyer = uniqueAddr("12");
  const reset = await rpc(request, "__resetClock", {});
  expect(reset.body.ok, "reset clock").toBe(true);
  const a1 = await rpc(request, "attestVerifiedClient", {
    subject: client,
    from: OPERATOR,
    claims: { countryOfResidence: "EU", ageOver18: true },
  });
  expect(a1.body.ok, JSON.stringify(a1.body)).toBe(true);
  const a2 = await rpc(request, "attestVerifiedLawyer", {
    subject: lawyer,
    from: OPERATOR,
    claims: { jurisdiction: "DE", barAdmissionNumber: "X-1", admittedAt: 0, validUntil: 0 },
  });
  expect(a2.body.ok, JSON.stringify(a2.body)).toBe(true);
  return { client, lawyer };
}

test.describe.serial("mock-chain foundation — parity with LegalEngagementEscrow.sol", () => {
  test.beforeAll(() => {
    reseedDatabase();
  });

  test("chain-health — GET /api/chain-health is healthy in mock mode", async ({ request }) => {
    const r = await request.get("/api/chain-health");
    expect(r.status()).toBe(200);
    const body = (await r.json()) as { ok: boolean; mode: string; blockNumber: number };
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("mock");
    expect(typeof body.blockNumber).toBe("number");
  });

  test("attest gating — non-operator cannot attest (OnlyOperator)", async ({ request }) => {
    const subject = uniqueAddr("c2");
    const not = uniqueAddr("99");
    const r = await rpc(request, "attestVerifiedClient", {
      subject,
      from: not,
      claims: {},
    });
    expect(r.body.ok).toBe(false);
    expect(r.body.code).toBe("OnlyOperator");
    expect(r.status).toBe(403);
  });

  test("happy-path-paid — open + fund → markDelivered → release; events + state line up", async ({ request }) => {
    const { client, lawyer } = await mintPair(request);
    const nullifier = uniqueHex32("hp");

    const open = await rpc<{ engagementId: number; proposalIndex: number; txHash: string }>(
      request,
      "openEngagementAndFundFirstProposal",
      {
        client,
        lawyer,
        matterRef: MATTER_REF,
        amountWei: "1000000000000000000",
        valueWei: "1000000000000000000",
        zkProof: ZK_PROOF,
        zkNullifier: nullifier,
        initialTranscriptRoot: ROOT_A,
      },
    );
    expect(open.body.ok, JSON.stringify(open.body)).toBe(true);
    const engagementId = open.body.result!.engagementId;
    expect(engagementId).toBeGreaterThan(0);

    const deliver = await rpc(request, "markDelivered", {
      engagementId,
      proposalIndex: 0,
      from: lawyer,
    });
    expect(deliver.body.ok, JSON.stringify(deliver.body)).toBe(true);

    const release = await rpc(request, "releaseProposal", {
      engagementId,
      proposalIndex: 0,
      from: client,
    });
    expect(release.body.ok, JSON.stringify(release.body)).toBe(true);

    // State assertion — pulled from the indexer-mirrored Engagement row.
    const eng = await rpcGet<{
      engagement: {
        state: string;
        proposalCount: number;
        proposals: Array<{ state: string; amountToLawyerWei: string | null }>;
      };
    }>(request, "getEngagement", { engagementId });
    expect(eng.body.ok).toBe(true);
    expect(eng.body.result!.engagement.state).toBe("ACTIVE");
    expect(eng.body.result!.engagement.proposalCount).toBe(1);
    expect(eng.body.result!.engagement.proposals[0].state).toBe("RELEASED");
    expect(eng.body.result!.engagement.proposals[0].amountToLawyerWei).toBe("1000000000000000000");

    // Event-log shape — every state transition emitted exactly once.
    const events = await rpcGet<{ events: Array<{ kind: string }> }>(request, "getEvents", { engagementId });
    expect(events.body.ok).toBe(true);
    const kinds = events.body.result!.events.map((e) => e.kind);
    expect(kinds).toContain("EngagementOpened");
    expect(kinds).toContain("ProposalFunded");
    expect(kinds).toContain("ProposalDelivered");
    expect(kinds).toContain("ProposalReleased");
    expect(kinds).toContain("TranscriptAnchored");
  });

  test("cooldown-revert — escalate before 30d → CooldownNotElapsed; after → succeeds → resolveDispute sum-equality", async ({ request }) => {
    const { client, lawyer } = await mintPair(request);
    const open = await rpc<{ engagementId: number }>(
      request,
      "openEngagementAndFundFirstProposal",
      {
        client,
        lawyer,
        matterRef: MATTER_REF,
        amountWei: "5000",
        valueWei: "5000",
        zkProof: ZK_PROOF,
        zkNullifier: uniqueHex32("cd"),
      },
    );
    expect(open.body.ok).toBe(true);
    const engagementId = open.body.result!.engagementId;

    await rpc(request, "markDelivered", { engagementId, proposalIndex: 0, from: lawyer });

    // Pre-cooldown: must revert with CooldownNotElapsed AND populate unlockAt.
    const pre = await rpc(request, "escalateProposal", {
      engagementId,
      proposalIndex: 0,
      transcriptRoot: ROOT_B,
      from: lawyer,
    });
    expect(pre.body.ok).toBe(false);
    expect(pre.body.code).toBe("CooldownNotElapsed");
    expect(pre.status).toBe(425);
    expect(pre.body.unlockAt).toMatch(/T.*Z$/);
    const unlockAt = new Date(pre.body.unlockAt!).getTime();
    expect(unlockAt).toBeGreaterThan(Date.now());

    // Skip 31 days (matches Solidity LAWYER_DISPUTE_COOLDOWN = 30 days).
    const skip = await rpc(request, "__skipTime", { seconds: 31 * 86400 });
    expect(skip.body.ok).toBe(true);

    const post = await rpc(request, "escalateProposal", {
      engagementId,
      proposalIndex: 0,
      transcriptRoot: ROOT_B,
      from: lawyer,
    });
    expect(post.body.ok, JSON.stringify(post.body)).toBe(true);

    // Sum-equality must hold: 3000 + 2000 == 5000.
    const resolve = await rpc(request, "resolveDispute", {
      engagementId,
      proposalIndex: 0,
      toLawyerWei: "3000",
      toClientWei: "2000",
      from: OPERATOR,
    });
    expect(resolve.body.ok, JSON.stringify(resolve.body)).toBe(true);

    await rpc(request, "__resetClock", {});
  });

  test("resolve-split-mismatch — toLawyer + toClient !== amount → InvalidSplit", async ({ request }) => {
    const { client, lawyer } = await mintPair(request);
    const open = await rpc<{ engagementId: number }>(
      request,
      "openEngagementAndFundFirstProposal",
      {
        client,
        lawyer,
        matterRef: MATTER_REF,
        amountWei: "1000",
        valueWei: "1000",
        zkProof: ZK_PROOF,
        zkNullifier: uniqueHex32("sm"),
      },
    );
    expect(open.body.ok).toBe(true);
    const engagementId = open.body.result!.engagementId;
    await rpc(request, "markDelivered", { engagementId, proposalIndex: 0, from: lawyer });
    await rpc(request, "__skipTime", { seconds: 31 * 86400 });
    await rpc(request, "escalateProposal", {
      engagementId,
      proposalIndex: 0,
      transcriptRoot: ROOT_B,
      from: lawyer,
    });

    // Off-by-one over.
    const over = await rpc(request, "resolveDispute", {
      engagementId,
      proposalIndex: 0,
      toLawyerWei: "501",
      toClientWei: "500",
      from: OPERATOR,
    });
    expect(over.body.ok).toBe(false);
    expect(over.body.code).toBe("InvalidSplit");
    expect(over.status).toBe(422);

    // Off-by-one under.
    const under = await rpc(request, "resolveDispute", {
      engagementId,
      proposalIndex: 0,
      toLawyerWei: "499",
      toClientWei: "500",
      from: OPERATOR,
    });
    expect(under.body.ok).toBe(false);
    expect(under.body.code).toBe("InvalidSplit");

    // Resolve cleanly so the test leaves the engagement in a terminal state.
    const ok = await rpc(request, "resolveDispute", {
      engagementId,
      proposalIndex: 0,
      toLawyerWei: "1000",
      toClientWei: "0",
      from: OPERATOR,
    });
    expect(ok.body.ok).toBe(true);

    await rpc(request, "__resetClock", {});
  });

  test("nullifier-reuse — second open with same nullifier reverts NullifierAlreadyUsed", async ({ request }) => {
    const { client, lawyer } = await mintPair(request);
    const dup = uniqueHex32("nu");

    const first = await rpc(request, "openEngagementAndFundFirstProposal", {
      client,
      lawyer,
      matterRef: MATTER_REF,
      amountWei: "100",
      valueWei: "100",
      zkProof: ZK_PROOF,
      zkNullifier: dup,
    });
    expect(first.body.ok, JSON.stringify(first.body)).toBe(true);

    const second = await rpc(request, "openEngagementAndFundFirstProposal", {
      client,
      lawyer,
      matterRef: MATTER_REF,
      amountWei: "100",
      valueWei: "100",
      zkProof: ZK_PROOF,
      zkNullifier: dup,
    });
    expect(second.body.ok).toBe(false);
    expect(second.body.code).toBe("NullifierAlreadyUsed");
    expect(second.status).toBe(409);
  });

  test("nonce-reuse — fundProposal with consumed nonce reverts NonceAlreadyUsed", async ({ request }) => {
    // F4: fundProposal now does REAL EIP-712 verification, so the lawyer
    // address has to be derived from a private key we hold in-test. Mint a
    // fresh keypair, attest the lawyer at that address, then sign the offer
    // for real before calling fundProposal.
    const lawyerPk = generatePrivateKey();
    const lawyer = privateKeyToAccount(lawyerPk).address.toLowerCase();
    const client = uniqueAddr("c1");
    const reset = await rpc(request, "__resetClock", {});
    expect(reset.body.ok).toBe(true);
    expect(
      (await rpc(request, "attestVerifiedClient", {
        subject: client,
        from: OPERATOR,
        claims: { countryOfResidence: "EU", ageOver18: true },
      })).body.ok,
    ).toBe(true);
    expect(
      (await rpc(request, "attestVerifiedLawyer", {
        subject: lawyer,
        from: OPERATOR,
        claims: { jurisdiction: "DE", barAdmissionNumber: "X-1", admittedAt: 0, validUntil: 0 },
      })).body.ok,
    ).toBe(true);

    const open = await rpc<{ engagementId: number }>(
      request,
      "openEngagementAndFundFirstProposal",
      {
        client,
        lawyer,
        matterRef: MATTER_REF,
        amountWei: "100",
        valueWei: "100",
        zkProof: ZK_PROOF,
        zkNullifier: uniqueHex32("no"),
      },
    );
    expect(open.body.ok).toBe(true);
    const engagementId = open.body.result!.engagementId;
    const nonce = uniqueHex32("nx");
    const itemsHash = ROOT_A;

    // Real EIP-712 signature over (engagementId, amount, itemsHash, nonce).
    // Domain mirrors `lib/chain/eip712.ts` — must stay in sync.
    const domain = {
      name: "FirmusNovusEscrow",
      version: "1",
      chainId: 1,
      verifyingContract: "0xe5c70011111111111111111111111111111e5c70" as const,
    };
    const types = {
      ProposalOffer: [
        { name: "engagementId", type: "uint256" },
        { name: "amount", type: "uint256" },
        { name: "itemsHash", type: "bytes32" },
        { name: "nonce", type: "bytes32" },
      ],
    } as const;
    const sig = await signTypedData({
      privateKey: lawyerPk,
      domain,
      types,
      primaryType: "ProposalOffer",
      message: {
        engagementId: BigInt(engagementId),
        amount: 200n,
        itemsHash: itemsHash as `0x${string}`,
        nonce: nonce as `0x${string}`,
      },
    });

    const first = await rpc(request, "fundProposal", {
      engagementId,
      amountWei: "200",
      valueWei: "200",
      itemsHash,
      nonce,
      lawyerOfferSig: sig,
      from: client,
    });
    expect(first.body.ok, JSON.stringify(first.body)).toBe(true);

    const second = await rpc(request, "fundProposal", {
      engagementId,
      amountWei: "200",
      valueWei: "200",
      itemsHash,
      nonce, // intentionally re-use
      lawyerOfferSig: sig,
      from: client,
    });
    expect(second.body.ok).toBe(false);
    expect(second.body.code).toBe("NonceAlreadyUsed");
    expect(second.status).toBe(409);
  });

  test("mutual-refund — happy path; second call → InvalidProposalState; missing sig → InvalidRefundSignature", async ({ request }) => {
    const { client, lawyer } = await mintPair(request);
    const open = await rpc<{ engagementId: number }>(
      request,
      "openEngagementAndFundFirstProposal",
      {
        client,
        lawyer,
        matterRef: MATTER_REF,
        amountWei: "999",
        valueWei: "999",
        zkProof: ZK_PROOF,
        zkNullifier: uniqueHex32("mr"),
      },
    );
    expect(open.body.ok).toBe(true);
    const engagementId = open.body.result!.engagementId;

    // F6: real EIP-712 sigs derived from the deterministic dev-key per
    // wallet. Shadow-user creation in `resolveUserId` populates the
    // matching `devSignerAddress`, so recovery succeeds via the dev fallback.
    const clientSig = await signMutualRefundFor({
      walletAddress: client,
      engagementId,
      proposalIndex: 0,
    });
    const lawyerSig = await signMutualRefundFor({
      walletAddress: lawyer,
      engagementId,
      proposalIndex: 0,
    });

    // Missing one sig (empty string fails shape check) → InvalidRefundSignature.
    const missing = await rpc(request, "mutualRefundProposal", {
      engagementId,
      proposalIndex: 0,
      clientSig,
      lawyerSig: "",
      from: client,
    });
    expect(missing.body.ok).toBe(false);
    expect(missing.body.code).toBe("InvalidRefundSignature");
    expect(missing.status).toBe(422);

    // Happy path — both sigs present and recover to the right wallets.
    const ok = await rpc(request, "mutualRefundProposal", {
      engagementId,
      proposalIndex: 0,
      clientSig,
      lawyerSig,
      from: client,
    });
    expect(ok.body.ok, JSON.stringify(ok.body)).toBe(true);

    // Second call on the now-Refunded proposal must InvalidProposalState
    // (not Refundable). Single-shot replay safety from the state-machine
    // transition — even with valid sigs, the proposal isn't Funded any more.
    const dup = await rpc(request, "mutualRefundProposal", {
      engagementId,
      proposalIndex: 0,
      clientSig,
      lawyerSig,
      from: client,
    });
    expect(dup.body.ok).toBe(false);
    expect(dup.body.code).toBe("InvalidProposalState");
    expect(dup.status).toBe(409);
  });

  test("mutual-refund — Delivered proposal cannot be mutually refunded (only Funded is refundable)", async ({ request }) => {
    const { client, lawyer } = await mintPair(request);
    const open = await rpc<{ engagementId: number }>(
      request,
      "openEngagementAndFundFirstProposal",
      {
        client,
        lawyer,
        matterRef: MATTER_REF,
        amountWei: "100",
        valueWei: "100",
        zkProof: ZK_PROOF,
        zkNullifier: uniqueHex32("md"),
      },
    );
    expect(open.body.ok).toBe(true);
    const engagementId = open.body.result!.engagementId;

    // Mark delivered, then attempt mutual refund. Real EIP-712 sigs so the
    // recovery succeeds — the failure must come from the proposal-state
    // check, not the signature-recovery path. (If sigs failed first the test
    // wouldn't prove the Funded-only invariant.)
    await rpc(request, "markDelivered", { engagementId, proposalIndex: 0, from: lawyer });
    const clientSig = await signMutualRefundFor({
      walletAddress: client,
      engagementId,
      proposalIndex: 0,
    });
    const lawyerSig = await signMutualRefundFor({
      walletAddress: lawyer,
      engagementId,
      proposalIndex: 0,
    });
    const r = await rpc(request, "mutualRefundProposal", {
      engagementId,
      proposalIndex: 0,
      clientSig,
      lawyerSig,
      from: client,
    });
    expect(r.body.ok).toBe(false);
    expect(r.body.code).toBe("InvalidProposalState");
  });

  test("closure-blocks — open + fund → close → EngagementNotClean; release → close succeeds", async ({ request }) => {
    const { client, lawyer } = await mintPair(request);
    const open = await rpc<{ engagementId: number }>(
      request,
      "openEngagementAndFundFirstProposal",
      {
        client,
        lawyer,
        matterRef: MATTER_REF,
        amountWei: "10",
        valueWei: "10",
        zkProof: ZK_PROOF,
        zkNullifier: uniqueHex32("cl"),
      },
    );
    expect(open.body.ok).toBe(true);
    const engagementId = open.body.result!.engagementId;

    const blocked = await rpc(request, "closeEngagement", {
      engagementId,
      finalRoot: ROOT_C,
      from: client,
    });
    expect(blocked.body.ok).toBe(false);
    expect(blocked.body.code).toBe("EngagementNotClean");
    expect(blocked.status).toBe(409);

    await rpc(request, "releaseProposal", { engagementId, proposalIndex: 0, from: client });
    const okClose = await rpc(request, "closeEngagement", {
      engagementId,
      finalRoot: ROOT_C,
      from: client,
    });
    expect(okClose.body.ok, JSON.stringify(okClose.body)).toBe(true);

    const eng = await rpcGet<{ engagement: { state: string } }>(request, "getEngagement", { engagementId });
    expect(eng.body.result!.engagement.state).toBe("CLOSED");
  });

  test("operator-gating — non-operator resolveDispute → OnlyOperator", async ({ request }) => {
    const { client, lawyer } = await mintPair(request);
    const open = await rpc<{ engagementId: number }>(
      request,
      "openEngagementAndFundFirstProposal",
      {
        client,
        lawyer,
        matterRef: MATTER_REF,
        amountWei: "8",
        valueWei: "8",
        zkProof: ZK_PROOF,
        zkNullifier: uniqueHex32("op"),
      },
    );
    expect(open.body.ok).toBe(true);
    const engagementId = open.body.result!.engagementId;

    await rpc(request, "markDelivered", { engagementId, proposalIndex: 0, from: lawyer });
    await rpc(request, "__skipTime", { seconds: 31 * 86400 });
    await rpc(request, "escalateProposal", {
      engagementId,
      proposalIndex: 0,
      transcriptRoot: ROOT_B,
      from: lawyer,
    });

    const r = await rpc(request, "resolveDispute", {
      engagementId,
      proposalIndex: 0,
      toLawyerWei: "8",
      toClientWei: "0",
      from: client, // wrong sender — not the operator
    });
    expect(r.body.ok).toBe(false);
    expect(r.body.code).toBe("OnlyOperator");
    expect(r.status).toBe(403);

    await rpc(request, "__resetClock", {});
  });

  test("eth-amount-mismatch — value !== amount → EthAmountMismatch", async ({ request }) => {
    const { client, lawyer } = await mintPair(request);
    const r = await rpc(request, "openEngagementAndFundFirstProposal", {
      client,
      lawyer,
      matterRef: MATTER_REF,
      amountWei: "100",
      valueWei: "99",
      zkProof: ZK_PROOF,
      zkNullifier: uniqueHex32("em"),
    });
    expect(r.body.ok).toBe(false);
    expect(r.body.code).toBe("EthAmountMismatch");
    expect(r.status).toBe(422);
  });

  test("not-verified — open without lawyer cap → NotVerifiedLawyer", async ({ request }) => {
    // Mint client only.
    const client = uniqueAddr("c3");
    const lawyer = uniqueAddr("13");
    const ac = await rpc(request, "attestVerifiedClient", { subject: client, from: OPERATOR, claims: {} });
    expect(ac.body.ok).toBe(true);

    const r = await rpc(request, "openEngagementAndFundFirstProposal", {
      client,
      lawyer,
      matterRef: MATTER_REF,
      amountWei: "1",
      valueWei: "1",
      zkProof: ZK_PROOF,
      zkNullifier: uniqueHex32("nv"),
    });
    expect(r.body.ok).toBe(false);
    expect(r.body.code).toBe("NotVerifiedLawyer");
    expect(r.status).toBe(401);
  });

  test("not-engagement-client — fundProposal from a non-client address → NotEngagementClient", async ({ request }) => {
    const { client, lawyer } = await mintPair(request);
    const open = await rpc<{ engagementId: number }>(
      request,
      "openEngagementAndFundFirstProposal",
      {
        client,
        lawyer,
        matterRef: MATTER_REF,
        amountWei: "1",
        valueWei: "1",
        zkProof: ZK_PROOF,
        zkNullifier: uniqueHex32("ec"),
      },
    );
    expect(open.body.ok).toBe(true);
    const engagementId = open.body.result!.engagementId;

    // Caller is an unrelated address.
    const r = await rpc(request, "fundProposal", {
      engagementId,
      amountWei: "1",
      valueWei: "1",
      itemsHash: ROOT_A,
      nonce: uniqueHex32("ec2"),
      lawyerOfferSig: VALID_SIG_SHAPE,
      from: uniqueAddr("99"),
    });
    expect(r.body.ok).toBe(false);
    expect(r.body.code).toBe("NotEngagementClient");
    expect(r.status).toBe(403);
  });

  test("dev guard — POST /api/dev/chain rejects unknown method with 400", async ({ request }) => {
    const r = await request.post("/api/dev/chain", { data: { method: "no_such_method", args: {} } });
    expect(r.status()).toBe(400);
    const body = (await r.json()) as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("UnknownMethod");
  });

  test("free-engagement uniformity — openFreeEngagement materialises Proposal[0] at amount=0 (F3)", async ({ request }) => {
    // F3: free + paid follow the same lifecycle. Free engagements now create
    // a zero-amount Proposal[0] so the deliver→release flow works uniformly.
    const { client, lawyer } = await mintPair(request);
    const open = await rpc<{ engagementId: number; proposalIndex: number }>(
      request,
      "openFreeEngagement",
      {
        client,
        lawyer,
        matterRef: MATTER_REF,
        zkProof: ZK_PROOF,
        zkNullifier: uniqueHex32("fr"),
      },
    );
    expect(open.body.ok, JSON.stringify(open.body)).toBe(true);
    expect(open.body.result!.proposalIndex).toBe(0);
    const engagementId = open.body.result!.engagementId;

    const eng = await rpcGet<{
      engagement: {
        proposalCount: number;
        proposals: Array<{ state: string; amountWei: string; proposalIndex: number }>;
      };
    }>(request, "getEngagement", { engagementId });
    expect(eng.body.result!.engagement.proposalCount).toBe(1);
    expect(eng.body.result!.engagement.proposals[0].proposalIndex).toBe(0);
    expect(eng.body.result!.engagement.proposals[0].state).toBe("FUNDED");
    expect(eng.body.result!.engagement.proposals[0].amountWei).toBe("0");

    // Deliver→release on a zero-amount proposal works the same way.
    const deliver = await rpc(request, "markDelivered", { engagementId, proposalIndex: 0, from: lawyer });
    expect(deliver.body.ok, JSON.stringify(deliver.body)).toBe(true);
    const release = await rpc(request, "releaseProposal", { engagementId, proposalIndex: 0, from: client });
    expect(release.body.ok, JSON.stringify(release.body)).toBe(true);

    const final = await rpcGet<{ engagement: { proposals: Array<{ state: string; amountToLawyerWei: string | null }> } }>(
      request,
      "getEngagement",
      { engagementId },
    );
    expect(final.body.result!.engagement.proposals[0].state).toBe("RELEASED");
    expect(final.body.result!.engagement.proposals[0].amountToLawyerWei).toBe("0");
  });
});
