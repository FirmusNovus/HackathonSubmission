# Implementation Plan: Marketing & Lawyer Discovery

**Branch**: `001-marketing-and-discovery` | **Date**: 2026-05-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-marketing-and-discovery/spec.md`

## Summary

Three server-rendered, public marketing surfaces — Landing (`/`), Lawyer
Directory (`/lawyers`), and Lawyer Profile (`/lawyers/[id]`) — that
introduce the EBSI trust message, list every VERIFIED lawyer with
filter chips, and convert a profile view into a booking click-through.
Approach: Next.js 15 App Router server components with Prisma reads;
filter state in the URL; one feature card component (`LawyerCard`)
shared across the directory and the recently-joined section.

## Technical Context

**Language/Version**: TypeScript 5.7 strict, Node 20+
**Primary Dependencies**: `next@15.1`, `react@19`, `@prisma/client@6`,
`tailwindcss@4`, `lucide-react`, Radix primitives via `components/ui/*`,
`class-variance-authority`, `tailwind-merge`
**Storage**: PostgreSQL 16 — read-only on this surface
(`LawyerProfile` + `User`)
**Testing**: Playwright E2E (`tests/e2e/landing.spec.ts`,
`tests/e2e/directory.spec.ts`)
**Target Platform**: Modern desktop + mobile browsers; SSR for SEO
**Project Type**: Web application (Next.js full-stack)
**Performance Goals**: Landing TTFB < 800 ms on warm Postgres in dev;
directory list with 12 rows < 1 s
**Constraints**: WCAG AA contrast; EBSI gold under 5% visual weight;
no client-side JavaScript required to read the hero or click "Find a
Lawyer"
**Scale/Scope**: Three pages, ~12 seeded lawyers, ~600 expected at
production scale (single Postgres instance is sufficient)

## Constitution Check

| Principle | Compliance |
|---|---|
| I. Brand & Naming | "Firmus Novus" hard-coded in `MarketingNav`, `Footer`, `<title>`. No "Lex Nova" anywhere. ✅ |
| II. Tokenized EUR | Every price string passes through `formatEUR()`; lawyer cards render `pricingHeadline` (`€240 / hr`, etc.). ✅ |
| III. Dual-Wallet Identity | Marketing surfaces are pre-auth — wallet flow not invoked here, but the "Book a consultation" CTA routes unauthenticated visitors to `/connect?role=client`. ✅ |
| IV. Quiet Web3, Loud Trust | Hero copy: "Verified Legal Counsel, On-Chain." (the only crypto word in the headline); "smart contract" forbidden in marketing copy. ✅ |
| V. Design Tokens | Teal CTA, gold EBSI badge in hero/trust strip and lawyer cards (under 5% area). Inter + Fraunces; lucide icons only. ✅ |
| VI. Role-Gated Routing | `/lawyers` and `/lawyers/[id]` are public — outside the role-gated middleware matcher. ✅ |
| VII. Real Persistence, Stubbed Plumbing | Directory and profile read live from Prisma. No crypto plumbing exercised here. ✅ |

No violations.

## Project Structure

### Documentation (this feature)

```text
specs/001-marketing-and-discovery/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (REST endpoint shapes)
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
app/
├── page.tsx                              # 1. Landing (server component)
├── lawyers/
│   ├── page.tsx                          # 2. Directory (server)
│   ├── directory-filters.tsx             # client component for chip filters
│   └── [id]/page.tsx                     # 3. Profile (server)
└── api/
    ├── lawyers/route.ts                  # GET list (filter, sort)
    └── lawyers/[id]/route.ts             # GET one
components/
├── firmus/
│   ├── lawyer-card.tsx                   # shared card primitive
│   ├── ebsi-badge.tsx
│   ├── network-pattern.tsx               # hero backdrop
│   ├── stars.tsx
│   └── pricing-badge.tsx
├── layout/
│   ├── marketing-nav.tsx
│   └── footer.tsx
└── ui/                                   # Button, Badge, Chip, Tabs, Card
lib/
└── db/client.ts                          # Prisma singleton
tests/e2e/
├── landing.spec.ts                       # hero + recently joined render
└── directory.spec.ts                     # filter narrows list; card → profile
```

**Structure Decision**: Single Next.js application; this feature ships as
three pages plus two read endpoints. No new top-level directories
introduced.

## Complexity Tracking

> Constitution Check passes — no violations to justify.
