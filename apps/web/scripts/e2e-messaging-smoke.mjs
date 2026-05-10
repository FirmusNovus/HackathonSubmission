// End-to-end encryption smoke test.
//
// Two seeded users (Sarah / Maria) derive their messaging keypairs from
// fixed test seeds (we control the keys here; in real life they come from
// a wallet signature). Each posts their pubkey to the server, encrypts a
// message to the other, and the recipient decrypts it.
//
// Asserts:
//   1. The DB row for a sent message contains ciphertext + nonce + sender
//      pubkey, and NO plaintext (no `content` column populated).
//   2. The recipient can decrypt with their own privkey + the sender's pubkey
//      from the row.
//   3. The platform itself cannot decrypt — it has no privkey for either
//      side.

import assert from "node:assert/strict";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { PrismaClient } from "@prisma/client";

const BASE = "http://127.0.0.1:3010";

// ---- minimal cookie jar (mirrors sse-smoke.mjs) ----------------------
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
    const next = res.headers.get("location").startsWith("http")
      ? res.headers.get("location")
      : `${BASE}${res.headers.get("location")}`;
    const headers2 = new Headers();
    headers2.set("cookie", jar.cookieHeader());
    const res2 = await fetch(next, { headers: headers2, redirect: "manual" });
    jar.captureFrom(res2);
    return res2;
  }
  return res;
}
async function devSignIn(jar, wallet, role) {
  const r = await fetchJ(jar, `/dev/sign-in?wallet=${encodeURIComponent(wallet)}&role=${role}`);
  if (r.status >= 400) throw new Error(`dev-sign-in failed: ${r.status}`);
}

// ---- run --------------------------------------------------------------
const SEEDED_CLIENT = "0x2222000000000000000000000000000000000001"; // Sarah
const SEEDED_LAWYER = "0x1111000000000000000000000000000000000001"; // Maria

const clientJar = makeJar();
const lawyerJar = makeJar();

console.log("→ sign in two parties");
await devSignIn(clientJar, SEEDED_CLIENT, "client");
await devSignIn(lawyerJar, SEEDED_LAWYER, "lawyer");

// Each party derives their own keypair. We use deterministic seeds so the
// test is reproducible — in the real flow these come from a wallet sig.
const clientKp = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(0x11));
const lawyerKp = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(0x22));

console.log("→ enroll pubkeys with /api/users/me/encryption-key");
async function enroll(jar, pub) {
  const r = await fetchJ(jar, "/api/users/me/encryption-key", {
    method: "POST",
    body: JSON.stringify({ encryptionPublicKey: naclUtil.encodeBase64(pub) }),
  });
  if (!r.ok) throw new Error(`enroll failed: ${r.status} ${await r.text()}`);
}
await enroll(clientJar, clientKp.publicKey);
await enroll(lawyerJar, lawyerKp.publicKey);

console.log("→ resolve a conversation between Sarah and Maria");
const prisma = new PrismaClient();
const sarah = await prisma.user.findUnique({ where: { walletAddress: SEEDED_CLIENT } });
const maria = await prisma.user.findUnique({ where: { walletAddress: SEEDED_LAWYER } });
if (!sarah || !maria) throw new Error("seeded users missing");
let conv = await prisma.conversation.findFirst({
  where: {
    AND: [
      { participants: { some: { id: sarah.id } } },
      { participants: { some: { id: maria.id } } },
    ],
  },
});
if (!conv) {
  console.log("  no existing conversation — creating one (no booking ref)");
  conv = await prisma.conversation.create({
    data: {
      participants: { connect: [{ id: sarah.id }, { id: maria.id }] },
    },
  });
}
console.log("  conversation:", conv.id);

