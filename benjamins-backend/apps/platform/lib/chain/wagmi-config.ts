"use client";
import { http, createConfig } from "wagmi";
import { anvil, baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);

export const wagmiConfig =
  CHAIN_ID === 84532
    ? createConfig({
        chains: [baseSepolia],
        transports: { [baseSepolia.id]: http(RPC_URL) },
        connectors: [injected()],
      })
    : createConfig({
        chains: [anvil],
        transports: { [anvil.id]: http(RPC_URL) },
        connectors: [injected()],
      });
