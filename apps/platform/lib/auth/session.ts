// Owner spec: 001-verified-legal-engagement.
// Cookie-based session: signed JWT carrying the SIWE-bound address + roles.

import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { getVerifiedUser } from '@/lib/db/verified-users';

const COOKIE_NAME = 'fn_session';
const SESSION_TTL = 60 * 60 * 24 * 7;
const secret = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? 'dev-only-session-secret-replace-in-production',
);

export interface Session {
  address: string;
  iat: number;
}

export async function createSession(address: string): Promise<void> {
  const token = await new SignJWT({ address: address.toLowerCase() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL}s`)
    .sign(secret);
  const c = await cookies();
  c.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL,
  });
}

export async function getSession(): Promise<Session | null> {
  const c = await cookies();
  const token = c.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return { address: (payload.address as string).toLowerCase(), iat: payload.iat as number };
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const c = await cookies();
  c.set(COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 });
}

export interface SessionWithRole extends Session {
  role: 'client' | 'lawyer' | 'operator' | null;
  isClient: boolean;
  isLawyer: boolean;
  isOperator: boolean;
}

import { ADDRESSES } from '@/lib/chain/client';

export async function getSessionWithRoles(): Promise<SessionWithRole | null> {
  const s = await getSession();
  if (!s) return null;
  const isClient = !!getVerifiedUser(s.address, 'client');
  const isLawyer = !!getVerifiedUser(s.address, 'lawyer');
  const isOperator = s.address.toLowerCase() === ADDRESSES.operator.toLowerCase();
  return {
    ...s,
    role: isLawyer ? 'lawyer' : isClient ? 'client' : isOperator ? 'operator' : null,
    isClient,
    isLawyer,
    isOperator,
  };
}
