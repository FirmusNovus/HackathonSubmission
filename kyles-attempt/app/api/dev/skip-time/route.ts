import { NextResponse } from "next/server";
import { __skipTime } from "@/lib/chain/clock";
import { prisma } from "@/lib/db/client";

// =============================================================================
// /api/dev/skip-time — F5 dev-only mock-clock helper.
// -----------------------------------------------------------------------------
// Used by Playwright + dev tooling to fast-forward the mock clock past the
// 30-day lawyer dispute cooldown without sleeping. Mirrors `__skipTime` in
// `lib/chain/clock.ts`. Gated identically to `/api/dev/chain` — the route is
// 404 in production unless `ENABLE_MOCK_AUTH === "true"`.
//
// POST { seconds: number } → { offsetSeconds }
// GET                       → { offsetSeconds }
//
// Why a dedicated route in addition to /api/dev/chain's `__skipTime`
// dispatch? Two reasons:
//   1. Smaller, single-purpose surface that doesn't require the caller to
//      know the chain RPC envelope shape — handy in UI dev tools and the F5
//      cooldown e2e tests.
//   2. Separating it lets the route be added/removed without churning the
//      chain RPC dispatcher whitelist.
// =============================================================================

const SINGLETON_ID = "default";

function devGuard(): NextResponse | null {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_MOCK_AUTH !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}

export async function POST(request: Request) {
  const guarded = devGuard();
  if (guarded) return guarded;
  let body: { seconds?: unknown };
  try {
    body = (await request.json()) as { seconds?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const seconds = Number(body.seconds);
  if (!Number.isFinite(seconds)) {
    return NextResponse.json(
      { error: "seconds must be a finite number" },
      { status: 400 },
    );
  }
  try {
    const offsetSeconds = await __skipTime(seconds);
    return NextResponse.json({ offsetSeconds });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  const guarded = devGuard();
  if (guarded) return guarded;
  // Read-through: GET should return the *current* offset without mutating it.
  // Calling __skipTime(0) here would still be a write and bumps `updatedAt`
  // unnecessarily. So we hit the row directly via Prisma.
  const row = await prisma.mockClock.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: { id: SINGLETON_ID, offsetSeconds: 0 },
  });
  return NextResponse.json({ offsetSeconds: row.offsetSeconds });
}
