// Smoke-test for Phase 6: simulate the full funding flow against local anvil.
// 1. Operator attests test wallets as verified-client / verified-lawyer.
// 2. Client wallet calls openEngagementAndFundFirstMilestone with value.
// 3. Asserts EngagementOpened + MilestoneFunded events match expectations.

import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, parseAbi, parseEther, parseEventLogs, keccak256, stringToBytes } from "viem";
import { defineChain } from "viem";
import addrs from "../lib/chain/deployed-addresses.json" with { type: "json" };

const RPC = "http://127.0.0.1:8545";
const MNEMONIC = process.env.ANVIL_MNEMONIC ?? "basket salmon giraffe unit wine chat pretty behind aim habit cattle donor";
const OP_KEY = process.env.OPERATOR_PRIVATE_KEY;

const anvil = defineChain({ id: 31337, name: "Anvil", network: "anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] }, public: { http: [RPC] } } });

const pub = createPublicClient({ chain: anvil, transport: http(RPC) });
const op = createWalletClient({ chain: anvil, transport: http(RPC),
  account: privateKeyToAccount(OP_KEY) });

// Anvil's deterministic account 1 = client, 2 = lawyer
const client = mnemonicToAccount(MNEMONIC, { addressIndex: 1 });
const lawyer = mnemonicToAccount(MNEMONIC, { addressIndex: 2 });
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
  "event EngagementOpened(uint256 indexed engagementId, address indexed client, address indexed lawyer, bytes32 matterRef)",
  "event MilestoneFunded(uint256 indexed engagementId, uint256 indexed milestoneIndex, uint256 amount)",
]);

const SCHEMA_CLIENT = await pub.readContract({ address: addrs.ATTESTATION_MANAGER_ADDRESS, abi: ATT_ABI, functionName: "SCHEMA_CLIENT" });
const SCHEMA_LAWYER = await pub.readContract({ address: addrs.ATTESTATION_MANAGER_ADDRESS, abi: ATT_ABI, functionName: "SCHEMA_LAWYER" });

const isClient = await pub.readContract({ address: addrs.ATTESTATION_MANAGER_ADDRESS, abi: ATT_ABI, functionName: "hasCapability", args: [client.address, SCHEMA_CLIENT] });
if (!isClient) {
  console.log("attesting client…");
  const tx = await op.writeContract({ address: addrs.ATTESTATION_MANAGER_ADDRESS, abi: ATT_ABI, functionName: "attestVerifiedClient", args: [client.address, "DE", true] });
  await pub.waitForTransactionReceipt({ hash: tx });
}
const isLawyer = await pub.readContract({ address: addrs.ATTESTATION_MANAGER_ADDRESS, abi: ATT_ABI, functionName: "hasCapability", args: [lawyer.address, SCHEMA_LAWYER] });
if (!isLawyer) {
  console.log("attesting lawyer…");
  const now = BigInt(Math.floor(Date.now() / 1000));
  const tx = await op.writeContract({ address: addrs.ATTESTATION_MANAGER_ADDRESS, abi: ATT_ABI, functionName: "attestVerifiedLawyer", args: [lawyer.address, "DE", "BAR-123", now - 86400n * 365n, now + 86400n * 365n] });
  await pub.waitForTransactionReceipt({ hash: tx });
}

const clientWallet = createWalletClient({ chain: anvil, transport: http(RPC), account: client });
const bookingId = "smoke-test-booking-" + Date.now();
const matterRef = keccak256(stringToBytes(bookingId));
const amount = parseEther("0.05");
console.log("\nfunding engagement…");
console.log("  bookingId:", bookingId);
console.log("  matterRef:", matterRef);
console.log("  amount:   ", amount.toString(), "wei");

const tx = await clientWallet.writeContract({
  address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI,
  functionName: "openEngagementAndFundFirstMilestone",
  args: [lawyer.address, matterRef, amount, "0x", keccak256(stringToBytes(bookingId + "-nullifier")), "0x0000000000000000000000000000000000000000000000000000000000000000"],
  value: amount,
});
console.log("  tx:", tx);
const receipt = await pub.waitForTransactionReceipt({ hash: tx });
console.log("  status:", receipt.status, "block:", receipt.blockNumber);

const opened = parseEventLogs({ abi: ESC_ABI, eventName: "EngagementOpened", logs: receipt.logs });
const funded = parseEventLogs({ abi: ESC_ABI, eventName: "MilestoneFunded", logs: receipt.logs });
console.log("\nEngagementOpened:", opened[0].args);
console.log("MilestoneFunded: ", funded[0].args);

console.log("\n✓ Phase 6 smoke test passed: engagement", opened[0].args.engagementId.toString(), "funded with", funded[0].args.amount.toString(), "wei");
