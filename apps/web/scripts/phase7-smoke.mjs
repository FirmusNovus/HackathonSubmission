// Smoke-test for Phase 7: client funds an engagement, then releases it.
// Verifies:
//   1. EngagementOpened + MilestoneFunded events on funding
//   2. Lawyer's ETH balance increases by exactly the funded amount on release
//   3. MilestoneReleased event fires with the right (engagementId, milestoneIndex)
//   4. getMilestone() shows state == Released (3) afterwards

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

// Use higher account indices than phase6-smoke so we don't reuse a wallet
// that already burned its conflict nullifier. Anvil's default mnemonic gives
// us 10 accounts; phase6-smoke uses indices 1+2.
const client = mnemonicToAccount(MNEMONIC, { addressIndex: 3 });
const lawyer = mnemonicToAccount(MNEMONIC, { addressIndex: 4 });
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
  "function releaseMilestone(uint256 engagementId, uint256 milestoneIndex)",
  "function getMilestone(uint256 engagementId, uint256 milestoneIndex) view returns ((uint256 amount, uint8 state, uint64 deliveredAt, uint256 amountToLawyer, uint256 amountToClient))",
  "event EngagementOpened(uint256 indexed engagementId, address indexed client, address indexed lawyer, bytes32 matterRef)",
  "event MilestoneFunded(uint256 indexed engagementId, uint256 indexed milestoneIndex, uint256 amount)",
  "event MilestoneReleased(uint256 indexed engagementId, uint256 indexed milestoneIndex)",
]);

// --- 1. Set up attestations ---------------------------------------------
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
  const tx = await op.writeContract({ address: addrs.ATTESTATION_MANAGER_ADDRESS, abi: ATT_ABI, functionName: "attestVerifiedLawyer", args: [lawyer.address, "DE", "BAR-PHASE7", now - 86400n * 365n, now + 86400n * 365n] });
  await pub.waitForTransactionReceipt({ hash: tx });
}

// --- 2. Fund a fresh engagement -----------------------------------------
const clientWallet = createWalletClient({ chain: anvil, transport: http(RPC), account: client });
const bookingId = "phase7-booking-" + Date.now();
const matterRef = keccak256(stringToBytes(bookingId));
const amount = parseEther("0.07");

console.log("\n=== FUND ===");
console.log("  amount:", amount.toString(), "wei");
const fundTx = await clientWallet.writeContract({
  address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI,
  functionName: "openEngagementAndFundFirstMilestone",
  args: [lawyer.address, matterRef, amount, "0x", keccak256(stringToBytes(bookingId + "-nullifier")), "0x0000000000000000000000000000000000000000000000000000000000000000"],
  value: amount,
});
const fundReceipt = await pub.waitForTransactionReceipt({ hash: fundTx });
const opened = parseEventLogs({ abi: ESC_ABI, eventName: "EngagementOpened", logs: fundReceipt.logs });
const engagementId = opened[0].args.engagementId;
console.log("  engagementId:", engagementId.toString());

// --- 3. Release ----------------------------------------------------------
const lawyerBalanceBefore = await pub.getBalance({ address: lawyer.address });
console.log("\n=== RELEASE ===");
console.log("  lawyer balance before:", lawyerBalanceBefore.toString(), "wei");

const relTx = await clientWallet.writeContract({
  address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI,
  functionName: "releaseMilestone",
  args: [engagementId, 0n],
});
console.log("  tx:", relTx);
const relReceipt = await pub.waitForTransactionReceipt({ hash: relTx });
console.log("  status:", relReceipt.status, "block:", relReceipt.blockNumber);

const released = parseEventLogs({ abi: ESC_ABI, eventName: "MilestoneReleased", logs: relReceipt.logs });
if (released.length === 0) throw new Error("no MilestoneReleased event in receipt");
console.log("  MilestoneReleased:", released[0].args);

// --- 4. Assertions -------------------------------------------------------
const lawyerBalanceAfter = await pub.getBalance({ address: lawyer.address });
const delta = lawyerBalanceAfter - lawyerBalanceBefore;
console.log("  lawyer balance after: ", lawyerBalanceAfter.toString(), "wei");
console.log("  delta:                ", delta.toString(), "wei (expected", amount.toString() + ")");

if (delta !== amount) {
  throw new Error(`Lawyer balance delta ${delta} !== expected ${amount}`);
}
if (released[0].args.engagementId !== engagementId) {
  throw new Error(`MilestoneReleased.engagementId ${released[0].args.engagementId} !== ${engagementId}`);
}
if (released[0].args.milestoneIndex !== 0n) {
  throw new Error(`MilestoneReleased.milestoneIndex ${released[0].args.milestoneIndex} !== 0`);
}

const ms = await pub.readContract({
  address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI,
  functionName: "getMilestone", args: [engagementId, 0n],
});
console.log("\nmilestone post-release:", ms);
// MilestoneState.Released == 3
if (ms.state !== 3) {
  throw new Error(`Milestone state ${ms.state} !== Released(3)`);
}
if (ms.amountToLawyer !== amount) {
  throw new Error(`amountToLawyer ${ms.amountToLawyer} !== ${amount}`);
}

console.log("\n✓ Phase 7 smoke test passed: engagement", engagementId.toString(), "released", amount.toString(), "wei to lawyer.");
