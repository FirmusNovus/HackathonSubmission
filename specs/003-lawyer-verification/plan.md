# Implementation Plan: Lawyer Verification

**Branch**: `003-lawyer-verification` | **Date**: 2026-05-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-lawyer-verification/spec.md`

## Summary

A submission form that captures bar credentials and supporting documents,
creates a `PENDING` LawyerProfile, and routes the user through one of
three verification paths: dev auto-verify (timer-based), admin
key-gated POST, or stubbed EBSI Trusted Issuers Registry round-trip.
File uploads land on local disk under `/uploads/credentials/<userId>`
and are served back through an auth-checked download route.

## Technical Context

**Language/Version**: TypeScript 5.7 strict
**Primary Dependencies**: `next@15.1`, `react-hook-form@7`, `zod@3`,
`@prisma/client@6`, `next-auth@5`
**Storage**: PostgreSQL (`LawyerProfile`); local disk for uploads
**Testing**: Playwright (`tests/e2e/verify-lawyer.spec.ts`); a unit
test for the admin endpoint key check
**Target Platform**: Modern browsers
**Project Type**: Web application
**Performance Goals**: Form submission < 1 s; auto-verify timer
honoured within ±1 s
**Constraints**: Auth-checked downloads (only the owning lawyer or
admin); admin endpoint requires `x-admin-key` header; dev auto-verify
gated by `DEV_AUTO_VERIFY_SECONDS` env (0 disables)
**Scale/Scope**: One submission form, one server action, two API
routes (`/api/verification`, `/api/admin/verify-lawyer`), two upload
routes (POST + GET), one EBSI stub

## Constitution Check

| Principle | Compliance |
|---|---|
| I. Brand & Naming | EBSI verification rail copy uses "Firmus Novus." ✅ |
| II. Tokenized EUR | The `hourlyRateEUR` and consultation rate fields are EUR-named in the Prisma schema; the form labels read `(EUR)`. ✅ |
| III. Dual-Wallet Identity | Verification requires the lawyer to be authenticated — i.e. they have completed the dual-wallet flow (spec 002). ✅ |
| IV. Quiet Web3, Loud Trust | Verification rail headlines lead with EBSI; "smart contract" never appears. ✅ |
| V. Design Tokens | Drop-zone uses dashed slate-200 border; verification rail header carries the EBSI seal. Form fields use the standard `Input`/`Label` primitives. ✅ |
| VI. Role-Gated Routing | `/verify-lawyer` is in the middleware matcher; allows authenticated users regardless of role to support post-onboarding submission. ✅ |
| VII. Real Persistence, Stubbed Plumbing | LawyerProfile rows are real; `verifyLawyerCredentials()` in `lib/web3/ebsi.ts` is the labelled stub for the production swap. ✅ |

No violations.

## Project Structure

### Documentation (this feature)

```text
specs/003-lawyer-verification/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── verification.md          # POST /api/verification
│   ├── admin-verify.md          # POST /api/admin/verify-lawyer
│   ├── upload.md                # POST /api/uploads
│   └── upload-download.md       # GET /api/uploads/[...path]
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
app/
├── verify-lawyer/
│   ├── page.tsx                          # Server component (auth gate)
│   └── verify-lawyer-form.tsx            # Client form (zod)
└── api/
    ├── verification/route.ts             # POST submission handler
    ├── admin/verify-lawyer/route.ts      # POST admin key-gated verify
    └── uploads/
        ├── route.ts                      # POST upload (multipart)
        └── [...path]/route.ts            # GET (auth-checked download)
lib/
├── auth/session.ts                       # `requireUser()` for verify-lawyer
└── web3/ebsi.ts                          # `verifyLawyerCredentials()` stub
prisma/schema.prisma                      # LawyerProfile (PENDING/VERIFIED/REJECTED)
tests/e2e/verify-lawyer.spec.ts
```

**Structure Decision**: Single Next.js app; the form, the submission
endpoint, the admin endpoint, and the upload routes ship in one
feature directory. Uploads live on local disk for the MVP — see
constitution VII.

## Complexity Tracking

> Constitution Check passes — no violations to justify.
