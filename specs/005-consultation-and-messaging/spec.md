# Feature Specification: Consultation Room & Messaging

**Feature Branch**: `005-consultation-and-messaging`
**Created**: 2026-05-08
**Status**: Draft
**Input**: Translation of
`app/client/consultation/[bookingId]/page.tsx`,
`app/client/consultation/[bookingId]/consultation-room.tsx`,
`app/lawyer/consultation/[bookingId]/page.tsx`,
`app/client/messages/page.tsx`,
`app/client/messages/messages-view.tsx`,
`app/lawyer/messages/page.tsx`, `app/api/messages/route.ts`, and
`app/api/bookings/[id]/complete/route.ts`.

## User Scenarios & Testing

### User Story 1 — Client and lawyer meet in the consultation room (Priority: P1)

The client opens `/client/consultation/[bookingId]` and the lawyer
opens `/lawyer/consultation/[bookingId]`. Each sees a dark-mode video
room with a placeholder canvas, mute / camera / screen-share / hang-up
controls, and a real chat panel that polls the database every five
seconds. Either party can mark the consultation complete, which
releases escrow and transitions the booking to `COMPLETED`.

**Why this priority**: This is where the consultation actually
happens — the entire booking flow ends here.

**Independent Test**: Sign in as the client on a paired booking, send
a chat message; sign in as the lawyer on the mirror route, see the
message within 5s. Click "Mark Complete" — the booking flips to
`COMPLETED` and the escrow stub records a release hash.

**Acceptance Scenarios**:

1. **Given** a client and a lawyer paired on an `ACCEPTED` booking,
   **When** each opens their consultation route, **Then** both see a
   dark theme (`bg-navy-950`), the Firmus logo in light mode, the
   booking metadata (practice area, scheduled time, duration), and
   four controls: mute, camera, screen-share, hang-up.
2. **Given** the chat panel, **When** a participant sends a message,
   **Then** it persists via `POST /api/messages` against the
   booking's `Conversation` and appears in the other party's chat
   within 5s (5-second polling interval).
3. **Given** either party clicks "Mark Complete," **When** the POST
   to `/api/bookings/[id]/complete` returns, **Then** the booking
   transitions to `COMPLETED`, the escrow stub returns an
   `escrowReleaseHash`, and the user is redirected to their role
   home (`/client/home` or `/lawyer/dashboard`).
4. **Given** a booking owned by another user, **When** any
   consultation route loads, **Then** the response is 404 — server
   verifies booking ownership before rendering.

### User Story 2 — Threaded messaging outside a consultation (Priority: P2)

A client opens `/client/messages` and sees a threads list (one per
conversation) with the last-message preview, plus an active
conversation pane with the full message history. The lawyer's mirror
is `/lawyer/messages`.

**Why this priority**: Users need to message before and after the
consultation slot — scheduling, follow-ups, attachments.

**Acceptance Scenarios**:

1. **Given** a client with three conversations, **When** they open
   `/client/messages`, **Then** all three threads are listed with
   the counterparty name and last-message preview.
2. **Given** an open thread, **When** the user types and sends,
   **Then** the message persists and renders in the thread within
   5s for the other side.
3. **Given** a conversation with no messages, **When** opened,
   **Then** an empty-state prompt invites the user to send the first
   message.

### User Story 3 — Mark Complete releases escrow exactly once (Priority: P1)

The "Mark Complete" action is idempotent — invoking it twice on the
same booking does not double-release escrow.

**Why this priority**: Escrow is money; double-spend is the worst
possible outcome.

**Acceptance Scenarios**:

1. **Given** a booking with status `ACCEPTED` or `IN_PROGRESS`,
   **When** the first "Mark Complete" arrives, **Then** the row
   flips to `COMPLETED`, `escrowReleaseHash` is set, and a 200
   response is returned.
2. **Given** a booking already `COMPLETED`, **When** "Mark Complete"
   is invoked again, **Then** the response is a no-op (200 with the
   existing release hash) — no second escrow release call is made.

### Edge Cases

- A user opens a consultation route for a booking that is
  `REQUESTED` (not yet accepted) — the route shows a "waiting for
  lawyer" placeholder rather than the room.
- The chat polling fails transiently — the UI does not crash; the
  next poll recovers.
- A non-participant POSTs to `/api/messages` with another user's
  conversation id — the request is rejected as 403.

## Requirements

### Functional Requirements

- **FR-001**: The consultation room MUST be rendered in dark mode
  (`bg-navy-950`) for both client and lawyer routes.
- **FR-002**: The chat panel MUST poll `GET /api/messages?
  conversationId=…` every 5 seconds while the room is open.
- **FR-003**: `POST /api/messages` MUST verify the requester is a
  participant of the target Conversation before writing.
- **FR-004**: A Message row carries `conversationId`, `senderId`,
  `content`, optional `attachmentUrl` and `attachmentType`, and a
  `createdAt` timestamp; messages are ordered by
  `(conversationId, createdAt)`.
- **FR-005**: "Mark Complete" MUST: (a) verify the requesting user is
  the booking's client or the booking's lawyer's user, (b) call
  `releaseEscrow(bookingId)`, (c) write `escrowReleaseHash` and flip
  status to `COMPLETED`, (d) be idempotent.
- **FR-006**: The "Mark Complete" action MUST redirect the caller to
  their role home on success.
- **FR-007**: The video controls (mute / camera / screen-share /
  hang-up) MUST render and be keyboard-reachable, even though video
  itself is a placeholder canvas in the MVP.
- **FR-008**: The messages views MUST surface the counterparty's
  name (the lawyer for clients, the anonymized client identifier for
  lawyers) on each thread.

### Key Entities

- **Conversation** — `id`, optional `bookingId` (unique), participants
  (User[] many-to-many), `createdAt`, `updatedAt`.
- **Message** — `id`, `conversationId` (cascade delete), `senderId`,
  `content`, `attachmentUrl?`, `attachmentType?`, `createdAt`. Indexed
  on `(conversationId, createdAt)`.

## Success Criteria

### Measurable Outcomes

- **SC-001**: New chat messages appear on the other party's screen in
  under 6 seconds (5s poll + render budget).
- **SC-002**: 100% of "Mark Complete" calls on already-completed
  bookings are no-ops — exactly one escrow release per booking.
- **SC-003**: 0 successful `POST /api/messages` calls from
  non-participants.
- **SC-004**: The dark-mode consultation room maintains WCAG AA
  contrast for all text and chrome.

## Assumptions

- Real video is a stub for the MVP. Production picks one of: Daily
  (fastest integration), Huddle01 (on-chain story), or LiveKit
  (open-source self-host). See README "Stubbed (TODOs in code)".
- The 5-second poll is a deliberate MVP simplification. Production
  swaps it for WebSockets or Server-Sent Events.
- Attachment handling for messages reuses the same upload API as
  credentials but under a separate path; this is a v1.1 detail and
  out of immediate MVP scope.
- The "lawyer side" of the consultation room is a thin wrapper that
  reuses the same `ConsultationRoom` component — only the
  `/lawyer/...` route differs.
