# Firmus Novus

A privacy-preserving European legal-services marketplace. Lawyers prove their bar admission via EUDI bar credentials; clients prove they're EU-resident adults via their PID; both are anchored on chain by the operator as EAS attestations. Engagements run as milestone-based escrow with mutual refunds and arbiter-resolved disputes.

This README covers **deploying the system for jury/demo evaluation**. For development workflow see `scripts/dev-reset.sh` and `pnpm dev`.

---

## TL;DR

```bash
git clone <this repo>
cd firmusnovus
bash scripts/start.sh              # → http://localhost:3000
```

That builds a single Docker image, spins up anvil + the three Next.js apps, deploys the contracts, and seeds both SQLite DBs. About 5–8 minutes for the first build, ~30 s on subsequent runs.

To wipe and start over:

```bash
bash scripts/reset.sh
```

To expose the platform on a public URL via ngrok (so an EUDI wallet on a different device can reach it):

```bash
bash scripts/start-ngrok.sh
```

---

## What's running

The container exposes two ports on the host:

| Host port | What it is | Who talks to it |
|---|---|---|
| `:3000` | The proxy. Serves the platform UI at `/`, the issuer at `/issuer/*`, and the OID4VCI endpoints at `/api/issuer/*`. | Browsers, EUDI wallets. |
| `:8545` | Anvil JSON-RPC. | MetaMask, Otterscan. |
| `:5100` | [Otterscan](https://github.com/otterscan/otterscan) — Etherscan-shaped block explorer for the in-container anvil. Open `http://localhost:5100` to inspect every tx (funding, release, refund, dispute, resolve) with decoded calldata. | You, in a browser. |

Inside the container:

- **anvil** — local EVM (chain id `31337`, 10 funded accounts, 2 s blocks, no gas).
- **proxy** (`tsx` on `:3000`) — single ingress, fronts the two Next.js apps.
- **web** (`next start` on `:3010`) — the platform UI.
- **issuer** (`next start` on `:3001`) — OID4VCI test issuer for PID + bar credentials.

Container restart re-runs the entrypoint, which redeploys the contracts and reseeds both DBs from scratch. There is no persistent volume.

---

## Prerequisites

| | Why |
|---|---|
| **Docker** | Runs the whole stack. Tested with Docker 24+. |
| **Google Chrome** (latest) | wwwallet's WebAuthn implementation only works reliably here. See *The wwwallet/passkey limitation* below. |
| **MetaMask** in each Chrome profile | To sign SIWE messages and submit funding/release/dispute txs. |
| **Up to 3 Google accounts** | One per persona (operator / lawyer / client). |
| (optional) **ngrok CLI** | Only if you want a public URL. Run `ngrok config add-authtoken <yours>` once. |

You do **not** need Node, pnpm, Foundry, or anything else on the host. They all live inside the image.

---

## The wwwallet / passkey limitation (read this first)

The EUDI wallet we integrate with — [wwwallet](https://demo.wwwallet.org/) — uses passkeys (WebAuthn) for its master credential. In our hands, **the only reliable combination is**:

- **Google Chrome** (Edge/Brave have worked occasionally, Safari/Firefox have not)
- Each Chrome profile **signed in to its own Google account**, so passkey storage doesn't collide
- One Chrome profile per persona — never two personas in the same profile

To run all three personas on one machine:

1. Chrome → profile menu (top-right circle) → **Add** → sign in to (or create) a fresh Google account.
2. Repeat so you have one profile per persona.
3. Install MetaMask in each profile separately.
4. Open `https://demo.wwwallet.org` in each profile and complete first-run setup. The Google passkey is bound at this step.

Skipping any of this will look like "the wallet button does nothing" or "no passkey appears". It's not the platform — it's wwwallet's auth model.

---

## Personas

You'll demo with three roles. **Each role = one Chrome profile = one MetaMask account = one EUDI wallet**.

| Role | Anvil account | Special handling |
|---|---|---|
| **Operator** | index `0` (matches `OPERATOR_PRIVATE_KEY` in `.env`) | The platform recognises this exact wallet at SIWE time and pins it to `OPERATOR`. Operator skips PID/bar onboarding entirely — they go straight to `/admin/dashboard`. |
| **Lawyer** | indices `1–3` recommended (Anna, Carlos, Dieter — see `/issuer`) | Onboarded by presenting **PID + bar credential**, both minted from `/issuer`. Role lifts to LAWYER once the bar credential is attested on chain. |
| **Client** | indices `4–6` recommended (Sofia, Eva, Marta) | Onboarded by presenting **PID only**. |

The operator is special because the contract's `attestVerifiedClient` / `attestVerifiedLawyer` / `resolveDispute` calls are all gated on the operator address. Everyone else's role comes from on-chain attestations.

You can use any anvil account for lawyer or client — the persona names listed above are just the test data baked into the issuer.

---

## Step-by-step setup (per persona)

### 1. Get anvil's credentials

```bash
docker logs firmus-novus 2>&1 | grep -A 25 "Available Accounts"
```

You'll see ten address/private-key pairs. Pick one per persona. **Index 0 is always the operator** — its private key is also baked into `.env` as `OPERATOR_PRIVATE_KEY`, so you can use either.

### 2. Add the chain to MetaMask

In each Chrome profile's MetaMask:

- Networks → **Add a network manually**
- Network name: `Anvil (Firmus dev)`
- RPC URL: `http://localhost:8545`
- Chain ID: `31337`
- Currency symbol: `ETH`

### 3. Import the persona's account

MetaMask → account picker → **Import account** → paste the private key from step 1.

You should see ~100 ETH on the account. (Anvil's `--balance 100`.)

### 4. Mint the credentials

Navigate to the test issuer:

- **Local run**: `http://localhost:3000/issuer`
- **ngrok run**: the public URL printed by `start-ngrok.sh`, then `/issuer`

You'll see a list of test personas (Anna Schmidt, Carlos García, …). Pick the persona matching your account index and click **Mint PID** (and **Mint Bar** if it's a lawyer). wwwallet opens; passkey prompts; approve.

> ⚠ **Important**: the issuer's persona index must match the anvil account index. If you imported anvil account `1` to MetaMask, mint Anna Schmidt's credentials. Mismatch → on-chain attestation fires for the wrong wallet → onboarding will silently bind the credentials to a different MetaMask account.

### 5. Onboard

1. Open the platform — `http://localhost:3000` (or your ngrok URL).
2. Click **Connect wallet**, pick your persona's MetaMask account, sign the SIWE message.
3. The platform routes you to `/connect`:
   - **Operator** → automatically redirected to `/admin/dashboard`. Done.
   - **Client** → present PID only → land on `/client/home`.
   - **Lawyer** → present PID, then bar credential → land on `/lawyer/dashboard`.
4. The `/connect` flow opens wwwallet for each presentation. Approve with your passkey.

### 6. Operator: enable secure messaging

The operator decrypts dispute archives client-side. On `/admin/dashboard` you'll see an amber **"Decryption key not enrolled"** card — click **Enable** and sign once with the operator wallet. After that, every dispute view at `/admin/disputes/*` will decrypt automatically.

---

## Demo flows worth showing

**Booking + escrow + release** (golden path)

1. Client picks a lawyer at `/lawyers/[id]`, books a consultation.
2. Lawyer accepts (`/lawyer/orders/[id]`).
3. Client funds escrow (one MetaMask tx).
4. Lawyer marks the consultation complete; client releases (one MetaMask tx).

**Mutual refund**

5. Either party can propose a refund from the same case page; the other co-signs; one MetaMask tx executes the refund.

**Follow-up order**

6. Lawyer creates a follow-up order from `/lawyer/follow-ups/new`; client funds; later releases.

**Dispute resolution**

7. Either party clicks **Open dispute**.
8. Both parties click **Submit my archive to the arbiter** — their conversation is decrypted client-side and re-encrypted to the operator.
9. Operator opens `/admin/disputes/[kind]/[id]`, reads both archives side-by-side, picks a split, signs the `resolveDispute` tx.

---

## Reset

```bash
bash scripts/reset.sh           # local
bash scripts/reset.sh --ngrok   # bring it back up with the ngrok tunnel
```

Removes the container, restarts it. Anvil chain is wiped, contracts redeploy at fresh addresses, both DBs reseed. **Your MetaMask account stays the same** (same private key) but its on-chain attestations and balances reset. **You'll need to re-onboard each persona.**

If you've added Firmus's anvil network to MetaMask and start running into "wrong nonce" or "transaction underpriced" errors after a reset — MetaMask caches per-wallet nonces. Settings → Advanced → **Clear activity tab data** clears them.

---

## ngrok run (public URL)

```bash
bash scripts/start-ngrok.sh
```

What this does:

1. Starts a free ngrok tunnel pointing at `http://localhost:3000`, gets the public URL.
2. Builds the Docker image.
3. Runs the container with `PUBLIC_HOSTNAME=<ngrok URL>`. The issuer + verifier metadata served to the wallet now uses that URL, so wwwallet can reach the issuer's `.well-known` endpoints.

Caveats:

- **Anvil is NOT tunneled.** Only `:3000` goes through ngrok. MetaMask must point at `http://localhost:8545` on whichever machine is running the container. If a remote viewer wants to do real chain interaction, they'd need to run their own copy.
- The ngrok free tier rotates URLs on every restart. If you reset, the URL changes; mints / onboarding sessions started before the restart will fail because the issuer URL no longer matches.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Wallet button does nothing in Chrome | Profile not signed in to a Google account, or two profiles share an account | Use a fresh Google account in each Chrome profile; close + reopen the profile |
| `Could not connect to wallet` (MetaMask) | Wrong network selected | Switch MetaMask network to `Anvil (Firmus dev)` |
| `Internal JSON-RPC error: nonce too high` | Reset wiped the chain but MetaMask cached nonces | MetaMask → Settings → Advanced → **Clear activity tab data** |
| Onboarding finalize returns 500 | Stale JWT after a reset | Sign out (top-right menu) and sign back in |
| `/connect` redirects in a loop | Operator wallet detected but role mismatch in JWT | Sign out, clear cookies for the host, sign back in |
| Issuer mint button opens wwwallet but credential never lands | wwwallet can't reach the issuer's `.well-known` | Check `PUBLIC_HOSTNAME` in `docker logs firmus-novus`; for ngrok make sure the URL hasn't rotated |
| Dispute archive panels empty for the operator | Operator messaging key not enrolled | `/admin/dashboard` → click **Enable** on the amber card |
| `the lawyer hasn't enabled secure messaging yet` | Counterparty hasn't visited their `/messages` tab once | Have the counterparty open `/lawyer/messages` (or `/client/messages`) and sign once |
| `host port 8545 already in use` | A previous anvil is still running on the host | `pkill -x anvil`, or set `PORT=3010 bash scripts/start.sh` and adjust MetaMask |
| ngrok "tunnel not found" | Authtoken missing | `ngrok config add-authtoken <token>` once |

Container logs are the single source of truth: `docker logs -f firmus-novus`.

---

## What's where

```
/                  marketing landing → /lawyers
/lawyers           directory of verified lawyers
/lawyers/[id]      lawyer profile
/connect           onboarding flow (PID, optional bar credential)
/client/...        client surface (cases, follow-ups, messages, engagements, consultation room)
/lawyer/...        lawyer surface (dashboard, orders, follow-ups, profile editor, engagements, consultation room)
/admin/...         operator surface (dashboard, dispute resolution) — gated to OPERATOR role
/issuer            test OID4VCI issuer (mint PID + bar credentials)
/api/...           platform API
/api/issuer/...    OID4VCI endpoints (proxied to the issuer app)
```

---

## Architecture (one paragraph)

A pnpm workspace with three Next.js 15 apps (`apps/web`, `apps/issuer`, `apps/proxy`) plus shared packages (`packages/dcql`, `packages/sd-jwt`, `packages/oid4vci`, `packages/db-toolkit`, `packages/crypto`). Identity is rooted in the EUDI ecosystem (PID + bar credentials, OID4VCI for issuance, OID4VP for presentation) and bound to wallets via EAS attestations on a Solidity escrow contract (`contracts/`). Messaging is end-to-end via NaCl box X25519 keypairs derived from a wallet signature; dispute archives use the same primitive but re-encrypted to the operator. SSE keeps both parties' UIs in sync without polling. SQLite for everything app-side; SQLite for the issuer too (separate DB).
