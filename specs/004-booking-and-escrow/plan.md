# Implementation Plan: Booking & Smart-Contract Escrow

**Branch**: `004-booking-and-escrow` | **Date**: 2026-05-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-booking-and-escrow/spec.md`

## Summary

The conversion path: a client describes a case on
`/client/book/[lawyerId]`, the server creates a `REQUESTED` Booking, calls
the stubbed `createEscrow` (returns a fake tx hash after a 2-s delay),
creates a paired Conversation, and hard-navigates to the consultation
room. Lawyer-side Accept / Decline routes transition the booking
forward. Client home (`/client/home`) surfaces active bookings and
recommended VERIFIED lawyers.

## Technical Context

**Language/Version**: TypeScript 5.7 strict
**Primary Dependencies**: `next@15.1`, `react-hook-form@7`, `zod@3`,
`@prisma/client@6`, `next-auth@5`, `viem@2` (production swap target)
**Storage**: PostgreSQL — `Booking`, `Conversation`, `LawyerProfile`,
`User`
**Testing**: Playwright (`tests/e2e/booking.spec.ts`); contract tests
on the four routes
**Target Platform**: Modern browsers
**Project Type**: Web application
**Performance Goals**: Booking POST round-trip < 3 s including the 2-s
escrow stub delay; client home initial render < 1 s
**Constraints**: 5% platform fee derived server-side (client display
is advisory); booking writes are atomic with their Conversation row;
state machine: `REQUESTED → ACCEPTED | DECLINED`,
`ACCEPTED → IN_PROGRESS | CANCELLED`,
`IN_PROGRESS → COMPLETED | DISPUTED`
**Scale/Scope**: Three pages (home, book, request review listing),
four API routes (POST `/bookings`, POST `/bookings/[id]/accept`, POST
`/bookings/[id]/decline`, plus list reads)

## Constitution Check

| Principle | Compliance |
|---|---|
| I. Brand & Naming | Booking page says "Confirm and fund" / "Funds release on completion" — no Lex Nova references. ✅ |
| II. Tokenized EUR | Fee summary computed in EUR; `formatEUR()` for every price; no ETH copy. ✅ |
| III. Dual-Wallet Identity | The booking flow assumes the client has completed onboarding and has a wallet on session. Escrow funding is a tx-wallet operation (stubbed). ✅ |
| IV. Quiet Web3, Loud Trust | "Funds are released to the lawyer only when the consultation completes." — the escrow indicator is visual, not jargon-loaded. ✅ |
| V. Design Tokens | EscrowStatusIndicator uses teal highlight on the active node; lawyer-card avatar uses gold ring (verified). lucide icons. ✅ |
| VI. Role-Gated Routing | `/client/home` and `/client/book/...` are CLIENT-only; the lawyer accept/decline routes verify ownership server-side. ✅ |
| VII. Real Persistence, Stubbed Plumbing | Booking + Conversation rows are real; `createEscrow` / `releaseEscrow` / `disputeEscrow` are the labelled stubs in `lib/web3/escrow.ts` with documented production surface area. ✅ |

No violations.

## Project Structure

### Documentation (this feature)

```text
specs/004-booking-and-escrow/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── bookings.md             # POST /api/bookings
│   ├── booking-accept.md       # POST /api/bookings/[id]/accept
│   └── booking-decline.md      # POST /api/bookings/[id]/decline
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
app/
├── client/
│   ├── home/page.tsx                     # Greeting, categories, active card, recommended
│   ├── book/[lawyerId]/
│   │   ├── page.tsx                      # Server component (lawyer fetch, auth)
│   │   └── booking-form.tsx              # Client form + escrow stub UI
│   └── cases/page.tsx                    # → /client/home redirect
└── api/bookings/
    ├── route.ts                          # POST create
    ├── [id]/accept/route.ts              # POST accept
    └── [id]/decline/route.ts             # POST decline
components/firmus/
├── escrow-status-indicator.tsx
└── lawyer-card.tsx                        # reused from spec 001
lib/
├── web3/escrow.ts                        # createEscrow stub + production surface comment
└── utils/format.ts                       # formatEUR
prisma/schema.prisma                      # Booking, Conversation, BookingStatus enum
tests/e2e/booking.spec.ts
```

**Structure Decision**: Single Next.js app. The escrow stub is one
file (`lib/web3/escrow.ts`) with the production Solidity surface
documented in a top-of-file comment block — see constitution VII.

## Complexity Tracking

> Constitution Check passes — no violations to justify.
