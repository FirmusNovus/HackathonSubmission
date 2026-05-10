// Smoke-test for Phase 9 mutual refund.
//
// Verifies on chain:
//   1. Open an engagement + fund milestone 0 (consultation).
//   2. Both parties sign EIP-712 MutualRefundAuthorization{eid, msIdx}.
//      The contract uses domain ("LexNovaEscrow", "1") + the deployed escrow
//      verifying contract — same domain the platform's refund-eip712.ts
//      builds.
//   3. Either party submits mutualRefundMilestone(eid, msIdx, clientSig, lawyerSig).
//   4. MilestoneMutuallyRefunded event fires.
//   5. Client's ETH balance grows by exactly the funded amount minus the
//      gas the client paid for funding (we measure deltas across the lawyer
//      side which doesn't move).
//   6. getMilestone reports state == Refunded (6) with amountToClient = full amount.

import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient, createWalletClient, http, parseAbi, parseEther,
  parseEventLogs, keccak256, stringToBytes, defineChain,
} from "viem";
import addrs from "../lib/chain/deployed-addresses.json" with { type: "json" };

const RPC = "http://127.0.0.1:8545";
const MNEMONIC = process.env.ANVIL_MNEMONIC ?? "basket salmon giraffe unit wine chat pretty behind aim habit cattle donor";
const OP_KEY = process.env.OPERATOR_PRIVATE_KEY;

const anvil = defineChain({
  id: 31337, name: "Anvil", network: "anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] }, public: { http: [RPC] } },
});

const pub = createPublicClient({ chain: anvil, transport: http(RPC) });
const op = createWalletClient({ chain: anvil, transport: http(RPC), account: privateKeyToAccount(OP_KEY) });

// Use unused account indices so we don't reuse a conflict-nullifier already
// burned by phase{6,7,8}-smoke.
const client = mnemonicToAccount(MNEMONIC, { addressIndex: 7 });
const lawyer = mnemonicToAccount(MNEMONIC, { addressIndex: 8 });
console.log("operator:", op.account.address);
console.log("client:  ", client.address);
console.log("lawyer:  ", lawyer.address);

const ATT_ABI = parseAbi([
  "function attestVerifiedClient(address subject, string countryOfResidence, bool ageOver18) returns (bytes32)",
  "function attestVerifiedLawyer(address subject, string jurisdiction, string barAdmissionNumber, uint64 admittedAt, uint64 validUntil) returns (bytes32)",
  "function hasCapability(address subject, bytes32 schema) view returns (bool)",
  "function SCHEMA_CLIENT() view returns (bytes32)",
  "function SCHEMA_LAWYER() view returns (bytes32)",
]);
const ESC_ABI = parseAbi([
  "function openEngagementAndFundFirstMilestone(address lawyer, bytes32 matterRef, uint256 amount, bytes zkConflictProof, bytes32 zkNullifier, bytes32 initialTranscriptRoot) payable returns (uint256)",
  "function mutualRefundMilestone(uint256 engagementId, uint256 milestoneIndex, bytes clientSignature, bytes lawyerSignature)",
  "function getMilestone(uint256 engagementId, uint256 milestoneIndex) view returns ((uint256 amount, uint8 state, uint64 deliveredAt, uint256 amountToLawyer, uint256 amountToClient))",
  "event EngagementOpened(uint256 indexed engagementId, address indexed client, address indexed lawyer, bytes32 matterRef)",
  "event MilestoneMutuallyRefunded(uint256 indexed engagementId, uint256 indexed milestoneIndex)",
]);

const SCHEMA_CLIENT = await pub.readContract({ address: addrs.ATTESTATION_MANAGER_ADDRESS, abi: ATT_ABI, functionName: "SCHEMA_CLIENT" });
const SCHEMA_LAWYER = await pub.readContract({ address: addrs.ATTESTATION_MANAGER_ADDRESS, abi: ATT_ABI, functionName: "SCHEMA_LAWYER" });
const isClient = await pub.readContract({ address: addrs.ATTESTATION_MANAGER_ADDRESS, abi: ATT_ABI, functionName: "hasCapability", args: [client.address, SCHEMA_CLIENT] });
if (!isClient) {
  console.log("\nattesting client…");
  const tx = await op.writeContract({ address: addrs.ATTESTATION_MANAGER_ADDRESS, abi: ATT_ABI, functionName: "attestVerifiedClient", args: [client.address, "DE", true] });
  await pub.waitForTransactionReceipt({ hash: tx });
}
const isLawyer = await pub.readContract({ address: addrs.ATTESTATION_MANAGER_ADDRESS, abi: ATT_ABI, functionName: "hasCapability", args: [lawyer.address, SCHEMA_LAWYER] });
if (!isLawyer) {
  console.log("attesting lawyer…");
  const now = BigInt(Math.floor(Date.now() / 1000));
  const tx = await op.writeContract({ address: addrs.ATTESTATION_MANAGER_ADDRESS, abi: ATT_ABI, functionName: "attestVerifiedLawyer", args: [lawyer.address, "DE", "BAR-PHASE9", now - 86400n * 365n, now + 86400n * 365n] });
  await pub.waitForTransactionReceipt({ hash: tx });
}

