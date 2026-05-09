# Wallet integration spike — SD-JWT VC variant

Verifies the open Phase-2 question from [docs/09-spec-v2.md §Day-1 reachability](../../docs/09-spec-v2.md): **does wwWallet accept a `did:key` issuer for OID4VCI, and can we round-trip a credential through wwWallet via OID4VCI + OID4VP?**

**Round-9 finding (from reading wallet-frontend source code):** wwWallet's OID4VCI consume path supports `vc+sd-jwt`, `dc+sd-jwt`, and `mso_mdoc` formats only. It does NOT consume `jwt_vc_json` (W3C JWT VC). This spike was rewritten to use SD-JWT VC accordingly. The change reverberated in the spec: `@cef-ebsi/verifiable-credential` was dropped in favor of `@sd-jwt/sd-jwt-vc` for both lawyer and client credential layers. Same library, same did:key issuer, different format.

## What this spike contains

- **`issuer.mjs`** — a minimal OID4VCI issuer (Express). Stands in for the bar association.
  - Generates a fresh `did:key` ES256 keypair at boot, prints it.
  - Exposes `/.well-known/openid-credential-issuer` metadata advertising `vc+sd-jwt`.
  - Implements the **pre-authorized code grant** flow: `/offer`, `/token`, `/credential`.
  - Signs the credential with `@sd-jwt/sd-jwt-vc`'s `SDJwtVcInstance` using ES256 + WebCrypto.
  - Includes `cnf.jwk` (holder key binding) extracted from the wallet's proof JWT at credential time.
  - Selectively-disclosable claims: `jurisdiction`, `specialty`, `admittedSince`, `barAdmissionNumber`.
  - Operator UI at `/` — click a button, get an offer URL.

- **`verifier.mjs`** — a minimal OID4VP verifier (Express). Stands in for the platform's verifier.
  - Generates an OID4VP request with a `presentation_definition` filtering on `vct = urn:lex-nova:LegalProfessionalAccreditation`.
  - Receives the SD-JWT VC presentation via `direct_post`.
  - Resolves the issuer's did:key by parsing the credential's `kid` header (uses `@cef-ebsi/key-did-resolver`).
  - Validates the issuer signature, extracts disclosed claims, derives capabilities.
  - Stores a profile keyed by holder JWK thumbprint (derived from `cnf.jwk` in the credential).
  - Operator UI at `/` — request a presentation, view stored profiles.

What's **not** in scope for this spike:
- MetaMask / SIWE login
- Client PID flow (separate, via `issuer.eudiw.dev`)
- ZK conflict-check
- On-chain EAS attestations
- The platform's UI

## Run

```bash
cd spike/wallet-integration
npm install              # if you haven't yet
npm run both             # starts issuer on 3001 and verifier on 3002 in one terminal

# Or in two terminals:
npm run issuer
npm run verifier
```

Now you have:

- Issuer at `http://localhost:3001`
- Verifier at `http://localhost:3002`

## The HTTPS problem (read this before testing)

wwWallet runs at `https://demo.wwwallet.org` (HTTPS). When you paste an offer or presentation URL, wwWallet's browser tab will fetch metadata from your local issuer/verifier. **Mixed content rules in modern browsers block HTTPS pages from loading HTTP resources.**

Three ways to handle this:

### Option A — Cloudflare Tunnel (recommended for hackathon)

```bash
# Install cloudflared (one-time):
#   Linux:    sudo dnf install cloudflared    # Fedora
#             sudo apt install cloudflared    # Debian/Ubuntu
#   macOS:    brew install cloudflared
#
# Then in two terminals:
cloudflared tunnel --url http://localhost:3001    # → prints e.g. https://abc-xyz.trycloudflare.com
cloudflared tunnel --url http://localhost:3002    # → prints e.g. https://def-uvw.trycloudflare.com

# Then run our spike pointed at those tunnel URLs:
ISSUER_URL=https://abc-xyz.trycloudflare.com npm run issuer
VERIFIER_URL=https://def-uvw.trycloudflare.com npm run verifier
```

Each tunnel URL lasts as long as `cloudflared` is running. No account or signup needed for the free quick tunnels.

### Option B — ngrok

```bash
ngrok http 3001    # → https://abc.ngrok.io
ngrok http 3002    # → https://def.ngrok.io
```

Same idea. Free tier works for short tests.

### Option C — Run wwWallet locally over HTTP

Clone `wwWallet/wallet-frontend` and `wwWallet/wallet-ecosystem` repos and run the wallet at `http://localhost:3000`. Then both wallet and issuer/verifier are HTTP and the browser is happy. Heavier setup; only worth it if you're going to iterate a lot.

## The test procedure

