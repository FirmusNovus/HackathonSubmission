// Simulated wallet — runs the full OID4VCI + OID4VP roundtrip against the
// SD-JWT VC variant of our spike issuer + verifier.

import crypto from "node:crypto";
import { generateKeyPair, exportJWK, base64url, importJWK, SignJWT } from "jose";
import { util as keyDidUtil } from "@cef-ebsi/key-did-resolver";

const ISSUER = process.env.ISSUER_URL ?? "http://localhost:3001";
const VERIFIER = process.env.VERIFIER_URL ?? "http://localhost:3002";

// ---------- 1. simulated wallet's holder keypair ----------

console.log("[wallet] generating holder keypair (ES256)");
const { privateKey: holderPriv, publicKey: holderPub } = await generateKeyPair("ES256", { extractable: true });
const holderJwk = await exportJWK(holderPub);
const holderPrivJwk = await exportJWK(holderPriv);
const HOLDER_DID = keyDidUtil.createDid(holderJwk);
const HOLDER_KID = `${HOLDER_DID}#${HOLDER_DID.split(":")[2]}`;
console.log("[wallet] holder DID:", HOLDER_DID.slice(0, 60) + "...");

// ---------- 2. fetch issuer metadata ----------

console.log(`\n[wallet] GET ${ISSUER}/.well-known/openid-credential-issuer`);
const meta = await fetch(`${ISSUER}/.well-known/openid-credential-issuer`).then((r) => r.json());
const cfg = Object.values(meta.credential_configurations_supported)[0];
console.log("[wallet] format:", cfg.format);
console.log("[wallet] vct:", cfg.vct);
console.log("[wallet] crypto binding:", cfg.cryptographic_binding_methods_supported);

// ---------- 3. request offer ----------

console.log(`\n[wallet] POST ${ISSUER}/offer`);
const offerResp = await fetch(`${ISSUER}/offer`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
}).then((r) => r.json());
console.log("[wallet] received offer URL");

// The offer URL uses credential_offer_uri (not inline credential_offer).
// Fetch the offer JSON from that URI — same path wwWallet takes.
console.log(`[wallet] GET ${offerResp.offerUri}`);
const offer = await fetch(offerResp.offerUri).then((r) => r.json());
const preAuthCode =
  offer.grants["urn:ietf:params:oauth:grant-type:pre-authorized_code"]["pre-authorized_code"];
console.log("[wallet] pre-authorized_code:", preAuthCode.slice(0, 12) + "...");

// ---------- 4. exchange code for token ----------

console.log(`\n[wallet] POST ${ISSUER}/token`);
const tokenResp = await fetch(`${ISSUER}/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:pre-authorized_code",
    "pre-authorized_code": preAuthCode,
  }).toString(),
}).then((r) => r.json());
console.log("[wallet] access_token:", tokenResp.access_token.slice(0, 16) + "...");
console.log("[wallet] c_nonce:", tokenResp.c_nonce);

// ---------- 5. create proof JWT (binding holder key + c_nonce) ----------

console.log(`\n[wallet] creating proof JWT signed by holder key`);
const proofJwt = await new SignJWT({
  iss: HOLDER_DID,
  aud: ISSUER,
  iat: Math.floor(Date.now() / 1000),
  nonce: tokenResp.c_nonce,
})
  .setProtectedHeader({
    alg: "ES256",
    typ: "openid4vci-proof+jwt",
    jwk: holderJwk,
  })
  .sign(holderPriv);
console.log("[wallet] proof JWT:", proofJwt.slice(0, 60) + "...");

// ---------- 6. request the credential ----------

console.log(`\n[wallet] POST ${ISSUER}/credential`);
const credResp = await fetch(`${ISSUER}/credential`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${tokenResp.access_token}`,
  },
  body: JSON.stringify({
    format: "vc+sd-jwt",
    proof: { proof_type: "jwt", jwt: proofJwt },
  }),
}).then((r) => r.json());

