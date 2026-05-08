// Owner spec: 001-verified-legal-engagement.
// Typed contract bindings produced from deployed addresses + hand-trimmed ABIs.

import { ADDRESSES, SCHEMA_UIDS } from './addresses';
import { attestationManagerAbi, escrowAbi } from './abis';

export const attestationManager = {
  address: ADDRESSES.attestationManager as `0x${string}`,
  abi: attestationManagerAbi,
} as const;

export const escrow = {
  address: ADDRESSES.legalEngagementEscrow as `0x${string}`,
  abi: escrowAbi,
} as const;

export const SCHEMA_LAWYER = SCHEMA_UIDS.lawyer as `0x${string}`;
export const SCHEMA_CLIENT = SCHEMA_UIDS.client as `0x${string}`;
