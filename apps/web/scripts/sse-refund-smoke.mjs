// SSE + API smoke for the Phase 9 refund flow.
//
// Lifecycle:
//   1. Client books, lawyer accepts (dev-login skips wallet sigs).
//   2. Inject a synthetic Engagement row linking the booking to a known
//      on-chain engagement id — needed because /refund/sign requires the
//      booking to be funded, and dev-login can't drive a real on-chain
//      funding tx (we have no private key for the fixture wallets).
//   3. Subscribe to SSE on both sides.
//   4. Client signs refund (dev-login bypass) → SSE pushes
//      clientRefundSigned to both subscribers.
//   5. Lawyer signs refund → SSE pushes lawyerRefundSigned + the response
//      from /refund/sign carries both sigs (so the second signer's UI
//      could submit the chain tx).
//
// Doesn't exercise the chain submit (`mutualRefundMilestone`); that's
// covered end-to-end by `phase9-smoke.mjs`.

import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

const BASE = "http://127.0.0.1:3010";

function makeJar() {
  const cookies = new Map();
  return {
    cookieHeader() {
      return Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
    },
    captureFrom(res) {
      const lines = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      for (const line of lines) {
        const [pair] = line.split(";");
        const eq = pair.indexOf("=");
        if (eq < 0) continue;
        const name = pair.slice(0, eq).trim();
        const val = pair.slice(eq + 1).trim();
        if (val === "" || val === "deleted") cookies.delete(name);
        else cookies.set(name, val);
      }
    },
  };
}

async function fetchJ(jar, path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set("cookie", jar.cookieHeader());
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
  jar.captureFrom(res);
  if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
    const loc = res.headers.get("location");
    const next = loc.startsWith("http") ? loc : `${BASE}${loc}`;
    const headers2 = new Headers();
    headers2.set("cookie", jar.cookieHeader());
    const res2 = await fetch(next, { headers: headers2, redirect: "manual" });
    jar.captureFrom(res2);
    return res2;
  }
  return res;
}

async function devSignIn(jar, wallet, role) {
  const res = await fetchJ(jar, `/dev/sign-in?wallet=${encodeURIComponent(wallet)}&role=${role}`);
  if (res.status >= 400) throw new Error(`dev-sign-in failed: ${res.status}`);
}

