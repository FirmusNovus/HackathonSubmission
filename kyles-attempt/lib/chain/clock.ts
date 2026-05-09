// =============================================================================
// Mockable clock.
// -----------------------------------------------------------------------------
// The real chain has `block.timestamp`. We need a way to fast-forward it in
// dev and tests so the 30-day lawyer dispute cooldown doesn't require a real
// 30-day wait. The offset is persisted in `MockClock` (singleton row) so it
// survives process restarts during a test run.
//
// Only `__skipTime` and `__resetClock` mutate the offset. They're used by the
// `/api/dev/skip-time` route (added in F4+) and the Playwright helpers.
// =============================================================================

import { prisma } from "@/lib/db/client";

const SINGLETON_ID = "default";

let _cachedOffsetSeconds: number | null = null;
let _cacheReadAt = 0;
const CACHE_TTL_MS = 200;

async function getOffsetSeconds(): Promise<number> {
  // Tiny read-through cache: now() is called many times per request; we don't
  // want each one to hit SQLite. 200ms is short enough that __skipTime feels
  // immediate from the caller's perspective and long enough to absorb hot
  // loops inside one request.
  const elapsed = Date.now() - _cacheReadAt;
  if (_cachedOffsetSeconds !== null && elapsed < CACHE_TTL_MS) {
    return _cachedOffsetSeconds;
  }
  const row = await prisma.mockClock.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: { id: SINGLETON_ID, offsetSeconds: 0 },
  });
  _cachedOffsetSeconds = row.offsetSeconds;
  _cacheReadAt = Date.now();
  return _cachedOffsetSeconds;
}

/**
 * The chain's "current time". In production this is `block.timestamp` (which
 * can drift up to ~15s from wall-clock). In the mock chain it's
 * `Date.now() + offset`. Always returns a Date with second-precision behaviour
 * — the contract uses uint64 seconds, so we floor here too.
 */
export async function now(): Promise<Date> {
  const offset = await getOffsetSeconds();
  const wallSeconds = Math.floor(Date.now() / 1000);
  return new Date((wallSeconds + offset) * 1000);
}

/**
 * Synchronous now() for hot paths that already have the offset on hand. The
 * unit tests in F4+ use this; chain functions should prefer the async form.
 */
export function nowSyncWithOffset(offsetSeconds: number): Date {
  const wallSeconds = Math.floor(Date.now() / 1000);
  return new Date((wallSeconds + offsetSeconds) * 1000);
}

/**
 * `next start` runs with NODE_ENV=production even for our Playwright suite.
 * The Playwright config sets ENABLE_MOCK_AUTH=true to opt in to dev-only
 * helpers (mirrors `app/dev/sign-in/route.ts`); we honour the same opt-in
 * here so the e2e suite can fast-forward the cooldown clock against the
 * production-built server.
 */
function devGuardOk(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.ENABLE_MOCK_AUTH === "true";
}

/**
 * Fast-forward the mock clock. Used by /api/dev/skip-time in dev mode and by
 * Playwright helpers that need to bypass the 30-day cooldown. NOOP outside
 * dev/test environments — guarding here so a stray call from a leaked admin
 * route doesn't accidentally rewind production time.
 */
export async function __skipTime(seconds: number): Promise<number> {
  if (!devGuardOk()) {
    throw new Error("__skipTime is not available in production");
  }
  const row = await prisma.mockClock.upsert({
    where: { id: SINGLETON_ID },
    update: { offsetSeconds: { increment: seconds } },
    create: { id: SINGLETON_ID, offsetSeconds: seconds },
  });
  _cachedOffsetSeconds = row.offsetSeconds;
  _cacheReadAt = Date.now();
  return row.offsetSeconds;
}

export async function __resetClock(): Promise<void> {
  if (!devGuardOk()) {
    throw new Error("__resetClock is not available in production");
  }
  await prisma.mockClock.upsert({
    where: { id: SINGLETON_ID },
    update: { offsetSeconds: 0 },
    create: { id: SINGLETON_ID, offsetSeconds: 0 },
  });
  _cachedOffsetSeconds = 0;
  _cacheReadAt = Date.now();
}
