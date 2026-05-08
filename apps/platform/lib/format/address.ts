// Owner spec: 001-verified-legal-engagement.

export function truncateAddress(addr: string): string {
  if (!addr.startsWith('0x') || addr.length !== 42) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