console.log("→ Sarah encrypts a message to Maria");
const plaintext = "Hi Maria — can you confirm next steps for the inheritance dispute?";
const nonce = nacl.randomBytes(nacl.box.nonceLength);
const cipher = nacl.box(naclUtil.decodeUTF8(plaintext), nonce, lawyerKp.publicKey, clientKp.secretKey);
const sendBody = {
  conversationId: conv.id,
  ciphertext: naclUtil.encodeBase64(cipher),
  nonce: naclUtil.encodeBase64(nonce),
  senderEncryptionPublicKey: naclUtil.encodeBase64(clientKp.publicKey),
};
const sendRes = await fetchJ(clientJar, "/api/messages", { method: "POST", body: JSON.stringify(sendBody) });
if (!sendRes.ok) throw new Error(`send failed: ${sendRes.status} ${await sendRes.text()}`);
const { message } = await sendRes.json();
console.log("  messageId:", message.id);

console.log("→ confirm DB row holds only ciphertext (no plaintext)");
const stored = await prisma.message.findUnique({ where: { id: message.id } });
if (!stored) throw new Error("message not stored");
console.log("  content:                   ", stored.content);
console.log("  ciphertext (b64, len):     ", stored.ciphertext?.length);
console.log("  nonce (b64):               ", stored.nonce);
console.log("  senderEncryptionPublicKey: ", stored.senderEncryptionPublicKey?.slice(0, 24) + "…");
assert.strictEqual(stored.content, null, "DB row should NOT have plaintext content");
assert(stored.ciphertext, "DB row must have ciphertext");
assert(stored.nonce, "DB row must have nonce");
assert(stored.senderEncryptionPublicKey, "DB row must have sender pubkey");

console.log("→ Maria fetches the message and decrypts");
const fetchRes = await fetchJ(lawyerJar, `/api/messages?conversationId=${conv.id}`);
const { messages } = await fetchRes.json();
const fetched = messages.find((m) => m.id === message.id);
if (!fetched) throw new Error("Maria did not receive the message");
const recoveredBytes = nacl.box.open(
  naclUtil.decodeBase64(fetched.ciphertext),
  naclUtil.decodeBase64(fetched.nonce),
  naclUtil.decodeBase64(fetched.senderEncryptionPublicKey),
  lawyerKp.secretKey,
);
if (!recoveredBytes) throw new Error("Maria failed to decrypt");
const recovered = naclUtil.encodeUTF8(recoveredBytes);
console.log("  decrypted plaintext:", recovered);
assert.strictEqual(recovered, plaintext);

console.log("→ confirm SENDER can also decrypt her own outgoing message");
// NaCl box's ECDH is symmetric — Sarah uses Maria's pubkey + her own privkey
// to recover the same shared secret she encrypted with originally. This is
// the sanity check for the sender-can't-decrypt regression: if the viewer
// is the sender, the "other party's pubkey" is the recipient's, NOT the
// sender's pubkey from the row.
const senderRecovered = nacl.box.open(
  naclUtil.decodeBase64(fetched.ciphertext),
  naclUtil.decodeBase64(fetched.nonce),
  lawyerKp.publicKey, // recipient's pub — Sarah knows this from her thread state
  clientKp.secretKey, // Sarah's own priv
);
if (!senderRecovered) throw new Error("sender failed to decrypt her own message");
assert.strictEqual(naclUtil.encodeUTF8(senderRecovered), plaintext);

console.log("→ confirm a third party (no privkey) can't decrypt");
const stranger = nacl.box.keyPair();
const strangerAttempt = nacl.box.open(
  naclUtil.decodeBase64(fetched.ciphertext),
  naclUtil.decodeBase64(fetched.nonce),
  naclUtil.decodeBase64(fetched.senderEncryptionPublicKey),
  stranger.secretKey,
);
assert.strictEqual(strangerAttempt, null, "stranger should not be able to decrypt");

await prisma.$disconnect();
console.log("\n✓ Phase 10 messaging smoke passed: ciphertext-only at rest, both sender and recipient decrypt, stranger can't.");
