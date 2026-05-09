/**
 * Fetch an issuer's JWKS over HTTP. Replaces the old direct-disk read of
 * data/issuers/<kind>.jwk now that the issuers run as separate processes
 * (apps/bar-issuer, apps/pid-issuer) and only expose their public keys via
 * the standard `.well-known/jwks.json` endpoint.
 *
 * The platform's verifier calls this when it needs to validate an SD-JWT VC's
 * signature. Cache is intentionally absent — JWKS rotation should be
 * observable mid-session; the request volume is once-per-presentation.
 */
import type { JWK } from "jose";

export type IssuerKind = "bar" | "pid";

export async function fetchIssuerJwks(kind: IssuerKind): Promise<{ keys: JWK[] }> {
  const baseHost = process.env.PUBLIC_HOSTNAME?.replace(/\/$/, "") ?? "http://localhost:3000";
  const url = `${baseHost}/api/issuer/${kind}/.well-known/jwks.json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`failed to fetch ${kind} issuer JWKS at ${url}: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { keys?: JWK[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new Error(`${kind} issuer JWKS response had no keys`);
  }
  return { keys: body.keys };
}
