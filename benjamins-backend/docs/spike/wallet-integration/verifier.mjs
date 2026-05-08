// Minimal OID4VP verifier for the lex-nova spike — SD-JWT VC variant.
//
// Receives a Verifiable Presentation (an SD-JWT VC + key-binding JWT)
// from wwWallet, validates the issuer signature against the bar's did:key,
// extracts disclosed claims, and stores a profile keyed by holder DID/JWK
// thumbprint with derived capabilities.

import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { base64url, importPKCS8, SignJWT } from "jose";
import { SDJwtVcInstance } from "@sd-jwt/sd-jwt-vc";
import { util as keyDidUtil } from "@cef-ebsi/key-did-resolver";

const PORT = process.env.PORT ?? 3002;
const VERIFIER_URL = process.env.VERIFIER_URL ?? `http://localhost:${PORT}`;
const VCT_BAR = "urn:lex-nova:LegalProfessionalAccreditation";
const VCT_PID = "urn:eudi:pid:1";
// Backwards-compat alias for any code still referencing VCT.
const VCT = VCT_BAR;

// ----- Generate a self-signed x.509 cert at boot via openssl ----------------
// wwWallet requires request_uri to return a signed JWT with typ=oauth-authz-req+jwt
// and x5c header. SAN DNS check defaults to false in wwWallet config, so any
// self-signed cert works. We shell out to openssl for reliability — node's
// crypto module doesn't expose cert generation.

const verifierHostname = (() => {
  try { return new URL(VERIFIER_URL).hostname; } catch { return "lex-nova-verifier"; }
})();

console.log("Generating verifier x.509 self-signed cert via openssl...");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-verifier-"));
const keyPath = path.join(tmpDir, "key.pem");
const certPath = path.join(tmpDir, "cert.pem");

execFileSync("openssl", [
  "req", "-x509", "-newkey", "rsa:2048", "-nodes",
  "-keyout", keyPath,
  "-out", certPath,
  "-days", "365",
  "-subj", `/CN=${verifierHostname}`,
  "-sha256",
  "-addext", `subjectAltName=DNS:${verifierHostname}`,
], { stdio: ["ignore", "ignore", "ignore"] });

const certPem = fs.readFileSync(certPath, "utf-8");
const keyPem = fs.readFileSync(keyPath, "utf-8");
fs.rmSync(tmpDir, { recursive: true, force: true });

const certB64Der = certPem
  .replace(/-----BEGIN CERTIFICATE-----/, "")
  .replace(/-----END CERTIFICATE-----/, "")
  .replace(/\s+/g, "");

const verifierPrivateKey = await importPKCS8(keyPem, "RS256");
console.log(`Verifier cert ready, CN=${verifierHostname}, cert b64 length=${certB64Der.length}`);

// ----- In-memory state -------------------------------------------------------

const presentationRequests = new Map();   // requestId -> presentation_definition
const presentationResponses = new Map();  // requestId -> { verified, claims, capabilities }
const profiles = new Map();               // holderDid|jwkThumbprint -> { capabilities, claims }

// ----- SD-JWT verifier — resolves the issuer JWK from the credential's
//        kid header, which contains a did:key URI we can decode locally. -----

const subtle = crypto.webcrypto.subtle;

