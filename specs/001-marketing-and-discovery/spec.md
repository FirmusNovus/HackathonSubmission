# Feature Specification: Marketing & Lawyer Discovery

**Feature Branch**: `001-marketing-and-discovery`
**Created**: 2026-05-08
**Status**: Draft
**Input**: Translation of `app/page.tsx`, `app/lawyers/page.tsx`, and
`app/lawyers/[id]/page.tsx` from the existing Firmus Novus implementation.

## User Scenarios & Testing

### User Story 1 — Visit landing and grasp what Firmus Novus does (Priority: P1)

A first-time visitor lands at `/` and within one viewport scroll
understands: this is verified European legal counsel, EBSI is the trust
substrate, and they can either browse lawyers or read how it works.

**Why this priority**: This is the marketing surface. If it does not land
the EBSI trust message in seconds, no other feature gets used.

**Independent Test**: Visit `/` unauthenticated. The hero shows the
"Verified Legal Counsel, On-Chain." headline with the EBSI badge, the
"How It Works" three-step section, the trust-strip stats, and three
recently-joined verified lawyer cards. The "Find a Lawyer" CTA links to
`/lawyers`.

**Acceptance Scenarios**:

1. **Given** a fresh visitor, **When** they load `/`, **Then** the hero
   headline reads "Verified Legal Counsel, On-Chain." with "On-Chain."
   in teal italic, and an EBSI seal badge with the label "Verified
   through EBSI & Blockchain" is shown.
2. **Given** the landing page, **When** the visitor scrolls past the hero,
   **Then** they see exactly three "How It Works" steps in this order:
   Describe Need → Match with Verified Lawyer → Connect Securely.
3. **Given** the landing page, **When** the recently-joined section
   renders, **Then** it lists the three most recently created VERIFIED
   lawyers, each linkable to their profile.

### User Story 2 — Find a lawyer by need (Priority: P1)

A client with a specific legal problem opens `/lawyers`, narrows by
practice area, language, and pricing model, and clicks through to a
lawyer's public profile.

**Why this priority**: This is the core discovery path. Without it, no
booking happens.

**Independent Test**: Visit `/lawyers`, apply a filter (e.g. specialty =
"Family"), confirm result count matches the filtered set in the database,
click a card to land on `/lawyers/[id]` and see the full profile.

**Acceptance Scenarios**:

1. **Given** the directory, **When** no filters are applied, **Then** all
   VERIFIED lawyers appear, sorted by recency.
2. **Given** the directory, **When** the user filters by practice
   specialty, language, or pricing kind, **Then** the visible list narrows
   accordingly without a full page reload feel.
3. **Given** the directory, **When** the user clicks a lawyer card,
   **Then** they land on `/lawyers/[id]` with the lawyer's tabs
   (About / Credentials / Reviews / Availability) and a sticky booking
   sidebar.
4. **Given** a lawyer with `verificationStatus = PENDING`, **When** the
   directory renders, **Then** that lawyer is NOT shown.

### User Story 3 — Inspect a lawyer's profile and book (Priority: P1)

From a profile, the client reads the bio, credentials, and pricing, then
clicks "Book a consultation," which routes them through onboarding (if
unauthenticated) and into the booking flow.

**Why this priority**: This is the bridge between discovery and the
revenue path.

**Independent Test**: On `/lawyers/[id]`, the About tab shows bio +
specialties + languages + jurisdictions. Credentials shows EBSI
verification status, bar registration, admission date, years of
experience. The booking sidebar shows the lawyer's `pricingHeadline` and
the 30-min and 60-min consultation rates in EUR with a "Book a
consultation" CTA.

**Acceptance Scenarios**:

1. **Given** an unauthenticated visitor on a lawyer profile, **When**
   they click "Book a consultation," **Then** they are routed to
   `/connect?role=client` to onboard.
2. **Given** an authenticated client on a lawyer profile, **When** they
   click "Book a consultation," **Then** they are routed to
   `/client/book/[lawyerId]`.
3. **Given** any lawyer profile, **When** the page renders, **Then** the
   EBSI badge appears with the lawyer's `ebsiCredentialId` truncated and
   in monospace.
4. **Given** the Reviews tab, **When** opened, **Then** it shows an
   empty-state placeholder (Reviews are excluded from MVP).

### Edge Cases

- A lawyer ID that does not exist or is not VERIFIED on the public
  profile returns a 404.
- The directory with zero matching lawyers shows an empty-state with a
  "clear filters" affordance.
- Hero CTAs work without JavaScript (server-rendered links).

## Requirements

### Functional Requirements

- **FR-001**: The system MUST render the landing page server-side and
  fetch the three most recently created VERIFIED lawyers for the
  "Recently joined" section.
- **FR-002**: The system MUST display the EBSI trust signal (gold badge
  + "Verified through EBSI & Blockchain") in the hero and the trust strip.
- **FR-003**: The directory MUST allow filtering by practice specialty,
  language, and pricing kind (HOURLY / FIXED / SUBSCRIPTION / SUCCESS).
- **FR-004**: The directory MUST hide PENDING and REJECTED lawyers.
- **FR-005**: The lawyer profile page MUST present four tabs: About,
  Credentials, Reviews, Availability. Reviews ships as an empty-state
  placeholder for the MVP.
- **FR-006**: The lawyer profile sidebar MUST show the headline pricing
  string, the 30-minute and 60-minute consultation rates in tokenized
  EUR, and a "Book a consultation" CTA.
- **FR-007**: All lawyer cards MUST display the EBSI verification badge
  in muted gold and respect the under-5%-visual-weight rule.
- **FR-008**: The "Book a consultation" CTA MUST route unauthenticated
  visitors to `/connect?role=client` and authenticated clients to
  `/client/book/[lawyerId]`.

### Key Entities

- **LawyerProfile** — public-facing fields: `name`, `city`, `headline`,
  `bio`, `specialties[]`, `languages[]`, `jurisdictions[]`, `pricingKind`,
  `pricingHeadline`, `consultationRate30`, `consultationRate60`,
  `pricingItems`, `yearsExperience`, `barRegistrationNum`,
  `barJurisdiction`, `admissionDate`, `verificationStatus`,
  `ebsiCredentialId`, `tags`. Only `VERIFIED` rows surface publicly.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A first-time visitor can read the hero, scan three steps,
  and land on `/lawyers` in under five clicks-or-scrolls.
- **SC-002**: The directory's filtered result set matches the database
  query exactly — no client-side dropping.
- **SC-003**: The lawyer profile page renders below 800ms TTFB on a
  warm Postgres in dev.
- **SC-004**: WCAG AA contrast holds for every text-on-background pairing
  introduced by these views.

## Assumptions

- Reviews tab UI ships as an empty-state placeholder (per constitution
  scope boundary).
- The directory hides `PENDING` lawyers; the lawyer-side flow is covered
  by spec 003.
- The visitor does not need a wallet to browse the directory or read
  profiles — the wallet is required at booking time.
- Twelve seeded lawyers span twelve EU cities (Stockholm, Berlin, Rome,
  Paris, Warsaw, Copenhagen, Milan, Vienna, Madrid, Amsterdam, Brussels,
  Prague), with two seeded as PENDING (Margaux Laurent, Stefan Novak)
  to demonstrate the verification states.
