"use client";

import { useState } from "react";

export type VerifierKind = "pid" | "bar";
export type VerifiedResult = {
  status: "verified";
  kind: VerifierKind;
  state: string;
  verifiedAttrs: Record<string, unknown>;
  holderJwk: Record<string, unknown> | null;
};

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Drives an OID4VP presentation: POST /api/verifier/request → open wwwallet
 * → poll /api/verifier/result/{state} until verified or rejected.
 *
 * Returns the disclosed claims when the wallet completes the presentation.
 */
export function useVerifierPresentation() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function present(kind: VerifierKind): Promise<VerifiedResult> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/verifier/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `verifier/request HTTP ${res.status}`);
      }
      const { state, wwwalletUrl } = (await res.json()) as { state: string; wwwalletUrl: string };

      window.open(wwwalletUrl, "_blank", "noopener,noreferrer");

      const verified = await pollResult(state);
      return { ...verified, state };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      throw err;
    } finally {
      setPending(false);
    }
  }

  return { present, pending, error };
}

async function pollResult(state: string): Promise<Omit<VerifiedResult, "state">> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const res = await fetch(`/api/verifier/result/${state}`, { cache: "no-store" });
    if (res.status === 202) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    if (res.status === 200) {
      const body = (await res.json()) as VerifiedResult;
      return body;
    }
    // 400 = rejected, anything else is unexpected
    const body = (await res.json().catch(() => ({}))) as { reason?: string; error?: string };
    throw new Error(body.reason ?? body.error ?? `verifier/result HTTP ${res.status}`);
  }
  throw new Error("Verifier polling timed out — the wallet didn't complete the presentation in 5 minutes.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