// We can't preconfigure a static issuer JWK because each spike-issuer run
// generates a fresh keypair. So we build a fresh SDJwtVcInstance per
// verification call, pulling the issuer JWK from the credential's kid.
async function makeVerifierForKid(kid) {
  if (!kid?.startsWith("did:key:")) {
    throw new Error(`unsupported issuer kid: ${kid}`);
  }
  const issuerDid = kid.split("#")[0];
  // Decode the did:key — the full key is encoded in the DID itself.
  // @cef-ebsi/key-did-resolver exposes a resolver that returns the DID document.
  const { getResolver } = await import("@cef-ebsi/key-did-resolver");
  const resolver = getResolver();
  const docRes = await resolver["key"](issuerDid, { method: "key", id: issuerDid }, {});
  const verificationMethod = docRes?.didDocument?.verificationMethod?.[0];
  const issuerJwk = verificationMethod?.publicKeyJwk;
  if (!issuerJwk) throw new Error(`could not extract JWK from did:key for ${kid}`);

  return new SDJwtVcInstance({
    verifier: async (data, sig) => {
      const key = await subtle.importKey(
        "jwk",
        issuerJwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"]
      );
      const sigBytes = typeof sig === "string" ? base64url.decode(sig) : sig;
      return subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        sigBytes,
        new TextEncoder().encode(data)
      );
    },
    hasher: async (d, alg) => {
      const out = await subtle.digest(alg.toUpperCase(), new TextEncoder().encode(d));
      return new Uint8Array(out);
    },
    hashAlg: "sha-256",
  });
}

// ----- Helpers --------------------------------------------------------------

// Compute a stable identifier for the holder from cnf.jwk (JWK thumbprint).
async function jwkThumbprint(jwk) {
  // RFC 7638 thumbprint over the canonicalized public-key fields
  const canonical = JSON.stringify(
    Object.fromEntries(["crv", "kty", "x", "y"].filter((k) => k in jwk).map((k) => [k, jwk[k]]))
  );
  const hash = await subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return base64url.encode(new Uint8Array(hash));
}

// ----- Express app ----------------------------------------------------------

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Store full request objects for /request-object/:id lookup. wwWallet's
// OID4VP URL handler requires request_uri mode (not inline params).
const requestObjects = new Map(); // id -> the JSON request object

// DCQL queries per credential kind. Each kind picks its credential id,
// vct, claims, and operator-visible purpose. The dcql_query.credentials[].id
// is what wwWallet keys the vp_token by in the response, so we keep ours
// stable per kind ("lawyer-cred" or "client-pid"). Note `credential_sets[]
// .purpose` is currently dropped by wwWallet's DCQL flow (hardcoded to
// "Not specified by verifier" at OpenID4VPServerAPI.ts:251) but we set it
// anyway so it works once wwWallet ships proper DCQL purpose support.
function buildDcqlQuery(kind) {
  if (kind === "pid") {
    return {
      credentials: [
        {
          id: "client-pid",
          format: "vc+sd-jwt",
          meta: { vct_values: [VCT_PID] },
          claims: [
            { path: ["given_name"] },
            { path: ["family_name"] },
            { path: ["nationalities"] },
            { path: ["age_equal_or_over", "18"] },
            { path: ["address", "country"] },
          ],
        },
      ],
      credential_sets: [
        {
          options: [["client-pid"]],
          purpose:
            "Lex Nova needs to confirm you are a real EU-resident person before activating your client profile. Only the listed claims (name, nationality, country of residence, age-over-18) will be disclosed.",
        },
      ],
    };
  }
  return {
    credentials: [
      {
        id: "lawyer-cred",
        format: "vc+sd-jwt",
        meta: { vct_values: [VCT_BAR] },
        claims: [
          { path: ["given_name"] },
          { path: ["family_name"] },
          { path: ["jurisdiction"] },
          { path: ["bar_admission_date"] },
          { path: ["valid_until"] },
        ],
      },
    ],
    credential_sets: [
      {
        options: [["lawyer-cred"]],
        purpose:
          "Lex Nova needs to confirm you are an admitted lawyer before activating your advisor profile. Only the listed claims will be disclosed; your bar number stays private.",
      },
    ],
  };
}

