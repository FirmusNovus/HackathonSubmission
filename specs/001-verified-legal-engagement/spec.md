# Feature Specification: Firmus Novus — Verified Legal Engagement

**Feature Branch**: `001-verified-legal-engagement`
**Created**: 2026-05-08
**Status**: Draft
**Input**: User description: see [User Description](#user-description) below.

## User Description

The user requested a unified specification produced from several
internal input sets that disagreed on terminology and on how the
structured payment artifact behaved. The user asked for explicit
consultation on each mismatch before any spec was written and required
that the result read as a fully new project. Testing is hosted via
ngrok.

The user resolved five design decisions before this spec was written
(2026-05-08):

1. Brand naming: only the title carries the public name; the body
   uses neutral language ("the platform").
2. The structured payment artifact is named **proposal**. No
   alternative names are used.
3. Clients initiate **consultation requests**. Consultations are
   free or paid (lawyer's choice). Paid consultations fund escrow
   on creation; free ones do not.
4. Lawyers initiate **proposals** during the engagement for
   additional work. Each proposal funds independently in escrow
   before release.
5. The dispute mechanism is asymmetric: client may dispute any
   funded or delivered proposal immediately; lawyer may only
   escalate after a 30-day cooldown that starts on the on-chain
   delivery action. This asymmetry is enforced on chain, not by
   platform policy.

## Clarifications

### Session 2026-05-08

- Q: How does the platform resolve concurrent state-changing actions on the same proposal? → A: Chain-as-arbiter. Both parties broadcast independently; the contract's `require()` checks reject the second transaction; the loser's UI surfaces "state changed; reload" after the on-chain event is observed. No server-side locking.
- Q: How does the platform behave when the deployed chain is unreachable? → A: Health-checked, eventually-consistent. Before any wallet-sign action, the platform pings the chain; if unreachable, the action is disabled with a clear "chain unavailable" banner so no user wastes gas. After successful broadcast, the indexer reconciles transparently when it catches up.
- Q: Which UI languages does the platform support for the MVP? → A: English only. Lawyers' `languages[]` field (the languages they offer counsel in) still supports any language, independently of UI chrome. Multi-language UI is production trajectory.
- Q: What is a free consultation request's timeout / cancel policy? → A: 7-day auto-expire if the lawyer takes no action; the client may also cancel manually at any time before that. Paid consultations follow the same timeout but cancellation goes through the mutual-refund flow because escrow is already funded.
- Q: Is account deletion / GDPR right-to-erasure in scope for the MVP? → A: Out of scope. Documented under production trajectory; the MVP ships without an account-delete surface. Plan-time discussion will name the on-chain immutability carve-out (capability attestations, transcript anchors) so the production-trajectory implementation knows what it's working with.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Visitor finds a verified lawyer (Priority: P1)

A first-time visitor lands on the public site, reads the value
proposition (verified European legal counsel, on-chain trust signal),
browses the lawyer directory, narrows by specialty / language /
pricing model, and reads a lawyer's full profile.

**Why this priority**: discovery is the platform's marketing surface.
Without it nobody books anything.

**Independent Test**: visit `/` unauthenticated; the hero shows
"Verified Legal Counsel, On-Chain." with a verification badge; click
"Find a Lawyer" → directory; apply a filter; click a lawyer card; the
profile shows About / Credentials / Reviews / Availability tabs and a
sticky booking sidebar with the lawyer's published consultation rates
in ETH.

**Acceptance Scenarios**:

1. **Given** an unauthenticated visitor, **When** they load the
   landing page, **Then** they see the hero copy, the three "How It
   Works" steps, the trust strip, and the three most recently
   verified lawyers.
2. **Given** the directory, **When** the visitor applies any
   combination of specialty, language, or pricing-kind filters,
   **Then** the visible list narrows to match the filter exactly.
3. **Given** a lawyer profile, **When** the visitor inspects the
   "Verified" badge, **Then** the badge resolves to a live on-chain
   capability attestation UID; clicking it reveals the UID and a
   chain-explorer link.
4. **Given** a lawyer whose verification has been revoked or whose
   credential has expired, **When** the directory or profile is
   viewed, **Then** that lawyer does not appear in the directory and
   the profile route returns 404.

---

### User Story 2 — Lawyer onboards by presenting a bar credential (Priority: P1)

A new lawyer connects their wallet, signs a sign-in challenge, mints
the credentials they need at the platform's credential-issuer site
(an EU resident credential and a bar-membership credential), returns
to the platform, presents both via a privacy-preserving disclosure
flow, fills in the self-declared parts of their public profile (city,
headline, bio, specialties, languages, jurisdictions, pricing,
availability, avatar image), and lands on their dashboard. From this
point on they appear in the public directory.

**Why this priority**: lawyers are the supply side of the marketplace.
Without onboarded lawyers the consultation flow has no counterparty.

**Independent Test**: from a wallet that the credential issuer has on
both rosters, complete: connect → sign in → mint two credentials →
return → present each → fill profile fields → view dashboard. Verify
two on-chain capability attestations exist for the lawyer's wallet
(client + lawyer), the platform persists only the disclosed-attribute
subsets in its records, and the lawyer's profile renders in the public
directory.

**Acceptance Scenarios**:

1. **Given** a wallet with no prior account, **When** the user picks
   "I'm a lawyer" at the role chooser, **Then** the onboarding
   stepper shows three stages: Authenticate, Verify identity, Verify
   profession.
2. **Given** Verify identity, **When** the lawyer presents a valid EU
   resident credential, **Then** the platform persists exactly the
   country of residence and an "is over 18" boolean and writes a
   verified-client capability attestation on chain. No name, no birth
   date, no document number is ever sent to the platform's verifier.
3. **Given** Verify profession, **When** the lawyer presents a valid
   bar-membership credential, **Then** the platform persists their
   given name, family name, jurisdiction, bar admission number,
   admission date, and validity end-date, and writes a
   verified-lawyer capability attestation on chain.
4. **Given** the lawyer presents an expired bar credential or one
   whose holder binding does not match the signed-in wallet,
   **When** the platform verifies it, **Then** the platform refuses
   to write the attestation and surfaces a clear, non-technical
   error.
5. **Given** an onboarded lawyer with no profile row, **When** they
   land at the post-onboarding handoff, **Then** they are routed to
   the profile editor to fill self-declared fields. Their profile
   becomes publicly visible only after they save the form.

---

### User Story 3 — Client onboards and books a consultation (Priority: P1)

A new client connects their wallet, signs in, mints an EU resident
credential at the issuer, returns to the platform, presents it,
chooses a verified lawyer, and books a consultation (free or paid
depending on the lawyer's setting). For paid consultations, escrow
is funded as part of booking. The client lands in the consultation
workspace where chat is live and the lawyer can prepare for the
session.

**Why this priority**: consultation booking is the revenue moment and
the demo's primary narrative arc.

**Independent Test**: as a client wallet holding a freshly-minted EU
resident credential, complete: connect → sign in → present
credential → land at home → pick a lawyer → submit consultation
request with date / duration / practice area / case description. If
the lawyer's consultation is paid, sign one transaction to fund
escrow. Land in the consultation workspace; verify the conversation
row exists and is paired with the engagement.

**Acceptance Scenarios**:

1. **Given** a client onboarding, **When** they reach Verify identity,
   **Then** the disclosure dialog visibly requests **only** the
   "country of residence" and "over 18" attributes.
2. **Given** an authenticated client on a verified lawyer's profile,
   **When** they click "Book a consultation," **Then** they are
   routed to a consultation request form that displays the lawyer's
   stated consultation type (free or paid) and, if paid, the rate in
   ETH.
3. **Given** the client submits the form for a paid consultation,
   **When** the server processes it, **Then** the system creates an
   engagement record, opens the on-chain escrow with the consultation
   amount funded by the client's wallet signature, and creates a
   sibling conversation linked to the engagement.
4. **Given** the client submits the form for a free consultation,
   **When** the server processes it, **Then** the system creates the
   engagement and the conversation but no escrow transaction occurs.
5. **Given** any successful submission, **When** the response
   resolves, **Then** the client is hard-navigated to the
   consultation workspace.
6. **Given** a case description shorter than 20 characters, **When**
   the form submits, **Then** field-level validation fails inline and
   no engagement is created.

---

### User Story 4 — Lawyer accepts or declines a consultation request (Priority: P1)

A lawyer reviews an incoming consultation request from their dashboard,
sees only an anonymized client identifier (not a name) plus the
disclosed-attribute subset (over-18, country), the practice area, the
scheduled time, and the case description. The lawyer accepts or
declines.

**Why this priority**: without the lawyer's response, the consultation
state is stuck even when the on-chain escrow is funded.

**Independent Test**: sign in as a lawyer with one pending
consultation request; open the request review page; verify the client
appears as `anon-XXXX` (a wallet-derived stable identifier), not a
name; click Accept; verify the engagement transitions to ACCEPTED and
the lawyer is redirected to the dashboard.

**Acceptance Scenarios**:

1. **Given** a pending consultation request owned by the signed-in
   lawyer, **When** they open the request review page, **Then** the
   client field shows only the anonymous identifier; the client's
   name is not present (the platform does not have it).
2. **Given** the request page, **When** the fee breakdown renders,
   **Then** for paid consultations it shows the consultation amount,
   the platform fee (5% of consultation), and the lawyer's net.
3. **Given** the lawyer is not the request's owning lawyer,
   **When** they attempt to view or act on it, **Then** the response
   is 403 / 404 (no leakage of the request's existence).
4. **Given** the lawyer accepts a paid consultation, **When** the
   server processes it, **Then** the engagement state advances to
   ACCEPTED and the consultation room becomes the active workspace
   for both parties.
5. **Given** the lawyer declines a paid consultation, **When** the
   server processes the decline, **Then** a mutual-refund
   authorization flow is initiated (lawyer signs immediately; client
   signs to receive their refund) before the engagement may close.

---

### User Story 5 — Consultation happens, both parties chat, client marks complete (Priority: P1)

The client and the lawyer both open the consultation workspace. They
exchange end-to-end-encrypted messages. After the consultation, the
client clicks "Mark Complete" and the escrow funds release to the
lawyer. The conversation transcript is anchored on chain at release.

**Why this priority**: this is where the consultation actually
happens. The release transaction is the platform's "money moves"
moment.

**Independent Test**: with a paid, accepted consultation, sign in as
the client, send a chat message; sign in as the lawyer in another
browser, see the message within 5 seconds; click "Mark Complete" as
the client; sign one transaction; verify the consultation status is
COMPLETED, the lawyer's wallet receives the funds, and the
transcript Merkle root is anchored on chain in the same block.

**Acceptance Scenarios**:

1. **Given** an accepted paid consultation, **When** each party
   opens their consultation route, **Then** both see a shared
   workspace with a chat panel, the engagement metadata strip, and a
   proposals panel summarizing the engagement state.
2. **Given** a participant sends a chat message, **When** the message
   POSTs, **Then** the platform stores ciphertext only (no plaintext
   field is accepted by the route schema), verifies the sender's
   signature against their wallet, appends the leaf to the
   per-engagement transcript, and the other party's panel renders the
   decrypted message within 5 seconds.
3. **Given** the client clicks "Mark Complete" on a funded
   consultation, **When** the wallet broadcasts the release
   transaction, **Then** the funds move to the lawyer's address,
   the transcript root is anchored on chain in the same transaction,
   and the engagement record reflects COMPLETED.
4. **Given** "Mark Complete" is invoked twice on the same
   consultation, **When** the second call arrives, **Then** the
   response is an idempotent no-op — exactly one release happens.
5. **Given** a non-participant POSTs to the messaging endpoint,
   **When** the server processes it, **Then** the response is 403 and
   no row is written.
6. **Given** a participant opens the workspace from a browser without
   their wallet, **When** the chat panel loads, **Then** the
   ciphertext is fetched but cannot be decrypted; the UI surfaces
   "Connect your wallet to view this conversation."

---

### User Story 6 — Lawyer sends a follow-up proposal during the engagement (Priority: P1)

After the initial consultation completes, the lawyer can issue a
**proposal** to the client for additional work — line items
(hourly or fixed) plus deliverables. The lawyer signs the proposal at
creation. The client reviews it and either funds it (single
transaction signs and broadcasts) or declines. Once funded, the work
proceeds. The lawyer marks delivered; the client releases. Either
party may dispute under the asymmetric rules.

**Why this priority**: this is the multi-engagement substrate — what
turns a one-off consultation into a sustained working relationship.
It also surfaces the engagement's trust primitives (lawyer
proposes / client funds / asymmetric dispute) inside the consultation
workspace.

**Independent Test**: with an active engagement (consultation
completed, escrow released), the lawyer clicks "Send proposal,"
fills in line items and deliverables, signs, and submits. The
client's workspace polls and displays the proposal with Accept-and-
fund / Decline actions. The client funds; the lawyer marks
delivered; the client releases. Verify each on-chain transition fires
its event and updates the off-chain mirror.

**Acceptance Scenarios**:

1. **Given** an engagement whose most recent proposal (or
   consultation) is in a terminal state, **When** the lawyer opens
   the proposals panel, **Then** a "Send proposal" action is
   available.
2. **Given** the proposal form, **When** the lawyer enters line items
   (each typed `hourly` or `fixed` with appropriate fields) and
   deliverables (title + description), **Then** the form computes a
   total and a 5% platform fee preview.
3. **Given** the lawyer signs and submits, **When** the server
   processes the request, **Then** a wallet-signed proposal artifact
   is recorded against the engagement and a system note is posted
   into the chat for the client to see.
4. **Given** the client accepts and funds, **When** the funding
   transaction confirms, **Then** the proposal enters the FUNDED
   state and on-chain escrow holds the proposal amount.
5. **Given** a proposal in FUNDED state, **When** the lawyer marks
   delivered on chain, **Then** the on-chain delivery timestamp is
   recorded and the proposal enters the DELIVERED state. The client
   side may release at any time; the lawyer side may only escalate
   if 30 days have elapsed since delivery.
6. **Given** a proposal in FUNDED or DELIVERED state, **When** the
   client clicks Release and signs, **Then** the funds move to the
   lawyer's address and the proposal enters the RELEASED state.
7. **Given** a proposal in FUNDED or DELIVERED state, **When** the
   client (or the lawyer after cooldown) initiates a dispute,
   **Then** the proposal enters the DISPUTED state and no further
   release / refund is possible until the operator resolves.
8. **Given** the engagement parties wish to mutually refund a funded-
   undelivered proposal, **When** both parties sign a mutual-refund
   authorization off chain and one party broadcasts, **Then** the
   contract verifies both signatures and refunds the parked amount
   to the client.
9. **Given** an attempted lawyer escalation before 30 days have
   elapsed since delivery, **When** the wallet broadcasts the
   escalate call, **Then** the contract reverts and the UI surfaces
   the timestamp at which escalation will become possible.

---

### User Story 7 — Operator resolves a dispute (Priority: P2)

When a proposal is in DISPUTED state, the platform operator opens an
operator-only queue, reviews the dispute (parties' addresses, the
disclosed-attribute subsets, the engagement matter description, the
proposal amount and delivery timestamp), and submits a split
resolution. The split must equal the parked amount; the contract
enforces this on chain.

**Why this priority**: a marketplace without dispute resolution is
not a marketplace; users will not fund anything if there is no
recourse. P2 because the happy path runs without it, but the
demonstration is incomplete without it.

**Independent Test**: produce a DISPUTED proposal (via either client-
immediate dispute or lawyer-cooldown-then-escalate). Sign in as the
operator address; open the operator dispute queue; pick the row;
enter a split (amounts must sum to the parked amount); sign the
resolve transaction; verify the funds move accordingly and the
proposal advances to the terminal RESOLVED state.

**Acceptance Scenarios**:

1. **Given** a non-operator session, **When** the user attempts to
   open the operator dispute queue, **Then** the response is 404 (do
   not leak the path's existence).
2. **Given** the operator opens the dispute detail, **When** the
   page renders, **Then** it shows: parties' wallet addresses
   (truncated, monospaced), each party's disclosed-attribute subset,
   the matter description (cleartext, supplied by the client),
   the proposal amount and delivery timestamp, and an Evidence
   section that is empty unless either party has chosen to share a
   decrypted excerpt out of band.
3. **Given** the resolution form, **When** the operator enters split
   amounts, **Then** the form rejects any sum that does not equal
   the parked amount (and the contract reverts on broadcast).
4. **Given** the operator submits a valid resolution, **When** the
   transaction confirms, **Then** the funds move to the two
   addresses in a single on-chain action and the proposal enters the
   terminal RESOLVED state.

---

### User Story 8 — Lawyer self-service: dashboard + profile editor (Priority: P2)

A signed-in lawyer reviews their dashboard (pending requests,
upcoming this week, active consultations, 30-day net earnings),
edits their public profile with a live preview, and uploads a
profile avatar.

**Why this priority**: lawyers must self-serve to keep their listing
fresh and respond to incoming requests promptly.

**Independent Test**: as a verified lawyer, open the dashboard;
verify the four stat cards render with values from the database;
open the profile editor; change a field (e.g. hourly rate or bio);
confirm the live preview updates without saving; click Save; reload
the public profile and verify the change is live. Upload an avatar
image; confirm it appears at the correct sizes on the dashboard, the
public profile, and the directory card.

**Acceptance Scenarios**:

1. **Given** a verified lawyer, **When** the dashboard renders,
   **Then** the four stat cards (pending requests, upcoming this
   week, active consultations, 30-day net earnings) compute from a
   single parallel batch and the today's-schedule strip lists
   bookings whose scheduled time falls in the current day.
2. **Given** the profile editor, **When** the lawyer edits any
   self-declared field, **Then** the live preview pane updates
   without a server round-trip.
3. **Given** the lawyer uploads a profile photo (≤ 5 MB; JPG, PNG,
   or WebP), **When** the upload completes, **Then** the server
   transcodes it to two stored variants (480 px and 192 px square,
   center-cropped) and the avatar surfaces consistently on every
   render of that lawyer.
4. **Given** the lawyer attempts to edit a credential-derived field
   (name, bar registration number, jurisdiction, admission date),
   **When** the form attempts to submit, **Then** the field is
   read-only and the server-side validation rejects unknown fields.

---

### Edge Cases

- A user opens the platform without a wallet — they can browse public
  pages but cannot sign in, present credentials, fund consultations,
  or read encrypted message history.
- A user's verification is revoked mid-engagement — in-flight
  proposals can still complete (release / refund / dispute work as
  normal), but no new engagement may open against them and they
  vanish from the public directory immediately.
- A user signs into a different browser without the wallet's
  per-engagement key material — message history is fetched as
  ciphertext but cannot be decrypted; the UI surfaces a "Connect
  your wallet" state.
- A wallet completes credential issuance at the issuer site but
  closes the tab before returning to the platform — the issuer's
  short-lived flow rows expire after 10 minutes; the credential
  itself stays in the user's wallet.
- The server receives a message-post that includes a plaintext
  field — the request schema rejects it; only the ciphertext
  envelope is accepted.
- A non-participant posts to the messaging endpoint with another
  conversation's id — the request returns 403 and writes nothing.
- A non-operator address attempts the resolve-dispute action — the
  contract reverts unconditionally.
- A resolve-dispute split that does not equal the parked amount —
  rejected client-side and the contract reverts.
- A close-engagement attempt while a proposal is in funded /
  delivered / disputed state — the contract reverts and the UI
  surfaces the blocking proposal with a "Resolve this first" call to
  action.
- A lawyer attempts escalation before the 30-day cooldown has
  elapsed since the on-chain delivery action — the contract reverts
  with the unix timestamp at which escalation becomes possible.
- The platform attempts to act on the user's behalf without the
  user's signature (e.g. forge a credential, decrypt a message,
  unilaterally release escrow) — every such path is forbidden by
  cryptography, not by policy: the platform holds no key material
  capable of any of these actions.
- Two parties act on the same proposal simultaneously (e.g. client
  releases while lawyer marks delivered) — the contract's state
  machine accepts the first confirming transaction and reverts the
  second. The losing party's UI surfaces "state changed; reload"
  after observing the on-chain event; no server-side lock is held
  in advance.
- The deployed chain is unreachable when the user attempts a
  funds-touching action — the action is disabled at the UI before
  the wallet is opened; a "secure payment network is temporarily
  unavailable" banner is shown. No signature is solicited and no
  gas is spent into a degraded state.
- The chain is reachable but the platform's event indexer is
  briefly behind (e.g. recovering from a transient outage) — the
  off-chain mirror reconciles automatically when the indexer
  catches up. The user-facing workspace refreshes without manual
  intervention.
- A lawyer never responds to a consultation request — after 7
  days the request auto-transitions to EXPIRED. For a paid
  request, the parked escrow is returned via the mutual-refund
  flow (lawyer co-signs); for a free request, no on-chain action
  is required.
- A client cancels a paid consultation before the lawyer has
  accepted — the cancellation transitions the request to
  CANCELLED but does not move the parked escrow on its own; the
  mutual-refund authorization flow runs to refund the client.

## Requirements *(mandatory)*

### Functional Requirements

#### Identity, capabilities, and onboarding

- **FR-001**: The platform MUST allow a user to connect a wallet and
  prove ownership of an Ethereum address (single-wallet sign-in)
  before performing any state-changing action.
- **FR-002**: The platform MUST onboard a client only after the
  client presents a valid EU resident credential disclosing exactly
  two attributes: country of residence, and an "over 18" boolean.
  The platform MUST persist only those two attributes plus the
  wallet address. Name, birth date, document number, full address,
  place of birth, and sex MUST NOT be requested by the platform's
  verifier and MUST NOT be persisted.
- **FR-003**: The platform MUST onboard a lawyer only after the
  lawyer presents a valid bar-membership credential disclosing
  given name, family name, jurisdiction, bar admission number,
  admission date, and validity end-date. Lawyers MUST also hold the
  client capability (i.e. they present the EU resident credential
  too) so they may also act as clients on unrelated engagements.
- **FR-004**: The platform MUST persist on-chain capability
  attestations binding a wallet address to its verified roles
  (verified-client, verified-lawyer). The platform MUST NOT persist
  the underlying credential payload.
- **FR-005**: A single wallet MAY hold any subset of capabilities
  simultaneously. Capability checks MUST be per-action, not
  per-user.
- **FR-006**: The platform operator MUST NOT be able to grant
  verified-client or verified-lawyer capability without a
  successful credential presentation in the platform's onboarding
  code path. Capability writes MUST originate exclusively from a
  successful presentation.
- **FR-007**: Credentials MUST be issued by a separate process from
  the platform — its own application with its own signing keys and
  its own database. The platform MUST verify the issuer's signatures
  only via the issuer's public JWKS over HTTP. The platform MUST
  NOT have read access to the issuer's signing keys.
- **FR-008**: The credential issuer MUST hold two distinct signing
  keys (one for EU resident credentials, one for bar credentials).
  A signature with one key MUST NOT be accepted as valid for the
  other credential type.
- **FR-009**: The platform's verifier MUST refuse to accept a
  credential presentation if the credential is signature-invalid,
  expired (validity end-date in the past), or carries a holder
  binding that does not match the signed-in wallet.
- **FR-010**: After successful onboarding, clients land at the
  client home; lawyers land at the lawyer dashboard if they have a
  profile, or at the profile editor if they do not.

#### Consultation requests (client-initiated)

- **FR-011**: A verified client MUST be able to send a consultation
  request to a specific verified lawyer. The request carries a
  scheduled time, a duration (30 or 60 minutes), a practice area,
  and a free-form case description (≥ 20 characters).
- **FR-012**: Each lawyer MUST be able to set their consultation
  type to either FREE or PAID. PAID consultations use the lawyer's
  published 30/60-minute rate.
- **FR-013**: When the client submits a request for a PAID
  consultation, the platform MUST open an on-chain engagement and
  fund the consultation amount in escrow as part of the same user
  action. When the client submits a request for a FREE
  consultation, the platform MUST open the engagement record
  without any escrow transaction.
- **FR-014**: The platform MUST create a paired conversation
  alongside every engagement, with the client and the lawyer's
  user as the two participants.
- **FR-015**: The lawyer MUST be able to accept or decline an
  incoming consultation request. Acceptance transitions the
  engagement to the active state. Declining a paid consultation
  MUST initiate a mutual-refund authorization flow before the
  engagement may close.
- **FR-015a**: A consultation request that has not been accepted
  or declined by the lawyer within **7 days** of submission MUST
  auto-transition to an EXPIRED state. The client's view MUST
  surface the expiry transparently and offer a "request another
  lawyer" affordance. For a free expired request, no further state
  change is needed. For a paid expired request, the parked escrow
  MUST be refunded to the client via the same mutual-refund
  authorization flow used for declines (FR-015 + FR-031), with the
  lawyer's signature required to broadcast the refund.
- **FR-015b**: The client MUST be able to cancel an unaccepted
  consultation request at any time before the lawyer accepts. For
  a free request, cancellation transitions the request to
  CANCELLED and the engagement record is marked terminal. For a
  paid request, cancellation initiates the mutual-refund
  authorization flow (the lawyer co-signs to refund the parked
  escrow); a unilateral cancel by the client MUST NOT move the
  parked funds, consistent with FR-031 (no unilateral refunds of
  funded escrow).

#### Proposals (lawyer-initiated, multi)

- **FR-016**: An engagement MUST support zero or more **proposals**
  in addition to the consultation. Only the lawyer MAY create a
  proposal.
- **FR-017**: A proposal MUST carry: a list of line items
  (each typed `hourly` or `fixed`, with appropriate fields and a
  computed subtotal), a list of deliverables (title +
  description), and a total computed server-side from the line
  items. The platform fee is 5% of the proposal total.
- **FR-018**: A proposal MUST be wallet-signed by the lawyer at
  creation. The signature MUST be verified by the server before
  the proposal is recorded.
- **FR-019**: A client MUST be able to fund a proposal with one
  wallet signature; the funding transaction carries the lawyer's
  signed proposal artifact and the contract verifies the lawyer's
  signature on chain.
- **FR-020**: A funded proposal MAY be marked DELIVERED on chain
  by the lawyer. This action is OPTIONAL in the happy path — the
  client may release at any time after fund. Its sole on-chain
  purpose is to start the lawyer-side dispute cooldown clock.
- **FR-021**: The client MUST be able to release a proposal in
  the FUNDED or DELIVERED state at any time, sending the funds
  to the lawyer's address in a single on-chain action.
- **FR-022**: A proposal that has been released, refunded, or
  resolved is in a terminal state and may not transition further.
- **FR-023**: A new proposal MUST NOT be created while the most
  recent proposal (or the consultation, if no proposals exist
  yet) is in a non-terminal state (FUNDED, DELIVERED, DISPUTED).

#### Asymmetric dispute mechanism

- **FR-024**: The client MUST be able to dispute any FUNDED or
  DELIVERED proposal (or paid consultation) immediately, with no
  cooldown, parking the funds until the operator resolves.
- **FR-025**: The lawyer MUST be able to escalate a DELIVERED
  proposal only after a 30-day cooldown has elapsed since the
  on-chain delivery action. Earlier attempts MUST revert with a
  clear message including the unix timestamp at which escalation
  becomes possible. The cooldown MUST be enforced on chain, not
  by platform policy.
- **FR-026**: A DISPUTED proposal MUST NOT be releasable,
  refundable, or re-disputable by either party until the operator
  resolves it.
- **FR-027**: The platform operator address MUST be the only
  caller that can resolve a dispute. The contract MUST gate the
  resolve call on this and reject every other caller, including
  the engagement parties.
- **FR-028**: A resolve action MUST specify two split amounts
  (one to the lawyer, one to the client) whose sum equals the
  parked amount to the wei. Mismatched sums MUST revert.
- **FR-029**: After resolution, the proposal MUST move to the
  terminal RESOLVED state and the engagement may continue to
  subsequent proposals or close.
- **FR-030**: The operator MUST NOT receive, through any
  platform-issued action, any ability to decrypt messages,
  unseal client identity, or affect non-disputed engagements.

#### Mutual refund

- **FR-031**: A FUNDED proposal MAY be refunded only with both
  parties' wallet signatures over a per-proposal authorization
  artifact. The contract MUST verify both signatures before
  transferring the parked amount back to the client.
- **FR-032**: A DELIVERED proposal MUST NOT be mutually
  refundable; recourse for delivered work is dispute-and-resolve.

#### Engagement closure

- **FR-033**: Either engagement party MUST be able to close the
  engagement, but only when every proposal (and the consultation,
  if paid) is in a terminal state (RELEASED, RESOLVED, REFUNDED).
  Closure attempts otherwise MUST revert with a message
  identifying the blocking proposal.
- **FR-034**: A closed engagement MUST be terminal — no further
  proposals, messages, or state transitions are permitted, and
  the final transcript root MUST be anchored on chain at the
  moment of closure.

#### End-to-end-encrypted messaging

- **FR-035**: Messages between engagement parties MUST be
  encrypted with keys derived in the browser from the parties'
  wallet keys via ECDH. The platform MUST NOT possess any key
  material capable of decrypting them.
- **FR-036**: The messaging route MUST accept ONLY a ciphertext
  envelope shape (ciphertext, IV, salt, signature, sender). A
  request including a plaintext field MUST be rejected by the
  schema.
- **FR-037**: Each message MUST be signed by the sender's wallet
  and the platform MUST verify the signature against the
  declared sender's address before recording the message.
- **FR-038**: Messages MUST be hashed into a per-engagement
  Merkle transcript. The on-chain transcript root MUST be
  updated at every engagement state transition that touches
  funds (consultation funding, proposal fund / mark delivered /
  release / refund / resolve, closure).
- **FR-039**: The chat panel MUST poll for new messages at most
  every 5 seconds while the workspace is open.
- **FR-040**: A user without their wallet MUST NOT be able to
  read message history; the UI MUST surface a clear "connect your
  wallet" state instead of partial content.

#### Discovery (public surface)

- **FR-041**: The platform MUST render the landing, directory,
  and profile pages without requiring authentication.
- **FR-042**: The directory MUST allow filtering by practice
  specialty, language, and pricing kind.
- **FR-043**: The directory MUST show only lawyers whose
  on-chain verified-lawyer attestation is currently valid (no
  revocation, no past validity end-date).
- **FR-044**: Each lawyer profile MUST surface a verification
  badge that resolves to a live on-chain capability check; the
  badge MUST display the attestation UID truncated and in
  monospace, and MUST link to a chain-explorer.

#### Lawyer self-service

- **FR-045**: A lawyer MUST be able to edit the self-declared
  fields of their public profile via a tabbed editor with a live
  preview pane. Self-declared fields are: city, headline, bio,
  specialties, languages, jurisdictions, pricing kind, pricing
  headline, hourly rate, 30-min and 60-min consultation rates,
  pricing items (for non-hourly kinds), tags, availability.
- **FR-046**: Credential-derived fields (given name, family name,
  bar registration number, jurisdiction-of-admission, admission
  date, validity end-date) MUST be read-only in the profile
  editor and the server MUST reject any attempt to update them
  through the profile editor's API.
- **FR-047**: A lawyer MUST be able to upload a profile avatar
  image (JPG, PNG, or WebP; ≤ 5 MB). The platform MUST transcode
  the upload to two stored variants (480 px and 192 px square,
  center-cropped) and surface them consistently across every
  lawyer-rendering surface.
- **FR-048**: The lawyer dashboard MUST compute, in one parallel
  batch, four stats: pending requests count, upcoming-this-week
  count, active consultations count, and 30-day net earnings
  (sum of consultation/proposal amounts minus platform fees over
  RELEASED states updated in the last 30 days).

#### Pseudonymity surface

- **FR-049**: A lawyer's server-rendered view of a client
  pre-acceptance MUST contain only the wallet address (rendered
  through a stable, wallet-derived anonymous identifier such as
  `anon-XXXX`), the country of residence, and the over-18
  boolean. Names MUST never appear pre-acceptance.
- **FR-050**: After acceptance, the client's wallet address
  becomes visible in the consultation workspace. The client's
  name remains absent from the platform's records and surfaces
  only inside encrypted in-engagement messages (which the
  platform cannot read).
- **FR-051**: The public directory MUST show only the disclosed
  practising attributes of a lawyer; the underlying credential
  payload, the lawyer's other engagements, and any client data
  MUST NOT appear.

#### Anti-tamper and audit

- **FR-052**: All capability changes (grant, revoke), all on-chain
  proposal/consultation state transitions, and all transcript
  anchors MUST be recorded on chain. Off-chain wallet-signed
  artifacts (proposal offers, mutual-refund authorizations) MUST
  be preserved by the platform as part of the per-engagement
  record and committed to the on-chain transcript root at the
  events listed in FR-038.
- **FR-053**: The platform MUST NOT possess the ability to
  forge, retroactively edit, or backdate any of the on-chain
  records listed above; modification MUST require a new
  transaction signed by the appropriate wallet.

#### Concurrency & state consistency

- **FR-058**: The on-chain contract MUST be the canonical state machine
  for every proposal and consultation transition. The platform MUST
  NOT acquire server-side locks before broadcasting state-changing
  transactions; instead, both parties may broadcast independently and
  the contract's `require()` checks reject any transition that is
  no longer valid. The platform's off-chain mirror MUST be updated
  only by observing on-chain events, never by speculative writes.
- **FR-059**: When a state-changing transaction reverts because the
  proposal's state changed between the user's click and broadcast,
  the UI MUST surface a non-technical "state changed — please reload"
  message and refresh the workspace's view from the latest on-chain
  state. The error MUST NOT be presented as a generic failure or a
  request to "try again" (which would imply the user can retry the
  same action).
- **FR-060**: Before any user action that will trigger a wallet
  signature for an on-chain transaction (consultation funding,
  proposal fund / mark delivered / release / dispute / escalate,
  mutual refund, resolve, close), the platform MUST verify the
  deployed chain is reachable (a lightweight RPC health check, e.g.
  `eth_blockNumber`). If the chain is unreachable, the action MUST
  be disabled in the UI and a non-technical "secure payment network
  is temporarily unavailable — please try again in a moment" banner
  MUST be surfaced. The user MUST NOT be allowed to broadcast a
  signature into a degraded state.
- **FR-061**: After a successful broadcast, if the platform's
  event indexer falls behind because of transient chain
  unavailability, the off-chain mirror MUST eventually become
  consistent with on-chain state once the chain is reachable
  again. The user-facing workspace MUST refresh automatically when
  the indexer catches up; manual user intervention MUST NOT be
  required for routine indexer recovery.

#### Quiet trust language

- **FR-054**: User-facing copy MUST avoid Web3 jargon. Headlines
  MUST say "secure payment held until your consultation
  completes" rather than "smart-contract escrow." Wallet
  addresses MUST be truncated and rendered in a monospaced font.
- **FR-055**: ETH amounts ARE shown to users (e.g. `0.0123 ETH`
  in fee summaries) — paired with quieter "secure payment"
  framing. EUR (or any other fiat currency) MUST NOT appear in
  user-facing copy.
- **FR-055a**: All user-facing UI copy in the MVP MUST be English. The
  lawyer's self-declared `languages[]` field (the languages they
  offer counsel in) is independent of UI chrome and supports any
  language label the lawyer enters. The directory's language
  filter populates from the union of lawyers' `languages[]`
  values. Multi-language UI chrome is production trajectory.

#### Development & testing affordances

- **FR-056**: The platform MUST support a development bypass
  mode (toggled by an environment flag named in
  [Assumptions](#assumptions)) that:
  - Refuses to start when the deployment environment is
    production.
  - Replaces the role chooser with a persona picker that lists
    the pre-staged demo personas.
  - On persona selection, idempotently seeds the platform's
    records, writes the corresponding capability attestations on
    chain via the operator key, and loads dev key material into
    the browser so client-side encryption / decryption work.
  - Exposes a development-only login endpoint that issues the
    same session bypass programmatically (so test suites can
    drive the workflow without a wallet round-trip).
  - Surfaces a persistent visible "Dev mode" banner so the user
    can never confuse a bypass session with a production one.
- **FR-057**: The development hosting target is **ngrok** (or an
  equivalent single-hostname HTTPS tunnel). The platform's
  reverse proxy MUST route `/api/issuer/*` to the issuer
  application and everything else to the platform application
  on the same hostname (free-tier ngrok constraint: one
  hostname).

### Key Entities *(include if feature involves data)*

- **User Wallet** — the user's controlled key material, identified
  by an Ethereum address. Holds zero or more verifiable
  credentials. May hold zero or more capabilities. All
  authentication, signing, and per-engagement message keys derive
  from this wallet.
- **Capability Attestation** — an on-chain record binding a wallet
  address to a single capability (verified-client,
  verified-lawyer). Issued only after the gating credential
  presentation. Revocable.
- **Lawyer Profile** — self-declared profile data (city, headline,
  bio, specialties, languages, jurisdictions, pricing, tags,
  availability, avatar) plus the credential-derived read-only
  fields the lawyer disclosed at onboarding. Visibility in the
  public directory is gated on a currently-valid verified-lawyer
  attestation.
- **Engagement** — an accepted bilateral relationship between a
  verified client and a verified lawyer. Carries a matter
  description, a target jurisdiction, a target practice area, an
  off-chain transcript that accumulates continuously, and an
  on-chain root anchored at funds-touching events. Has zero or
  more proposals attached. Lifecycle: active → closed.
- **Consultation** — the client-initiated entry point to an
  engagement. Carries a scheduled time, a duration, a practice
  area, a case description. May be FREE (no escrow) or PAID
  (escrow funded at booking). State machine: REQUESTED → ACCEPTED
  → IN_PROGRESS → COMPLETED, plus DECLINED / DISPUTED / EXPIRED
  (auto after 7 days of lawyer inaction) / CANCELLED (client-
  initiated before lawyer accepts) branches. Paid consultations
  in EXPIRED or CANCELLED states require a mutual-refund
  authorization to release the parked escrow.
- **Proposal** — a lawyer-initiated, wallet-signed offer to
  perform additional work, attached to an engagement after the
  consultation. Carries line items (hourly or fixed), deliverables,
  a total, and a 5% platform fee. State machine: ISSUED → FUNDED
  → DELIVERED → RELEASED, plus DISPUTED → RESOLVED and FUNDED →
  REFUNDED branches.
- **Conversation** — a per-engagement message thread, paired
  one-to-one with an engagement.
- **Message** — an end-to-end-encrypted message envelope: sender
  address, ciphertext, IV, salt, sender wallet signature. Stored
  as opaque bytes server-side. Hashed into the engagement's
  Merkle transcript at insertion.
- **Mutual Refund Authorization** — an off-chain artifact carrying
  both parties' wallet signatures over `(engagement, proposal,
  nonce)`, used to refund a FUNDED-undelivered proposal.
- **Disclosed Attribute Set** — the subset of credential
  attributes a user explicitly chose to reveal at onboarding.
  These are the only attributes the platform persists about a
  user. For clients: country of residence, over-18 boolean. For
  lawyers: given name, family name, jurisdiction, bar admission
  number, admission date, validity end-date.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time client with a credential-equipped
  wallet can go from landing on the platform to a funded paid
  consultation in under five minutes (excluding any wall-clock
  wait for the lawyer to respond), performing exactly one wallet
  credential presentation and one wallet signature for the
  funding transaction.
- **SC-002**: A first-time lawyer with credential-equipped wallet
  can complete onboarding (connect → present EU resident
  credential → present bar credential → fill profile fields → see
  themself in the public directory) in under three minutes.
- **SC-003**: When the platform is asked, by any party other than
  the engagement counterparty, for the contents of any message,
  no readable content can be produced — the response is provably
  ciphertext with no key path to plaintext from the platform's
  data.
- **SC-004**: 100% of pre-cooldown lawyer-escalation attempts are
  refused with a clear message stating when escalation will
  become available.
- **SC-005**: An operator resolution moves the disputed-proposal
  funds in a single on-chain action whose total transferred
  amount equals the parked amount to the wei. Mismatched sums
  are rejected client-side and on chain.
- **SC-006**: A lawyer's persisted view of a client pre-acceptance
  contains only the disclosed-attribute subset and the wallet's
  anonymous identifier — an audit of all platform records that
  reference the engagement reveals no additional client
  attributes.
- **SC-007**: A revoked verified-lawyer attestation removes the
  affected wallet from the directory and prevents new
  engagements within a single page refresh on any client
  device. In-flight engagements continue to their natural
  completion.
- **SC-008**: The platform's operational records, read in full,
  contain no key material capable of decrypting any message,
  unsealing any client identity beyond their disclosed
  attributes, or forging any capability attestation.
- **SC-009**: A new chat message appears on the other party's
  screen in under 6 seconds (5-second poll + render budget).
- **SC-010**: All five core paths (lawyer onboarding, client
  onboarding, paid consultation booking and completion,
  client-immediate dispute resolution, lawyer-cooldown-then-
  escalate resolution) can each be demonstrated end-to-end
  against a single running deployment without configuration
  changes.
- **SC-011**: A development bypass session takes a user from
  persona-pick to their role-appropriate home in under 4
  seconds, including the on-chain capability writes; a build
  with the bypass flag set in production environment refuses to
  start.
- **SC-012**: The lawyer dashboard renders all four stat cards
  and the today's-schedule strip in under 1.2 seconds on warm
  development infrastructure.

## Assumptions

- **Brand naming.** The public name of the platform appears once,
  in the title of this spec. Throughout the body and in
  downstream artifacts, the neutral term "the platform" is used.
- **Currency.** All on-chain amounts and all user-facing amounts
  are denominated in native ETH on the deployed chain. EUR or
  other fiat currency does not appear in any user-facing copy or
  any database column. Production trajectory may add an ERC-20
  stablecoin variant; the contract surface is shaped to allow it
  without changing the API visible to clients, lawyers, or
  arbiters.
- **Hosting target for testing.** The development and demo
  deployment is fronted by ngrok (or equivalent single-hostname
  HTTPS tunnel). The reverse proxy splits the path namespace:
  `/api/issuer/*` reaches the issuer application; everything
  else reaches the platform application. wwWallet (or any
  OID4VCI/OID4VP-compliant web wallet) sees a single origin.
- **Wallet handoff.** The platform integrates with a web-based
  wallet (validated against wwWallet). Credential offers and
  presentations are conveyed via HTTPS handoff URLs (the
  `credential_offer_uri` and `request_uri` modes of the
  underlying protocols), not native-scheme deep links.
- **Issuer scope.** A single issuer application stands in for
  two real-world authorities (national EU resident credential
  providers and individual bar associations). The cryptographic
  separation lives in the *signing keys*, not in the *number of
  processes*. Production trajectory deploys these as
  independent services run by independent operators.
- **Operator role.** The platform operator address is the
  arbiter for the MVP — the contract gates the resolve action on
  this address. Production trajectory introduces a separated
  arbiter pool of credentialed lawyers, with the operator
  forbidden from acting as arbiter; the contract surface is
  preserved across that swap.
- **File storage.** Avatar images and any future message
  attachments are stored on local disk under a per-user
  directory. Production trajectory swaps in object storage
  (S3 / Cloudflare R2) with signed URLs.
- **Video.** The consultation workspace renders a placeholder
  canvas plus the standard four controls (mute, camera,
  screen-share, hang-up). Real video transport is production
  trajectory; the cryptographic spine of the consultation
  (E2EE chat + on-chain transcript) is unaffected.
- **Demo personas.** Five lawyer personas (covering five EU
  jurisdictions) and at least one client persona are pre-staged
  in the issuer's roster. Each persona must complete the real
  onboarding flow on stage to land on the platform; the platform
  itself starts empty on every fresh deployment.
- **Time-skip.** The 30-day lawyer-side dispute cooldown is
  demonstrated using the chain's standard time-jump RPC during
  the demo. The cooldown duration in the contract is the real
  30 days — the demo skips the chain forward, the demo does not
  shorten the cooldown.
- **Reviews.** Public reviews on a lawyer's profile are out of
  scope for this spec; the Reviews tab on the profile page
  ships as an empty-state placeholder.

## Dependencies

- **Wallet integration** validated against wwWallet (or
  equivalent OID4VCI/OID4VP-conformant web wallet). The
  validated quirk list (metadata cache headers, `request_uri`
  and `credential_offer_uri` mode requirements, `client_id`
  prefix syntax, `iss` claim hostname rule, `vp_token` parsing
  flexibility) carries forward.
- **Reverse proxy** that routes a single ngrok hostname's path
  namespace between the two applications.
- **Two distinct application processes** with separate signing
  keys / databases on the filesystem; a static-analysis check in
  CI ensures the platform application does not import from the
  issuer application's source tree.
- **On-chain primitives**: capability attestations, proposal-
  funded escrow with the asymmetric dispute mechanism, and
  per-engagement transcript anchoring. Production-trajectory
  swaps for the conflict-of-interest non-membership proof
  (Noir / UltraHonk) and the trusted-issuer-registry lookup are
  documented separately and do not change the API surface.

## Out of Scope (production trajectory)

- Trusted issuer registry runtime lookup at attestation time.
- Conflict-of-interest non-membership proof at first proposal
  funding (the contract retains a stub verifier; the lawyer-side
  conflict-set commitment UI is not built).
- Identity unsealing for fraud / regulatory escalation.
- Separated arbiter pool (operator-as-arbiter is the MVP
  arrangement).
- Real-time video transport.
- Object-storage-backed file storage with signed URLs.
- Decentralized message transport (XMTP / Waku); the same
  cryptographic envelope is used over an HTTP transport for the MVP.
- Forward secrecy via Double Ratchet on the messaging layer.
- ERC-20 stablecoin escrow variant.
- Public reviews / ratings on lawyer profiles.
- Operator capability administration UI (capability revocation
  is performed via direct contract calls when needed).
- **Account deletion / GDPR right-to-erasure.** The MVP ships
  without an account-delete surface. Production trajectory will erase the
  off-chain platform-owned records (verified_users rows, lawyer
  profile data, avatar files, conversation rows, ciphertext
  message history) and surface a plain-language note that
  on-chain capability attestations and transcript anchors are
  immutable cryptographic artifacts that survive deletion. Article
  17 GDPR's "compliance with a legal obligation" and "legitimate
  interests" carve-outs cover the on-chain layer; the wallet's
  on-chain history is the user's responsibility to manage at the
  wallet level.
