// Display-side formatters. The platform shows tokenized EUR — never crypto denominations to end users.

const eurWhole = new Intl.NumberFormat("en-EU", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const eurExact = new Intl.NumberFormat("en-EU", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a EUR amount. Whole-euro figures render without decimals; fractional with 2dp. */
export function formatEUR(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? eurWhole.format(n) : eurExact.format(n);
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
