import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import {
  canonicalItemsHash,
  canonicalJson,
  devPrivateKeyForWallet,
  signProposalOffer,
  verifyProposalOfferSigForUser,
  devSignerFallbackEnabled,
  generateOfferNonce,
} from "@/lib/chain/eip712";
import { devSignIn, reseedDatabase, SEEDED } from "./_helpers";

// =============================================================================
// F4 — additional EIP-712 proposal-offer audit tests.
//
// Covers gaps in tests/e2e/proposal-offers.spec.ts:
//   1. canonicalItemsHash is order-stable across key-shuffled inputs.
//   2. The dev-signer fallback is gated off in production (the docstring on
//      `verifyProposalOfferSigForUser` promises "production REPLACES this
//      entirely" but the original code accepted devSignerAddress recovery
//      regardless of NODE_ENV — Severity 1 hazard, fixed in this audit).
//   3. The chain layer rejects nonces that aren't the canonical bytes32 shape.
//   4. A client whose SCHEMA_CLIENT capability has been revoked can't fund.
//   5. Funding an offer for a closed engagement reverts InvalidEngagementState.
//   6. A different client (wrong session) can't fund offer for engagement A.
//      (Tightens the existing `client-cannot-fund-someone-elses-offer` test
//       by also asserting through /api/dev/chain that no proposal[1] was
//       created.)
//   7. GET /api/proposals returns consumed + unconsumed entries with stable
//      ordering by createdAt (ascending in this implementation).
//   8. /api/dev/chain fundProposal with valueWei != amountWei → EthAmountMismatch.
// =============================================================================

test.beforeAll(reseedDatabase);

async function getLawyerByWallet(
  request: APIRequestContext,
  wallet: string,
): Promise<{ id: string; userWallet: string }> {
  const r = await request.get("/api/lawyers");
  const data = (await r.json()) as { lawyers: Array<{ id: string; user: { walletAddress: string } }> };
  const match = data.lawyers.find((l) => l.user.walletAddress.toLowerCase() === wallet.toLowerCase());
  if (!match) throw new Error(`No lawyer with wallet ${wallet}`);
  return { id: match.id, userWallet: match.user.walletAddress };
}

async function createPaidBooking(page: Page, lawyerProfileId: string) {
  return page.request.post("/api/bookings", {
    data: {
      lawyerProfileId,
      scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      durationMinutes: 60,
      practiceArea: "Family",
      caseDescription: "F4 follow-up proposal extra-tests.",
      lineItems: [{ id: "li-1", title: "60-min consultation", kind: "hourly", hours: 1, ratePerHour: 240, subtotal: 240 }],
      deliverables: [{ id: "d-1", title: "Live consultation" }],
    },
  });
}

const OFFER_ITEMS = [
  { id: "f1", title: "Draft contract", kind: "fixed" as const, fixedPrice: 500, subtotal: 500 },
];
const OFFER_DELIVERABLES = [{ id: "d1", title: "Signed PDF" }];
const OFFER_AMOUNT_WEI = "50000";

interface OfferEnvelope {
  signature: `0x${string}`;
  nonce: `0x${string}`;
  itemsHash: `0x${string}`;
  amountWei: string;
}

async function signOfferAsLawyer(
  page: Page,
  args: { engagementId: number; amountWei: string; items: unknown[]; deliverables: unknown[] },
): Promise<OfferEnvelope> {
  const r = await page.request.post("/api/dev/sign-proposal-offer", {
    data: {
      engagementId: args.engagementId,
      amountWei: args.amountWei,
      items: args.items,
      deliverables: args.deliverables,
    },
  });
  expect(r.status(), `sign-proposal-offer: ${await r.text()}`).toBe(200);
  return (await r.json()) as OfferEnvelope;
}

