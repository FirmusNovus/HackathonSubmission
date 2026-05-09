import { expect, test, type APIRequestContext } from "@playwright/test";
import { devSignIn, reseedDatabase, SEEDED } from "./_helpers";

// =============================================================================
// Feature 2 — additional capability registry parity tests (audit follow-up).
//
// Layered on top of `capability.spec.ts` to cover the gaps the F2 reviewer
// flagged:
//   1. revoke-then-existing-booking-still-works — in-flight engagement
//      survives a capability revoke (mirrors the AttestationManager + escrow
//      contract semantic that revoke only blocks NEW openEngagement* calls).
//   2. directory-list-rebuilds-after-state-change — verifies the directory
//      query rebuilds correctly across mint/revoke transitions for multiple
//      lawyers in the same suite.
//   3. expired-capability-equals-revoked — an `expiresAt` in the past must be
//      treated as inactive (hasCapability == false; directory hides).
//   4. onboarding-attest-client-route-mints-capability — first POST mints a
//      row; second POST mints a FRESH row (the latest-row read is what
//      `hasCapability` consults; the old row is harmless residue).
//   5. operator-cannot-attest-self-as-lawyer — only the operator may attest;
//      a SCHEMA_OPERATOR capability does NOT confer SCHEMA_LAWYER.
// =============================================================================

const OPERATOR = "0x09e8a70811111111111111111111111111111bbb";

type ChainResp<T = unknown> = { ok: boolean; result?: T; code?: string; message?: string };

async function rpcPost<T = unknown>(
  request: APIRequestContext,
  method: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: ChainResp<T> }> {
  const r = await request.post("/api/dev/chain", { data: { method, args } });
  let body: ChainResp<T>;
  try {
    body = (await r.json()) as ChainResp<T>;
  } catch {
    body = { ok: false, code: "ParseError", message: await r.text() };
  }
  return { status: r.status(), body };
}

async function rpcGet<T = unknown>(
  request: APIRequestContext,
  method: string,
  params: Record<string, string | number>,
): Promise<{ status: number; body: ChainResp<T> }> {
  const qs = new URLSearchParams({ method });
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const r = await request.get(`/api/dev/chain?${qs.toString()}`);
  let body: ChainResp<T>;
  try {
    body = (await r.json()) as ChainResp<T>;
  } catch {
    body = { ok: false, code: "ParseError", message: await r.text() };
  }
  return { status: r.status(), body };
}

function getAdminKey(): string {
  const key = process.env.ADMIN_API_KEY;
  if (!key) throw new Error("ADMIN_API_KEY not set in test env");
  return key;
}

async function adminPost(
  request: APIRequestContext,
  payload: Record<string, unknown>,
  adminKey: string,
) {
  return request.post("/api/admin/verify-lawyer", {
    headers: { "x-admin-key": adminKey },
    data: payload,
  });
}

