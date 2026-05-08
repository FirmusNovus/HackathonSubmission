import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Address, Hex } from "viem";

const DEPLOYED_ADDRESSES_PATH = join(process.cwd(), "lib/chain/deployed-addresses.json");

export interface DeployedAddresses {
  ATTESTATION_MANAGER_ADDRESS: Address;
  LEGAL_ENGAGEMENT_ESCROW_ADDRESS: Address;
  ZK_VERIFIER_ADDRESS: Address;
  EAS_ADDRESS: Address;
  SCHEMA_REGISTRY_ADDRESS: Address;
  SCHEMA_LAWYER: Hex;
  SCHEMA_CLIENT: Hex;
  SCHEMA_ARBITER: Hex;
}

const PLACEHOLDER: DeployedAddresses = {
  ATTESTATION_MANAGER_ADDRESS: "0x0000000000000000000000000000000000000000",
  LEGAL_ENGAGEMENT_ESCROW_ADDRESS: "0x0000000000000000000000000000000000000000",
  ZK_VERIFIER_ADDRESS: "0x0000000000000000000000000000000000000000",
  EAS_ADDRESS: "0x0000000000000000000000000000000000000000",
  SCHEMA_REGISTRY_ADDRESS: "0x0000000000000000000000000000000000000000",
  SCHEMA_LAWYER: "0x0000000000000000000000000000000000000000000000000000000000000000",
  SCHEMA_CLIENT: "0x0000000000000000000000000000000000000000000000000000000000000000",
  SCHEMA_ARBITER: "0x0000000000000000000000000000000000000000000000000000000000000000",
};

let _cached: DeployedAddresses | null = null;

export function getAddresses(): DeployedAddresses {
  if (_cached) return _cached;
  if (!existsSync(DEPLOYED_ADDRESSES_PATH)) {
    return PLACEHOLDER;
  }
  const raw = readFileSync(DEPLOYED_ADDRESSES_PATH, "utf-8");
  _cached = JSON.parse(raw) as DeployedAddresses;
  return _cached;
}

export function refreshAddresses(): void {
  _cached = null;
}

/**
 * Chain id used for EIP-712 typed-data domains. Reads `CHAIN_ID` from env
 * if set; defaults to 31337 (anvil) for local dev. Production deployments
 * (Base Sepolia, etc.) override via env at process start.
 */
export function getChainId(): number {
  const fromEnv = process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : NaN;
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 31337;
}