### Step 1 — Issuance flow

1. Start the issuer (`npm run issuer` or via tunnel as above).
2. Open the issuer URL in a browser — `http://localhost:3001` (or your tunnel URL).
3. Note the issuer's logged DID (e.g. `did:key:z2dmzD81cgPx...`).
4. In a separate browser tab, open `https://demo.wwwallet.org`. Sign in (or sign up) with WebAuthn / a passkey.
5. wwWallet should generate a holder DID for you. Find it under "Settings" or check the network logs for a `did:key:...` your wallet uses. Copy that DID.
6. Back on the issuer UI, paste the holder DID into the input box. Click "Generate credential offer."
7. **Copy the offer URL** (`openid-credential-offer://?credential_offer=...`).
8. In wwWallet, look for an "Add credential" or "Receive credential" entry — paste the offer URL.
9. wwWallet should fetch issuer metadata, run the OID4VCI flow, and ask whether to accept the credential.
10. Approve. wwWallet should display "Legal Professional Accreditation" in its credentials list.

**Success criteria:** wwWallet shows the credential. Inspect it — it should contain your holder DID as the subject, `jurisdiction: DE`, `specialty: GmbH formation`, etc.

**Failure modes:**
- "Issuer rejected" / "metadata not found" — wwWallet can't reach your issuer. Check the tunnel URL is HTTPS and reachable.
- "Unsupported credential" — wwWallet doesn't recognize the credential format or DID method. **This is the open Phase-2 question.** If it errors specifically about did:key, try the did:web fallback (separate document).
- "Schema not registered" — EBSI library couldn't validate against the schema URL. Try a different schema URL, or relax the validation.

### Step 2 — Presentation flow

1. With the credential in wwWallet, open the verifier UI: `http://localhost:3002` (or tunnel URL).
2. Click "Request lawyer credential presentation."
3. Copy the presentation request URL (`openid4vp://?...`).
4. In wwWallet, find the "Present credential" entry — paste the URL.
5. wwWallet should match the request to your held LegalProfessionalAccreditation and ask for approval.
6. Approve. wwWallet sends the VP to the verifier.
7. The verifier UI's "Result" section should populate with `verified: true`, `capabilities: ["verified_lawyer"]`, and the disclosed claims.
8. Click "Show stored profiles." Your holder DID should appear with `capabilities: ["verified_lawyer"]`.

**Success criteria:** the verifier shows `verified: true` and the right capabilities. The whole spike answers "yes" — wwWallet is the wallet for our project.

### Step 3 — A second capability

Demonstrate multi-capability profiles (the canonical model): present another credential type and watch the same holder DID gain another capability.

Skip for the spike — requires implementing PID issuance, which the EU's hosted `issuer.eudiw.dev` does already. In the real platform, the lawyer's wwWallet has both PID and LegalProfAccreditation, presented in one OID4VP, two attestations land, profile gains both capabilities. The mechanism is the same.

## What the spike proves (or doesn't)

If you got through Steps 1 and 2 cleanly:
- ✓ wwWallet accepts our did:key issuer
- ✓ `@cef-ebsi/verifiable-credential` mints credentials wwWallet can consume
- ✓ wwWallet presents back via OID4VP and our verifier extracts the right claims
- ✓ The capability-profile model works as designed
- → **Phase 2 day-1 question is answered. Ship Path F.**

If Step 1 fails specifically on did:key:
- → Switch issuer DID method to did:web (host `/.well-known/did.json`).
- → Retest. Most wallets accept did:web because it's just an HTTPS fetch.
- → If that also fails, drop down to a minimal browser wallet page or fork wallet-ecosystem.

If Step 2 fails specifically on `presentation_definition`:
- → The wallet's matching algorithm differs from what we wrote. Look at wwWallet's accepted formats more carefully and adjust the descriptor.

Whichever path the spike forces, the outcome is the same: we know exactly what to build for Phase 2 day 1.

## Notes on simplifications

- **No proof-of-key check on the credential endpoint.** Real OID4VCI requires the wallet to send a `proof` (a JWT signed by the holder key with `c_nonce` from the token endpoint) to bind the credential to the wallet. We trust the subject DID from the offer instead. Add the proof check before any production use.
- **No signature check on the VP envelope.** The verifier only validates the nested credential's signature, not the holder's signature over the VP. For the spike that's fine; for production, verify both.
- **In-memory state.** Pre-auth codes, access tokens, and profiles all live in `Map`s that vanish on restart. That's fine for the spike.
- **No EBSI schema fetch happens in production unless `validateCredentialSchema: true`** — we leave it default (true) for the issuance side; the schema URL we reference is a real EBSI conformance schema and resolves cleanly per round-7 verification.
