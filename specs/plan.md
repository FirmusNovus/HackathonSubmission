# Implementation Plan: Firmus Novus MVP

**Branch**: `main` (single delivery)
**Date**: 2026-05-08
**Spec**: see `specs/001-marketing-and-discovery` through
`specs/006-lawyer-workspace`

This plan describes the technology choices that apply across all six
feature specs. Per-feature plans (with research, data-model, and
quickstart sections) can be expanded by running `/speckit-plan`
inside each feature directory.

## Summary

Firmus Novus is a Next.js 15 App Router application backed by
PostgreSQL via Prisma 6. Authentication is wallet-based (SIWE) through
NextAuth v5. Web3 integration is real for wallet connection
(wagmi + viem + RainbowKit) but stubbed for the EBSI Trusted Issuers
Registry, the Over18 VC exchange, and the smart-contract escrow — each
stub lives behind a clearly-named seam in `lib/web3/*` ready for the
production swap.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict). React 19. Node 20+
**Primary Dependencies**:
- `next@15.1` (App Router, server components by default)
- `react@19`, `react-dom@19`
- `@prisma/client@6`, `prisma@6`
- `next-auth@5` (beta), `siwe@3`
- `wagmi@2`, `viem@2`, `@rainbow-me/rainbowkit@2`
- `@tanstack/react-query@5`
- `tailwindcss@4` with `@theme` token block
- Radix primitives + `class-variance-authority` + `tailwind-merge`
- `react-hook-form@7` + `zod@3` + `@hookform/resolvers`
- `lucide-react` (icons; **no emoji**)

**Storage**: PostgreSQL 16 (local via `docker-compose.yml`). Schema in
`prisma/schema.prisma`. All money fields are `Decimal(10,2)` and named
`*EUR`.

**Testing**: Playwright E2E (`npm run test:e2e`). Type checking via
`tsc --noEmit`. Lint via `next lint`.

**Target Platform**: Modern desktop browsers (Chromium / Firefox /
Safari). Mobile-responsive but desktop is the primary form factor for
the consultation room demo.

**Project Type**: Web application (Next.js full-stack — frontend +
API routes in one repo).

**Performance Goals**:
- Landing TTFB < 800ms on warm Postgres in dev.
- Lawyer dashboard data batch < 1.2s end-to-end.
- Chat message round-trip < 6s (5s poll + render budget).

**Constraints**:
- WCAG AA contrast everywhere (constitution §V).
- Two accent colors only — teal #14B8A6, gold #C9A961 — gold under
  5% of visual weight.
- No emoji as UI elements anywhere.
- Wallet addresses always truncated and monospaced.
- All currency strings rendered through `formatEUR()`.

**Scale/Scope**:
- 12 routes shipping for the MVP (12 client/marketing views + lawyer
  mirrors + admin endpoint).
- 12 seeded VERIFIED + PENDING lawyers spanning 12 EU cities.
- 4 seeded clients with bookings and message threads.

## Constitution Check

This plan honors the seven constitution principles:

1. **Brand & Naming** — only "Firmus Novus" appears in user-facing
   strings; "Lex Nova" is forbidden. Pre-merge grep gate: `rg -i 'lex
   nova' app components lib` MUST return no matches.
2. **Tokenized EUR, Not ETH** — every money field in the schema is
   `*EUR`; UI rendering goes through `formatEUR()`. Pre-merge gate:
   `rg -i '\\bETH\\b|ether' app components` MUST not match in
   user-facing copy.
3. **Dual-Wallet Identity Model** — implemented in
   `app/connect/connect-flow.tsx`. The order (identity → Over18 →
   transaction) is encoded in the `Stage` state machine.
4. **Quiet Web3, Loud Trust** — copy review gate before any new view
   ships: hero/CTA strings must not contain "smart contract,"
   "blockchain," "escrow" — replaced with "secure payment held until
   your consultation completes."
5. **Design Tokens & Visual Discipline** — Tailwind v4 `@theme` block
   in `app/globals.css` is the source of truth. Components import
   tokens by class name only; no hardcoded hex values outside the
   theme block.
6. **Role-Gated Routing** — `middleware.ts` matcher covers
   `/client/:path*`, `/lawyer/:path*`, `/verify-lawyer`. Pages
   double-check via `requireClient()` / `requireLawyer()` from
   `lib/auth/session.ts`.
7. **Real Persistence, Stubbed Crypto Plumbing** — every stub is
   isolated under `lib/web3/{escrow,ebsi}.ts` with a `TODO(production)`
   comment block describing the swap.

## Project Structure

### Documentation

```text
specs/
├── plan.md                           # This file (cross-feature plan)
├── 001-marketing-and-discovery/
│   └── spec.md
├── 002-onboarding-and-auth/
│   └── spec.md
├── 003-lawyer-verification/
│   └── spec.md
├── 004-booking-and-escrow/
│   └── spec.md
├── 005-consultation-and-messaging/
│   └── spec.md
└── 006-lawyer-workspace/
    └── spec.md
```

