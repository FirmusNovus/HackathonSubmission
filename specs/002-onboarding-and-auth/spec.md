# Feature Specification: Onboarding & Authentication

**Feature Branch**: `002-onboarding-and-auth`
**Created**: 2026-05-08
**Status**: Draft
**Input**: Translation of `app/connect/page.tsx`,
`app/connect/connect-flow.tsx`, `lib/auth/config.ts`, and
`lib/web3/ebsi.ts` from the existing Firmus Novus implementation.

## User Scenarios & Testing

### User Story 1 — A client onboards with the dual-wallet flow (Priority: P1)

A new client visits `/connect`, picks the "I need legal help" role,
selects an EBSI identity wallet provider, shares an Over18 Verifiable
Credential, then connects their transaction wallet and signs a SIWE
message to authenticate.

**Why this priority**: This is the only legitimate entry point to any
client surface. Every booking, message, and consultation depends on it.

**Independent Test**: Open `/connect`, choose Client, pick any EBSI
provider (e.g. DS Wallet), confirm the Over18 step succeeds, pick a
transaction wallet (MetaMask), and verify the user lands at
`/client/home` with a session that carries `role = CLIENT` and the
chosen `ebsiWalletProvider`.

**Acceptance Scenarios**:

1. **Given** an unauthenticated visitor, **When** they open `/connect`,
   **Then** they see a "Welcome to Firmus Novus" role-selection card
   with two options: "I need legal help" and "I'm a lawyer."
2. **Given** the role is "client," **When** they continue past role,
   **Then** the stepper shows four stages: Role → Identity wallet →
   Age check → Transaction wallet.
3. **Given** the client is on the Identity wallet stage, **When** they
   pick one of the seven EBSI providers (DS Wallet, eKibisis,
   eDiplomas, SSI Auth, PwC-ID, IDENTFY, PrimusMoney) and click
   continue, **Then** they advance to the Age check stage.
4. **Given** the client is on the Age check stage, **When** they click
   "Share Over18 credential," **Then** the system simulates a wallet
   round-trip and marks the credential as verified, after which they
   may continue.
5. **Given** the client is on the Transaction wallet stage, **When**
   they pick MetaMask, WalletConnect, or Coinbase Wallet, **Then** the
   system simulates connect → sign and lands them at `/client/home`
   authenticated as a seeded client (Sarah Mueller in demo mode).
6. **Given** a successful sign-in, **When** the session is inspected,
   **Then** it carries `role`, `walletAddress`, and
   `ebsiWalletProvider` claims.

### User Story 2 — A lawyer onboards with a three-step flow (Priority: P1)

A new lawyer picks the "I'm a lawyer" role, selects an EBSI identity
wallet, then connects a transaction wallet and signs in. They land on
`/verify-lawyer` if they have not yet submitted credentials, or on
`/lawyer/dashboard` if they have.

**Why this priority**: Lawyers are the supply side of the marketplace.

**Independent Test**: From `/connect?role=lawyer`, complete identity →
transaction (no Age step), verify the user lands authenticated as a
seeded lawyer (Maria Chen in demo mode) with `role = LAWYER`.

**Acceptance Scenarios**:

1. **Given** the role is "lawyer," **When** they continue past role,
   **Then** the stepper shows three stages — no Age check.
2. **Given** a lawyer with no `LawyerProfile` row, **When** they finish
   sign-in, **Then** they are routed to `/verify-lawyer`.
3. **Given** a lawyer who has already submitted credentials, **When**
   they finish sign-in, **Then** they are routed to `/lawyer/dashboard`.

### User Story 3 — Demo-mode shortcuts the real wallet round-trip (Priority: P2)

In dev/demo mode, no real wallet is opened; the flow simulates the
timing and signs the user in as a deterministic seeded user via the
internal `/dev/sign-in` route.

**Why this priority**: The MVP ships at a hackathon — demos must be
deterministic and reliable on conference Wi-Fi.

**Acceptance Scenarios**:

