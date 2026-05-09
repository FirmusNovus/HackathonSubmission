/**
 * Per-engagement Merkle transcript helpers (Constitution Inv-5).
 *
 * Two leaf types share the same tree:
 *
 *   1. Proposal leaves — the engagement_proposals chain at engagement open.
 *      Indices 0..N-1 where N = proposal count. The root over these is the
 *      `initialTranscriptRoot` committed via openEngagementAndFundFirstMilestone.
 *   2. Message leaves — appended one per encrypted message after the
 *      engagement opens. Indices N..N+M-1 where M = message count.
 *
 * Both leaves are sha256 of a canonical envelope so the chain root can be
 * recomputed deterministically from the persisted rows.
 *
 *   proposalLeaf = sha256("lex-nova/v1/transcript-leaf\n" || proposalMessage(...) || "\nsig:" || signature)
 *   messageLeaf  = sha256("lex-nova/v1/transcript-leaf-msg\n" || envelopeMessage(...) || "\nsig:" || signature)
 */
import { IncrementalMerkleTree, sha256 } from "@lex-nova/crypto";
import { envelopeMessage, proposalMessage } from "@lex-nova/crypto";

export interface ProposalLeafInput {
  matter_id: number;
  amount_wei: string;
  note: string | null;
  prev_proposal_id: number | null;
  signature: string;
}

const LEAF_HEADER = "lex-nova/v1/transcript-leaf\n";

export async function proposalLeaf(p: ProposalLeafInput): Promise<Uint8Array> {
  const msg = proposalMessage({
    matterId: p.matter_id,
    amountWei: p.amount_wei,
    note: p.note ?? "",
    prevProposalId: p.prev_proposal_id,
  });
  const payload = LEAF_HEADER + msg + "\nsig:" + p.signature;
  return sha256(new TextEncoder().encode(payload));
}

export async function transcriptRootFromProposals(
  proposals: ProposalLeafInput[]
): Promise<Uint8Array> {
  const tree = await IncrementalMerkleTree.create();
  for (const p of proposals) {
    const leaf = await proposalLeaf(p);
    tree.append(leaf);
  }
  return tree.currentRoot();
}

export interface MessageLeafInput {
  engagement_id: number;
  ciphertext_hash_hex: string;
  iv_hex: string;
  salt_hex: string;
  signature: string;
}

const MSG_LEAF_HEADER = "lex-nova/v1/transcript-leaf-msg\n";

export async function messageLeaf(m: MessageLeafInput): Promise<Uint8Array> {
  const msg = envelopeMessage({
    engagementId: m.engagement_id,
    ciphertextHashHex: m.ciphertext_hash_hex,
    ivHex: m.iv_hex,
    saltHex: m.salt_hex,
  });
  const payload = MSG_LEAF_HEADER + msg + "\nsig:" + m.signature;
  return sha256(new TextEncoder().encode(payload));
}

/**
 * Recompute the running transcript root after appending all message leaves
 * to the proposal-chain leaves. Called after a message is persisted so the
 * server can mirror the root that *would* be committed at the next anchor
 * (the actual on-chain anchor still happens via T070 / Group F).
 */
export async function transcriptRootFromAll(
  proposals: ProposalLeafInput[],
  messages: MessageLeafInput[]
): Promise<Uint8Array> {
  const tree = await IncrementalMerkleTree.create();
  for (const p of proposals) tree.append(await proposalLeaf(p));
  for (const m of messages) tree.append(await messageLeaf(m));
  return tree.currentRoot();
}