// 1. Generate a presentation request URL using request_uri mode.
//    Body: { kind: "bar" | "pid" } — defaults to "bar" for backwards
//    compatibility with the existing operator UI.
app.post("/presentation/request", (req, res) => {
  const requestId = crypto.randomBytes(16).toString("hex");
  const nonce = crypto.randomBytes(16).toString("hex");
  const kind = req.body?.kind === "pid" ? "pid" : "bar";
  const dcqlQuery = buildDcqlQuery(kind);
  presentationRequests.set(requestId, { dcqlQuery, kind });

  // Full OID4VP request object — wwWallet fetches this from /request-object/:id.
  // wwWallet (wallet-common) uses Draft 23+ syntax: the scheme is encoded as
  // a prefix on `client_id` itself (e.g. "x509_san_dns:host.example.com"),
  // not in a separate `client_id_scheme` field. Supported schemes per
  // wallet-common's supportedClientIdSchemes set: "x509_san_dns" and "x509_hash".
  // The hostname after the prefix must match the cert's SAN DNS entry.
  const verifierHost = (() => { try { return new URL(VERIFIER_URL).hostname; } catch { return "lex-nova-verifier"; } })();
  const prefixedClientId = `x509_san_dns:${verifierHost}`;
  const requestObject = {
    response_type: "vp_token",
    response_mode: "direct_post",
    client_id: prefixedClientId,
    response_uri: `${VERIFIER_URL}/presentation/callback?id=${requestId}`,
    dcql_query: dcqlQuery,
    nonce,
    state: requestId,
  };
  requestObjects.set(requestId, requestObject);

  const requestUri = `${VERIFIER_URL}/request-object/${requestId}`;
  // wwWallet's URL handler triggers when both client_id AND request_uri
  // are present in the URL — and the URL-level client_id must already be
  // in the prefixed form, otherwise wwWallet rejects with non_supported_client_id_scheme
  // before it even fetches the request object.
  const requestUrl =
    `openid4vp://?client_id=${encodeURIComponent(prefixedClientId)}` +
    `&request_uri=${encodeURIComponent(requestUri)}`;

  // Also build a one-click wwWallet URL the operator UI can use directly.
  const wwwalletUrl =
    `https://demo.wwwallet.org/cb?client_id=${encodeURIComponent(prefixedClientId)}` +
    `&request_uri=${encodeURIComponent(requestUri)}`;

  res.json({ requestId, requestUrl, requestUri, wwwalletUrl });
});

// 1b. Serve the request object as a SIGNED JWT for request_uri lookups.
//     wwWallet requires:
//       - typ: "oauth-authz-req+jwt"
//       - x5c: [base64-DER cert]
//       - signature verifies against the cert's public key
//     SAN DNS check defaults to false, so any self-signed cert is fine.
app.get("/request-object/:id", async (req, res) => {
  const obj = requestObjects.get(req.params.id);
  if (!obj) return res.status(404).json({ error: "request_object_not_found" });

  const jwt = await new SignJWT(obj)
    .setProtectedHeader({
      alg: "RS256",
      typ: "oauth-authz-req+jwt",
      x5c: [certB64Der],
    })
    .sign(verifierPrivateKey);

  res.setHeader("Content-Type", "application/oauth-authz-req+jwt");
  res.send(jwt);
});

