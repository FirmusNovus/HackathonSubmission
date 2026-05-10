// Smoke-test for Phase 8: multi-milestone engagement on chain.
//
//   1. Open an engagement + fund milestone 0 (the consultation).
//   2. Fund milestone 1 via fundMilestone(engagementId, amount). This is the
//      follow-up order path Phase 8 introduces.
//   3. Release milestone 0 (consultation done).
//   4. Release milestone 1 (follow-up done).
//   5. Assert lawyer balance grew by exactly amount0 + amount1, and that
//      getMilestone() reports both as Released with full amountToLawyer.

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

// Use unused account indices so we don't collide with the phase6/phase7
// nullifiers already burned earlier.
const client = mnemonicToAccount(MNEMONIC, { addressIndex: 5 });
const lawyer = mnemonicToAccount(MNEMONIC, { addressIndex: 6 });
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
  "function fundMilestone(uint256 engagementId, uint256 amount) payable returns (uint256)",
  "function releaseMilestone(uint256 engagementId, uint256 milestoneIndex)",
  "function getEngagement(uint256 engagementId) view returns ((address client, address lawyer, bytes32 matterRef, uint8 state, bytes32 transcriptRoot, uint256 milestoneCount))",
  "function getMilestone(uint256 engagementId, uint256 milestoneIndex) view returns ((uint256 amount, uint8 state, uint64 deliveredAt, uint256 amountToLawyer, uint256 amountToClient))",
  "event EngagementOpened(uint256 indexed engagementId, address indexed client, address indexed lawyer, bytes32 matterRef)",
  "event MilestoneFunded(uint256 indexed engagementId, uint256 indexed milestoneIndex, uint256 amount)",
  "event MilestoneReleased(uint256 indexed engagementId, uint256 indexed milestoneIndex)",
]);

// --- Attestations -------------------------------------------------------
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
  const tx = await op.writeContract({ address: addrs.ATTESTATION_MANAGER_ADDRESS, abi: ATT_ABI, functionName: "attestVerifiedLawyer", args: [lawyer.address, "DE", "BAR-PHASE8", now - 86400n * 365n, now + 86400n * 365n] });
  await pub.waitForTransactionReceipt({ hash: tx });
}

const cw = createWalletClient({ chain: anvil, transport: http(RPC), account: client });
const bookingId = "phase8-booking-" + Date.now();
const matterRef = keccak256(stringToBytes(bookingId));
const amount0 = parseEther("0.04"); // consultation
const amount1 = parseEther("0.09"); // follow-up

// --- 1. Fund milestone 0 (consultation) --------------------------------
console.log("\n=== FUND MILESTONE 0 (consultation) ===");
let tx = await cw.writeContract({
  address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI,
  functionName: "openEngagementAndFundFirstMilestone",
  args: [lawyer.address, matterRef, amount0, "0x", keccak256(stringToBytes(bookingId + "-null")), "0x0000000000000000000000000000000000000000000000000000000000000000"],
  value: amount0,
});
let receipt = await pub.waitForTransactionReceipt({ hash: tx });
const opened = parseEventLogs({ abi: ESC_ABI, eventName: "EngagementOpened", logs: receipt.logs });
const engagementId = opened[0].args.engagementId;
console.log("  engagementId:", engagementId.toString());
console.log("  amount0:", amount0.toString(), "wei");

// --- 2. Fund milestone 1 (follow-up order) -----------------------------
console.log("\n=== FUND MILESTONE 1 (follow-up) ===");
tx = await cw.writeContract({
  address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI,
  functionName: "fundMilestone",
  args: [engagementId, amount1],
  value: amount1,
});
receipt = await pub.waitForTransactionReceipt({ hash: tx });
const funded1 = parseEventLogs({ abi: ESC_ABI, eventName: "MilestoneFunded", logs: receipt.logs });
console.log("  MilestoneFunded:", funded1[0].args);
if (funded1[0].args.milestoneIndex !== 1n) {
  throw new Error(`Expected milestoneIndex 1, got ${funded1[0].args.milestoneIndex}`);
}
if (funded1[0].args.amount !== amount1) {
  throw new Error(`Expected amount ${amount1}, got ${funded1[0].args.amount}`);
}

// --- 3. Release both milestones -----------------------------------------
const lawyerBefore = await pub.getBalance({ address: lawyer.address });
console.log("\nlawyer balance before releases:", lawyerBefore.toString());

console.log("\n=== RELEASE MILESTONE 0 ===");
tx = await cw.writeContract({
  address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI,
  functionName: "releaseMilestone",
  args: [engagementId, 0n],
});
receipt = await pub.waitForTransactionReceipt({ hash: tx });
console.log("  MilestoneReleased:", parseEventLogs({ abi: ESC_ABI, eventName: "MilestoneReleased", logs: receipt.logs })[0].args);

console.log("\n=== RELEASE MILESTONE 1 ===");
tx = await cw.writeContract({
  address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI,
  functionName: "releaseMilestone",
  args: [engagementId, 1n],
});
receipt = await pub.waitForTransactionReceipt({ hash: tx });
console.log("  MilestoneReleased:", parseEventLogs({ abi: ESC_ABI, eventName: "MilestoneReleased", logs: receipt.logs })[0].args);

// --- 4. Assertions -------------------------------------------------------
const lawyerAfter = await pub.getBalance({ address: lawyer.address });
const expected = amount0 + amount1;
const delta = lawyerAfter - lawyerBefore;
console.log("\nlawyer balance after releases: ", lawyerAfter.toString());
console.log("delta:                          ", delta.toString(), "wei (expected", expected.toString() + ")");
if (delta !== expected) {
  throw new Error(`Lawyer balance delta ${delta} !== expected ${expected}`);
}

const ms0 = await pub.readContract({ address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI, functionName: "getMilestone", args: [engagementId, 0n] });
const ms1 = await pub.readContract({ address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI, functionName: "getMilestone", args: [engagementId, 1n] });
console.log("\nmilestone 0 post-release:", ms0);
console.log("milestone 1 post-release:", ms1);
// state == 3 means MilestoneState.Released
if (ms0.state !== 3 || ms1.state !== 3) {
  throw new Error(`Expected both milestones in Released state (3), got ${ms0.state} / ${ms1.state}`);
}
if (ms0.amountToLawyer !== amount0 || ms1.amountToLawyer !== amount1) {
  throw new Error(`Per-milestone amountToLawyer mismatch: ${ms0.amountToLawyer} / ${ms1.amountToLawyer}`);
}

const eng = await pub.readContract({ address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI, functionName: "getEngagement", args: [engagementId] });
console.log("\nengagement post-release:", eng);
if (eng.milestoneCount !== 2n) {
  throw new Error(`Expected milestoneCount 2, got ${eng.milestoneCount}`);
}

console.log("\n✓ Phase 8 smoke test passed: engagement", engagementId.toString(),
  "now has 2 released milestones totaling", expected.toString(), "wei to lawyer.");