if (!credResp.credential) {
  console.error("FAIL: no credential returned:", credResp);
  process.exit(1);
}
console.log("[wallet] format:", credResp.format);
console.log("[wallet] credential length:", credResp.credential.length);
const sdJwtVc = credResp.credential;

// quick decode of the issuer-signed JWT (first segment of the SD-JWT)
const [headerB64, payloadB64] = sdJwtVc.split("~")[0].split(".");
const cred = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
console.log("[wallet] decoded VC:");
console.log("[wallet]   iss:", cred.iss?.slice(0, 60) + "...");
console.log("[wallet]   vct:", cred.vct);
console.log("[wallet]   has cnf.jwk:", !!cred.cnf?.jwk);
console.log("[wallet]   has _sd (selectively-disclosable claims):", Array.isArray(cred._sd));

// ---------- 7. ask verifier for a presentation request ----------

console.log(`\n[wallet] POST ${VERIFIER}/presentation/request`);
const presReqResp = await fetch(`${VERIFIER}/presentation/request`, {
  method: "POST",
}).then((r) => r.json());
console.log("[wallet] requestId:", presReqResp.requestId);

// Fetch the full request object from request_uri (same path wwWallet takes).
// /request-object/:id now returns a signed JWT, not JSON.
console.log(`[wallet] GET ${presReqResp.requestUri}`);
const requestObjectJwt = await fetch(presReqResp.requestUri).then((r) => r.text());
const [, payloadB64] = requestObjectJwt.split(".");
const requestObject = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
const responseUri = requestObject.response_uri;
const state = requestObject.state;

// ---------- 8. construct an SD-JWT VP ----------
// For SD-JWT VC presentations, the VP token IS the SD-JWT VC with disclosures
// appended. We pass through the full credential as received (all disclosures
// included). In a real flow the wallet would selectively pick disclosures
// matching the request's input descriptors.

console.log("[wallet] presenting full credential (all disclosures included)");

console.log(`\n[wallet] POST ${responseUri}`);
const submitResp = await fetch(responseUri, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    vp_token: sdJwtVc,
    presentation_submission: JSON.stringify({
      id: "submission-1",
      definition_id: presReqResp.requestId,
      descriptor_map: [
        { id: "lawyer-cred", format: "vc+sd-jwt", path: "$" },
      ],
    }),
    state,
  }).toString(),
});
console.log("[wallet] submission status:", submitResp.status);
const submitJson = await submitResp.json();
console.log("[wallet] submission body:", JSON.stringify(submitJson));

// ---------- 9. poll for verifier result ----------

console.log(`\n[wallet] GET ${VERIFIER}/presentation/result/${presReqResp.requestId}`);
const resultResp = await fetch(`${VERIFIER}/presentation/result/${presReqResp.requestId}`).then(
  (r) => r.json()
);
console.log("[wallet] verifier result:", JSON.stringify(resultResp, null, 2));

// ---------- 10. check profile ----------

console.log(`\n[wallet] GET ${VERIFIER}/profiles`);
const profiles = await fetch(`${VERIFIER}/profiles`).then((r) => r.json());
console.log("[wallet] all profiles:", JSON.stringify(profiles, null, 2).slice(0, 500));

// ---------- assertions ----------

console.log("\n========================================");
let allPassed = true;
function assertEq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}: ${ok ? "" : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
  if (!ok) allPassed = false;
}
assertEq("verification succeeded", resultResp.verified, true);
assertEq("capabilities", resultResp.capabilities, ["verified_lawyer"]);
assertEq("vct preserved", resultResp.claims?.vct, "urn:lex-nova:LegalProfessionalAccreditation");
assertEq("jurisdiction disclosed", resultResp.claims?.jurisdiction, "DE");
assertEq("specialty disclosed", resultResp.claims?.specialty, "Corporate / GmbH formation");
console.log("========================================");
console.log(allPassed ? "\nALL CHECKS PASSED — SD-JWT VC spike works end-to-end" : "\nSOME CHECKS FAILED");
process.exit(allPassed ? 0 : 1);
