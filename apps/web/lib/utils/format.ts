// Display-side formatters. Amounts are in ETH after the hackathon pivot.

/**
 * Format an ETH amount as `0.06 ETH`. Up to 4 decimals, trailing zeros
 * trimmed. Whole values render as `1 ETH` (no decimal noise).
 */
export function formatETH(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0 ETH";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const trimmed = abs.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `${sign}${trimmed} ETH`;
}

/** Truncate an EVM address to the design-spec form: 0x4f02…2c1a. */
export function truncateAddress(address: string | null | undefined): string {
  if (!address) return "—";
  if (address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** "Tomorrow · 10:30 CET" style for booking sidebars. */
const dateFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

export function formatScheduled(date: Date): string {
  return `${dateFmt.format(date)} · ${timeFmt.format(date)}`;
}

export function formatRelativeDay(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) return dateFmt.format(date);
  return dateFmt.format(date);
}
