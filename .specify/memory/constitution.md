# Firmus Novus Constitution

> Verified Legal Counsel, On-Chain.

Firmus Novus is a decentralized law-firm web application that connects clients
with EBSI-verified lawyers across Europe. Clients describe a legal need, match
with a verified lawyer, book a consultation, fund a smart-contract escrow, and
meet inside the dApp. Funds release to the lawyer only after the consultation
is marked complete.

## Core Principles

### I. Brand & Naming (NON-NEGOTIABLE)

The product is **Firmus Novus**. The original design bundle was authored
under the prototype codename "Lex Nova" — that name MUST NOT appear in code,
copy, UI, schema, or marketing. Every reference is rebranded to Firmus Novus
before it ships.

### II. Tokenized EUR, Not ETH (NON-NEGOTIABLE)

All user-visible monetary amounts are denominated in **tokenized EUR**, never
in ETH or other crypto-asset units. Schema fields are suffixed `EUR`
(`hourlyRateEUR`, `consultationFeeEUR`, `platformFeeEUR`). UI shows `€240`,
never `0.07 ETH`. Smart-contract escrow handles a stablecoin-EUR token —
clients and lawyers see euros only.

### III. Dual-Wallet Identity Model (NON-NEGOTIABLE)

Every user connects two wallets, in a strict order:

1. **EBSI-conformant identity wallet** — selected first. Holds Verifiable
   Credentials. Approved providers: DS Wallet, eKibisis, eDiplomas, SSI Auth,
   PwC-ID, IDENTFY, PrimusMoney. Firmus Novus never sees the underlying
   documents.
2. **Transaction wallet** — connected second. Used for SIWE (Sign-In With
   Ethereum) authentication and for funding / receiving escrow. Brands:
   MetaMask, WalletConnect, Coinbase Wallet.

For client onboarding, a third intermediate step requests an **Over18
Verifiable Credential** from the identity wallet — a boolean attestation;
date of birth is never shared.

### IV. Quiet Web3, Loud Trust

Web3 vocabulary stays quiet in user-facing copy. Headlines say "secure
payment held until your consultation completes," not "smart contract
escrow." Wallet addresses are truncated and rendered in a monospaced font
(e.g. `0x4f02…2c1a`). EBSI verification is the marquee trust signal —
crypto plumbing is invisible.

### V. Design Tokens & Visual Discipline (NON-NEGOTIABLE)

- **Two accent colors only**: teal `#14B8A6` for actions and Web3 signals;
  muted gold `#C9A961` for EBSI verification — gold MUST stay under 5% of
  visual weight on any view.
- **Typography**: Inter for UI text, Fraunces for hero/page titles. Fraunces
  is a free substitute for the brief's licensed Tiempos / GT Sectra; flagged
  for swap before launch.
- **Iconography**: lucide-react only. **No emoji as UI elements**, anywhere.
- **Accessibility**: WCAG AA contrast everywhere; all interactive elements
  keyboard-reachable; `aria-hidden` on decorative icons.

### VI. Role-Gated Routing

Every URL under `/client/*` requires an authenticated user with role
`CLIENT`. Every URL under `/lawyer/*` requires role `LAWYER`. The
`/verify-lawyer` page requires authentication but allows pending lawyers.
Middleware enforces this; pages also call `requireClient()` /
`requireLawyer()` server-side. Role mixing is forbidden.

### VII. Real Persistence, Stubbed Crypto Plumbing

The MVP persists everything user-visible to Postgres via Prisma — bookings,
messages, conversations, lawyer profiles, nonces. The crypto plumbing layer
is stubbed in code at named seams:

| Seam | Path | Stub behavior |
|------|------|---------------|
| Smart-contract escrow | `lib/web3/escrow.ts` | Returns fake tx hashes after a delay |
| EBSI lawyer verification | `lib/web3/ebsi.ts` | Auto-verifies in dev |
| EBSI Over18 VC | `app/connect/connect-flow.tsx` | 1.5s sleep |
| Video consultation | consultation room | Placeholder canvas |
| File storage | `app/api/uploads/route.ts` | Local disk under `/uploads` |

Stubs MUST stay self-contained and clearly labeled, so production swaps are
surgical.

## Scope Boundaries (MVP)

**In scope** — twelve views: Landing, Lawyer Directory, Lawyer Profile,
Connect Wallet + Role, Lawyer Verification, Client Home, Booking & Payment,
Consultation Room, Client Messages, Lawyer Dashboard, Request Review,
Profile Editor. Plus lawyer-side mirrors of consultation and messages, and
a `/client/cases` redirect.

**Out of scope** — reviews UI on the lawyer profile (placeholder copy
only), disputes inbox / juror flow, admin panel UI (a single
`/api/admin/verify-lawyer` endpoint covers it), notifications center, email
notifications.

When a design and the original product brief disagree, the design wins, and
the resolution is logged in the README. Recorded resolutions: tokenized EUR
over ETH; dual-wallet onboarding order; per-lawyer pricing kinds (HOURLY /
FIXED / SUBSCRIPTION / SUCCESS); twelve seeded lawyers spanning twelve EU
cities; reviews and disputes excluded.

## Engineering Workflow

- **Stack** is fixed by the design and the team: Next.js 15 App Router,
  React 19, TypeScript strict, Tailwind CSS v4, Prisma 6 + PostgreSQL,
  NextAuth v5 with SIWE Credentials, wagmi 2 + viem 2 + RainbowKit,
  shadcn-style primitives on Radix + CVA, react-hook-form + zod,
  lucide-react.
- **Schema** is the source of truth for shape. UI types follow Prisma
  models; API routes return Prisma-shaped JSON.
- **Validation** at every boundary — zod for forms, route handlers, and
  external inputs.
- **Tests** are Playwright end-to-end on the golden flows: sign-in,
  directory filter, booking, consultation complete, lawyer accept/decline.
- **Local dev** via `docker compose up -d` for Postgres, `npm run dev` for
  the app, seeded with twelve lawyers + four clients.

## Governance

This constitution supersedes feature-level decisions where they conflict.
Amendments require a recorded rationale in the spec that introduces the
change. The brand, currency, dual-wallet, and design-token principles are
non-negotiable for the MVP — touching them is a brand-level decision, not
a feature-level one.

**Version**: 1.0.0 | **Ratified**: 2026-05-08 | **Last Amended**: 2026-05-08
