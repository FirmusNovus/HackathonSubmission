// =============================================================================
// Contract surface mirror — `LegalEngagementEscrow.sol` + `AttestationManager.sol`.
// -----------------------------------------------------------------------------
// Each method here is the moral twin of one Solidity function. State checks
// throw the typed errors from `./errors.ts` so callers can map them to HTTP
// shapes via `chainErrorToHttp`. Every mutation runs in a Prisma transaction
// and appends one ChainEvent per emitted on-chain event — that's the seam
// where the F1 mock chain becomes a real chain in F4+ (viem watch + indexer
// fold the events into the same mirror tables).
//
// All Ethereum addresses are stored lower-cased. Wei amounts are decimal
// strings on disk and bigints in memory (see `./units.ts`).
//
// What's intentionally faked:
//   - ZK proof verification — `verifyZKProof` returns true for any non-empty
//     triple (proof, root, nullifier). Production swap-in is the bb-generated
//     UltraHonk verifier wired through `setZKVerifier`.
//   - EIP-712 signature verification — we check shape only (65-byte hex). A
//     real implementation recovers the signer and asserts equality with the
//     expected address. TODO(F4): real EIP-712.
// =============================================================================

import type { Prisma } from "@prisma/client";
import type { Hex } from "viem";
import { prisma } from "@/lib/db/client";
import {
  ConflictProofFailed,
  CooldownNotElapsed,
  EngagementNotClean,
  EthAmountMismatch,
  InvalidEngagementState,
  InvalidProposalState,
  InvalidSplit,
  NoSuchAttestation,
  NonceAlreadyUsed,
  NotEngagementClient,
  NotEngagementLawyer,
  NotEngagementParty,
  NotVerifiedClient,
  NotVerifiedLawyer,
  NullifierAlreadyUsed,
  OnlyOperator,
} from "@/lib/chain/errors";
import { now } from "@/lib/chain/clock";
import { bigIntToWei, weiToBigInt } from "@/lib/chain/units";
import { generateAttestationUid, generateTxHash, nextMockBlock, nextMockEngagementId } from "@/lib/chain/clients";
import { assertMirrorMatches } from "@/lib/chain/indexer";
import {
  verifyMutualRefundSigForUser,
  verifyProposalOfferSigForUser,
} from "@/lib/chain/eip712";

// =============================================================================
// Constants
// =============================================================================

/** 30 days, the contract-enforced lawyer dispute cooldown. */
export const LAWYER_DISPUTE_COOLDOWN_SECONDS = 30 * 86400;

export const SCHEMA_LAWYER = "SCHEMA_LAWYER";
export const SCHEMA_CLIENT = "SCHEMA_CLIENT";
export const SCHEMA_OPERATOR = "SCHEMA_OPERATOR";
export type SchemaId = typeof SCHEMA_LAWYER | typeof SCHEMA_CLIENT | typeof SCHEMA_OPERATOR;

export const ENGAGEMENT_STATE = {
  NONE: "NONE",
  ACTIVE: "ACTIVE",
  CLOSED: "CLOSED",
} as const;
export type EngagementState = (typeof ENGAGEMENT_STATE)[keyof typeof ENGAGEMENT_STATE];

export const PROPOSAL_STATE = {
  NONE: "NONE",
  FUNDED: "FUNDED",
  DELIVERED: "DELIVERED",
  RELEASED: "RELEASED",
  DISPUTED: "DISPUTED",
  RESOLVED: "RESOLVED",
  REFUNDED: "REFUNDED",
} as const;
export type ProposalState = (typeof PROPOSAL_STATE)[keyof typeof PROPOSAL_STATE];

const ZERO_ROOT = "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Operator address — the one wallet that may attest capabilities and resolve
 * disputes. Derived from `OPERATOR_WALLET` env var. The seeded fallback is
 * stable across runs so seeded data lines up with hard-coded test addresses.
 */
export function getOperatorAddress(): string {
  const envAddr = process.env.OPERATOR_WALLET ?? process.env.OPERATOR_ADDRESS;
  if (envAddr && /^0x[0-9a-fA-F]{40}$/.test(envAddr)) {
    return envAddr.toLowerCase();
  }
  // Stable seeded fallback. 0xOPERATOR…BAR — short enough that test fixtures
  // can hard-code it. The trailing "BAR" is just a label; the bytes parse fine.
  return "0x09e8a70811111111111111111111111111111bbb";
}

export const OPERATOR_ADDRESS = getOperatorAddress();

// =============================================================================
// Internal helpers
// =============================================================================

function lower(addr: string): string {
  return addr.toLowerCase();
}

function isHexBytes(s: string | null | undefined, byteLen: number): boolean {
  if (!s) return false;
  const expected = 2 + byteLen * 2; // "0x" + 2 chars/byte
  if (s.length !== expected) return false;
  return /^0x[0-9a-fA-F]+$/.test(s);
}

/**
 * Shape-only sig check — retained for any pre-F6 callers that still hand us
 * raw signatures without going through the typed-data verifiers. F6 swapped
 * the mutual-refund path to real EIP-712 recovery
 * (`verifyMutualRefundSigForUser`); the only remaining shape-only callers
 * are dev RPC routes that pre-validate before dispatching.
 */
function isValidSigShape(sig: string | null | undefined): boolean {
  return isHexBytes(sig, 65);
}
void isValidSigShape; // retained for potential future shape-only paths.

