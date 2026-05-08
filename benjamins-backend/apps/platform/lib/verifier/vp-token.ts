/**
 * Re-exported from `lib/credentials/dcql.ts` so the verifier code path has a
 * dedicated import surface. The actual logic (handling the wwWallet's
 * string-or-array vp_token shape) lives there because the same function is
 * used both client-side and server-side.
 */
export { pickVpFromToken } from "@lex-nova/dcql";
