# Firmus Novus

> Verified Legal Counsel, On-Chain.

Firmus Novus is a decentralized law-firm web application that connects clients with EBSI-verified lawyers across Europe. Clients describe a legal need, match with a verified lawyer, book a consultation, fund a smart-contract escrow, and meet inside the dApp. Funds release to the lawyer only after the consultation is marked complete.

This repository implements the MVP of the brand and product per the [`lex-nova-design-system`](https://api.anthropic.com/v1/design/h/p2G5VkDhpRQGOe1Vuq3dRg) bundle (the design's working name was "Lex Nova" — every reference in code, copy, and UI uses **Firmus Novus**, the rebrand).

---

## Stack

- **Next.js 15** (App Router) · **React 19** · **TypeScript strict**
- **Tailwind CSS v4** with design tokens in `app/globals.css` (`@theme` block)
- **Prisma 6** + **SQLite** (file-based at `prisma/dev.db` — no external service required)
- **NextAuth v5 (Auth.js)** with a Credentials provider that verifies SIWE (Sign-In With Ethereum) signatures
- **wagmi 2 + viem 2 + RainbowKit** for wallet connection
- **shadcn/ui-style** primitives in `components/ui/*` built on Radix + CVA
- **react-hook-form + zod** for forms and validation
- **lucide-react** for icons (no emoji, per design spec)

---

## Run locally

```bash
# 1. Install + generate Prisma client
npm install
cp .env.example .env
# (edit .env: set AUTH_SECRET, NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID, ADMIN_API_KEY)

# 2. Create the SQLite database + run the seed
npx prisma migrate dev --name init
npx prisma db seed

# 3. Develop
npm run dev
# open http://localhost:3000
```

The SQLite database lives at `prisma/dev.db` and is git-ignored. Delete the file
to start over, or run `npm run db:reset` to wipe + reseed via Prisma.

The seed creates twelve EBSI-verified lawyers spanning Stockholm, Berlin, Rome, Paris, Warsaw, Copenhagen, Milan, Vienna, Madrid, Amsterdam, Brussels, and Prague — with a mix of hourly, fixed-package, subscription, and no-win-no-fee pricing models. It also creates four sample clients and a handful of bookings + message threads.

### Auth flow (dev)

The onboarding flow at `/connect` walks: **Role → EBSI identity wallet → (clients) Over18 age check → Transaction wallet → SIWE sign-in.** The transaction wallet is real (RainbowKit). The EBSI wallet is stubbed at the picker — the user records which provider they use; no actual VC exchange happens. Once a wallet is connected, SIWE auto-signs to authenticate.

### Admin verification

```bash
curl -X POST http://localhost:3000/api/admin/verify-lawyer \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"lawyerProfileId":"<id>"}'
```

In dev, applications submitted via `/verify-lawyer` are auto-verified `DEV_AUTO_VERIFY_SECONDS` seconds later (default `5`). Set the env to `0` to disable.

---

## Twelve views shipped

| # | URL | View |
|---|-----|------|
| 1 | `/` | Landing — hero, How It Works, Trust Strip, Recently joined |
| 2 | `/lawyers` | Directory — search + filters (practice / language / pricing model) |
| 3 | `/lawyers/[id]` | Lawyer Profile — tabs (About / Credentials / Reviews / Availability), sticky booking sidebar |
| 4 | `/connect` | Connect Wallet + Role — multi-stage with EBSI identity + tx wallet |
| 5 | `/verify-lawyer` | Lawyer Verification — credential form + drop zones + EBSI rail |
| 6 | `/client/home` | Client Home — greeting, clickable categories, active consultation, recommended |
| 7 | `/client/book/[lawyerId]` | Booking & Payment — date/time, duration, fee summary, escrow visualisation |
| 8 | `/client/consultation/[bookingId]` | Consultation Room — dark mode, video placeholder, real chat, Mark Complete |
| 9 | `/client/messages` | Messages — threads list + active conversation |
| 10 | `/lawyer/dashboard` | Dashboard — stats, today's schedule, earnings spark, recent requests |
| 11 | `/lawyer/requests/[id]` | Request Review — anonymous client, conflict check, accept/decline |
| 12 | `/lawyer/profile/edit` | Profile Editor — tabs, live preview, sticky save bar |

Plus the lawyer mirror routes for messages and consultation, and a redirect helper for `/client/cases`.

---

## What is real vs stubbed

### Real
- SQLite + Prisma schema with twelve seeded lawyers
- NextAuth + SIWE (real signature verification, one-time nonces)
- Wallet connection (wagmi + viem + RainbowKit)
- File uploads (local `/uploads/credentials/<userId>/…`, served via auth-checked API)
- All bookings, messages, conversations persisted in DB
- Role-gated middleware + page-level `requireClient` / `requireLawyer`

### Stubbed (TODOs in code)
| Stub | Where | What's needed for production |
|------|-------|------------------------------|
| Smart-contract escrow | `lib/web3/escrow.ts` | Deploy escrow contract on a low-fee L2 (Polygon / Arbitrum). Replace `createEscrow`/`releaseEscrow`/`disputeEscrow` stubs with viem `writeContract` calls signed by the user's wallet. |
| EBSI verification | `lib/web3/ebsi.ts`, `app/api/verification/route.ts` | Integrate the EBSI Trusted Issuers Registry (https://ec.europa.eu/digital-building-blocks/sites/display/EBSI/EBSI+Trusted+Issuers+Registry) and OpenID for VC. Issue VCs back to the lawyer's identity wallet on success. |
| EBSI Over18 VC for clients | `app/connect/connect-flow.tsx` (age stage) | Replace the 1.5-second sleep with a real OID4VP request to the connected identity wallet for the Over18 attestation. |
| Video room | `app/client/consultation/[bookingId]/consultation-room.tsx` | Pick a real SDK — recommend **Daily**, **Huddle01**, or **LiveKit**. Daily is fastest to integrate; Huddle01 fits the on-chain story; LiveKit is open-source if self-hosting. |
| File storage | `app/api/uploads/route.ts` | Migrate from local disk to **S3** or **Cloudflare R2** with signed URLs. Local disk doesn't survive container restarts and won't scale beyond a single node. |
| Email notifications | _(none)_ | Add Resend (or Postmark) for booking confirmations, accept/decline, verification status. |

### Excluded from MVP per the original prompt
- Reviews tab UI on the lawyer profile (placeholder copy ships; data model exists in design spec, can be added when built out)
- Disputes inbox / detail / juror flow (designed but explicitly out of MVP scope)
- Admin panel UI (single API endpoint at `/api/admin/verify-lawyer`)
- Notifications centre

---

## Design ambiguities resolved

When the design and the original prompt disagreed I went with the design and flagged the choice in chat before coding. The notable resolutions:

1. **Currency: tokenized EUR, not ETH.** Prisma fields renamed (`hourlyRateEUR`, `consultationFeeEUR`, `platformFeeEUR`); UI shows `€240`, never crypto denominations.
2. **Dual-wallet onboarding.** EBSI identity wallet (DS / eKibisis / eDiplomas / SSI Auth / PwC-ID / IDENTFY / PrimusMoney) is selected first; transaction wallet (MetaMask / WalletConnect / Coinbase) is connected second. SIWE happens against the tx wallet.
3. **Pricing models per lawyer.** `LawyerProfile.pricingKind` enum (HOURLY / FIXED / SUBSCRIPTION / SUCCESS) plus `pricingItems` JSON column for service packages.
4. **Twelve seeded lawyers.** Prompt's name list, design's pricing-model variety. Two lawyers (Margaux Laurent, Stefan Novak) are seeded as PENDING to demonstrate the verification states.
5. **Reviews + disputes excluded from MVP.** The design ships them; the prompt's "Do not do" list excludes them. Excluded — empty-state placeholders on the Reviews tab; no dispute UI.
6. **`client-app/components.jsx` was not exported in the design bundle.** ClientHome / Booking / ConsultationRoom / Messages were rebuilt from the design README + chat transcripts, matching tokens, layout rhythm, and the component vocabulary established in the marketing / lawyer-app / onboarding kits.

---

## Project layout

```
app/
  page.tsx                        # 1. Landing
  lawyers/page.tsx                # 2. Directory
  lawyers/[id]/page.tsx           # 3. Public profile
  connect/page.tsx                # 4. Connect Wallet + Role
  verify-lawyer/page.tsx          # 5. Lawyer Verification
  client/
    layout.tsx                    # auth gate
    home/page.tsx                 # 6. Client Home
    book/[lawyerId]/page.tsx      # 7. Booking
    consultation/[id]/page.tsx    # 8. Consultation Room (dark)
    messages/page.tsx             # 9. Messages
    cases/page.tsx                # → redirects to /client/home
  lawyer/
    layout.tsx                    # auth gate
    dashboard/page.tsx            # 10. Dashboard
    requests/page.tsx             # list (helper)
    requests/[id]/page.tsx        # 11. Request Review
    profile/edit/page.tsx         # 12. Profile Editor
    consultation/[id]/page.tsx    # mirror of 8 for the lawyer side
    messages/page.tsx             # mirror of 9 for the lawyer side
  api/
    auth/[...nextauth]/route.ts
    auth/nonce/route.ts
    lawyers/route.ts
    lawyers/[id]/route.ts
    bookings/route.ts
    bookings/[id]/{accept,decline,complete}/route.ts
    messages/route.ts
    uploads/{route.ts,[...path]/route.ts}
    verification/route.ts
    admin/verify-lawyer/route.ts
components/
  ui/                             # Radix-based primitives
  firmus/                         # FirmusLogo, EBSIBadge, LawyerCard, …
  layout/                         # MarketingNav, AppTopBar, Footer, AuthShell
lib/
  db/client.ts                    # Prisma singleton
  auth/{config.ts,session.ts}     # NextAuth + SIWE + role helpers
  web3/{config.ts,escrow.ts,ebsi.ts}
  utils/{cn.ts,format.ts,anonymize.ts}
prisma/
  schema.prisma
  seed.ts
middleware.ts                     # role-gated route matcher
```

---

## Brand non-negotiables (kept)

- Two accent colours only: **teal `#14B8A6`** for actions / Web3 signals, **muted gold `#C9A961`** for EBSI verification (under 5% of visual weight).
- Web3 vocabulary stays quiet: "secure payment held until your consultation completes" instead of "smart contract escrow" in headlines.
- Wallet addresses are truncated and rendered in a monospaced font (`0x4f02…2c1a`).
- **Inter** for UI text, **Fraunces** for hero/page titles. Fraunces is a free substitute for the brief's licensed Tiempos / GT Sectra — flagged for swap before launch.
- WCAG AA contrast everywhere.
- No emoji as UI elements; lucide icons only.

---

## License

Proprietary · © Firmus Novus S.A.
