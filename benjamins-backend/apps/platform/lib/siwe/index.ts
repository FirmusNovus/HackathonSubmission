import { SiweMessage, generateNonce } from "siwe";
import type { Address } from "viem";

export function createNonce(): string {
  return generateNonce();
}

export interface BuildSiweArgs {
  address: Address;
  domain: string;
  uri: string;
  chainId: number;
  nonce: string;
  statement?: string;
  issuedAt?: string;
}

export function buildSiweMessage(args: BuildSiweArgs): string {
  const message = new SiweMessage({
    domain: args.domain,
    address: args.address,
    statement: args.statement ?? "Sign in to Lex Nova",
    uri: args.uri,
    version: "1",
    chainId: args.chainId,
    nonce: args.nonce,
    issuedAt: args.issuedAt,
  });
  return message.prepareMessage();
}

export interface VerifyResult {
  ok: boolean;
  address?: Address;
  reason?: string;
}

export async function verifySiwe(message: string, signature: string, expectedNonce: string): Promise<VerifyResult> {
  try {
    const parsed = new SiweMessage(message);
    if (parsed.nonce !== expectedNonce) {
      return { ok: false, reason: "nonce mismatch" };
    }
    const result = await parsed.verify({ signature });
    if (!result.success) {
      return { ok: false, reason: result.error?.type ?? "verification failed" };
    }
    return { ok: true, address: parsed.address as Address };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
