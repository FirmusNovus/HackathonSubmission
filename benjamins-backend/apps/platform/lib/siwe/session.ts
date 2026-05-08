import { cookies } from "next/headers";
import type { Address } from "viem";

const SESSION_COOKIE = "lex_nova_session";
const NONCE_COOKIE = "lex_nova_siwe_nonce";

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const NONCE_MAX_AGE = 60 * 10; // 10 min

export function setSessionCookie(address: Address): void {
  cookies().set(SESSION_COOKIE, address, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
}

export function clearSessionCookie(): void {
  cookies().delete(SESSION_COOKIE);
}

export function getSessionAddress(): Address | null {
  const v = cookies().get(SESSION_COOKIE)?.value;
  return v ? (v as Address) : null;
}

export function setNonceCookie(nonce: string): void {
  cookies().set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: NONCE_MAX_AGE,
    path: "/",
  });
}

export function getNonceCookie(): string | null {
  return cookies().get(NONCE_COOKIE)?.value ?? null;
}

export function clearNonceCookie(): void {
  cookies().delete(NONCE_COOKIE);
}
