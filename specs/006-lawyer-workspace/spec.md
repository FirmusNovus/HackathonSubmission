# Feature Specification: Lawyer Workspace

**Feature Branch**: `006-lawyer-workspace`
**Created**: 2026-05-08
**Status**: Draft
**Input**: Translation of `app/lawyer/dashboard/page.tsx`,
`app/lawyer/requests/[id]/page.tsx`,
`app/lawyer/requests/[id]/request-actions.tsx`,
`app/lawyer/profile/edit/page.tsx`,
`app/lawyer/profile/edit/profile-editor.tsx`,
`app/api/lawyer/profile/route.ts`, and
`lib/utils/anonymize.ts`.

## User Scenarios & Testing

### User Story 1 — Lawyer dashboard shows the day at a glance (Priority: P1)

A signed-in lawyer lands on `/lawyer/dashboard` and sees: a greeting,
four stats (pending requests, upcoming this week, active consultations,
30-day net earnings), today's schedule, and a "Recent requests" list
linking to per-request review pages.

**Why this priority**: This is where lawyers spend their attention.

**Independent Test**: Sign in as a seeded lawyer with at least one
`REQUESTED` booking and one `ACCEPTED` booking scheduled today. The
dashboard renders the four stat cards with non-zero values and lists
the request and the day's session.

**Acceptance Scenarios**:

1. **Given** a lawyer with no LawyerProfile, **When** they open
   `/lawyer/dashboard`, **Then** they see an empty-state directing
   them to `/verify-lawyer`.
2. **Given** a verified lawyer, **When** the dashboard renders,
   **Then** the four stats are computed in a single Promise.all from
   the database: pending count (REQUESTED), upcoming-this-week
   (ACCEPTED in next 7 days), active count (ACCEPTED or
   IN_PROGRESS), 30-day net earnings (sum of fee minus platform fee
   for COMPLETED in last 30 days).
3. **Given** the dashboard, **When** today's schedule is loaded,
   **Then** it lists bookings with `scheduledAt` in [start-of-today,
   start-of-tomorrow), sorted ascending, including each client.
4. **Given** the recent-requests list, **When** rendered, **Then** it
   shows the five most recent `REQUESTED` bookings, with the client
   identifier anonymized.

### User Story 2 — Lawyer reviews and acts on a request (Priority: P1)

The lawyer opens `/lawyer/requests/[id]` and sees an anonymized client
ID, the practice area, jurisdiction, scheduled time and duration, the
case description, and a fee breakdown showing the consultation fee,
the platform fee, and the net to the lawyer. They click Accept or
Decline; the booking transitions and they return to the dashboard.

**Why this priority**: This is the supply-side decision moment.

**Acceptance Scenarios**:

1. **Given** a `REQUESTED` booking owned by the signed-in lawyer,
   **When** they open the request page, **Then** the client field
   shows only an anonymous identifier derived from the wallet via
   `anonymousClientId(walletAddress)` — not the client's name.
2. **Given** the fee breakdown, **When** rendered, **Then** it shows
   `consultationFeeEUR`, `platformFeeEUR`, and `consultationFeeEUR -
   platformFeeEUR` as the net.
3. **Given** the lawyer is not the booking's owner, **When** they
   open the page, **Then** the response is 404.
4. **Given** Accept or Decline is clicked, **When** the action
   resolves, **Then** the booking state transitions per spec 004
   FR-007 and the user is redirected to the dashboard.

### User Story 3 — Lawyer edits their public profile with a live preview (Priority: P2)

The lawyer opens `/lawyer/profile/edit` and edits headline, bio,
specialties, languages, jurisdictions, pricing kind, pricing items,
hourly rate, consultation rates. A preview pane mirrors how the
profile will appear to clients. A sticky save bar persists changes
on confirm.

**Why this priority**: Profile freshness drives discovery; lawyers
must self-serve.

**Acceptance Scenarios**:

1. **Given** a verified lawyer, **When** they edit a field, **Then**
   the live preview updates without a save.
2. **Given** a save, **When** PATCH `/api/lawyer/profile` returns
   200, **Then** the LawyerProfile is updated and a toast confirms.
