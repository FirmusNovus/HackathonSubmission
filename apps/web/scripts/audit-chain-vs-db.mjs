// Cross-check that every Engagement row in the DB has a matching on-chain
// engagement at the recorded engagementIdOnChain, and vice-versa for the
// orders/milestones we've created. Surfaces drift early — a row that points
// at a stale chain id, a milestoneIndex that doesn't match a real milestone,
// etc.

import { createPublicClient, http, parseAbi, defineChain } from "viem";
import { PrismaClient } from "@prisma/client";
import addrs from "../lib/chain/deployed-addresses.json" with { type: "json" };

const RPC = "http://127.0.0.1:8545";
const anvil = defineChain({
  id: 31337, name: "Anvil", network: "anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] }, public: { http: [RPC] } },
});
const pub = createPublicClient({ chain: anvil, transport: http(RPC) });

const ESC_ABI = parseAbi([
  "function getEngagement(uint256 engagementId) view returns ((address client, address lawyer, bytes32 matterRef, uint8 state, bytes32 transcriptRoot, uint256 milestoneCount))",
  "function getMilestone(uint256 engagementId, uint256 milestoneIndex) view returns ((uint256 amount, uint8 state, uint64 deliveredAt, uint256 amountToLawyer, uint256 amountToClient))",
  "function nextEngagementId() view returns (uint256)",
]);

const MS_STATE = ["None", "Funded", "Delivered", "Released", "Disputed", "Resolved", "Refunded"];

const prisma = new PrismaClient();
let ok = true;
const note = (msg) => console.log(msg);
const fail = (msg) => { ok = false; console.log("✘", msg); };

const engagements = await prisma.engagement.findMany({
  include: { booking: true, orders: true, lawyerProfile: { include: { user: true } }, client: true },
});
note(`engagements in DB: ${engagements.length}`);
const onChainNext = await pub.readContract({
  address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI, functionName: "nextEngagementId",
});
note(`engagements on chain: ${onChainNext}`);

for (const e of engagements) {
  console.log(`\n• engagement ${e.id} (chain id ${e.engagementIdOnChain})`);
  let chainEng;
  try {
    chainEng = await pub.readContract({
      address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI,
      functionName: "getEngagement", args: [BigInt(e.engagementIdOnChain)],
    });
  } catch (err) {
    fail(`getEngagement failed: ${err.message}`);
    continue;
  }
  // state 0 = None -> engagement doesn't exist on chain
  if (chainEng.state === 0) {
    fail(`chain has no engagement at id ${e.engagementIdOnChain}`);
    continue;
  }
  const dbClientWallet = e.client.walletAddress.toLowerCase();
  const dbLawyerWallet = e.lawyerProfile.user.walletAddress.toLowerCase();
  if (chainEng.client.toLowerCase() !== dbClientWallet) {
    fail(`client mismatch: db=${dbClientWallet} chain=${chainEng.client.toLowerCase()}`);
  }
  if (chainEng.lawyer.toLowerCase() !== dbLawyerWallet) {
    fail(`lawyer mismatch: db=${dbLawyerWallet} chain=${chainEng.lawyer.toLowerCase()}`);
  }
  if (chainEng.matterRef.toLowerCase() !== e.matterRef.toLowerCase()) {
    fail(`matterRef mismatch: db=${e.matterRef} chain=${chainEng.matterRef}`);
  }

  // Milestone count: 1 (consultation) + the orders we've actually funded
  // (status ACCEPTED/COMPLETED, those got a milestoneIndex).
  const fundedOrders = e.orders.filter((o) => o.milestoneIndex !== null);
  const expectedMilestones = 1 + fundedOrders.length;
  if (Number(chainEng.milestoneCount) !== expectedMilestones) {
    fail(`milestoneCount mismatch: chain=${chainEng.milestoneCount} expected=${expectedMilestones} (1 booking + ${fundedOrders.length} funded orders)`);
  } else {
    note(`  ✓ milestoneCount = ${chainEng.milestoneCount}`);
  }

  // Booking (milestone 0) check — only walk it if the booking row carries an
  // escrow tx (otherwise the consultation hasn't been funded yet).
  if (e.booking?.escrowTxHash) {
    const m0 = await pub.readContract({
      address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI,
      functionName: "getMilestone", args: [BigInt(e.engagementIdOnChain), 0n],
    });
    note(`  ms 0 (consultation): state=${MS_STATE[m0.state]} amount=${m0.amount}`);
    const expected = e.booking.escrowReleaseHash ? "Released" : "Funded";
    if (MS_STATE[m0.state] !== expected) {
      fail(`  consultation state ${MS_STATE[m0.state]} != expected ${expected}`);
    }
  }

  for (const o of fundedOrders) {
    const m = await pub.readContract({
      address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS, abi: ESC_ABI,
      functionName: "getMilestone", args: [BigInt(e.engagementIdOnChain), BigInt(o.milestoneIndex)],
    });
    note(`  ms ${o.milestoneIndex} (order ${o.id}): state=${MS_STATE[m.state]} amount=${m.amount}`);
    const expected = o.escrowReleaseHash ? "Released" : (o.status === "ACCEPTED" ? "Funded" : MS_STATE[m.state]);
    if (MS_STATE[m.state] !== expected) {
      fail(`  order ${o.id} state ${MS_STATE[m.state]} != expected ${expected}`);
    }
  }
}

await prisma.$disconnect();

console.log(ok ? "\n✓ on-chain ↔ DB: in sync" : "\n✘ DRIFT detected — see ✘ markers above");
process.exit(ok ? 0 : 1);