async function appendEvent(
  tx: Prisma.TransactionClient,
  args: { engagementId: number | null; kind: string; payload: unknown; txHash: string },
): Promise<{ blockNumber: number }> {
  const blockNumber = await nextMockBlock(tx);
  await tx.chainEvent.create({
    data: {
      engagementId: args.engagementId,
      kind: args.kind,
      payload: JSON.stringify(args.payload ?? {}),
      txHash: args.txHash,
      blockNumber,
    },
  });
  return { blockNumber };
}

/**
 * Sanity-check the mirror after a mutating call: replay the event log for
 * `engagementId` via the indexer and assert the rebuilt shape matches the
 * Engagement + Proposal rows. Failures log a warning rather than throwing —
 * this is a programmer-error tripwire, not a runtime failure mode the user
 * should see. The F1 reviewer flagged the missing post-write assertion as
 * Severity 3; this closes that loop.
 *
 * Gated on `DEBUG_CHAIN_MIRROR`: enabled by default in development + tests
 * (where catching a divergence is cheap and high-value), opt-in only in
 * production via `DEBUG_CHAIN_MIRROR=1`. The reads are cheap but production
 * mutation paths shouldn't pay for them by default.
 */
function mirrorAssertEnabled(): boolean {
  if (process.env.DEBUG_CHAIN_MIRROR === "1") return true;
  if (process.env.DEBUG_CHAIN_MIRROR === "0") return false;
  return process.env.NODE_ENV !== "production";
}

