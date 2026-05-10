// End-to-end smoke test for the booking + order SSE channels.
//
// Walks the lifecycle the user reported as broken:
//   1. Client creates a booking.
//   2. Client opens an SSE stream on it.
//   3. Lawyer accepts the booking (separate cookie jar).
//   4. Verify the client's SSE stream receives an event with
//      lawyerAcceptedAt populated. (Pre-fix the lawyer's accept didn't
//      propagate, so the client could "double-fund" because the page
//      thought they still needed to.)
//
// Talks to the local dev server at http://127.0.0.1:3010. Relies on the
// dev-login bypass at /dev/sign-in (NODE_ENV !== "production").

import assert from "node:assert/strict";

const BASE = "http://127.0.0.1:3010";

// ---- minimal cookie jar ----------------------------------------------
function makeJar() {
  const cookies = new Map();
  return {
    cookieHeader() {
      return Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
    },
    captureFrom(res) {
      // Node's fetch returns Set-Cookie values via getSetCookie()
      const lines = typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : res.headers.raw?.()?.["set-cookie"] ?? [];
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
  // Auth flows redirect — follow once with the same jar so the destination
  // cookie lands too.
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
  const u = `/dev/sign-in?wallet=${encodeURIComponent(wallet)}&role=${role}`;
  const res = await fetchJ(jar, u);
  assert(res.status < 400, `dev-sign-in failed: ${res.status}`);
}

// ---- SSE helper -------------------------------------------------------
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

// ---- run --------------------------------------------------------------
const SEEDED_CLIENT = "0x2222000000000000000000000000000000000001"; // Sarah Mueller
const SEEDED_LAWYER = "0x1111000000000000000000000000000000000001"; // Maria Chen

const clientJar = makeJar();
const lawyerJar = makeJar();

console.log("→ sign in client + lawyer");
await devSignIn(clientJar, SEEDED_CLIENT, "client");
await devSignIn(lawyerJar, SEEDED_LAWYER, "lawyer");

// Look up Maria's lawyerProfileId
console.log("→ resolve Maria's lawyerProfileId");
const lawyersRes = await fetchJ(clientJar, "/api/lawyers");
const { lawyers } = await lawyersRes.json();
const maria = lawyers.find((l) => l.user.walletAddress.toLowerCase() === SEEDED_LAWYER.toLowerCase());
if (!maria) throw new Error("Maria not in /api/lawyers — did seed run?");

console.log("→ client creates booking");
const createRes = await fetchJ(clientJar, "/api/bookings", {
  method: "POST",
  body: JSON.stringify({
    lawyerProfileId: maria.id,
    scheduledAt: new Date(Date.now() + 86400_000).toISOString(),
    durationMinutes: 60,
    practiceArea: "Family",
    caseDescription: "SSE smoke test booking — please ignore.",
  }),
});
if (!createRes.ok) throw new Error(`create booking failed: ${createRes.status} ${await createRes.text()}`);
const { booking } = await createRes.json();
console.log("  bookingId:", booking.id);

console.log("→ open SSE on booking from BOTH client and lawyer");
const ac = new AbortController();
const events = [];
const lawyerEvents = [];
const collect = (jar, sink) => (async () => {
  try {
    for await (const evt of sse(jar, `/api/bookings/${booking.id}/events`, ac.signal)) {
      sink.push(evt);
    }
  } catch (e) {
    if (e.name !== "AbortError") throw e;
  }
})();
const sseTask = collect(clientJar, events);
const sseTaskLawyer = collect(lawyerJar, lawyerEvents);

// Give the stream a moment to land its initial event before we mutate.
await new Promise((r) => setTimeout(r, 300));

console.log("→ lawyer accepts booking");
const acc = await fetchJ(lawyerJar, `/api/bookings/${booking.id}/accept`, { method: "POST" });
if (!acc.ok) throw new Error(`accept failed: ${acc.status} ${await acc.text()}`);

// Wait for both streams to record the post-accept event
const start = Date.now();
while ((events.length < 2 || lawyerEvents.length < 2) && Date.now() - start < 5000) {
  await new Promise((r) => setTimeout(r, 100));
}
ac.abort();
await sseTask;
await sseTaskLawyer;

const summarize = (e) => ({
  status: e.status,
  clientAcceptedAt: e.clientAcceptedAt ? "✓" : null,
  lawyerAcceptedAt: e.lawyerAcceptedAt ? "✓" : null,
  engagementIdOnChain: e.engagementIdOnChain,
});

console.log("\nclient stream:");
for (const e of events) console.log("  -", JSON.stringify(summarize(e)));
console.log("lawyer stream:");
for (const e of lawyerEvents) console.log("  -", JSON.stringify(summarize(e)));

const checkLifecycle = (name, list) => {
  assert(list.length >= 2, `${name}: expected at least 2 SSE events, got ${list.length}`);
  const initial = list[0];
  const afterAccept = list[list.length - 1];
  assert(initial.clientAcceptedAt, `${name}: initial event should have clientAcceptedAt set`);
  assert(!initial.lawyerAcceptedAt, `${name}: initial event should NOT have lawyerAcceptedAt yet`);
  assert(afterAccept.lawyerAcceptedAt, `${name}: post-accept event must have lawyerAcceptedAt set`);
  assert(afterAccept.status === "REQUESTED", `${name}: status should still be REQUESTED until on-chain funding`);
  assert(afterAccept.engagementIdOnChain === null, `${name}: engagementIdOnChain should still be null`);
};
checkLifecycle("client", events);
checkLifecycle("lawyer", lawyerEvents);

console.log("\n✓ SSE channel delivers booking lifecycle events to both parties.");