1. **Given** demo mode is on, **When** the user picks any tx wallet,
   **Then** the chosen wallet brand is shown in the connecting spinner
   ("Connecting to MetaMask…"), even though no extension is opened.
2. **Given** demo mode is on, **When** sign-in completes, **Then** the
   client lands as `0x2222…0001` (Sarah Mueller) and the lawyer as
   `0x1111…0001` (Maria Chen).
3. **Given** the demo-mode banner, **When** the role page renders,
   **Then** it visibly states "wallet connections and signatures are
   simulated."

### Edge Cases

- A user revisits `/connect` while already authenticated — they are
  redirected to their role-appropriate home (`/client/home` or
  `/lawyer/dashboard`).
- The user goes back from Age check to Identity wallet — their picked
  provider is preserved.
- Sign-in fails mid-flow — an error banner with a "Try again" button is
  shown; no partial user record is created.
- The SIWE nonce is reused — the second attempt is rejected (one-time
  nonces).

## Requirements

### Functional Requirements

- **FR-001**: The system MUST present a role chooser at `/connect` with
  exactly two options: client ("I need legal help") and lawyer ("I'm a
  lawyer").
- **FR-002**: The system MUST require, in order: identity wallet
  selection → (clients only) Over18 VC share → transaction wallet
  connection → SIWE signature.
- **FR-003**: The system MUST offer exactly seven EBSI identity wallet
  providers (DS Wallet, eKibisis, eDiplomas, SSI Auth, PwC-ID, IDENTFY,
  PrimusMoney) and exactly three transaction wallet brands (MetaMask,
  WalletConnect, Coinbase Wallet).
- **FR-004**: The Over18 step MUST be presented as a Verifiable
  Credential request — a boolean attestation, with explicit copy that
  date of birth is never shared.
- **FR-005**: The system MUST verify the SIWE message and signature
  server-side using the `siwe` library and reject reused nonces.
- **FR-006**: The system MUST persist `walletAddress`, `role`, and the
  chosen `ebsiWalletProvider` on the User row.
- **FR-007**: The session MUST be JWT-strategy and carry the user's
  `id`, `role`, `walletAddress`, and `ebsiWalletProvider`.
- **FR-008**: In dev mode, a `dev-login` Credentials provider MUST be
  available to bypass real wallet flows for seeded users; it MUST NOT
  be exposed in production.
- **FR-009**: After successful sign-in, clients route to `/client/home`
  and lawyers route to `/lawyer/dashboard` (or `/verify-lawyer` if
  they have no LawyerProfile).
- **FR-010**: A demo-mode banner on the Role stage MUST disclose that
  wallet connections and signatures are simulated.

### Key Entities

- **User** — `id`, `walletAddress` (unique, lowercase hex),
  `role` (CLIENT | LAWYER), `ebsiWalletProvider` (one of the seven
  IDs, nullable until selected), `ageVerifiedAt` (set after the
  Over18 step for clients), `createdAt`, `updatedAt`.
- **Nonce** — `id`, `nonce` (unique), `used` (boolean), `createdAt`.
  One-time use; reused nonces fail authentication.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A new client can complete the full four-stage onboarding
  in under 90 seconds in demo mode.
- **SC-002**: 100% of issued SIWE nonces are single-use and rejected on
  reuse.
- **SC-003**: 0 sessions are issued without a verified SIWE signature
  in production mode.
- **SC-004**: The dual-wallet stepper is keyboard-navigable end-to-end.

## Assumptions

- The MVP demos against seeded users in dev mode; production replaces
  the `handleMockSignIn` shortcut with a real wagmi/viem connect-and-
  sign round-trip via RainbowKit.
- The Over18 step's 1.5-second sleep is replaced in production with an
  OID4VP request to the connected identity wallet, returning a
  boolean over18 attestation. No DOB is exchanged.
- A user's `walletAddress` is normalized to lowercase before lookup or
  insert.
- Auth pages are excluded from role-gated middleware. The matcher
  covers `/client/:path*`, `/lawyer/:path*`, and `/verify-lawyer`.
