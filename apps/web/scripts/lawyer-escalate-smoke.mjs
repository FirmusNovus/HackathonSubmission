// Lawyer-escalation smoke. Mirrors phase11-smoke but exercises the lawyer's
// escalateMilestone path (with the demo-only cooldown=0).
//
//   1. Operator attests fresh client + lawyer wallets.
//   2. Client opens + funds milestone 0.
//   3. LAWYER calls escalateMilestone(eid, 0, 0x00…) → MilestoneDisputed event
//      with by=lawyer.
//   4. Operator resolves with a 100% client refund (lawyer escalated unjustly,
//      so demonstrating the operator can still side with the client).
//   5. Verify event payload + balances.

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

// Reuse different anvil indices than phase11-smoke so the attestations don't collide.
const client = mnemonicToAccount(MNEMONIC, { addressIndex: 8 });
const lawyer = mnemonicToAccount(MNEMONIC, { addressIndex: 7 });
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
  "function escalateMilestone(uint256 engagementId, uint256 milestoneIndex, bytes32 transcriptRoot)",
  "function resolveDispute(uint256 engagementId, uint256 milestoneIndex, uint256 amountToLawyer, uint256 amountToClient)",
  "function getMilestone(uint256 engagementId, uint256 milestoneIndex) view returns ((uint256 amount, uint8 state, uint64 deliveredAt, uint256 amountToLawyer, uint256 amountToClient))",
  "event EngagementOpened(uint256 indexed engagementId, address indexed client, address indexed lawyer, bytes32 matterRef)",
  "event MilestoneDisputed(uint256 indexed engagementId, uint256 indexed milestoneIndex, address by)",
  "event MilestoneResolved(uint256 indexed engagementId, uint256 indexed milestoneIndex, uint256 toLawyer, uint256 toClient)",
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
  const tx = await op.writeContract({ address: addrs.ATTESTATION_MANAGER_ADDRESS, abi: ATT_ABI, functionName: "attestVerifiedLawyer", args: [lawyer.address, "DE", "BAR-ESC-SMOKE", now - 86400n * 365n, now + 86400n * 365n] });
  await pub.waitForTransactionReceipt({ hash: tx });
}

const cw = createWalletClient({ chain: anvil, transport: http(RPC), account: client });
const lw = createWalletClient({ chain: anvil, transport: http(RPC), account: lawyer });

const bookingId = "lawyer-escalate-smoke-" + Date.now();
const matterRef = keccak256(stringToBytes(bookingId));
const amount = parseEther("0.10");

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
console.log("  engagementId:", engagementId.toString());

console.log("\n=== LAWYER ESCALATES (milestone state Funded, no markDelivered) ===");
tx = await lw.writeContract({
  address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI,
  functionName: "escalateMilestone",
  args: [engagementId, 0n, "0x0000000000000000000000000000000000000000000000000000000000000000"],
});
receipt = await pub.waitForTransactionReceipt({ hash: tx });
const disputed = parseEventLogs({ abi: ESC_ABI, eventName: "MilestoneDisputed", logs: receipt.logs });
console.log("  MilestoneDisputed:", disputed[0].args);
if (disputed[0].args.by.toLowerCase() !== lawyer.address.toLowerCase()) {
  throw new Error(`escalation by ${disputed[0].args.by} !== lawyer ${lawyer.address}`);
}
if (disputed[0].args.engagementId !== engagementId || disputed[0].args.milestoneIndex !== 0n) {
  throw new Error("dispute event id/milestone mismatch");
}

console.log("\n=== OPERATOR RESOLVES (100% client refund) ===");
const toLawyer = 0n;
const toClient = amount;
const clientBefore = await pub.getBalance({ address: client.address });
tx = await op.writeContract({
  address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI,
  functionName: "resolveDispute",
  args: [engagementId, 0n, toLawyer, toClient],
});
receipt = await pub.waitForTransactionReceipt({ hash: tx });
const resolved = parseEventLogs({ abi: ESC_ABI, eventName: "MilestoneResolved", logs: receipt.logs });
console.log("  MilestoneResolved:", resolved[0].args);
if (resolved[0].args.toLawyer !== toLawyer || resolved[0].args.toClient !== toClient) {
  throw new Error("resolve amounts mismatch");
}

const clientAfter = await pub.getBalance({ address: client.address });
const clientDelta = clientAfter - clientBefore;
console.log("  client delta:", clientDelta.toString(), "wei (expected", toClient.toString() + ")");
if (clientDelta !== toClient) throw new Error(`client delta ${clientDelta} !== ${toClient}`);

const ms = await pub.readContract({
  address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI,
  functionName: "getMilestone", args: [engagementId, 0n],
});
if (ms.state !== 5) throw new Error(`expected Resolved(5), got ${ms.state}`);

console.log("\n✓ Lawyer-escalation smoke passed: lawyer escalated from Funded, operator refunded, balance moved as expected.");