// 2. direct_post callback — wwWallet sends the VP here.
app.post("/presentation/callback", async (req, res) => {
  const requestId = req.query.id;
  const stored = presentationRequests.get(requestId);
  if (!stored) {
    return res.status(400).json({ error: "unknown_request" });
  }
  const requestKind = stored.kind ?? "bar";

  const vpToken = req.body.vp_token;
  console.log("[verifier] /callback body keys:", Object.keys(req.body));
  console.log("[verifier] request kind:", requestKind);
  console.log("[verifier] vp_token (first 200):", typeof vpToken, vpToken?.slice?.(0, 200));
  if (!vpToken) {
    return res.status(400).json({ error: "missing_vp_token" });
  }

  // DCQL response shape from wwWallet: vp_token is a JSON-stringified object
  // keyed by the dcql credential id (the id we set per kind in buildDcqlQuery).
  // The value is either a string or an array of strings depending on
  // wallet-common version, so handle both. (deployed wwWallet sends a string;
  // pinned wallet-common source builds an array — keep both paths.)
  const expectedKey = requestKind === "pid" ? "client-pid" : "lawyer-cred";
  const pickVp = (v) => (Array.isArray(v) ? v[0] : v);
  let sdJwtVc;
  try {
    const parsed = JSON.parse(vpToken);
    console.log("[verifier] vp_token parsed keys:", Object.keys(parsed));
    sdJwtVc = pickVp(parsed[expectedKey]);
    if (!sdJwtVc) {
      const firstKey = Object.keys(parsed)[0];
      sdJwtVc = pickVp(parsed[firstKey]);
      console.log("[verifier] fell back to first key:", firstKey);
    }
  } catch (e) {
    console.log("[verifier] vp_token wasn't JSON, treating as raw:", e.message);
    sdJwtVc = vpToken;
  }
  if (!sdJwtVc || typeof sdJwtVc !== "string") {
    console.error("[verifier] couldn't extract SD-JWT VC from vp_token:", vpToken.slice(0, 200));
    return res.status(400).json({ error: "invalid_vp_token_shape" });
  }
  console.log("[verifier] sdJwtVc (first 120):", sdJwtVc.slice(0, 120));
  console.log("[verifier] sdJwtVc tilde-segments:", sdJwtVc.split("~").length);

  try {
    // Parse out the issuer kid from the JWT header to know what to verify against.
    const [headerB64] = sdJwtVc.split("~")[0].split(".");
    console.log("[verifier] headerB64 length:", headerB64?.length);
    const headerJson = Buffer.from(headerB64, "base64url").toString("utf-8");
    console.log("[verifier] header JSON:", headerJson);
    const header = JSON.parse(headerJson);

    const verifier = await makeVerifierForKid(header.kid);
    const result = await verifier.verify(sdJwtVc);

    const claims = result.payload;
    const capabilities = [];
    if (claims.vct === VCT_BAR) capabilities.push("verified_lawyer");
    if (claims.vct === VCT_PID) capabilities.push("verified_client");

    // Derive a stable holder identifier from cnf.jwk
    const holderJwk = claims.cnf?.jwk;
    const holderId = holderJwk ? `jwk-thumbprint:${await jwkThumbprint(holderJwk)}` : "unknown";

    const existing = profiles.get(holderId) ?? { capabilities: [], claims: {} };
    profiles.set(holderId, {
      capabilities: [...new Set([...existing.capabilities, ...capabilities])],
      claims: { ...existing.claims, ...claims },
    });

    presentationResponses.set(requestId, { verified: true, capabilities, claims, holderId });
    res.json({ ok: true });
  } catch (e) {
    console.error("[verifier] verification failed:", e.message);
    presentationResponses.set(requestId, { verified: false, error: e.message });
    res.status(400).json({ error: "verification_failed", detail: e.message });
  }
});

// 3. Operator polls this for the result
app.get("/presentation/result/:id", (req, res) => {
  const r = presentationResponses.get(req.params.id);
  if (!r) return res.status(404).json({ status: "pending" });
  res.json({ status: "complete", ...r });
});

// 4. View all profiles
app.get("/profiles", (req, res) => {
  const out = {};
  for (const [k, v] of profiles.entries()) out[k] = v;
  res.json(out);
});

