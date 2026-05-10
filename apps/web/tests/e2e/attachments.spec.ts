import { expect, test } from "@playwright/test";
import { devSignIn, reseedDatabase, SEEDED } from "./_helpers";

test.beforeEach(reseedDatabase);

/**
 * End-to-end attachment flow:
 *   1. Sarah (client) uploads a file and sends it as a message attachment.
 *   2. The chat bubble renders the attachment as a downloadable link.
 *   3. Maria (the lawyer counterpart) signs in and can also download it —
 *      the upload route lets any conversation participant fetch the file,
 *      not just its uploader.
 *   4. Wrong MIME types get a clean 4xx with a helpful error message.
 */

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64",
);

test("Sarah → upload + send + render + Maria can download", async ({ page, browser }) => {
  await devSignIn(page, { wallet: SEEDED.client1, role: "client" });

  // Find Sarah's seeded conversation with Maria.
  const list = await page.request.get("/api/bookings");
  const { bookings } = (await list.json()) as { bookings: Array<{ id: string }> };
  expect(bookings.length).toBeGreaterThan(0);
  const detail = await page.request.get(`/api/bookings/${bookings[0].id}`);
  const { booking } = (await detail.json()) as { booking: { conversation?: { id: string } | null } };
  expect(booking.conversation?.id).toBeTruthy();
  const conversationId = booking.conversation!.id;

  // 1. Upload as Sarah.
  const upload = await page.request.post("/api/uploads", {
    multipart: {
      purpose: "messages",
      file: { name: "evidence.png", mimeType: "image/png", buffer: PNG_BYTES },
    },
  });
  expect(upload.status()).toBe(200);
  const { url } = (await upload.json()) as { url: string };
  expect(url).toMatch(/^\/api\/uploads\/messages\//);

  // 2. Sarah can fetch her own upload.
  const ownerFetch = await page.request.get(url);
  expect(ownerFetch.status()).toBe(200);

  // 3. Send the message with the attachmentUrl.
  const send = await page.request.post("/api/messages", {
    data: { conversationId, content: "Here is the evidence", attachmentUrl: url, attachmentType: "image/png" },
  });
  expect(send.status()).toBe(200);

  // 4. Maria signs in (separate context) and can download the file.
  const ctx = await browser.newContext();
  const lawyerPage = await ctx.newPage();
  await devSignIn(lawyerPage, { wallet: SEEDED.lawyerMaria, role: "lawyer" });
  const recipientFetch = await lawyerPage.request.get(url);
  expect(recipientFetch.status()).toBe(200);
  const bytes = await recipientFetch.body();
  expect(bytes.length).toBe(PNG_BYTES.length);
  await ctx.close();

  // 5. A non-participant client (Léa) is still 403.
  const ctx2 = await browser.newContext();
  const intruderPage = await ctx2.newPage();
  await devSignIn(intruderPage, { wallet: SEEDED.client3, role: "client" });
  const blocked = await intruderPage.request.get(url);
  expect(blocked.status()).toBe(403);
  await ctx2.close();
});

test("Bad MIME → 400 with a helpful error", async ({ page }) => {
  await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
  const r = await page.request.post("/api/uploads", {
    multipart: {
      purpose: "messages",
      file: { name: "weird.exe", mimeType: "application/x-msdownload", buffer: Buffer.from([0]) },
    },
  });
  expect(r.status()).toBe(400);
  const data = (await r.json()) as { error: string };
  expect(data.error).toMatch(/file type/i);
});

test("Messages UI renders attachment as a download link", async ({ page }) => {
  await devSignIn(page, { wallet: SEEDED.client1, role: "client" });

  // Pre-seed an attachment by hitting /api/uploads, then a message that uses it.
  const list = await page.request.get("/api/bookings");
  const { bookings } = (await list.json()) as { bookings: Array<{ id: string }> };
  const detail = await page.request.get(`/api/bookings/${bookings[0].id}`);
  const { booking } = (await detail.json()) as { booking: { conversation?: { id: string } | null } };
  expect(booking.conversation?.id).toBeTruthy();
  const conversationId = booking.conversation!.id;

  const upload = await page.request.post("/api/uploads", {
    multipart: {
      purpose: "messages",
      file: { name: "screenshot.png", mimeType: "image/png", buffer: PNG_BYTES },
    },
  });
  const { url } = (await upload.json()) as { url: string };
  await page.request.post("/api/messages", {
    data: { conversationId, content: "screenshot here", attachmentUrl: url, attachmentType: "image/png" },
  });

  await page.goto(`/client/messages?booking=${bookings[0].id}`, { waitUntil: "domcontentloaded" });
  // The image attachment renders as an <img> linked from an <a>.
  const img = page.locator(`img[src*="${url.split("/").slice(-1)[0].split("?")[0]}"]`);
  await expect(img.first()).toBeVisible({ timeout: 10_000 });
});
