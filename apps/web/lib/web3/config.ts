"use client";

import { http, createConfig } from "wagmi";
import { defineChain } from "viem";
import { injected } from "wagmi/connectors";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "31337");

// Local anvil. We define this even when CHAIN_ID is something else so the
// types stay consistent — if a non-anvil deployment is needed, plug in the
// canonical chain definition (e.g. baseSepolia from viem/chains) here.
export const anvil = defineChain({
  id: CHAIN_ID,
  name: "Anvil",
  network: "anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
});

export const wagmiConfig = createConfig({
  chains: [anvil],
  connectors: [injected({ shimDisconnect: true })],
  transports: { [anvil.id]: http(RPC_URL) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
