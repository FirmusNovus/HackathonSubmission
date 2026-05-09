# Implementation Plan: Lawyer Workspace

**Branch**: `006-lawyer-workspace` | **Date**: 2026-05-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-lawyer-workspace/spec.md`

## Summary

Three lawyer-side surfaces: dashboard (`/lawyer/dashboard`) batches
five DB queries into a single Promise.all to render at-a-glance stats,
today's schedule, and the five most recent requests; request review
(`/lawyer/requests/[id]`) shows an anonymized client identifier and
fee breakdown with Accept / Decline; profile editor
(`/lawyer/profile/edit`) is a tabbed form with a live preview pane
and a sticky save bar that PATCHes
`/api/lawyer/profile` with zod-validated input.

## Technical Context

**Language/Version**: TypeScript 5.7 strict
**Primary Dependencies**: `next@15.1`, `react@19`, `react-hook-form@7`,
`zod@3`, `@prisma/client@6`, `next-auth@5`, `@radix-ui/react-tabs`
**Storage**: PostgreSQL — `LawyerProfile`, `Booking`, `User`
**Testing**: Playwright (`tests/e2e/lawyer-dashboard.spec.ts`,
`tests/e2e/profile-editor.spec.ts`); a unit test for
`anonymousClientId()` stability
**Target Platform**: Modern desktop browsers (primary), responsive
mobile
**Project Type**: Web application
**Performance Goals**: Dashboard data batch < 1.2 s on warm Postgres;
profile save < 800 ms
**Constraints**: Anonymized client identifier on the request review
page until acceptance; ownership check on every workspace surface;
profile PATCH restricted to the signed-in lawyer's own row
**Scale/Scope**: Three pages, one PATCH endpoint, plus the
already-shipped accept/decline endpoints (spec 004)

## Constitution Check

| Principle | Compliance |
|---|---|
| I. Brand & Naming | Top bar reads "Firmus Novus"; the editor previews the public profile faithfully. ✅ |
| II. Tokenized EUR | Stat card "30-day net earnings" uses `formatEUR()`; the editor exposes `hourlyRateEUR`, `consultationRate30/60` as EUR-named fields. ✅ |
| III. Dual-Wallet Identity | Workspace requires a verified lawyer with both wallets bound; no wallet UI here. ✅ |
| IV. Quiet Web3, Loud Trust | Request review shows the anonymized client identifier in monospace — the only Web3-flavoured signal — paired with "Anonymous identifier · wallet verified." ✅ |
| V. Design Tokens | Stat cards use Fraunces 28-px numerals; profile editor preview reuses the public `LawyerCard` shape. lucide icons on every action. ✅ |
| VI. Role-Gated Routing | `/lawyer/*` is LAWYER-only via middleware; pages double-check via `requireLawyer()` and verify booking ownership on the request review page. ✅ |
| VII. Real Persistence, Stubbed Plumbing | All three surfaces read/write live Postgres. No crypto plumbing in this feature beyond what specs 003 / 004 stubbed. ✅ |

No violations.

## Project Structure

### Documentation (this feature)

```text
specs/006-lawyer-workspace/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── lawyer-profile-patch.md   # PATCH /api/lawyer/profile
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
app/
├── lawyer/
│   ├── layout.tsx                              # auth gate (LAWYER)
│   ├── dashboard/page.tsx                      # 10. Stats + schedule + requests
│   ├── requests/
│   │   ├── page.tsx                            # list (helper)
│   │   ├── [id]/page.tsx                       # 11. Anonymized request review
│   │   └── [id]/request-actions.tsx            # client component for accept/decline
│   └── profile/edit/
│       ├── page.tsx                            # 12. Editor shell
│       └── profile-editor.tsx                  # tabbed form + preview pane
└── api/lawyer/profile/route.ts                 # PATCH (zod-validated)
components/
├── firmus/
│   ├── empty-state.tsx
│   └── status-pill.tsx
└── layout/app-top-bar.tsx
lib/
├── auth/session.ts                             # `requireLawyer()`
└── utils/anonymize.ts                          # wallet → anonymous identifier
prisma/schema.prisma                            # LawyerProfile (editable subset)
tests/e2e/{lawyer-dashboard,profile-editor}.spec.ts
```

**Structure Decision**: Single Next.js app. The editor's live preview
intentionally reuses the public `LawyerCard`/profile-sidebar
components from spec 001 so preview drift is impossible — one
component, two contexts.

## Complexity Tracking

> Constitution Check passes — no violations to justify.
