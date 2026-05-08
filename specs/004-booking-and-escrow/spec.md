# Feature Specification: Booking & Smart-Contract Escrow

**Feature Branch**: `004-booking-and-escrow`
**Created**: 2026-05-08
**Status**: Draft
**Input**: Translation of `app/client/home/page.tsx`,
`app/client/book/[lawyerId]/page.tsx`,
`app/client/book/[lawyerId]/booking-form.tsx`,
`app/api/bookings/route.ts`, `app/api/bookings/[id]/accept/route.ts`,
`app/api/bookings/[id]/decline/route.ts`, and `lib/web3/escrow.ts`.

## User Scenarios & Testing

### User Story 1 — A client books and funds a consultation (Priority: P1)

A signed-in client picks a verified lawyer, chooses a date/time and a
30- or 60-minute duration, describes the case, and clicks "Confirm and
fund." The system writes a `REQUESTED` Booking row, simulates an
on-chain escrow funding tx, stores the tx hash, and routes the client
to the consultation room.

**Why this priority**: This is the revenue moment.

**Independent Test**: From `/lawyers/[id]`, click "Book a
consultation," fill the form with a 60-minute duration and a ≥20-char
description, confirm, and verify a Booking row exists with status
`REQUESTED`, the correct fees, an `escrowTxHash`, and a
`Conversation` row attached.

**Acceptance Scenarios**:

1. **Given** an authenticated client on
   `/client/book/[lawyerId]`, **When** they pick a date/time, a
   duration (30 or 60), a practice area, write a case description
   (≥20 chars), and click confirm, **Then** the system POSTs to
   `/api/bookings` with the lawyer's id and form data.
2. **Given** the booking POST, **When** the server processes it, **Then**
   it creates a Booking row with: `clientId` from session,
   `consultationFeeEUR` matching the lawyer's chosen-duration rate,
   `platformFeeEUR` = 5% of fee, `status = REQUESTED`,
   `escrowTxHash` from the stub escrow, and a sibling Conversation
   row linked via `bookingId`.
3. **Given** a successful booking, **When** the response returns,
   **Then** the client is hard-navigated to
   `/client/consultation/[bookingId]`.
4. **Given** a description shorter than 20 chars, **When** the client
   submits, **Then** they see an inline error and no row is created.

### User Story 2 — The client home greets and surfaces active work (Priority: P2)

A signed-in client lands at `/client/home` and sees a personalized
greeting, clickable practice-area categories that prefilter the
directory, an "Active consultation" card if any booking is in flight,
and a recommended-lawyers list.

**Why this priority**: Returning clients need a fast path back to
their work.

**Acceptance Scenarios**:

1. **Given** a returning client with one ACCEPTED booking,
   **When** they open `/client/home`, **Then** an "Active
   consultation" card with the lawyer's name and the scheduled time
   is shown, linking to the consultation room.
2. **Given** a client with no active bookings, **When** they open
   `/client/home`, **Then** the active card is hidden and the
   recommended-lawyers grid is the focal element.
3. **Given** the categories row, **When** the client clicks a
   category (Family / Estate / Property / Employment / Immigration /
   Business / Tax / IP), **Then** they land on `/lawyers` with that
   specialty pre-filtered.

### User Story 3 — The lawyer accepts or declines a request (Priority: P1)

A lawyer reviews an incoming `REQUESTED` booking on
`/lawyer/requests/[id]`, sees the anonymous client identifier, the
practice area, jurisdiction, time, and fee summary, and either accepts
or declines. The booking transitions to `ACCEPTED` or `DECLINED`.

**Why this priority**: Without this transition, escrow is held
indefinitely.

**Acceptance Scenarios**:

1. **Given** a `REQUESTED` booking owned by the signed-in lawyer,
   **When** they POST to `/api/bookings/[id]/accept`, **Then** the
   row transitions to `ACCEPTED` and the client sees the booking on
   their home as Active.
