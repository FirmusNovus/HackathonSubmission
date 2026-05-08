// Owner spec: 001-verified-legal-engagement.
// Wei → ETH formatter. 4 decimals, no scientific notation.

const WEI_PER_ETH = 10n ** 18n;

export function formatETH(wei: bigint | string): string {
  const w = typeof wei === 'string' ? BigInt(wei) : wei;
  const integer = w / WEI_PER_ETH;
  const remainder = w % WEI_PER_ETH;
  const padded = remainder.toString().padStart(18, '0');
  const fractional = padded.slice(0, 4).replace(/0+$/, '');
  return fractional.length > 0 ? `${integer}.${fractional} ETH` : `${integer} ETH`;
}
