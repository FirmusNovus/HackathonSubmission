// ============================================================================
// SMART CONTRACT ESCROW — STUB
// ----------------------------------------------------------------------------
// In production this module wraps a deployed escrow contract on an L2 (Polygon
// or Arbitrum, recommended for low fees on ~€100–€2000 escrow amounts).
//
// Required Solidity surface area for the production contract:
//
//   function createEscrow(address lawyer, uint256 amountEUR) external returns (bytes32 bookingId);
//   function releaseEscrow(bytes32 bookingId) external;          // client-only or auto on completion
//   function disputeEscrow(bytes32 bookingId) external;          // either party
//   function refundEscrow(bytes32 bookingId) external;           // arbitrator-only after dispute resolved
//   event EscrowCreated(bytes32 indexed bookingId, address indexed client, address indexed lawyer, uint256 amountEUR);
//   event EscrowReleased(bytes32 indexed bookingId, uint256 toLawyer, uint256 platformFee);
//   event EscrowDisputed(bytes32 indexed bookingId, address indexed by);
//
// TODO(production): replace these stubs with viem `writeContract` calls from
// the client (so the wallet signs), and use server-side `readContract` only
// for status verification.
// ============================================================================

function fakeTxHash(): string {
  const chars = "0123456789abcdef";
  let out = "0x";
  for (let i = 0; i < 64; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function delay(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export type EscrowReceipt = { txHash: string; createdAt: Date };

export async function createEscrow(_args: {
  bookingId: string;
  clientWallet: string;
  lawyerWallet: string;
  amountEUR: number;
}): Promise<EscrowReceipt> {
  // STUB: simulate a 2s on-chain confirmation.
  await delay(2000);
  return { txHash: fakeTxHash(), createdAt: new Date() };
}

export async function releaseEscrow(_bookingId: string): Promise<EscrowReceipt> {
  await delay(1500);
  return { txHash: fakeTxHash(), createdAt: new Date() };
}

export async function disputeEscrow(_bookingId: string): Promise<EscrowReceipt> {
  await delay(1500);
  return { txHash: fakeTxHash(), createdAt: new Date() };
}