async function* sse(jar, path, signal) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie: jar.cookieHeader(), accept: "text/event-stream" },
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`sse open failed: ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const evt = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = evt.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      yield JSON.parse(dataLine.slice(5).trim());
    }
  }
}

const SEEDED_CLIENT = "0x2222000000000000000000000000000000000001";
const SEEDED_LAWYER = "0x1111000000000000000000000000000000000001";

const clientJar = makeJar();
const lawyerJar = makeJar();
console.log("→ sign in client + lawyer");
await devSignIn(clientJar, SEEDED_CLIENT, "client");
await devSignIn(lawyerJar, SEEDED_LAWYER, "lawyer");

console.log("→ resolve Maria's lawyerProfileId");
const lawyersRes = await fetchJ(clientJar, "/api/lawyers");
const { lawyers } = await lawyersRes.json();
const maria = lawyers.find((l) => l.user.walletAddress.toLowerCase() === SEEDED_LAWYER.toLowerCase());
if (!maria) throw new Error("Maria missing — did seed run?");

console.log("→ client books");
const createRes = await fetchJ(clientJar, "/api/bookings", {
  method: "POST",
  body: JSON.stringify({
    lawyerProfileId: maria.id,
    scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    durationMinutes: 60,
    practiceArea: "Family",
    caseDescription: "Phase 9 SSE refund smoke test — please ignore.",
  }),
});
if (!createRes.ok) throw new Error(`create booking failed: ${createRes.status} ${await createRes.text()}`);
const { booking } = await createRes.json();
console.log("  bookingId:", booking.id);

console.log("→ lawyer accepts");
const accRes = await fetchJ(lawyerJar, `/api/bookings/${booking.id}/accept`, { method: "POST", body: "{}" });
if (!accRes.ok) throw new Error(`accept failed: ${accRes.status} ${await accRes.text()}`);

console.log("→ inject Engagement row (simulating funding) for dev-login coverage");
const prisma = new PrismaClient();
// Synthetic engagement id outside the chain's 1..N space + per-run unique
// so we don't collide with leftovers from a previous interrupted run.
const synthEngagementId = 100_000 + Math.floor(Math.random() * 1_000_000);
const matterRefBytes = ("00" + Math.random().toString(16).slice(2)).slice(-2).repeat(32);
const eng = await prisma.engagement.create({
  data: {
    clientId: booking.clientId,
    lawyerProfileId: booking.lawyerProfileId,
    matterRef: "0x" + matterRefBytes,
    engagementIdOnChain: synthEngagementId,
  },
});
await prisma.booking.update({
  where: { id: booking.id },
  data: { engagementId: eng.id, status: "ACCEPTED", escrowTxHash: "0x" + "cd".repeat(32) },
});

console.log("→ open SSE on both sides");
const ac = new AbortController();
const events = [];
const lawyerEvents = [];
const collect = (jar, sink) => (async () => {
  try {
    for await (const evt of sse(jar, `/api/bookings/${booking.id}/events`, ac.signal)) sink.push(evt);
  } catch (e) {
    if (e.name !== "AbortError") throw e;
  }
})();
const clientStreamTask = collect(clientJar, events);
const lawyerStreamTask = collect(lawyerJar, lawyerEvents);

// Allow initial events to land before mutating.
await new Promise((r) => setTimeout(r, 300));

console.log("→ client signs refund (dev-login bypass)");
const sigRes1 = await fetchJ(clientJar, `/api/bookings/${booking.id}/refund/sign`, {
  method: "POST",
  body: JSON.stringify({}),
});
if (!sigRes1.ok) throw new Error(`client sign failed: ${sigRes1.status} ${await sigRes1.text()}`);
const sig1 = await sigRes1.json();
console.log("  bothSigsPresent:", sig1.bothSigsPresent);
assert(!sig1.bothSigsPresent, "should not yet have both sigs");

await new Promise((r) => setTimeout(r, 300));

console.log("→ lawyer signs refund (dev-login bypass)");
const sigRes2 = await fetchJ(lawyerJar, `/api/bookings/${booking.id}/refund/sign`, {
  method: "POST",
  body: JSON.stringify({}),
});
if (!sigRes2.ok) throw new Error(`lawyer sign failed: ${sigRes2.status} ${await sigRes2.text()}`);
const sig2 = await sigRes2.json();
console.log("  bothSigsPresent:", sig2.bothSigsPresent);
assert(sig2.bothSigsPresent, "should have both sigs after second signer");
assert(sig2.clientSig && sig2.lawyerSig, "response should echo both sigs");

await new Promise((r) => setTimeout(r, 500));
ac.abort();
await clientStreamTask;
await lawyerStreamTask;

const summarize = (e) => ({
  client: e.clientRefundSigned,
  lawyer: e.lawyerRefundSigned,
  proposedBy: e.refundProposedBy,
  refundHash: e.escrowRefundHash,
});
console.log("\nclient stream:");
for (const e of events) console.log("  -", JSON.stringify(summarize(e)));
console.log("lawyer stream:");
for (const e of lawyerEvents) console.log("  -", JSON.stringify(summarize(e)));

const last = (arr) => arr[arr.length - 1];
for (const [name, list] of [["client", events], ["lawyer", lawyerEvents]]) {
  // Two transitions are required: at minimum, one snapshot showing only
  // the client signed, and a later snapshot showing both. (Whether the
  // initial pre-sign snapshot lands as a separate event depends on
  // connection timing — not asserted here.)
  assert(
    list.some((e) => e.clientRefundSigned && !e.lawyerRefundSigned),
    `${name}: never saw a snapshot with only the client signed`,
  );
  const final = last(list);
  assert(final.clientRefundSigned, `${name}: final event missing clientRefundSigned`);
  assert(final.lawyerRefundSigned, `${name}: final event missing lawyerRefundSigned`);
  assert(final.refundProposedBy === "CLIENT", `${name}: refundProposedBy should be CLIENT (signed first)`);
}

// Cleanup: detach + delete the synthetic engagement + the booking so a
// failed run doesn't leak rows that block the next attempt.
try {
  await prisma.booking.update({ where: { id: booking.id }, data: { engagementId: null } });
  await prisma.engagement.delete({ where: { id: eng.id } });
  await prisma.booking.delete({ where: { id: booking.id } });
} catch (e) {
  console.warn("cleanup warning:", e.message);
}
await prisma.$disconnect();

console.log("\n✓ Phase 9 SSE refund smoke passed: both sigs land via API, both subscribers see the state.");
