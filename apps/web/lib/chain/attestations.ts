/**
 * Read-only chain helpers for AttestationManager. Used to answer "is this
 * wallet already attested?" without reaching into our DB — the source of
 * truth for capability is the contract, not our cache.
 */
import { parseAbi, type Address } from "viem";
import { publicClient } from "./clients";
import { getAddresses } from "./addresses";

const ATTESTATION_MANAGER_ABI = parseAbi([
  "function hasCapability(address subject, bytes32 schemaId) view returns (bool)",
]);

export interface AttestationStatus {
  client: boolean;
  lawyer: boolean;
}

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Returns whether the given wallet has each capability attested on chain.
 * Falls back to `{ client: false, lawyer: false }` if the AttestationManager
 * address hasn't been written to deployed-addresses.json yet (i.e. the
 * contracts haven't been deployed). Lets the rest of the app keep working
 * even before `pnpm scripts:deploy` has been run once.
 */
export async function getAttestationStatus(walletAddress: string): Promise<AttestationStatus> {
  const addrs = getAddresses();
  if (addrs.ATTESTATION_MANAGER_ADDRESS === ZERO) {
    return { client: false, lawyer: false };
  }
  const subject = walletAddress.toLowerCase() as Address;
  try {
    const [client, lawyer] = await Promise.all([
      publicClient.readContract({
        address: addrs.ATTESTATION_MANAGER_ADDRESS,
        abi: ATTESTATION_MANAGER_ABI,
        functionName: "hasCapability",
        args: [subject, addrs.SCHEMA_CLIENT],
      }),
      publicClient.readContract({
        address: addrs.ATTESTATION_MANAGER_ADDRESS,
        abi: ATTESTATION_MANAGER_ABI,
        functionName: "hasCapability",
        args: [subject, addrs.SCHEMA_LAWYER],
      }),
    ]);
    return { client, lawyer };
  } catch {
    // Anvil down, RPC unreachable, or stale deployed-addresses.json — none of
    // these should brick onboarding. Treat as not-yet-attested.
    return { client: false, lawyer: false };
  }
}
