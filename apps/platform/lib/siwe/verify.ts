// Owner spec: 001-verified-legal-engagement.

import { SiweMessage } from 'siwe';
import { consumeNonce } from './nonce';

export interface VerifyOk {
  ok: true;
  address: string;
}
export interface VerifyErr {
  ok: false;
  error: string;
}

export async function verifySiwe(message: string, signature: string): Promise<VerifyOk | VerifyErr> {
  try {
    const msg = new SiweMessage(message);
    if (!consumeNonce(msg.nonce)) return { ok: false, error: 'nonce-reused-or-unknown' };
    const result = await msg.verify({ signature });
    if (!result.success) return { ok: false, error: 'verify-failed' };
    return { ok: true, address: msg.address.toLowerCase() };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
