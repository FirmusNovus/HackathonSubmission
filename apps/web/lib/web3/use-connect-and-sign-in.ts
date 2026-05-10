"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
import { signIn } from "next-auth/react";
import { SiweMessage } from "siwe";

/**
 * One-shot connect + SIWE flow:
 *   click → wallet popup (connect) → wallet popup (sign) → session cookie.
 *
 * Role-agnostic. The server's SIWE provider derives role from on-chain
 * AttestationManager state, so we don't need it here. New visitors get a
 * default CLIENT role server-side; the role is upgraded to LAWYER once the
 * lawyer-credential onboarding step writes a SCHEMA_LAWYER attestation.
 */
export function useConnectAndSignIn() {
  const { connectAsync, connectors } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const { address, isConnected } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function run(): Promise<{ address: `0x${string}` }> {
    setPending(true);
    setError(null);
    try {
      let walletAddress: `0x${string}` | undefined = address;
      if (!isConnected || !walletAddress) {
        const injected = connectors.find((c) => c.id === "injected") ?? connectors[0];
        if (!injected) {
          throw new Error("No browser wallet detected. Install MetaMask or another EIP-1193 wallet.");
        }
        const result = await connectAsync({ connector: injected });
        walletAddress = result.accounts[0];
      }
      if (!walletAddress) throw new Error("Wallet connection returned no account.");

      const nonceRes = await fetch("/api/auth/siwe/nonce", { method: "POST" });
      if (!nonceRes.ok) throw new Error(`Failed to fetch SIWE nonce (${nonceRes.status})`);
      const { nonce } = (await nonceRes.json()) as { nonce: string };

      const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "31337");
      const params = {
        domain: window.location.host,
        address: walletAddress,
        statement: "Sign in to Firmus Novus.",
        uri: window.location.origin,
        version: "1" as const,
        chainId,
        nonce,
        issuedAt: new Date().toISOString(),
      };
      const siwe = new SiweMessage(params);
      const messageString = siwe.prepareMessage();
      const signature = await signMessageAsync({ message: messageString });

      const result = await signIn("siwe", {
        message: JSON.stringify(params),
        signature,
        redirect: false,
      });
      if (!result || result.error) {
        throw new Error(result?.error ?? "Sign-in failed.");
      }
      return { address: walletAddress };
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      throw e;
    } finally {
      setPending(false);
    }
  }

  return { run, pending, error, isConnected, address, disconnectAsync };
}