// 5. Operator UI
app.get("/", (req, res) => {
  res.send(`<!doctype html>
<html><head><title>Lex Nova — Spike Verifier (SD-JWT VC)</title>
<style>body{font-family:monospace;max-width:760px;margin:2rem auto;padding:1rem}
button{font-family:monospace;padding:.5rem 1rem;margin:.25rem 0}
.url{background:#eee;padding:1rem;word-break:break-all;margin:.5rem 0}
.profile{background:#efe;padding:1rem;margin:.5rem 0;border-left:4px solid green}
section{border:1px solid #ddd;border-radius:6px;padding:1rem 1.25rem;margin:1.5rem 0}
section h2{margin:0 0 .5rem 0}
.bar-section{border-left:6px solid #1a2238}
.pid-section{border-left:6px solid #003399}
pre{white-space:pre-wrap}</style>
</head><body>
<h1>Lex Nova spike verifier (SD-JWT VC)</h1>
<p>Verifies presentations of <code>${VCT_BAR}</code> (lawyer onboarding) and <code>${VCT_PID}</code> (client onboarding) in <code>vc+sd-jwt</code> format.</p>

<section class="bar-section">
  <h2>⚖ Lawyer onboarding — bar credential</h2>
  <p style="margin:.25rem 0 .75rem 0;color:#555">Asks the wallet for the bar credential and grants <code>verified_lawyer</code>.</p>
  <button onclick="requestPres('bar')">Request bar credential presentation</button>
  <div id="bar-reqOut"></div>
</section>

<section class="pid-section">
  <h2>★ Client onboarding — EU PID</h2>
  <p style="margin:.25rem 0 .75rem 0;color:#555">Asks the wallet for the PID with selective disclosure (name, nationality, country of residence, age ≥ 18) and grants <code>verified_client</code>.</p>
  <button onclick="requestPres('pid')">Request PID presentation</button>
  <div id="pid-reqOut"></div>
</section>

<button onclick="loadProfiles()" style="margin-top:1rem">Show stored profiles</button>
<div id="profOut"></div>

<script>
const API_BASE = window.location.pathname.replace(/\\/$/, "");
async function requestPres(kind) {
  const outId = kind === "pid" ? "pid-reqOut" : "bar-reqOut";
  const out = document.getElementById(outId);
  const r = await fetch(API_BASE + "/presentation/request", {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({ kind: kind })
  });
  const j = await r.json();
  out.innerHTML =
    '<h3>Open in wwWallet (one-click):</h3>' +
    '<p><a href="' + j.wwwalletUrl + '" target="wwwallet" style="display:inline-block;background:#0070ff;color:white;padding:0.75rem 1.5rem;text-decoration:none;border-radius:4px">→ Present ' + kind + ' to verifier</a></p>' +
    '<details><summary>Detail</summary>' +
    '<p>request_uri: <code>' + j.requestUri + '</code></p>' +
    '<p>Raw request URL: <code style="word-break:break-all">' + j.requestUrl + '</code></p></details>';
  const reqId = j.requestId;
  const interval = setInterval(async () => {
    const r2 = await fetch(API_BASE + "/presentation/result/" + reqId);
    if (r2.status === 200) {
      const j2 = await r2.json();
      clearInterval(interval);
      out.insertAdjacentHTML(
        "beforeend",
        '<h3>Result:</h3><pre>' + JSON.stringify(j2, null, 2) + '</pre>'
      );
    }
  }, 2000);
}
async function loadProfiles() {
  const r = await fetch(API_BASE + "/profiles");
  const j = await r.json();
  let html = '<h3>Stored profiles:</h3>';
  for (const [k, profile] of Object.entries(j)) {
    html += '<div class="profile"><strong>Holder:</strong> ' + k +
            '<br><strong>Capabilities:</strong> ' + JSON.stringify(profile.capabilities) +
            '<br><strong>Claims:</strong><pre>' + JSON.stringify(profile.claims, null, 2) + '</pre></div>';
  }
  if (Object.keys(j).length === 0) html += '<p>(none yet)</p>';
  document.getElementById("profOut").innerHTML = html;
}
</script>
</body></html>`);
});

app.listen(PORT, () => {
  console.log(`Spike verifier (SD-JWT VC) listening on ${VERIFIER_URL}`);
  console.log(`Open ${VERIFIER_URL}/ to drive the OID4VP flow.`);
});
