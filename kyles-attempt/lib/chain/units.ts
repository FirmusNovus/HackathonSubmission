// =============================================================================
// Wei <-> string helpers.
// -----------------------------------------------------------------------------
// SQLite + Prisma can't store native bigints losslessly (Decimal is fine for
// EUR but wei needs base-10 integer string for cross-chain compatibility).
// We serialise as decimal strings everywhere on disk and deserialise to
// `bigint` at the boundary.
// =============================================================================

export function weiToBigInt(s: string | bigint | number): bigint {
  if (typeof s === "bigint") return s;
  if (typeof s === "number") return BigInt(s);
  // Allow a leading "0x" hex prefix as well, for robustness against callers
  // that picked up the representation from a tx receipt.
  if (s.startsWith("0x") || s.startsWith("0X")) return BigInt(s);
  return BigInt(s);
}

export function bigIntToWei(n: bigint | number | string): string {
  if (typeof n === "string") return weiToBigInt(n).toString(10);
  if (typeof n === "number") return BigInt(n).toString(10);
  return n.toString(10);
}