Each feature directory will gain `plan.md`, `tasks.md`, `research.md`,
`data-model.md`, `quickstart.md`, and `contracts/` as the team runs
`/speckit-plan` and `/speckit-tasks` for that slice.

### Source Code (repository root, when implementation lives alongside)

```text
app/
  page.tsx                            # 1. Landing                — spec 001
  lawyers/
    page.tsx                          # 2. Directory             — spec 001
    directory-filters.tsx             #                          — spec 001
    [id]/page.tsx                     # 3. Lawyer profile        — spec 001
  connect/
    page.tsx                          # 4. Connect Wallet + Role — spec 002
    connect-flow.tsx                  #                          — spec 002
  verify-lawyer/
    page.tsx                          # 5. Lawyer Verification   — spec 003
    verify-lawyer-form.tsx            #                          — spec 003
  client/
    layout.tsx                        # auth gate (CLIENT)
    home/page.tsx                     # 6. Client Home           — spec 004
    book/[lawyerId]/
      page.tsx                        # 7. Booking & Payment     — spec 004
      booking-form.tsx                #                          — spec 004
    consultation/[bookingId]/
      page.tsx                        # 8. Consultation Room     — spec 005
      consultation-room.tsx           #                          — spec 005
    messages/
      page.tsx                        # 9. Messages              — spec 005
      messages-view.tsx               #                          — spec 005
    cases/page.tsx                    # → /client/home (helper redirect)
  lawyer/
    layout.tsx                        # auth gate (LAWYER)
    dashboard/page.tsx                # 10. Dashboard            — spec 006
    requests/
      page.tsx                        # list (helper)            — spec 006
      [id]/page.tsx                   # 11. Request Review       — spec 006
      [id]/request-actions.tsx        #                          — spec 006
    profile/edit/
      page.tsx                        # 12. Profile Editor       — spec 006
      profile-editor.tsx              #                          — spec 006
    consultation/[bookingId]/page.tsx # mirror of 8              — spec 005
    messages/page.tsx                 # mirror of 9              — spec 005
  api/
    auth/[...nextauth]/route.ts       # NextAuth handlers        — spec 002
    auth/nonce/route.ts               # one-time SIWE nonces     — spec 002
    lawyers/route.ts                  # directory data           — spec 001
    lawyers/[id]/route.ts             # profile data             — spec 001
    bookings/route.ts                 # create booking           — spec 004
    bookings/[id]/accept/route.ts     # lawyer accept            — spec 004
    bookings/[id]/decline/route.ts    # lawyer decline           — spec 004
    bookings/[id]/complete/route.ts   # mark complete            — spec 005
    messages/route.ts                 # send + poll              — spec 005
    uploads/route.ts                  # credential uploads       — spec 003
    uploads/[...path]/route.ts        # auth-checked downloads   — spec 003
    verification/route.ts             # submit credentials       — spec 003
    admin/verify-lawyer/route.ts      # admin verify (key gate)  — spec 003
    lawyer/profile/route.ts           # PATCH own profile        — spec 006
  dev/sign-in/route.ts                # dev-mode shortcut        — spec 002
components/
  ui/                                 # Radix-based primitives (Button, Input, …)
  firmus/                             # FirmusLogo, EBSIBadge, LawyerCard,
                                      # NetworkPattern, EscrowStatusIndicator,
                                      # AvatarBubble, EmptyState, …
  layout/                             # MarketingNav, AppTopBar, Footer, AuthShell
lib/
  db/client.ts                        # Prisma singleton
  auth/{config.ts,session.ts}         # NextAuth + SIWE + role helpers
  web3/{config.ts,escrow.ts,ebsi.ts}  # wagmi config; stubs (constitution §VII)
  utils/{cn.ts,format.ts,anonymize.ts}
prisma/
  schema.prisma                       # see Key Entities across all six specs
  seed.ts                             # 12 lawyers + 4 clients + bookings
middleware.ts                         # role-gated route matcher
```

**Structure Decision**: The project ships as a single Next.js
application — frontend, API routes, and seed data live together.
This matches the existing implementation and keeps the hackathon-
scope deployment surface to one container.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Two wallets per user | EBSI identity VCs and tx-wallet escrow are architecturally distinct concerns; conflating them would force one wallet to hold both keys and trust contexts | A single-wallet flow loses either the EBSI VC story or the user-controlled tx wallet — both are non-negotiable for the trust narrative |
| Polling chat (5s) instead of WebSockets | Hackathon scope; polling is one Prisma query and zero infra | WebSockets need a separate process or platform feature beyond the Vercel/Next.js sweet spot — deferred to v1.1 |
| Local-disk file storage | Zero ops for the hackathon demo | S3 / R2 with signed URLs is a one-day swap once a bucket is provisioned (constitution §VII flags this) |
| Stubbed escrow + EBSI | Demoing on conference Wi-Fi against real chains and real Trusted Issuers Registry endpoints is brittle | The stubs preserve the API surface and timing characteristics; production swap is surgical at named seams |