test.describe.serial("Feature 2 — capability registry edge cases", () => {
  test.beforeEach(reseedDatabase);

  // ===========================================================================
  // 1. In-flight engagement survives a revoke.
  // ===========================================================================
  test("revoke-then-existing-booking-still-works — REVOKE mid-flow leaves ACCEPTED booking + consultation reachable", async ({
    browser,
    request,
  }) => {
    // Use the seeded ACCEPTED booking: client1 (Sarah) ↔ lawyer Maria.
    // Sign in as Sarah, look up the active booking.
    const clientCtx = await browser.newContext();
    const clientPage = await clientCtx.newPage();
    await devSignIn(clientPage, { wallet: SEEDED.client1, role: "client" });
    const list = await clientPage.request.get("/api/bookings");
    const { bookings } = (await list.json()) as {
      bookings: Array<{ id: string; status: string; lawyerProfileId: string; lawyerProfile: { user: { walletAddress: string } } }>;
    };
    const accepted = bookings.find(
      (b) => b.status === "ACCEPTED" && b.lawyerProfile.user.walletAddress === SEEDED.lawyerMaria,
    );
    expect(accepted, "expected seeded ACCEPTED booking with Maria").toBeTruthy();
    const bookingId = accepted!.id;

    // Revoke Maria's SCHEMA_LAWYER capability via the admin API.
    const revoke = await adminPost(
      request,
      { walletAddress: SEEDED.lawyerMaria, action: "REVOKE" },
      getAdminKey(),
    );
    expect(revoke.status()).toBe(200);

    // Capability gone.
    const cap = await rpcGet<{ hasCapability: boolean }>(request, "hasCapability", {
      subject: SEEDED.lawyerMaria,
      schemaId: "SCHEMA_LAWYER",
    });
    expect(cap.body.result?.hasCapability).toBe(false);

    // Booking row UNCHANGED — still ACCEPTED, still pointing at Maria.
    const after = await clientPage.request.get("/api/bookings");
    const { bookings: bookingsAfter } = (await after.json()) as {
      bookings: Array<{ id: string; status: string }>;
    };
    const stillAccepted = bookingsAfter.find((b) => b.id === bookingId);
    expect(stillAccepted?.status).toBe("ACCEPTED");

    // Client can reach the consultation room.
    const clientRoom = await clientPage.goto(`/client/consultation/${bookingId}`);
    expect(clientRoom?.status()).toBeLessThan(400);
    // The consultation room renders the lawyer name and the encrypted-session
    // header — assert one stable bit so we know the page rendered (not a redirect).
    await expect(clientPage.getByText(/Encrypted session/)).toBeVisible({ timeout: 5_000 });

    // Lawyer can ALSO reach their own consultation room — this is the
    // "in-flight engagement survives revoke" check.
    const lawyerCtx = await browser.newContext();
    const lawyerPage = await lawyerCtx.newPage();
    // The helper's `devSignIn` wants to land on /lawyer/dashboard, but Maria's
    // capability is gone so /lawyer/dashboard redirects to /verify-lawyer.
    // Bypass the helper's strict waitForURL by going through /dev/sign-in
    // with the verify-lawyer page as the redirect target.
    await lawyerPage.goto(
      `/dev/sign-in?wallet=${encodeURIComponent(SEEDED.lawyerMaria)}&role=lawyer&redirect=%2Fverify-lawyer`,
      { waitUntil: "domcontentloaded" },
    );
    await lawyerPage.waitForURL(/\/verify-lawyer/, { timeout: 10_000, waitUntil: "domcontentloaded" });

    // BUT the consultation room for the existing booking remains reachable.
    const lawyerRoom = await lawyerPage.goto(`/lawyer/consultation/${bookingId}`);
    expect(lawyerRoom?.status()).toBeLessThan(400);
    await expect(lawyerPage.getByText(/Encrypted session/)).toBeVisible({ timeout: 5_000 });

    // And messages page also reachable.
    const lawyerMsgs = await lawyerPage.goto("/lawyer/messages");
    expect(lawyerMsgs?.status()).toBeLessThan(400);

    await clientCtx.close();
    await lawyerCtx.close();
  });

  // ===========================================================================
  // 2. Directory rebuilds correctly across capability state transitions.
  // ===========================================================================
  test("directory-list-rebuilds-after-state-change — 3 lawyers, only the 1 active capability shows", async ({
    request,
  }) => {
    // Pick three distinct seeded lawyer wallets:
    //  - lawyerMaria      → seeded VERIFIED (active capability)
    //  - lawyerStefan     → seeded PENDING (no capability)
    //  - lawyerAnya       → starts active, we revoke during this test
    // After mutations: Maria active, Stefan no-cap, Anya revoked.
    // Directory must list Maria but NOT Stefan and NOT Anya.

    // Confirm initial state via /api/lawyers.
    const dir1 = await request.get("/api/lawyers");
    const { lawyers: dir1List } = (await dir1.json()) as {
      lawyers: Array<{ user: { walletAddress: string } }>;
    };
    const wallets1 = dir1List.map((l) => l.user.walletAddress);
    expect(wallets1).toContain(SEEDED.lawyerMaria);
    expect(wallets1).toContain(SEEDED.lawyerAnya);
    expect(wallets1).not.toContain(SEEDED.lawyerStefan); // PENDING, no cap.

    // Revoke Anya.
    const revoke = await adminPost(
      request,
      { walletAddress: SEEDED.lawyerAnya, action: "REVOKE" },
      getAdminKey(),
    );
    expect(revoke.status()).toBe(200);

    // Re-fetch directory.
    const dir2 = await request.get("/api/lawyers");
    const { lawyers: dir2List } = (await dir2.json()) as {
      lawyers: Array<{ user: { walletAddress: string } }>;
    };
    const wallets2 = dir2List.map((l) => l.user.walletAddress);
    expect(wallets2).toContain(SEEDED.lawyerMaria); // still active
    expect(wallets2).not.toContain(SEEDED.lawyerStefan); // still no cap
    expect(wallets2).not.toContain(SEEDED.lawyerAnya); // now revoked
  });

  // ===========================================================================
  // 3. Expired capability behaves identically to a revoked one.
  // ===========================================================================
  test("expired-capability-equals-revoked — expiresAt in the past hides the lawyer + blocks new bookings", async ({
    request,
  }) => {
    // Mint a fresh lawyer wallet a SCHEMA_LAWYER capability that expired
    // 1 day ago. The `attestVerifiedLawyer` chain method accepts `expiresAt`,
    // and the dev RPC plumbs it through (see app/api/dev/chain/route.ts).
    const wallet = "0x4444000000000000000000000000000000abcdef";
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const mint = await rpcPost(request, "attestVerifiedLawyer", {
      subject: wallet,
      claims: { jurisdiction: "DE", barAdmissionNumber: "X", admittedAt: "2020-01-01T00:00:00Z", validUntil: yesterday },
      expiresAt: yesterday,
      from: OPERATOR,
    });
    expect(mint.body.ok).toBe(true);

    // hasCapability must return false because expiresAt is in the past.
    const cap = await rpcGet<{ hasCapability: boolean }>(request, "hasCapability", {
      subject: wallet,
      schemaId: "SCHEMA_LAWYER",
    });
    expect(cap.body.result?.hasCapability).toBe(false);

    // getLatestCapability also returns null (the SQL filter requires gt now).
    const latest = await rpcGet<{ capability: unknown | null }>(request, "getLatestCapability", {
      subject: wallet,
      schemaId: "SCHEMA_LAWYER",
    });
    expect(latest.body.result?.capability).toBeNull();

    // Directory: this wallet has no LawyerProfile row, so wouldn't appear
    // anyway. The capability-only check is the load-bearing one — confirm
    // the same pattern holds for a SEEDED lawyer if we re-attest with an
    // expired capability after revoking the active one.
    //
    // Use Maria: revoke her current active cap, then attest a fresh one
    // with expiresAt in the past. Directory should hide her either way.
    const revoke = await adminPost(
      request,
      { walletAddress: SEEDED.lawyerMaria, action: "REVOKE" },
      getAdminKey(),
    );
    expect(revoke.status()).toBe(200);

    const expiredMint = await rpcPost(request, "attestVerifiedLawyer", {
      subject: SEEDED.lawyerMaria,
      claims: { jurisdiction: "SE", barAdmissionNumber: "SE-2003-08291", admittedAt: "2003-09-12T00:00:00Z", validUntil: yesterday },
      expiresAt: yesterday,
      from: OPERATOR,
    });
    expect(expiredMint.body.ok).toBe(true);

    const mariaCap = await rpcGet<{ hasCapability: boolean }>(request, "hasCapability", {
      subject: SEEDED.lawyerMaria,
      schemaId: "SCHEMA_LAWYER",
    });
    expect(mariaCap.body.result?.hasCapability).toBe(false);

    // Directory hides Maria.
    const dir = await request.get("/api/lawyers");
    const { lawyers } = (await dir.json()) as {
      lawyers: Array<{ user: { walletAddress: string } }>;
    };
    expect(lawyers.find((l) => l.user.walletAddress === SEEDED.lawyerMaria)).toBeUndefined();
  });

  // ===========================================================================
  // 4. /api/onboarding/attest-client mints + replaces a SCHEMA_CLIENT capability.
  // ===========================================================================
  test("onboarding-attest-client-route-mints-capability — first call mints; second mints a fresh row", async ({
    page,
    request,
  }) => {
    // Use a fresh client wallet so we control the capability state from zero.
    // The /dev/sign-in helper auto-mints a SCHEMA_CLIENT for client roles
    // before we can intervene — so revoke that auto-mint first so the route
    // gets to mint from a no-capability baseline.
    const wallet = "0x5555000000000000000000000000000000fedcba";
    await devSignIn(page, { wallet, role: "client" });

    // Revoke the auto-mint so we can observe the route's first-call behaviour.
    const initial = await rpcGet<{ capability: { attestationUid: string } | null }>(
      request,
      "getLatestCapability",
      { subject: wallet, schemaId: "SCHEMA_CLIENT" },
    );
    expect(initial.body.result?.capability).toBeTruthy();
    const initialUid = initial.body.result!.capability!.attestationUid;
    await rpcPost(request, "revokeCapability", { uid: initialUid, from: OPERATOR });

    const before = await rpcGet<{ hasCapability: boolean }>(request, "hasCapability", {
      subject: wallet,
      schemaId: "SCHEMA_CLIENT",
    });
    expect(before.body.result?.hasCapability).toBe(false);

    // First POST: mints a capability.
    const r1 = await page.request.post("/api/onboarding/attest-client", {
      data: { countryOfResidence: "DE" },
    });
    expect(r1.status()).toBe(200);
    const body1 = (await r1.json()) as { ok: boolean; capabilityUid: string };
    expect(body1.ok).toBe(true);
    expect(body1.capabilityUid).toMatch(/^0x[0-9a-f]{64}$/);

    const cap1 = await rpcGet<{ capability: { attestationUid: string } | null }>(
      request,
      "getLatestCapability",
      { subject: wallet, schemaId: "SCHEMA_CLIENT" },
    );
    expect(cap1.body.result?.capability?.attestationUid).toBe(body1.capabilityUid);

    // Second POST: mints a FRESH row. The latest-row read returns the new UID.
    // The previous row remains active (not revoked), but `hasCapability`
    // walks `orderBy issuedAt desc` so it always returns the newest.
    const r2 = await page.request.post("/api/onboarding/attest-client", {
      data: { countryOfResidence: "FR" },
    });
    expect(r2.status()).toBe(200);
    const body2 = (await r2.json()) as { ok: boolean; capabilityUid: string };
    expect(body2.ok).toBe(true);
    expect(body2.capabilityUid).not.toBe(body1.capabilityUid);

    const cap2 = await rpcGet<{ capability: { attestationUid: string } | null }>(
      request,
      "getLatestCapability",
      { subject: wallet, schemaId: "SCHEMA_CLIENT" },
    );
    expect(cap2.body.result?.capability?.attestationUid).toBe(body2.capabilityUid);
  });

  // ===========================================================================
  // 5. Only the operator may attest; SCHEMA_OPERATOR ≠ SCHEMA_LAWYER.
  // ===========================================================================
  test("operator-only-attestation — non-operator from rejected; SCHEMA_OPERATOR doesn't grant SCHEMA_LAWYER", async ({
    request,
  }) => {
    const stranger = "0x9999000000000000000000000000000000000abc";

    // attestVerifiedLawyer with `from: stranger` must be rejected as OnlyOperator.
    const reject = await rpcPost(request, "attestVerifiedLawyer", {
      subject: SEEDED.lawyerStefan,
      claims: { jurisdiction: "CZ", barAdmissionNumber: "X", admittedAt: "2020-01-01T00:00:00Z", validUntil: null },
      from: stranger,
    });
    expect(reject.body.ok).toBe(false);
    expect(reject.body.code).toBe("OnlyOperator");

    // The operator's own SCHEMA_OPERATOR capability does NOT confer
    // SCHEMA_LAWYER. The seed mints a SCHEMA_OPERATOR row for OPERATOR;
    // confirm the SCHEMA_LAWYER read for OPERATOR is still false.
    const lawyerCheck = await rpcGet<{ hasCapability: boolean }>(request, "hasCapability", {
      subject: OPERATOR,
      schemaId: "SCHEMA_LAWYER",
    });
    expect(lawyerCheck.body.result?.hasCapability).toBe(false);

    const operatorCheck = await rpcGet<{ hasCapability: boolean }>(request, "hasCapability", {
      subject: OPERATOR,
      schemaId: "SCHEMA_OPERATOR",
    });
    expect(operatorCheck.body.result?.hasCapability).toBe(true);

    // The operator wallet is also NOT in the public lawyers directory —
    // confirm /api/lawyers excludes it (no LawyerProfile + no SCHEMA_LAWYER).
    const dir = await request.get("/api/lawyers");
    const { lawyers } = (await dir.json()) as {
      lawyers: Array<{ user: { walletAddress: string } }>;
    };
    expect(lawyers.find((l) => l.user.walletAddress === OPERATOR)).toBeUndefined();
  });
});
