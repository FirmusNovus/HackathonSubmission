import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getAddresses, getChainId } from "@/lib/chain/addresses";
import { operatorAddress } from "@/lib/chain/clients";

export const runtime = "nodejs";

/**
 * Public chain configuration. The browser needs the escrow address + chain
 * id to build EIP-712 typed-data domains for `MutualRefundAuthorization`
 * signatures (and for any other future client-side typed-data flows).
 *
 * Also surfaces the operator's published P-256 messaging pubkey when
 * registered — disputers' browsers fetch it before encrypting a dispute
 * bundle. `null` until the operator visits `/operator/disputes` and
 * generates their key.
 *
 * No auth — these values are public. The cache header is intentionally
 * short (60s) since `operator_messaging_public_key` flips from null to
 * populated mid-session.
 */
export async function GET() {
  const addrs = getAddresses();
  const opAddr = operatorAddress();
  const opKeyRow = getDb()
    .prepare(
      `SELECT public_key_jwk FROM operator_messaging_key
       WHERE lower(operator_address) = lower(?)`
    )
    .get(opAddr) as { public_key_jwk: string } | undefined;
  return NextResponse.json(
    {
      chain_id: getChainId(),
      escrow_address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS,
      attestation_manager_address: addrs.ATTESTATION_MANAGER_ADDRESS,
      operator_address: opAddr,
      operator_messaging_public_key: opKeyRow ? JSON.parse(opKeyRow.public_key_jwk) : null,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, must-revalidate",
      },
    }
  );
}
