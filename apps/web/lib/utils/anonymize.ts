/** Anonymous client identifier ("Client #4A · 2f") derived from the wallet address. */
export function anonymousClientId(walletAddress: string): string {
  const hex = walletAddress.replace(/^0x/i, "").toUpperCase();
  return `#${hex.slice(0, 2)} · ${hex.slice(-2).toLowerCase()}`;
}