async function safeAssertMirror(engagementId: number): Promise<void> {
  if (!mirrorAssertEnabled()) return;
  try {
    await assertMirrorMatches(engagementId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[chain] mirror-divergence warning: ${msg}`);
  }
}

// =============================================================================
// Capabilities (AttestationManager)
// =============================================================================

export type AttestArgs = {
  subject: string;
  claims: Record<string, unknown>;
  expiresAt?: Date | null;
  /** Caller address — must equal the operator. Faked for now; F4+ uses msg.sender. */
  from: string;
};

async function attest(args: AttestArgs & { schemaId: SchemaId }): Promise<{ uid: string; txHash: string }> {
  if (lower(args.from) !== OPERATOR_ADDRESS) {
    throw new OnlyOperator();
  }
  const subject = lower(args.subject);
  const txHash = generateTxHash();
  const uid = generateAttestationUid();
  await prisma.$transaction(async (tx) => {
    await tx.capability.create({
      data: {
        subjectAddress: subject,
        schemaId: args.schemaId,
        attestationUid: uid,
        claims: JSON.stringify(args.claims ?? {}),
        expiresAt: args.expiresAt ?? null,
      },
    });
    await appendEvent(tx, {
      engagementId: null,
      kind: "Attested",
      payload: { subject, schemaId: args.schemaId, attestationUid: uid },
      txHash,
    });
  });
  return { uid, txHash };
}

export async function attestVerifiedLawyer(args: AttestArgs): Promise<{ uid: string; txHash: string }> {
  return attest({ ...args, schemaId: SCHEMA_LAWYER });
}

export async function attestVerifiedClient(args: AttestArgs): Promise<{ uid: string; txHash: string }> {
  return attest({ ...args, schemaId: SCHEMA_CLIENT });
}

/**
 * F7: mint a SCHEMA_OPERATOR capability. Mirrors `attestVerifiedLawyer` /
 * `attestVerifiedClient` but for the operator role. The seed self-attests its
 * own operator (the address is pinned in the AttestationManager constructor in
 * the on-chain contract); this helper exists so the admin / dev routes can
 * grant operator status to additional wallets at runtime without re-seeding.
 */
export async function attestOperator(args: AttestArgs): Promise<{ uid: string; txHash: string }> {
  return attest({ ...args, schemaId: SCHEMA_OPERATOR });
}

export async function revokeCapability(args: { uid: string; from: string }): Promise<{ txHash: string }> {
  if (lower(args.from) !== OPERATOR_ADDRESS) throw new OnlyOperator();
  const txHash = generateTxHash();
  await prisma.$transaction(async (tx) => {
    const row = await tx.capability.findUnique({ where: { attestationUid: args.uid } });
    if (!row) {
      // Mirrors `AttestationManager.NoSuchAttestation` (line 30 of the .sol).
      throw new NoSuchAttestation(`No such attestation: ${args.uid}`);
    }
    await tx.capability.update({
      where: { attestationUid: args.uid },
      data: { revokedAt: new Date() },
    });
    await appendEvent(tx, {
      engagementId: null,
      kind: "Revoked",
      payload: { subject: row.subjectAddress, schemaId: row.schemaId, attestationUid: args.uid },
      txHash,
    });
  });
  return { txHash };
}

/** Latest unrevoked unexpired capability for (subject, schemaId), or null. */
export async function getLatestCapability(subject: string, schemaId: SchemaId) {
  const subj = lower(subject);
  const nowDate = await now();
  return prisma.capability.findFirst({
    where: {
      subjectAddress: subj,
      schemaId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: nowDate } }],
    },
    orderBy: { issuedAt: "desc" },
  });
}

export async function hasCapability(subject: string, schemaId: SchemaId): Promise<boolean> {
  return (await getLatestCapability(subject, schemaId)) !== null;
}

// =============================================================================
// ZK conflict-of-interest verifier (StubZKConflictVerifier)
// =============================================================================

export async function setConflictRoot(args: { lawyerAddress: string; root: string; from: string }): Promise<{ txHash: string }> {
  const lawyer = lower(args.lawyerAddress);
  // Mirrors `onlyVerifiedLawyer` modifier on `setConflictRoot`.
  if (!(await hasCapability(lawyer, SCHEMA_LAWYER))) throw new NotVerifiedLawyer();
  if (lower(args.from) !== lawyer) throw new NotVerifiedLawyer();
  const txHash = generateTxHash();
  await prisma.$transaction(async (tx) => {
    await tx.lawyerConflictRoot.upsert({
      where: { lawyerAddress: lawyer },
      update: { root: args.root },
      create: { lawyerAddress: lawyer, root: args.root },
    });
    await appendEvent(tx, {
      engagementId: null,
      kind: "ConflictRootSet",
      payload: { lawyer, root: args.root },
      txHash,
    });
  });
  return { txHash };
}

/** Stub verifier — mirrors `StubZKConflictVerifier.verifyProof`, which always returns true. */
export function verifyZKProof(proof: string, root: string, nullifier: string): boolean {
  return Boolean(proof) && proof.length > 2 && Boolean(root) && Boolean(nullifier);
}

// =============================================================================
// Engagement lifecycle
// =============================================================================

export type OpenFreeEngagementArgs = {
  client: string;
  lawyer: string;
  matterRef: string;
  zkProof: string;
  zkNullifier: string;
  initialTranscriptRoot?: string;
  /**
   * Caller address — must equal `client` (case-insensitive). Mirrors
   * `msg.sender` on the Solidity contract: only the would-be client wallet may
   * open an engagement on its own behalf. Optional only for back-compat with
   * F1 fixtures; F2+ should always pass it.
   */
  from?: string;
};

/**
 * Free-engagement open. The "free" path is conceptually "open + fund with
 * amount=0" — the production Solidity entry point unifies them via
 * `openEngagementAndFundFirstProposal(amount=0, msg.value=0)`, but we expose
 * a separate API here so callers can opt into intake-style consultations
 * without thinking about wei.
 *
 * F3 update — uniform proposal lifecycle. Previously this path created an
 * Engagement with `proposalCount=0` and no Proposal row, leaving free and
 * paid bookings on different state-machine tracks. F3 makes them uniform:
 * we ALWAYS materialise `Proposal[0]` with `amountWei=0` and `state=FUNDED`
 * so the deliver→release flow works the same way for free and paid alike.
 * The bridge in `lib/chain/booking-bridge.ts` consumes this uniformity.
 */
export async function openFreeEngagement(
  args: OpenFreeEngagementArgs,
): Promise<{ engagementId: number; proposalIndex: 0; txHash: string }> {
  const client = lower(args.client);
  const lawyer = lower(args.lawyer);
  if (args.from !== undefined && lower(args.from) !== client) {
    // Mirrors `onlyVerifiedClient` / `msg.sender == client` on the Solidity
    // entry point. We surface NotVerifiedClient here because the contract's
    // modifier check would also fire (msg.sender lacking SCHEMA_CLIENT).
    throw new NotVerifiedClient();
  }
  if (!(await hasCapability(client, SCHEMA_CLIENT))) throw new NotVerifiedClient();
  if (!(await hasCapability(lawyer, SCHEMA_LAWYER))) throw new NotVerifiedLawyer();

  const conflictRow = await prisma.lawyerConflictRoot.findUnique({ where: { lawyerAddress: lawyer } });
  const conflictRoot = conflictRow?.root ?? ZERO_ROOT;
  if (!verifyZKProof(args.zkProof, conflictRoot, args.zkNullifier)) throw new ConflictProofFailed();

  const txHash = generateTxHash();
  const initialRoot = args.initialTranscriptRoot ?? ZERO_ROOT;

  const result = await prisma.$transaction(async (tx) => {
    const existingNullifier = await tx.usedNullifier.findUnique({ where: { nullifier: args.zkNullifier } });
    if (existingNullifier) throw new NullifierAlreadyUsed();
    const engagementId = await nextMockEngagementId(tx);
    await tx.usedNullifier.create({ data: { nullifier: args.zkNullifier, engagementId } });
    const engagement = await tx.engagement.create({
      data: {
        engagementId,
        clientUserId: await resolveUserId(tx, client),
        lawyerUserId: await resolveUserId(tx, lawyer),
        matterRef: args.matterRef,
        state: ENGAGEMENT_STATE.ACTIVE,
        transcriptRoot: initialRoot,
        proposalCount: 1,
        openTxHash: txHash,
      },
    });
    // F3: zero-amount Proposal[0] so free + paid follow the same lifecycle.
    await tx.proposal.create({
      data: {
        engagementInternalId: engagement.id,
        engagementId,
        proposalIndex: 0,
        amountWei: bigIntToWei(0n),
        state: PROPOSAL_STATE.FUNDED,
        fundTxHash: txHash,
      },
    });
    await appendEvent(tx, {
      engagementId,
      kind: "EngagementOpened",
      payload: { engagementId, client, lawyer, matterRef: args.matterRef },
      txHash,
    });
    await appendEvent(tx, {
      engagementId,
      kind: "ProposalFunded",
      payload: { engagementId, proposalIndex: 0, amount: "0" },
      txHash,
    });
    if (initialRoot !== ZERO_ROOT) {
      const { blockNumber } = await appendEvent(tx, {
        engagementId,
        kind: "TranscriptAnchored",
        payload: { engagementId, root: initialRoot },
        txHash,
      });
      await tx.transcriptRootHistory.create({
        data: { engagementId, root: initialRoot, blockNumber },
      });
    }
    return engagement;
  });

  await safeAssertMirror(result.engagementId);
  return { engagementId: result.engagementId, proposalIndex: 0, txHash };
}

export type OpenAndFundArgs = {
  client: string;
  lawyer: string;
  matterRef: string;
  amountWei: bigint | string;
  zkProof: string;
  zkNullifier: string;
  initialTranscriptRoot?: string;
  /** Must equal `amountWei`. Mirrors `msg.value` check in the contract. */
  valueWei: bigint | string;
  /**
   * Caller address — must equal `client` (case-insensitive). Mirrors
   * `msg.sender` on the Solidity contract's `onlyVerifiedClient` modifier:
   * only the would-be client wallet may open + fund on its own behalf.
   * Optional for back-compat with F1 fixtures; F2+ should always pass it.
   */
  from?: string;
};

export async function openEngagementAndFundFirstProposal(
  args: OpenAndFundArgs,
): Promise<{ engagementId: number; proposalIndex: 0; txHash: string }> {
  const client = lower(args.client);
  const lawyer = lower(args.lawyer);
  if (args.from !== undefined && lower(args.from) !== client) {
    throw new NotVerifiedClient();
  }
  if (!(await hasCapability(client, SCHEMA_CLIENT))) throw new NotVerifiedClient();
  if (!(await hasCapability(lawyer, SCHEMA_LAWYER))) throw new NotVerifiedLawyer();

  const amount = weiToBigInt(args.amountWei);
  const value = weiToBigInt(args.valueWei);
  if (value !== amount) throw new EthAmountMismatch();

  const conflictRow = await prisma.lawyerConflictRoot.findUnique({ where: { lawyerAddress: lawyer } });
  const conflictRoot = conflictRow?.root ?? ZERO_ROOT;
  if (!verifyZKProof(args.zkProof, conflictRoot, args.zkNullifier)) throw new ConflictProofFailed();

  const txHash = generateTxHash();
  const initialRoot = args.initialTranscriptRoot ?? ZERO_ROOT;

  const result = await prisma.$transaction(async (tx) => {
    const existingNullifier = await tx.usedNullifier.findUnique({ where: { nullifier: args.zkNullifier } });
    if (existingNullifier) throw new NullifierAlreadyUsed();
    const engagementId = await nextMockEngagementId(tx);
    await tx.usedNullifier.create({ data: { nullifier: args.zkNullifier, engagementId } });
    const engagement = await tx.engagement.create({
      data: {
        engagementId,
        clientUserId: await resolveUserId(tx, client),
        lawyerUserId: await resolveUserId(tx, lawyer),
        matterRef: args.matterRef,
        state: ENGAGEMENT_STATE.ACTIVE,
        transcriptRoot: initialRoot,
        proposalCount: 1,
        openTxHash: txHash,
      },
    });
    await tx.proposal.create({
      data: {
        engagementInternalId: engagement.id,
        engagementId,
        proposalIndex: 0,
        amountWei: bigIntToWei(amount),
        state: PROPOSAL_STATE.FUNDED,
        fundTxHash: txHash,
      },
    });
    await appendEvent(tx, {
      engagementId,
      kind: "EngagementOpened",
      payload: { engagementId, client, lawyer, matterRef: args.matterRef },
      txHash,
    });
    await appendEvent(tx, {
      engagementId,
      kind: "ProposalFunded",
      payload: { engagementId, proposalIndex: 0, amount: bigIntToWei(amount) },
      txHash,
    });
    const { blockNumber } = await appendEvent(tx, {
      engagementId,
      kind: "TranscriptAnchored",
      payload: { engagementId, root: initialRoot },
      txHash,
    });
    await tx.transcriptRootHistory.create({
      data: { engagementId, root: initialRoot, blockNumber },
    });
    return engagement;
  });

  await safeAssertMirror(result.engagementId);
  return { engagementId: result.engagementId, proposalIndex: 0, txHash };
}

// =============================================================================
// Proposal funding + lifecycle
// =============================================================================

export type FundProposalArgs = {
  engagementId: number;
  amountWei: bigint | string;
  itemsHash: string;
  nonce: string;
  lawyerOfferSig: string;
  valueWei: bigint | string;
  from: string;
};

export async function fundProposal(args: FundProposalArgs): Promise<{ proposalIndex: number; txHash: string }> {
  const from = lower(args.from);
  const amount = weiToBigInt(args.amountWei);
  const value = weiToBigInt(args.valueWei);
  if (value !== amount) throw new EthAmountMismatch();

  const txHash = generateTxHash();

  // Pre-flight loads so we have the engagement + lawyer + client wallets on
  // hand for both the party check AND the EIP-712 signature recovery. We
  // pull these outside the transaction because viem's
  // recoverTypedDataAddress is async and we don't want to keep a Prisma tx
  // open while it runs. The loaded rows are re-checked inside the tx below
  // for state consistency.
  const engagementPre = await prisma.engagement.findUnique({
    where: { engagementId: args.engagementId },
  });
  if (!engagementPre) throw new InvalidEngagementState();
  if (engagementPre.state !== ENGAGEMENT_STATE.ACTIVE) throw new InvalidEngagementState();
  const clientUserPre = await prisma.user.findUnique({ where: { id: engagementPre.clientUserId } });
  if (!clientUserPre || lower(clientUserPre.walletAddress) !== from) throw new NotEngagementClient();
  const lawyerUserPre = await prisma.user.findUnique({ where: { id: engagementPre.lawyerUserId } });
  if (!lawyerUserPre) throw new NotEngagementLawyer();

  // Real EIP-712 recovery + assertion. Throws `InvalidOfferSignature` on any
  // failure (malformed sig, recovered address ≠ engagement.lawyer wallet OR
  // dev signer alias). Mirrors the on-chain verification ordering: the
  // contract checks `msg.sender == client` before the EIP-712 recovery, so
  // an unrelated caller gets `NotEngagementClient` rather than a useless
  // `InvalidOfferSignature` response.
  await verifyProposalOfferSigForUser({
    message: {
      engagementId: BigInt(args.engagementId),
      amount,
      itemsHash: args.itemsHash as Hex,
      nonce: args.nonce as Hex,
    },
    signature: args.lawyerOfferSig as Hex,
    walletAddress: lawyerUserPre.walletAddress,
    devSignerAddress: lawyerUserPre.devSignerAddress,
  });

  const result = await prisma.$transaction(async (tx) => {
    const engagement = await tx.engagement.findUnique({ where: { engagementId: args.engagementId } });
    if (!engagement) throw new InvalidEngagementState();
    if (engagement.state !== ENGAGEMENT_STATE.ACTIVE) throw new InvalidEngagementState();
    const clientUser = await tx.user.findUnique({ where: { id: engagement.clientUserId } });
    if (!clientUser || lower(clientUser.walletAddress) !== from) throw new NotEngagementClient();

    const existingNonce = await tx.consumedProposalNonce.findUnique({ where: { nonce: args.nonce } });
    if (existingNonce) throw new NonceAlreadyUsed();

    const proposalIndex = engagement.proposalCount;
    await tx.consumedProposalNonce.create({
      data: { nonce: args.nonce, engagementId: args.engagementId, proposalIndex },
    });
    await tx.proposal.create({
      data: {
        engagementInternalId: engagement.id,
        engagementId: args.engagementId,
        proposalIndex,
        amountWei: bigIntToWei(amount),
        state: PROPOSAL_STATE.FUNDED,
        itemsHash: args.itemsHash,
        nonce: args.nonce,
        lawyerOfferSig: args.lawyerOfferSig,
        offerNonce: args.nonce,
        fundTxHash: txHash,
      },
    });
    await tx.engagement.update({
      where: { id: engagement.id },
      data: { proposalCount: proposalIndex + 1 },
    });
    await appendEvent(tx, {
      engagementId: args.engagementId,
      kind: "ProposalFunded",
      payload: { engagementId: args.engagementId, proposalIndex, amount: bigIntToWei(amount) },
      txHash,
    });
    return { proposalIndex, txHash };
  });
  await safeAssertMirror(args.engagementId);
  return result;
}

export async function markDelivered(args: {
  engagementId: number;
  proposalIndex: number;
  from: string;
}): Promise<{ deliveredAt: Date; txHash: string }> {
  const from = lower(args.from);
  const txHash = generateTxHash();
  const nowDate = await now();

  const result = await prisma.$transaction(async (tx) => {
    const { engagement, proposal } = await loadEngagementAndProposal(tx, args.engagementId, args.proposalIndex);
    const lawyerUser = await tx.user.findUnique({ where: { id: engagement.lawyerUserId } });
    if (!lawyerUser || lower(lawyerUser.walletAddress) !== from) throw new NotEngagementLawyer();
    if (proposal.state !== PROPOSAL_STATE.FUNDED) throw new InvalidProposalState();
    await tx.proposal.update({
      where: { id: proposal.id },
      data: { state: PROPOSAL_STATE.DELIVERED, deliveredAt: nowDate, deliverTxHash: txHash },
    });
    await appendEvent(tx, {
      engagementId: args.engagementId,
      kind: "ProposalDelivered",
      payload: {
        engagementId: args.engagementId,
        proposalIndex: args.proposalIndex,
        deliveredAt: Math.floor(nowDate.getTime() / 1000),
      },
      txHash,
    });
    return { deliveredAt: nowDate, txHash };
  });
  await safeAssertMirror(args.engagementId);
  return result;
}

export async function releaseProposal(args: {
  engagementId: number;
  proposalIndex: number;
  from: string;
}): Promise<{ txHash: string }> {
  const from = lower(args.from);
  const txHash = generateTxHash();

  const result = await prisma.$transaction(async (tx) => {
    const { engagement, proposal } = await loadEngagementAndProposal(tx, args.engagementId, args.proposalIndex);
    const clientUser = await tx.user.findUnique({ where: { id: engagement.clientUserId } });
    if (!clientUser || lower(clientUser.walletAddress) !== from) throw new NotEngagementClient();
    if (proposal.state !== PROPOSAL_STATE.FUNDED && proposal.state !== PROPOSAL_STATE.DELIVERED) {
      throw new InvalidProposalState();
    }
    await tx.proposal.update({
      where: { id: proposal.id },
      data: {
        state: PROPOSAL_STATE.RELEASED,
        amountToLawyerWei: proposal.amountWei,
        releaseTxHash: txHash,
      },
    });
    await appendEvent(tx, {
      engagementId: args.engagementId,
      kind: "ProposalReleased",
      payload: { engagementId: args.engagementId, proposalIndex: args.proposalIndex },
      txHash,
    });
    return { txHash };
  });
  await safeAssertMirror(args.engagementId);
  return result;
}

/**
 * Mutual refund — Funded → Refunded transition gated by a pair of EIP-712
 * signatures over the (engagementId, proposalIndex) typed-data shape. Either
 * party (client or lawyer) may submit; both signatures must verify against
 * the engagement's actual client + lawyer wallets respectively.
 *
 * F6: real EIP-712 recovery via `verifyMutualRefundSigForUser`. The dev
 * fallback (recovery to the seeded persona's `devSignerAddress`) is gated by
 * `devSignerFallbackEnabled()` exactly like the proposal-offer path — so
 * production deploys without `ENABLE_MOCK_AUTH=true` cannot accept a sig
 * recovered to anything other than the real EOA.
 *
 * The optional `nonce` argument is retained for backward-compat with pre-F6
 * callers but is no longer load-bearing — A's contract typed-data does NOT
 * include a nonce. Single-shot replay safety comes from the state-machine
 * transition (a second refund call trips InvalidProposalState because the
 * proposal is no longer Funded).
 */
export async function mutualRefundProposal(args: {
  engagementId: number;
  proposalIndex: number;
  nonce?: string | null;
  clientSig: string;
  lawyerSig: string;
  from: string;
}): Promise<{ txHash: string }> {
  const from = lower(args.from);

  // Pre-flight load so we have the parties' wallet addresses on hand for the
  // typed-data recoveries. Recovery is async (viem) and we don't want to keep
  // a Prisma tx open while it runs; the loaded rows are re-checked inside the
  // tx below for state consistency.
  const engagementPre = await prisma.engagement.findUnique({
    where: { engagementId: args.engagementId },
  });
  if (!engagementPre) throw new InvalidEngagementState();
  const clientUserPre = await prisma.user.findUnique({ where: { id: engagementPre.clientUserId } });
  const lawyerUserPre = await prisma.user.findUnique({ where: { id: engagementPre.lawyerUserId } });
  if (!clientUserPre || !lawyerUserPre) throw new NotEngagementParty();
  const isParty =
    lower(clientUserPre.walletAddress) === from || lower(lawyerUserPre.walletAddress) === from;
  if (!isParty) throw new NotEngagementParty();

  // Real EIP-712 recovery + assertion for BOTH signatures. Throws
  // InvalidRefundSignature on malformed sig or mismatched recovery. The
  // dev-signer fallback is gated identically to the F4 proposal-offer path
  // (devSignerFallbackEnabled() ⇒ NODE_ENV !== "production" ||
  // ENABLE_MOCK_AUTH === "true"); production builds without ENABLE_MOCK_AUTH
  // accept ONLY the real EOA recovery.
  const message = {
    engagementId: BigInt(args.engagementId),
    proposalIndex: BigInt(args.proposalIndex),
  };
  await verifyMutualRefundSigForUser({
    message,
    signature: args.clientSig as Hex,
    walletAddress: clientUserPre.walletAddress,
    devSignerAddress: clientUserPre.devSignerAddress,
  });
  await verifyMutualRefundSigForUser({
    message,
    signature: args.lawyerSig as Hex,
    walletAddress: lawyerUserPre.walletAddress,
    devSignerAddress: lawyerUserPre.devSignerAddress,
  });

  const txHash = generateTxHash();
  const result = await prisma.$transaction(async (tx) => {
    const { engagement, proposal } = await loadEngagementAndProposal(tx, args.engagementId, args.proposalIndex);
    void engagement;
    if (proposal.state !== PROPOSAL_STATE.FUNDED) throw new InvalidProposalState();
    await tx.mutualRefundAuth.create({
      data: {
        engagementId: args.engagementId,
        proposalIndex: args.proposalIndex,
        clientSig: args.clientSig,
        lawyerSig: args.lawyerSig,
        nonce: args.nonce ?? null,
      },
    });
    await tx.proposal.update({
      where: { id: proposal.id },
      data: {
        state: PROPOSAL_STATE.REFUNDED,
        amountToClientWei: proposal.amountWei,
        refundTxHash: txHash,
      },
    });
    await appendEvent(tx, {
      engagementId: args.engagementId,
      kind: "ProposalMutuallyRefunded",
      payload: { engagementId: args.engagementId, proposalIndex: args.proposalIndex },
      txHash,
    });
    return { txHash };
  });
  await safeAssertMirror(args.engagementId);
  return result;
}

export async function disputeProposal(args: {
  engagementId: number;
  proposalIndex: number;
  transcriptRoot: string;
  from: string;
}): Promise<{ txHash: string }> {
  const from = lower(args.from);
  const txHash = generateTxHash();
  const result = await prisma.$transaction(async (tx) => {
    const { engagement, proposal } = await loadEngagementAndProposal(tx, args.engagementId, args.proposalIndex);
    // F5: refuse on a CLOSED engagement. The on-chain contract gets this
    // for free because all proposals on a closed engagement are terminal
    // (so InvalidProposalState fires instead). Our mirror checks explicitly
    // to give callers the semantically-clearer InvalidEngagementState — this
    // matters once the operator's resolution + close paths land, where a
    // race could theoretically open the door to a dispute on a closing
    // engagement.
    if (engagement.state !== ENGAGEMENT_STATE.ACTIVE) throw new InvalidEngagementState();
    const clientUser = await tx.user.findUnique({ where: { id: engagement.clientUserId } });
    if (!clientUser || lower(clientUser.walletAddress) !== from) throw new NotEngagementClient();
    if (proposal.state !== PROPOSAL_STATE.FUNDED && proposal.state !== PROPOSAL_STATE.DELIVERED) {
      throw new InvalidProposalState();
    }
    await tx.proposal.update({
      where: { id: proposal.id },
      data: { state: PROPOSAL_STATE.DISPUTED, disputeTxHash: txHash },
    });
    await tx.engagement.update({
      where: { id: engagement.id },
      data: { transcriptRoot: args.transcriptRoot },
    });
    await appendEvent(tx, {
      engagementId: args.engagementId,
      kind: "ProposalDisputed",
      payload: { engagementId: args.engagementId, proposalIndex: args.proposalIndex, by: from },
      txHash,
    });
    const { blockNumber } = await appendEvent(tx, {
      engagementId: args.engagementId,
      kind: "TranscriptAnchored",
      payload: { engagementId: args.engagementId, root: args.transcriptRoot },
      txHash,
    });
    await tx.transcriptRootHistory.create({
      data: { engagementId: args.engagementId, root: args.transcriptRoot, blockNumber },
    });
    return { txHash };
  });
  await safeAssertMirror(args.engagementId);
  return result;
}

export async function escalateProposal(args: {
  engagementId: number;
  proposalIndex: number;
  transcriptRoot: string;
  from: string;
}): Promise<{ txHash: string }> {
  const from = lower(args.from);
  const txHash = generateTxHash();
  const currentTime = await now();
  const result = await prisma.$transaction(async (tx) => {
    const { engagement, proposal } = await loadEngagementAndProposal(tx, args.engagementId, args.proposalIndex);
    // F5: same engagement-state guard as disputeProposal.
    if (engagement.state !== ENGAGEMENT_STATE.ACTIVE) throw new InvalidEngagementState();
    const lawyerUser = await tx.user.findUnique({ where: { id: engagement.lawyerUserId } });
    if (!lawyerUser || lower(lawyerUser.walletAddress) !== from) throw new NotEngagementLawyer();
    if (proposal.state !== PROPOSAL_STATE.DELIVERED) throw new InvalidProposalState();
    if (!proposal.deliveredAt) throw new InvalidProposalState();
    const unlockAt = new Date(proposal.deliveredAt.getTime() + LAWYER_DISPUTE_COOLDOWN_SECONDS * 1000);
    if (currentTime.getTime() < unlockAt.getTime()) throw new CooldownNotElapsed(unlockAt);
    await tx.proposal.update({
      where: { id: proposal.id },
      data: { state: PROPOSAL_STATE.DISPUTED, disputeTxHash: txHash },
    });
    await tx.engagement.update({
      where: { id: engagement.id },
      data: { transcriptRoot: args.transcriptRoot },
    });
    await appendEvent(tx, {
      engagementId: args.engagementId,
      kind: "ProposalDisputed",
      payload: { engagementId: args.engagementId, proposalIndex: args.proposalIndex, by: from },
      txHash,
    });
    const { blockNumber } = await appendEvent(tx, {
      engagementId: args.engagementId,
      kind: "TranscriptAnchored",
      payload: { engagementId: args.engagementId, root: args.transcriptRoot },
      txHash,
    });
    await tx.transcriptRootHistory.create({
      data: { engagementId: args.engagementId, root: args.transcriptRoot, blockNumber },
    });
    return { txHash };
  });
  await safeAssertMirror(args.engagementId);
  return result;
}

export async function resolveDispute(args: {
  engagementId: number;
  proposalIndex: number;
  toLawyerWei: bigint | string;
  toClientWei: bigint | string;
  from: string;
}): Promise<{ txHash: string }> {
  if (lower(args.from) !== OPERATOR_ADDRESS) throw new OnlyOperator();
  const toLawyer = weiToBigInt(args.toLawyerWei);
  const toClient = weiToBigInt(args.toClientWei);
  const txHash = generateTxHash();
  const result = await prisma.$transaction(async (tx) => {
    const { proposal } = await loadEngagementAndProposal(tx, args.engagementId, args.proposalIndex);
    if (proposal.state !== PROPOSAL_STATE.DISPUTED) throw new InvalidProposalState();
    const total = weiToBigInt(proposal.amountWei);
    if (toLawyer + toClient !== total) throw new InvalidSplit();
    await tx.proposal.update({
      where: { id: proposal.id },
      data: {
        state: PROPOSAL_STATE.RESOLVED,
        amountToLawyerWei: bigIntToWei(toLawyer),
        amountToClientWei: bigIntToWei(toClient),
        resolveTxHash: txHash,
      },
    });
    await appendEvent(tx, {
      engagementId: args.engagementId,
      kind: "ProposalResolved",
      payload: {
        engagementId: args.engagementId,
        proposalIndex: args.proposalIndex,
        toLawyer: bigIntToWei(toLawyer),
        toClient: bigIntToWei(toClient),
      },
      txHash,
    });
    return { txHash };
  });
  await safeAssertMirror(args.engagementId);
  return result;
}

export async function anchorTranscript(args: {
  engagementId: number;
  newRoot: string;
  from: string;
}): Promise<{ txHash: string }> {
  const from = lower(args.from);
  const txHash = generateTxHash();
  const result = await prisma.$transaction(async (tx) => {
    const engagement = await tx.engagement.findUnique({ where: { engagementId: args.engagementId } });
    if (!engagement) throw new InvalidEngagementState();
    if (engagement.state !== ENGAGEMENT_STATE.ACTIVE) throw new InvalidEngagementState();
    const clientUser = await tx.user.findUnique({ where: { id: engagement.clientUserId } });
    const lawyerUser = await tx.user.findUnique({ where: { id: engagement.lawyerUserId } });
    if (!clientUser || !lawyerUser) throw new NotEngagementParty();
    const isParty = lower(clientUser.walletAddress) === from || lower(lawyerUser.walletAddress) === from;
    if (!isParty) throw new NotEngagementParty();
    await tx.engagement.update({
      where: { id: engagement.id },
      data: { transcriptRoot: args.newRoot },
    });
    const { blockNumber } = await appendEvent(tx, {
      engagementId: args.engagementId,
      kind: "TranscriptAnchored",
      payload: { engagementId: args.engagementId, root: args.newRoot },
      txHash,
    });
    await tx.transcriptRootHistory.create({
      data: { engagementId: args.engagementId, root: args.newRoot, blockNumber },
    });
    return { txHash };
  });
  await safeAssertMirror(args.engagementId);
  return result;
}

export async function closeEngagement(args: {
  engagementId: number;
  finalRoot: string;
  from: string;
}): Promise<{ txHash: string }> {
  const from = lower(args.from);
  const txHash = generateTxHash();
  const result = await prisma.$transaction(async (tx) => {
    const engagement = await tx.engagement.findUnique({ where: { engagementId: args.engagementId } });
    if (!engagement) throw new InvalidEngagementState();
    if (engagement.state !== ENGAGEMENT_STATE.ACTIVE) throw new InvalidEngagementState();
    const clientUser = await tx.user.findUnique({ where: { id: engagement.clientUserId } });
    const lawyerUser = await tx.user.findUnique({ where: { id: engagement.lawyerUserId } });
    if (!clientUser || !lawyerUser) throw new NotEngagementParty();
    const isParty = lower(clientUser.walletAddress) === from || lower(lawyerUser.walletAddress) === from;
    if (!isParty) throw new NotEngagementParty();
    const proposals = await tx.proposal.findMany({ where: { engagementInternalId: engagement.id } });
    for (const p of proposals) {
      if (
        p.state !== PROPOSAL_STATE.RELEASED &&
        p.state !== PROPOSAL_STATE.RESOLVED &&
        p.state !== PROPOSAL_STATE.REFUNDED
      ) {
        throw new EngagementNotClean();
      }
    }
    await tx.engagement.update({
      where: { id: engagement.id },
      data: { state: ENGAGEMENT_STATE.CLOSED, transcriptRoot: args.finalRoot, closedAt: new Date() },
    });
    const { blockNumber } = await appendEvent(tx, {
      engagementId: args.engagementId,
      kind: "TranscriptAnchored",
      payload: { engagementId: args.engagementId, root: args.finalRoot },
      txHash,
    });
    await tx.transcriptRootHistory.create({
      data: { engagementId: args.engagementId, root: args.finalRoot, blockNumber },
    });
    await appendEvent(tx, {
      engagementId: args.engagementId,
      kind: "EngagementClosed",
      payload: { engagementId: args.engagementId },
      txHash,
    });
    return { txHash };
  });
  await safeAssertMirror(args.engagementId);
  return result;
}

// =============================================================================
// Internal: load + invariant helpers
// =============================================================================

/**
 * Resolve a wallet address to a User.id, creating a thin shell user if no row
 * exists. Mock-chain expedience — production would 404 here because the user
 * must have completed SIWE first. F2 tightens this by requiring an existing
 * verified user; for F1 we accept either case so test fixtures can call the
 * chain layer with arbitrary addresses.
 *
 * F6: shadow users get their `devSignerAddress` pre-computed from the same
 * deterministic seed (`firmus-novus/dev-key/<wallet>`) the seeded personas
 * use. This means EIP-712 verification for chain-layer-synthesized
 * addresses succeeds via the dev-signer fallback, mirroring how seeded
 * personas behave. Without this, raw RPC tests that mint pairs via
 * `attestVerifiedClient` could never produce a verifiable mutual-refund or
 * proposal-offer sig — the dev-signer path requires the column to be set.
 * Production is unaffected because the SIWE-driven path always populates
 * a real `devSignerAddress` (or null for real EOAs) before any chain call.
 */
async function resolveUserId(tx: Prisma.TransactionClient, walletAddress: string): Promise<string> {
  const addr = lower(walletAddress);
  const existing = await tx.user.findUnique({ where: { walletAddress: addr } });
  if (existing) return existing.id;
  // Defer the dev-signer derivation to a dynamic import so this module
  // doesn't drag `node:crypto` (via dev-signer.ts → viem keccak/toHex paths
  // that compose with Node crypto) into bundles where it's not wanted. The
  // shadow-user path only fires from the chain layer (server-only).
  const { devSignerAddressForWallet } = await import("@/lib/chain/dev-signer");
  const devSignerAddress = devSignerAddressForWallet(addr);
  const created = await tx.user.create({
    data: { walletAddress: addr, role: "CLIENT", devSignerAddress },
  });
  return created.id;
}

async function loadEngagementAndProposal(
  tx: Prisma.TransactionClient,
  engagementId: number,
  proposalIndex: number,
) {
  const engagement = await tx.engagement.findUnique({ where: { engagementId } });
  if (!engagement) throw new InvalidEngagementState();
  const proposal = await tx.proposal.findUnique({
    where: { engagementId_proposalIndex: { engagementId, proposalIndex } },
  });
  if (!proposal) throw new InvalidProposalState();
  return { engagement, proposal };
}