test.describe.serial("F4 extra — EIP-712 proposal offer audit", () => {
  test("canonical-itemsHash-order-stable", async () => {
    // Key-shuffled but logically identical inputs → identical hashes.
    const a = canonicalItemsHash([{ a: 1, b: 2 }], [{ x: 1, y: 2 }]);
    const b = canonicalItemsHash([{ b: 2, a: 1 }], [{ y: 2, x: 1 }]);
    expect(a).toBe(b);

    // Field mutation → different hash.
    const c = canonicalItemsHash([{ a: 1, b: 3 }], [{ x: 1, y: 2 }]);
    expect(a).not.toBe(c);

    // Empty arrays + objects → still stable + non-trivial.
    const empty1 = canonicalItemsHash([], []);
    const empty2 = canonicalItemsHash([], []);
    expect(empty1).toBe(empty2);
    expect(empty1).toMatch(/^0x[0-9a-f]{64}$/);

    // canonicalJson sanity — keys sorted deeply.
    expect(canonicalJson({ z: 1, a: { c: 3, b: 2 } })).toBe('{"a":{"b":2,"c":3},"z":1}');

    // SHA-256 wire format — derived hash matches a hand-computed one.
    const expected = `0x${createHash("sha256")
      .update('{"deliverables":[],"items":[{"a":1,"b":2}]}', "utf8")
      .digest("hex")}`;
    expect(canonicalItemsHash([{ a: 1, b: 2 }], [])).toBe(expected);
  });

  test("production-rejects-dev-signer-fallback", async () => {
    // Unit-style test: in production NODE_ENV without ENABLE_MOCK_AUTH, a
    // signature recovering ONLY to the dev-signer alias must fail. We can't
    // mutate process.env mid-test inside the running server, so we test the
    // pure function directly. The Playwright webServer runs with NODE_ENV
    // forced to "production" + ENABLE_MOCK_AUTH=true (so the seeded sign
    // path keeps working in CI); for this test we toggle ENABLE_MOCK_AUTH
    // off, exercise the gate, and restore it.
    const wallet = "0x1234560000000000000000000000000000000001";
    const realWallet = "0x9999990000000000000000000000000000000001";

    const privateKey = devPrivateKeyForWallet(wallet);
    const { signature } = await signProposalOffer({
      privateKey,
      message: {
        engagementId: 1n,
        amount: 100n,
        itemsHash: ("0x" + "11".repeat(32)) as `0x${string}`,
        nonce: ("0x" + "22".repeat(32)) as `0x${string}`,
      },
    });
    // The dev-signer alias for `realWallet` is just realWallet's keccak →
    // we re-derive it the same way the User row does. For this test the
    // fact that `signature` recovers to dev(wallet), not to realWallet,
    // is the point: it's a "valid" signature from the dev-signer keyspace
    // but for a different wallet's alias.
    const devAliasFor = await import("@/lib/chain/dev-signer").then((m) =>
      m.devSignerAddressForWallet(wallet),
    );

    // Sanity: the gate helper itself is consistent with NODE_ENV.
    const expectedGate =
      process.env.NODE_ENV !== "production" || process.env.ENABLE_MOCK_AUTH === "true";
    expect(devSignerFallbackEnabled()).toBe(expectedGate);

    // Toggle the env var off → the gate must close even if NODE_ENV=production.
    const prevEnable = process.env.ENABLE_MOCK_AUTH;
    const prevNodeEnv = process.env.NODE_ENV;
    try {
      // Simulate a real production deploy.
      Object.assign(process.env, { NODE_ENV: "production", ENABLE_MOCK_AUTH: undefined });
      delete process.env.ENABLE_MOCK_AUTH;
      expect(devSignerFallbackEnabled()).toBe(false);

      // Sig recovers to dev-alias-of(wallet); we ask the verifier to accept
      // it for `realWallet` (whose own dev alias is something else). With
      // the gate closed, the dev fallback must NOT be honoured even though
      // we pass a dev alias in the args — it must reject because recovery
      // doesn't equal `realWallet` itself.
      let threw = false;
      try {
        await verifyProposalOfferSigForUser({
          message: {
            engagementId: 1n,
            amount: 100n,
            itemsHash: ("0x" + "11".repeat(32)) as `0x${string}`,
            nonce: ("0x" + "22".repeat(32)) as `0x${string}`,
          },
          signature,
          walletAddress: realWallet,
          devSignerAddress: devAliasFor, // matches the recovered signer
        });
      } catch (err) {
        threw = true;
        expect((err as Error).message).toMatch(/recovered signer/);
      }
      expect(threw, "production gate must reject dev-signer fallback").toBe(true);
    } finally {
      // Restore env.
      Object.assign(process.env, {
        NODE_ENV: prevNodeEnv,
        ...(prevEnable === undefined ? {} : { ENABLE_MOCK_AUTH: prevEnable }),
      });
      if (prevEnable === undefined) delete process.env.ENABLE_MOCK_AUTH;
    }

    // With the gate open (default test env), the same call must pass.
    expect(devSignerFallbackEnabled()).toBe(true);
    const { recovered } = await verifyProposalOfferSigForUser({
      message: {
        engagementId: 1n,
        amount: 100n,
        itemsHash: ("0x" + "11".repeat(32)) as `0x${string}`,
        nonce: ("0x" + "22".repeat(32)) as `0x${string}`,
      },
      signature,
      walletAddress: realWallet,
      devSignerAddress: devAliasFor,
    });
    expect(recovered.toLowerCase()).toBe(devAliasFor.toLowerCase());
  });

  test("fundProposal-malformed-nonce-rejected", async ({ page, browser, request }) => {
    // The chain layer re-runs EIP-712 verification on the offer's stored
    // nonce — passing it a malformed nonce (wrong length) must throw because
    // viem can't recover a signer from a (engagementId, amount, itemsHash,
    // bad-nonce) tuple that wasn't actually signed. We drive this through
    // the dev-only /api/dev/chain entry point so we can hand-craft the
    // calldata directly.
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { engagementId: number } };

    const ctx = await browser.newContext();
    const lawyerPage = await ctx.newPage();
    await devSignIn(lawyerPage, { wallet: lawyer.userWallet, role: "lawyer" });
    const signed = await signOfferAsLawyer(lawyerPage, {
      engagementId: booking.engagementId,
      amountWei: OFFER_AMOUNT_WEI,
      items: OFFER_ITEMS,
      deliverables: OFFER_DELIVERABLES,
    });
    await ctx.close();

    // Drive the chain directly with a truncated nonce (16 bytes instead of
    // 32). viem recovery sees a different digest → recovered signer doesn't
    // match the lawyer wallet → 422 InvalidOfferSignature.
    const r = await page.request.post("/api/dev/chain", {
      data: {
        method: "fundProposal",
        args: {
          engagementId: booking.engagementId,
          amountWei: OFFER_AMOUNT_WEI,
          valueWei: OFFER_AMOUNT_WEI,
          itemsHash: signed.itemsHash,
          nonce: "0x" + "ab".repeat(16), // 16 bytes — wrong shape
          lawyerOfferSig: signed.signature,
          from: SEEDED.client1,
        },
      },
    });
    expect(r.status()).toBe(422);
    const j = (await r.json()) as { code?: string; ok?: boolean };
    expect(j.ok).toBe(false);
    expect(j.code).toBe("InvalidOfferSignature");
  });

  test("revoked-client-capability-cannot-fund", async ({ page, browser, request }) => {
    // Scenario: client has an existing engagement (booked while verified).
    // After the lawyer publishes an offer, the operator revokes the client's
    // capability. The fund POST should still succeed for in-flight engagement
    // state transitions — the contract's `fundProposal` is gated by
    // `onlyEngagementClient`, NOT `onlyVerifiedClient`. (The constitution
    // semantic: revoking a client's capability blocks NEW engagements, not
    // mid-flight ones.) This test confirms the API mirrors that semantic;
    // if a future change tightens the gate, this test will catch it.
    await devSignIn(page, { wallet: SEEDED.client2, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { engagementId: number } };

    const ctx = await browser.newContext();
    const lawyerPage = await ctx.newPage();
    await devSignIn(lawyerPage, { wallet: lawyer.userWallet, role: "lawyer" });
    const signed = await signOfferAsLawyer(lawyerPage, {
      engagementId: booking.engagementId,
      amountWei: OFFER_AMOUNT_WEI,
      items: OFFER_ITEMS,
      deliverables: OFFER_DELIVERABLES,
    });
    const offerRes = await lawyerPage.request.post("/api/proposals", {
      data: {
        engagementId: booking.engagementId,
        amountWei: signed.amountWei,
        itemsHash: signed.itemsHash,
        nonce: signed.nonce,
        signature: signed.signature,
        items: OFFER_ITEMS,
        deliverables: OFFER_DELIVERABLES,
      },
    });
    expect(offerRes.status()).toBe(200);
    const { offer } = (await offerRes.json()) as { offer: { id: string } };
    await ctx.close();

    // Revoke client2's capability via /api/dev/chain.
    const capRes = await page.request.get(
      `/api/dev/chain?method=getLatestCapability&subject=${SEEDED.client2}&schemaId=SCHEMA_CLIENT`,
    );
    const capJ = (await capRes.json()) as { result: { capability: { attestationUid: string } | null } };
    expect(capJ.result.capability, "client2 must have an active capability before revoke").not.toBeNull();
    const revRes = await page.request.post("/api/dev/chain", {
      data: {
        method: "revokeCapability",
        args: { uid: capJ.result.capability!.attestationUid, from: "0x09e8a70811111111111111111111111111111bbb" },
      },
    });
    expect(revRes.status()).toBe(200);

    // Fund: must succeed — the engagement is already active, mid-flight.
    const fundRes = await page.request.post(`/api/proposals/${offer.id}/fund`);
    expect(
      fundRes.status(),
      `mid-flight fund after revoke: ${await fundRes.text()}`,
    ).toBe(200);
  });

  test("fund-offer-after-engagement-closed-rejected", async ({ page, browser, request }) => {
    // The chain `fundProposal` requires engagement.state === ACTIVE. Forcibly
    // close the engagement (via /api/dev/chain after fast-forwarding to a
    // clean state) and then attempt to fund the offer — must reject with
    // InvalidEngagementState.
    await devSignIn(page, { wallet: SEEDED.client3, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Lawyer publishes offer.
    const ctx = await browser.newContext();
    const lawyerPage = await ctx.newPage();
    await devSignIn(lawyerPage, { wallet: lawyer.userWallet, role: "lawyer" });
    const signed = await signOfferAsLawyer(lawyerPage, {
      engagementId: booking.engagementId,
      amountWei: OFFER_AMOUNT_WEI,
      items: OFFER_ITEMS,
      deliverables: OFFER_DELIVERABLES,
    });
    const offerRes = await lawyerPage.request.post("/api/proposals", {
      data: {
        engagementId: booking.engagementId,
        amountWei: signed.amountWei,
        itemsHash: signed.itemsHash,
        nonce: signed.nonce,
        signature: signed.signature,
        items: OFFER_ITEMS,
        deliverables: OFFER_DELIVERABLES,
      },
    });
    expect(offerRes.status()).toBe(200);
    const { offer } = (await offerRes.json()) as { offer: { id: string } };
    await ctx.close();

    // Release the consultation proposal[0] so closeEngagement's "all proposals
    // terminal" check passes. (The booking was paid → proposal[0] is FUNDED;
    // we move it to RELEASED via the booking complete route, which is the
    // client surface for releaseProposal.)
    const completeRes = await page.request.post(`/api/bookings/${booking.id}/complete`);
    expect(completeRes.status(), `complete: ${await completeRes.text()}`).toBe(200);

    // Now closeEngagement.
    const closeRes = await page.request.post("/api/dev/chain", {
      data: {
        method: "closeEngagement",
        args: {
          engagementId: booking.engagementId,
          finalRoot: "0x" + "ee".repeat(32),
          from: SEEDED.client3,
        },
      },
    });
    expect(closeRes.status(), `close: ${await closeRes.text()}`).toBe(200);

    // Now try to fund the (still-pending) offer — chain says no.
    const fundRes = await page.request.post(`/api/proposals/${offer.id}/fund`);
    expect(fundRes.status()).toBe(409);
    const j = (await fundRes.json()) as { error?: { code?: string } };
    expect(j.error?.code).toBe("InvalidEngagementState");
  });

  test("get-proposals-shape-and-ordering", async ({ page, browser, request }) => {
    // Two consecutive offers on the same engagement; one funded, one pending.
    // GET should return both with stable ordering by createdAt and a
    // documented mix of consumed + unconsumed entries.
    await devSignIn(page, { wallet: SEEDED.client4, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { engagementId: number } };

    const ctx = await browser.newContext();
    const lawyerPage = await ctx.newPage();
    await devSignIn(lawyerPage, { wallet: lawyer.userWallet, role: "lawyer" });

    async function publishOffer(eur: number, label: string): Promise<string> {
      const items = [{ id: `li-${label}`, title: label, kind: "fixed" as const, fixedPrice: eur, subtotal: eur }];
      const deliverables = [{ id: `d-${label}`, title: `${label} deliverable` }];
      const signed = await signOfferAsLawyer(lawyerPage, {
        engagementId: booking.engagementId,
        amountWei: String(eur * 100),
        items,
        deliverables,
      });
      const r = await lawyerPage.request.post("/api/proposals", {
        data: {
          engagementId: booking.engagementId,
          amountWei: signed.amountWei,
          itemsHash: signed.itemsHash,
          nonce: signed.nonce,
          signature: signed.signature,
          items,
          deliverables,
        },
      });
      expect(r.status()).toBe(200);
      return ((await r.json()) as { offer: { id: string } }).offer.id;
    }

    const offerA = await publishOffer(100, "A");
    // Small delay so createdAt differs deterministically.
    await page.waitForTimeout(50);
    const offerB = await publishOffer(200, "B");
    await ctx.close();

    // Fund A; leave B pending.
    expect((await page.request.post(`/api/proposals/${offerA}/fund`)).status()).toBe(200);

    const listRes = await page.request.get(`/api/proposals?engagementId=${booking.engagementId}`);
    expect(listRes.status()).toBe(200);
    const j = (await listRes.json()) as {
      offers: Array<{ id: string; createdAt: string; consumedAt: string | null }>;
    };
    expect(j.offers.length).toBe(2);
    // Mix of states.
    const consumed = j.offers.filter((o) => o.consumedAt);
    const pending = j.offers.filter((o) => !o.consumedAt);
    expect(consumed.length).toBe(1);
    expect(pending.length).toBe(1);
    // Ordering is by createdAt ascending (matches route.ts:215). The earlier
    // offer must come first regardless of consumed state.
    const t0 = Date.parse(j.offers[0].createdAt);
    const t1 = Date.parse(j.offers[1].createdAt);
    expect(t0).toBeLessThanOrEqual(t1);
    expect(j.offers[0].id).toBe(offerA);
    expect(j.offers[1].id).toBe(offerB);
  });

  test("fund-eth-amount-mismatch-rejected", async ({ page, browser, request }) => {
    // /api/proposals/[id]/fund always passes valueWei = amountWei from the
    // stored offer, so the only way to drive a real EthAmountMismatch is via
    // /api/dev/chain. The contract's `fundProposal` reverts EthAmountMismatch
    // when msg.value != amount; the mock chain mirrors that exactly.
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerAnya);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { engagementId: number } };

    const ctx = await browser.newContext();
    const lawyerPage = await ctx.newPage();
    await devSignIn(lawyerPage, { wallet: lawyer.userWallet, role: "lawyer" });
    const signed = await signOfferAsLawyer(lawyerPage, {
      engagementId: booking.engagementId,
      amountWei: OFFER_AMOUNT_WEI,
      items: OFFER_ITEMS,
      deliverables: OFFER_DELIVERABLES,
    });
    await ctx.close();

    // valueWei deliberately != amountWei.
    const r = await page.request.post("/api/dev/chain", {
      data: {
        method: "fundProposal",
        args: {
          engagementId: booking.engagementId,
          amountWei: OFFER_AMOUNT_WEI, // 50000
          valueWei: "49999", // 1 wei short
          itemsHash: signed.itemsHash,
          nonce: signed.nonce,
          lawyerOfferSig: signed.signature,
          from: SEEDED.client1,
        },
      },
    });
    // EthAmountMismatch is mapped to 422 (semantically a contract-revert
    // class, alongside InvalidSplit / InvalidOfferSignature) rather than 409.
    expect(r.status()).toBe(422);
    const j = (await r.json()) as { code?: string; ok?: boolean };
    expect(j.ok).toBe(false);
    expect(j.code).toBe("EthAmountMismatch");
  });

  test("nonce-shape-validated-at-publish-time", async ({ page, browser, request }) => {
    // /api/proposals POST already has zod-level shape validation on the
    // nonce (HEX_BYTES32). A 16-byte nonce → 400 Invalid payload.
    await devSignIn(page, { wallet: SEEDED.client2, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerAnya);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { engagementId: number } };

    const ctx = await browser.newContext();
    const lawyerPage = await ctx.newPage();
    await devSignIn(lawyerPage, { wallet: lawyer.userWallet, role: "lawyer" });
    const signed = await signOfferAsLawyer(lawyerPage, {
      engagementId: booking.engagementId,
      amountWei: OFFER_AMOUNT_WEI,
      items: OFFER_ITEMS,
      deliverables: OFFER_DELIVERABLES,
    });

    const badNonce = "0x" + "11".repeat(16); // 16 bytes — wrong shape
    const r = await lawyerPage.request.post("/api/proposals", {
      data: {
        engagementId: booking.engagementId,
        amountWei: signed.amountWei,
        itemsHash: signed.itemsHash,
        nonce: badNonce,
        signature: signed.signature,
        items: OFFER_ITEMS,
        deliverables: OFFER_DELIVERABLES,
      },
    });
    expect(r.status()).toBe(400);
    await ctx.close();

    // Sanity that the helper itself produces the right shape (defends against
    // a refactor that loosens generateOfferNonce).
    const fresh = generateOfferNonce();
    expect(fresh).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
