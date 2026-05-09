# Implementation Plan: Consultation Room & Messaging

**Branch**: `005-consultation-and-messaging` | **Date**: 2026-05-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-consultation-and-messaging/spec.md`

## Summary

A dark-mode video room (placeholder canvas + real chat) shared by both
participants of an ACCEPTED booking, plus a threaded messaging surface
for asynchronous follow-ups. Chat polls Postgres every 5 s; the
"Mark Complete" button is idempotent and releases the stubbed escrow
exactly once. The lawyer-side routes are thin wrappers around the same
`ConsultationRoom` component used by the client.

## Technical Context

**Language/Version**: TypeScript 5.7 strict
**Primary Dependencies**: `next@15.1`, `react@19`, `@prisma/client@6`,
`next-auth@5`, `lucide-react`
**Storage**: PostgreSQL — `Conversation`, `Message`, `Booking`
**Testing**: Playwright two-tab consultation test
(`tests/e2e/consultation.spec.ts`); idempotency unit test for
`/bookings/[id]/complete`
**Target Platform**: Modern browsers
**Project Type**: Web application
**Performance Goals**: Chat round-trip < 6 s (5-s poll + render);
"Mark Complete" round-trip < 2 s
**Constraints**: Idempotent completion; participant check on every
message POST; chat polling stops when the route unmounts
**Scale/Scope**: Two routes per side (consultation, messages) + one
shared component, four API routes (`GET /messages`, `POST /messages`,
`POST /bookings/[id]/complete`, plus the consultation-page server
fetch)

## Constitution Check

| Principle | Compliance |
|---|---|
| I. Brand & Naming | Consultation top bar uses `<FirmusLogo light />`. ✅ |
| II. Tokenized EUR | No prices on this surface — rule upheld vacuously. ✅ |
| III. Dual-Wallet Identity | Both participants have completed onboarding and the booking is `ACCEPTED`; no wallet flow inside the room. ✅ |
| IV. Quiet Web3, Loud Trust | Top-bar copy: `🔒 secure` + `● live` — no "smart contract" language. The completion CTA is "Mark Complete," not "Release escrow." ✅ |
| V. Design Tokens | Dark navy-950 stage; chat bubbles use teal-500 for "you" and white-0 for counterpart. lucide icons on every control with `aria-label`. WCAG AA contrast preserved on dark. ✅ |
| VI. Role-Gated Routing | `/client/consultation/[bookingId]` is CLIENT-only; the lawyer mirror lives under `/lawyer/...`. Both verify booking ownership server-side. ✅ |
| VII. Real Persistence, Stubbed Plumbing | Messages are real Postgres rows; video is a placeholder canvas pending a Daily/Huddle01/LiveKit swap; `releaseEscrow` is the labelled stub. ✅ |

No violations.

## Project Structure

### Documentation (this feature)

```text
specs/005-consultation-and-messaging/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── messages.md                   # GET + POST /api/messages
│   └── booking-complete.md           # POST /api/bookings/[id]/complete
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
app/
├── client/
│   ├── consultation/[bookingId]/
│   │   ├── page.tsx                       # Server component (auth, ownership)
│   │   └── consultation-room.tsx          # Shared dark-mode UI
│   └── messages/
│       ├── page.tsx
│       └── messages-view.tsx
├── lawyer/
│   ├── consultation/[bookingId]/page.tsx  # Mirror — reuses ConsultationRoom
│   └── messages/page.tsx                  # Mirror
└── api/
    ├── messages/route.ts                  # GET (poll) + POST (send)
    └── bookings/[id]/complete/route.ts    # POST mark complete (idempotent)
lib/
└── web3/escrow.ts                         # releaseEscrow stub
prisma/schema.prisma                       # Conversation, Message, Booking
tests/e2e/consultation.spec.ts
```

**Structure Decision**: Single Next.js app. The dark consultation
surface and the light messages surface share no chrome — they are
different layouts on the same data — so they ship as siblings rather
than a shared shell.

## Complexity Tracking

> Constitution Check passes — no violations to justify.
