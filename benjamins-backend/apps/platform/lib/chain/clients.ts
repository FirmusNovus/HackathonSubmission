import { createPublicClient, createWalletClient, http, type Address, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil, baseSepolia } from "viem/chains";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);

function selectChain(): Chain {
  switch (CHAIN_ID) {
    case 31337:
      return anvil;
    case 84532:
      return baseSepolia;
    default:
      throw new Error(`Unsupported CHAIN_ID ${CHAIN_ID}. Add it to lib/chain/clients.ts.`);
  }
}

export const chain = selectChain();

export const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
});

/**
 * Server-side wallet client backed by OPERATOR_PRIVATE_KEY. Used ONLY by the
 * platform operator's code paths (writing capability attestations, broadcasting
 * the deploy script). Client and lawyer wallets sign transactions in the
 * browser via wagmi — never on the server.
 */
export function operatorWalletClient() {
  const pk = process.env.OPERATOR_PRIVATE_KEY;
  if (!pk) throw new Error("OPERATOR_PRIVATE_KEY env not set");
  const account = privateKeyToAccount(pk as `0x${string}`);
  return createWalletClient({
    account,
    chain,
    transport: http(RPC_URL),
  });
}

export function operatorAddress(): Address {
  const pk = process.env.OPERATOR_PRIVATE_KEY;
  if (!pk) throw new Error("OPERATOR_PRIVATE_KEY env not set");
  return privateKeyToAccount(pk as `0x${string}`).address;
}
