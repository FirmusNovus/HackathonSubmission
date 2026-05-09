# Implementation Plan: Onboarding & Authentication

**Branch**: `002-onboarding-and-auth` | **Date**: 2026-05-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-onboarding-and-auth/spec.md`

## Summary

A four-stage client onboarding (and three-stage lawyer onboarding) that
binds an EBSI-conformant identity wallet, an Over18 Verifiable
Credential (clients only), and a transaction wallet to a User row,
authenticated via SIWE on the transaction wallet. Implemented as one
client-side state machine in `connect-flow.tsx` plus a NextAuth
Credentials provider that verifies SIWE messages and one-time nonces
server-side. A dev-only Credentials provider shortcuts the flow to
seeded users for hackathon demos.

## Technical Context

**Language/Version**: TypeScript 5.7 strict
**Primary Dependencies**: `next-auth@5` (beta), `siwe@3`, `wagmi@2`,
`viem@2`, `@rainbow-me/rainbowkit@2`, `@prisma/client@6`,
`react-hook-form@7`, `zod@3`
**Storage**: PostgreSQL — `User`, `Nonce` tables
**Testing**: Playwright (`tests/e2e/connect.spec.ts`) + a unit test for
SIWE nonce reuse rejection
**Target Platform**: Modern browsers with browser-extension or
WalletConnect support
**Project Type**: Web application
**Performance Goals**: Full client onboarding < 90 s in demo mode;
SIWE verify < 200 ms server-side
**Constraints**: One-time nonces; lowercase wallet address
normalization; dev-login provider MUST NOT be exposed in production;
Over18 step is a boolean attestation — DOB never exchanged
**Scale/Scope**: Two routes (`/connect`, `/dev/sign-in`), one
NextAuth handler, two Credentials providers (SIWE, dev-login), one
multi-stage form

## Constitution Check

| Principle | Compliance |
|---|---|
| I. Brand & Naming | "Firmus Novus" appears in onboarding card greeting; no Lex Nova. ✅ |
| II. Tokenized EUR | Onboarding does not show prices; the rule is upheld vacuously. ✅ |
| III. Dual-Wallet Identity | Order is enforced by the `Stage` state machine: `role → ebsi → age (clients) → tx`. The seven EBSI providers and three tx-wallet brands are hard-coded in `lib/web3/ebsi.ts` to prevent drift. ✅ |
| IV. Quiet Web3, Loud Trust | Stage pills read "EBSI · STEP …" (gold) and "PAYMENTS · STEP …" (teal). The Over18 card foregrounds eIDAS and the boolean attestation; "wallet" / "credential" never collapse to "crypto." ✅ |
| V. Design Tokens | Stepper uses teal-500 active / done; gold-tinted EBSI pill on identity stages; teal pill on transaction stage. lucide icons only (`Shield`, `Lock`, `Check`). ✅ |
| VI. Role-Gated Routing | `/connect` is public. After sign-in, the auth callback redirects clients to `/client/home` and lawyers to `/lawyer/dashboard` (or `/verify-lawyer`). The `authorized` callback rejects role-mismatched URLs. ✅ |
| VII. Real Persistence, Stubbed Plumbing | SIWE verification is real (`siwe.verify()` + nonce row). The wallet round-trip is real via wagmi/RainbowKit in production; in dev the `handleMockSignIn` shortcut bypasses to `/dev/sign-in`. The Over18 VC request is a 1.5-s sleep stub — labelled. ✅ |

No violations.

## Project Structure

### Documentation (this feature)

```text
specs/002-onboarding-and-auth/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── auth.md          # NextAuth Credentials providers contract
│   └── nonce.md         # GET /api/auth/nonce contract
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
app/
├── connect/
│   ├── page.tsx                          # Server component (auth-aware redirect)
│   └── connect-flow.tsx                  # Client state machine
├── dev/sign-in/route.ts                  # Dev-only seeded sign-in shortcut
└── api/auth/
    ├── [...nextauth]/route.ts            # NextAuth handlers
    └── nonce/route.ts                    # Mint one-time SIWE nonces
lib/
├── auth/
│   ├── config.ts                         # NextAuth config + SIWE Credentials
│   └── session.ts                        # `requireClient()`, `requireLawyer()`
└── web3/
    └── ebsi.ts                           # EBSI provider list (frozen),
                                          # Over18 stub, lawyer-cred stub
middleware.ts                             # role-gated route matcher
prisma/schema.prisma                      # User, Nonce models
tests/e2e/connect.spec.ts
```

**Structure Decision**: Single Next.js app; the onboarding state machine
lives in one client component to keep the four/three-stage flow
visible at one glance. The dev shortcut is a separate route (not a
fork inside the auth callback) so it can be tree-shaken in production
builds.

## Complexity Tracking

> Constitution Check passes — no violations to justify.
