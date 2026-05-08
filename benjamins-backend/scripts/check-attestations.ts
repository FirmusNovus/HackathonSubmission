/**
 * T047 chain-side smoke check.
 *
 * Reads the bar-issuer's local subjects table (apps/bar-issuer/data/db.sqlite)
 * to enumerate the lawyer-allocated wallet addresses, then queries
 * `AttestationManager.hasCapability(<address>, SCHEMA_LAWYER)` on chain.
 * Prints a pass/fail row per address.
 *
 * The bar-issuer DB is the authoritative roster of "who is a lawyer" — the
 * platform deliberately doesn't keep that registry; it only sees attestations
 * that have actually landed on chain after a real onboarding flow.
 *
 * The wallet-driven onboarding flow itself stays manual (needs wwWallet +
 * ngrok); this script is the automated half of "did the attestation actually
 * land?"
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { anvil } from "viem/chains";

const ROOT = join(__dirname, "..");
const BAR_DB_PATH =
  process.env.BAR_ISSUER_DB_PATH ?? join(ROOT, "apps/bar-issuer/data/db.sqlite");
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const ADDRESSES_PATH = join(ROOT, "apps/platform/lib/chain/deployed-addresses.json");

const ABI = parseAbi([
  "function hasCapability(address subject, bytes32 schemaId) view returns (bool)",
]);

async function main() {
  if (!existsSync(ADDRESSES_PATH)) {
    console.error(`× ${ADDRESSES_PATH} not found. Run \`pnpm scripts:deploy\` first.`);
    process.exit(1);
  }
  if (!existsSync(BAR_DB_PATH)) {
    console.error(`× ${BAR_DB_PATH} not found. Run \`pnpm scripts:seed\` first.`);
    process.exit(1);
  }
  const addrs = JSON.parse(readFileSync(ADDRESSES_PATH, "utf-8")) as {
    ATTESTATION_MANAGER_ADDRESS: Address;
    SCHEMA_LAWYER: `0x${string}`;
  };

  const db = new Database(BAR_DB_PATH, { readonly: true });
  const lawyers = db
    .prepare(`SELECT display_name, eth_address FROM subjects ORDER BY id`)
    .all() as { display_name: string; eth_address: Address }[];

  const client = createPublicClient({ chain: anvil, transport: http(RPC_URL) });

  console.log(`Checking ${lawyers.length} lawyer subjects against AttestationManager.hasCapability(SCHEMA_LAWYER):\n`);
  let attested = 0;
  for (const l of lawyers) {
    const ok = (await client.readContract({
      address: addrs.ATTESTATION_MANAGER_ADDRESS,
      abi: ABI,
      functionName: "hasCapability",
      args: [l.eth_address, addrs.SCHEMA_LAWYER],
    })) as boolean;
    console.log(`  ${ok ? "✓" : "·"} ${l.display_name.padEnd(24)} ${l.eth_address}`);
    if (ok) attested += 1;
  }

  console.log(`\nResult: ${attested}/${lawyers.length} attested.`);
  if (attested === lawyers.length) {
    console.log("✓ All lawyers attested.");
  } else if (attested === 0) {
    console.log("→ Empty platform. Onboard each lawyer at /onboarding/lawyer to populate.");
  } else {
    console.log("→ Partial. Onboard the unmarked ones via /onboarding/lawyer.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