2. **Given** a `REQUESTED` booking, **When** the lawyer POSTs to
   `/api/bookings/[id]/decline`, **Then** the row transitions to
   `DECLINED` (the escrow refund flow is stubbed for the MVP).
3. **Given** a booking owned by a different lawyer, **When** any
   accept/decline POST is attempted, **Then** the response is 403.

### Edge Cases

- A client tries to book a `PENDING` lawyer — the booking page
  returns 404 (only VERIFIED lawyers are bookable).
- A client tries to book a slot in the past — the form rejects it
  (the default offered datetime is tomorrow at 10:30).
- The escrow stub is asked to fund twice for the same booking — only
  the first call writes a tx hash; the second is a no-op.
- A client navigates to another client's booking — the consultation
  room enforces ownership server-side.

## Requirements

### Functional Requirements

- **FR-001**: The booking form MUST present datetime, a 30/60-minute
  duration radio, a practice-area picker (Family, Estate, Property,
  Employment, Immigration, Business, Tax, IP), and a free-form case
  description.
- **FR-002**: The fee summary MUST show the consultation fee, a 5%
  platform fee, and the total in tokenized EUR. Currency is rendered
  via `formatEUR()` — never as ETH.
- **FR-003**: The system MUST create the Booking, fund the stubbed
  escrow, and create the linked Conversation in a single server
  request, then return the booking id.
- **FR-004**: The escrow stub (`createEscrow`) MUST simulate a 2s
  on-chain confirmation and return a fake 0x-prefixed 64-hex tx hash.
- **FR-005**: The Conversation MUST be created with the client and
  the lawyer's user as the two participants.
- **FR-006**: The lawyer accept route MUST verify the requesting
  user owns the LawyerProfile attached to the booking before
  transitioning state.
- **FR-007**: The Booking status state machine is: `REQUESTED` →
  (`ACCEPTED` | `DECLINED`); `ACCEPTED` → (`IN_PROGRESS` |
  `CANCELLED`); `IN_PROGRESS` → (`COMPLETED` | `DISPUTED`).
- **FR-008**: The client home page MUST surface the most recent
  ACCEPTED or IN_PROGRESS booking as the Active card, and a list of
  three recommended VERIFIED lawyers.
- **FR-009**: All public copy in this surface MUST avoid "smart
  contract escrow" — use "secure payment held until your
  consultation completes" or similar.

### Key Entities

- **Booking** — `id`, `clientId`, `lawyerProfileId`, `scheduledAt`,
  `durationMinutes` (30 | 60), `consultationFeeEUR`, `platformFeeEUR`
  (5% of consultation), `status` (BookingStatus enum), `practiceArea`,
  `caseDescription`, `escrowTxHash` (set on funding),
  `escrowReleaseHash` (set on completion — see spec 005), `notes`,
  timestamps.
- **Conversation** — `id`, `bookingId` (unique nullable), participants
  (the client + the lawyer's user), `messages[]`.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A client can complete the booking flow in under 60
  seconds with the default values.
- **SC-002**: 0 bookings exist without a paired Conversation row.
- **SC-003**: 100% of booking writes carry a non-null `escrowTxHash`.
- **SC-004**: The lawyer accept/decline transitions are atomic — the
  row is never left in an intermediate state on failure.

## Assumptions

- The 5% platform fee is computed client-side for display and
  re-derived server-side for write — the server is authoritative.
- The escrow contract is a stub. Production deploys a contract on a
  low-fee L2 (Polygon or Arbitrum recommended) with the surface area
  documented in `lib/web3/escrow.ts` (createEscrow, releaseEscrow,
  disputeEscrow, refundEscrow).
- Disputes are out of MVP scope. The schema retains the `DISPUTED`
  status and a `disputeEscrow` stub for forward-compatibility.
- Recommended lawyers in the client home are simply the most recent
  three VERIFIED rows; personalization is out of MVP scope.
