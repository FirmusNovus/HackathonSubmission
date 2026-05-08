# Firmus Novus — Spec-Kit Translation (ETHPrague Hackathon Submission)

This directory holds a [Spec Kit](https://github.github.io/spec-kit/)
translation of the Firmus Novus MVP that lives in the parent directory
(`../`). It captures the existing implementation as a constitution +
six feature specifications + a cross-feature implementation plan — the
shape Spec Kit expects so that future work can be planned and executed
with the `/speckit-*` skills.

## Layout

```
.specify/                              # Spec-Kit toolkit (templates, scripts, skills)
.specify/memory/constitution.md        # Brand, currency, dual-wallet, design tokens
.claude/skills/speckit-*/              # /speckit-constitution, /speckit-specify, …
specs/
├── plan.md                            # Cross-feature implementation plan
├── 001-marketing-and-discovery/
├── 002-onboarding-and-auth/
├── 003-lawyer-verification/
├── 004-booking-and-escrow/
├── 005-consultation-and-messaging/
└── 006-lawyer-workspace/
design/                                # Full design system (see design/README.md)
├── foundations/                       # color, typography, spacing, motion, a11y, copy
├── css/                               # tokens.css, base.css, components.css, globals.css
├── components.md                      # component catalog
└── pages.md                           # all 12 views with layout maps
```

## How to use this from Claude Code

1. From inside this directory, start Claude Code.
2. Read the constitution: `.specify/memory/constitution.md`.
3. For any feature, open `specs/NNN-…/spec.md` and run
   `/speckit-plan` to expand `plan.md`, `research.md`, `data-model.md`,
   `quickstart.md`, and `contracts/`.
4. Then `/speckit-tasks` to generate `tasks.md`.
5. Then `/speckit-implement` to execute against the parent
   implementation, or against a fresh build inside this directory.

## What was translated

Twelve UI views + the API + the schema + the brand rules from the
parent repo were collapsed into:

- **Constitution** — the seven non-negotiables (brand, EUR, dual
  wallet, quiet web3, design tokens, role-gating, real persistence /
  stubbed crypto plumbing) plus scope boundaries and engineering
  workflow.
- **Six feature specs** — each one independently testable, with user
  stories prioritized P1/P2, acceptance scenarios in
  Given/When/Then form, functional requirements, key entities, and
  measurable success criteria.
- **One cross-feature plan** — the technology choices, project
  structure, constitution-check gates, and complexity-tracking
  table covering all six specs in one place.

## Source-of-truth mapping

| Spec | Parent files translated |
|------|-------------------------|
| 001 marketing-and-discovery | `app/page.tsx`, `app/lawyers/page.tsx`, `app/lawyers/[id]/page.tsx`, `app/lawyers/directory-filters.tsx`, `app/api/lawyers/*` |
| 002 onboarding-and-auth | `app/connect/*`, `lib/auth/config.ts`, `lib/web3/ebsi.ts`, `app/api/auth/*`, `middleware.ts` |
| 003 lawyer-verification | `app/verify-lawyer/*`, `app/api/verification/route.ts`, `app/api/admin/verify-lawyer/route.ts`, `app/api/uploads/*` |
| 004 booking-and-escrow | `app/client/home/page.tsx`, `app/client/book/[lawyerId]/*`, `app/api/bookings/*`, `lib/web3/escrow.ts` |
| 005 consultation-and-messaging | `app/client/consultation/[bookingId]/*`, `app/lawyer/consultation/[bookingId]/*`, `app/{client,lawyer}/messages/*`, `app/api/messages/route.ts`, `app/api/bookings/[id]/complete/route.ts` |
| 006 lawyer-workspace | `app/lawyer/dashboard/page.tsx`, `app/lawyer/requests/*`, `app/lawyer/profile/edit/*`, `app/api/lawyer/profile/route.ts`, `lib/utils/anonymize.ts` |