3. **Given** invalid input (e.g. negative `hourlyRateEUR`), **When**
   save is attempted, **Then** zod surfaces the error and no write
   occurs.
4. **Given** non-hourly pricing (`FIXED` / `SUBSCRIPTION` /
   `SUCCESS`), **When** the editor renders, **Then** it shows a
   `pricingItems` editor where the lawyer can list service
   packages: `{ title, desc, price, unit }`.

### Edge Cases

- The lawyer's request URL points at a booking that has already been
  accepted/declined — the page renders the resolved state, no
  action buttons.
- The dashboard's Promise.all has one branch fail — the page is
  resilient: the failing card shows a small error pill and the
  others render normally.
- Profile save is attempted while the row is `PENDING` — allowed;
  the data is editable regardless of verification state, but the
  profile only surfaces publicly when `VERIFIED`.

## Requirements

### Functional Requirements

- **FR-001**: `/lawyer/dashboard` MUST be gated to authenticated
  users with `role = LAWYER`.
- **FR-002**: The dashboard MUST compute, in one parallel batch,
  pending count, upcoming-this-week count, active count, today's
  schedule (with client included), the five most recent requests
  (with client included), and the 30-day net earnings.
- **FR-003**: 30-day net earnings = sum of
  `consultationFeeEUR - platformFeeEUR` over `status = COMPLETED`
  bookings updated in the last 30 days.
- **FR-004**: All client-facing identifiers shown to a lawyer
  pre-acceptance MUST be anonymized via
  `anonymousClientId(walletAddress)`. The client's name and email
  MUST NOT appear on the request review page.
- **FR-005**: `/lawyer/requests/[id]` MUST verify booking ownership
  via `booking.lawyerProfile.userId === session.user.id` and 404 on
  mismatch.
- **FR-006**: Accept and Decline MUST POST to
  `/api/bookings/[id]/accept` and `/api/bookings/[id]/decline`
  respectively (covered by spec 004) and redirect to
  `/lawyer/dashboard` on success.
- **FR-007**: `/lawyer/profile/edit` MUST present a tabbed editor
  with a live preview pane and a sticky save bar.
- **FR-008**: `PATCH /api/lawyer/profile` MUST validate inputs with
  zod, restrict updates to the signed-in lawyer's own profile, and
  return the updated row.
- **FR-009**: For non-HOURLY pricing kinds, the editor MUST allow
  managing a `pricingItems` JSON array of `{ title, desc, price,
  unit }` rows.

### Key Entities

- **LawyerProfile** — see specs 001 and 003 for the field surface.
  This spec exercises the editable subset:
  `headline`, `bio`, `specialties[]`, `languages[]`,
  `jurisdictions[]`, `pricingKind`, `pricingHeadline`,
  `hourlyRateEUR`, `consultationRate30`, `consultationRate60`,
  `pricingItems`, `tags[]`, `availability`.
- **Booking** — read-side projections only; status transitions live
  in spec 004. Relevant fields here: `status`, `scheduledAt`,
  `durationMinutes`, `consultationFeeEUR`, `platformFeeEUR`,
  `practiceArea`, `caseDescription`.

## Success Criteria

### Measurable Outcomes

- **SC-001**: The dashboard renders all four stats and the day's
  schedule in under 1.2s on a warm dev Postgres.
- **SC-002**: 0 instances of a client's real name leaking onto a
  pre-accept lawyer request review page.
- **SC-003**: 100% of profile edits made by the owning lawyer
  succeed; 100% of edits attempted on another lawyer's row fail
  with 403.
- **SC-004**: The live preview matches the public profile pixel-for-
  pixel for the editable fields under MVP layout assumptions.

## Assumptions

- The `anonymousClientId()` helper produces a stable, wallet-derived
  identifier — same wallet → same identifier — so the lawyer can
  correlate repeat requests without learning the client's identity
  pre-accept.
- After acceptance, the client's name becomes visible inside the
  consultation room and the messaging view; pre-accept anonymity
  is the only privacy boundary.
- The Reviews tab on the public profile remains a placeholder
  (constitution scope boundary). The editor does not surface review
  management.
- Availability JSON shape is a free-form blob in the schema; the
  editor accepts a simple weekday-and-hours grid for the MVP.