const cw = createWalletClient({ chain: anvil, transport: http(RPC), account: client });
const lw = createWalletClient({ chain: anvil, transport: http(RPC), account: lawyer });
const bookingId = "phase9-booking-" + Date.now();
const matterRef = keccak256(stringToBytes(bookingId));
const amount = parseEther("0.06");

console.log("\n=== FUND ===");
let tx = await cw.writeContract({
  address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI,
  functionName: "openEngagementAndFundFirstMilestone",
  args: [lawyer.address, matterRef, amount, "0x", keccak256(stringToBytes(bookingId + "-null")), "0x0000000000000000000000000000000000000000000000000000000000000000"],
  value: amount,
});
let receipt = await pub.waitForTransactionReceipt({ hash: tx });
const opened = parseEventLogs({ abi: ESC_ABI, eventName: "EngagementOpened", logs: receipt.logs });
const engagementId = opened[0].args.engagementId;
console.log("  engagementId:", engagementId.toString(), "amount:", amount.toString());

// --- Sign the EIP-712 MutualRefundAuthorization from BOTH wallets ----
const domain = {
  name: "LexNovaEscrow",
  version: "1",
  chainId: 31337,
  verifyingContract: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS,
};
const types = {
  MutualRefundAuthorization: [
    { name: "engagementId", type: "uint256" },
    { name: "milestoneIndex", type: "uint256" },
  ],
};
const message = { engagementId, milestoneIndex: 0n };

console.log("\n=== SIGN typed data (both parties) ===");
const clientSig = await cw.signTypedData({ domain, types, primaryType: "MutualRefundAuthorization", message });
const lawyerSig = await lw.signTypedData({ domain, types, primaryType: "MutualRefundAuthorization", message });
console.log("  clientSig:", clientSig.slice(0, 18) + "…");
console.log("  lawyerSig:", lawyerSig.slice(0, 18) + "…");

// --- Submit mutualRefundMilestone ------------------------------------
const clientBefore = await pub.getBalance({ address: client.address });
const lawyerBefore = await pub.getBalance({ address: lawyer.address });

console.log("\n=== mutualRefundMilestone ===");
// Submit from the CLIENT (whoever signs second is fine — chain just verifies both sigs).
tx = await cw.writeContract({
  address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI,
  functionName: "mutualRefundMilestone",
  args: [engagementId, 0n, clientSig, lawyerSig],
});
console.log("  tx:", tx);
receipt = await pub.waitForTransactionReceipt({ hash: tx });
console.log("  status:", receipt.status, "gasUsed:", receipt.gasUsed.toString());
const refunded = parseEventLogs({ abi: ESC_ABI, eventName: "MilestoneMutuallyRefunded", logs: receipt.logs });
if (refunded.length === 0) throw new Error("no MilestoneMutuallyRefunded event");
console.log("  MilestoneMutuallyRefunded:", refunded[0].args);

// --- Verify state ----------------------------------------------------
const ms = await pub.readContract({
  address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI,
  functionName: "getMilestone", args: [engagementId, 0n],
});
console.log("\nmilestone post-refund:", ms);
// MilestoneState.Refunded == 6
if (ms.state !== 6) throw new Error(`expected Refunded(6), got ${ms.state}`);
if (ms.amountToClient !== amount) throw new Error(`expected amountToClient ${amount}, got ${ms.amountToClient}`);
if (ms.amountToLawyer !== 0n) throw new Error(`expected amountToLawyer 0, got ${ms.amountToLawyer}`);

const clientAfter = await pub.getBalance({ address: client.address });
const lawyerAfter = await pub.getBalance({ address: lawyer.address });
const lawyerDelta = lawyerAfter - lawyerBefore;
const clientDelta = clientAfter - clientBefore;
console.log("\nlawyer balance delta:", lawyerDelta.toString(), "wei (expected 0)");
console.log("client balance delta:", clientDelta.toString(), "wei (expected ~", amount.toString(), "minus tx gas)");
if (lawyerDelta !== 0n) throw new Error(`lawyer balance moved by ${lawyerDelta} — should be 0 on refund`);
// Client's wallet pays the refund tx gas + receives the refunded amount.
// gasUsed * effectiveGasPrice tells us the gas cost paid out of client's balance.
const gasCost = receipt.gasUsed * receipt.effectiveGasPrice;
const expectedClientDelta = amount - gasCost;
if (clientDelta !== expectedClientDelta) {
  throw new Error(`client delta ${clientDelta} != expected ${expectedClientDelta} (amount ${amount} - gas ${gasCost})`);
}

console.log("\n✓ Phase 9 smoke test passed: engagement", engagementId.toString(),
  "milestone 0 mutually refunded;", amount.toString(), "wei returned to client.");
