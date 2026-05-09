# System B — `kyles-attempt`

> Location: `/home/kyle/programming/firmusnovus/ethprague/kyles-attempt/`
> Tagline (informal): "a good frontend creation of firmusnovus, a decentralized law firm"
>
> What it actually is: a single Next.js 15 application that takes the same Firmus Novus product brief — verified European lawyers, pseudonymous clients, escrowed consultations, encrypted-feel chat — and renders it as a polished, demo-grade marketplace. The Web3 substrate is **stubbed but isolated**: the data model anticipates EBSI credentials, escrow tx hashes, and on-chain anchoring, but the actual smart contract calls, ZK circuits, and OID4VCI/OID4VP flows are mocked behind clearly-named seams. The point is to prove the *user experience* — the lawyer's view of an incoming request, the client's view of a consultation room, the transition from booking to escrow to release — without waiting for the cryptographic infrastructure to land.

---

## 1. Executive summary

This is the "Web2 frontend with Web3 seams" version of Firmus Novus. The user-visible product is a complete legal marketplace: landing page, lawyer directory with filters, lawyer profile with About/Credentials/Reviews/Availability, dual-wallet onboarding (EBSI identity wallet + transaction wallet), client home with category chips, booking + invoice form, consultation room with chat and escrow indicator, lawyer dashboard with stats, request review with anonymous client identifier, profile editor with live preview, invoice editor, and a verification submission flow. Auth is real (NextAuth + SIWE with nonce verification). Data is real (Prisma + SQLite, full schema covering bookings, line items, deliverables, conversations, messages, EBSI credential IDs, escrow tx hashes). What's stubbed: the actual escrow contract calls (return fake tx hashes after a delay), the actual EBSI credential exchange (the wallet picker is real UI; the credential round-trip is a 1.5s setTimeout), and the video room (placeholder tiles next to a real chat).

The constitution governing this implementation lives in `/home/kyle/programming/firmusnovus/ethprague/.specify/memory/constitution.md` (v1.1.0) and is the same one that governs System A. The active spec is at `specs/001-verified-legal-engagement/spec.md` and is the same one. Both implementations target the same product; this one prioritizes UX completeness over cryptographic depth.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, RSC), React 19, TypeScript strict |
| Database | Prisma 6 + SQLite (Postgres-ready) |
| Auth | NextAuth v5 (Auth.js) Credentials provider + SIWE message verification |
| Wallets | wagmi 2 + viem 2 + RainbowKit (mocked in MVP, real in prod) |
| Styling | Tailwind CSS v4 with `@theme` design tokens |
| UI primitives | Radix UI composed into shadcn-style components, Class Variance Authority |
| Icons | lucide-react (no emoji) |
| Forms | react-hook-form + Zod (validation runs both client- and server-side) |
| E2E tests | Playwright (10 spec files; runs against `next start` on port 3100) |
| File storage | Local disk under `/uploads/` (cloud in production) |

The tokens (navy primary, teal action, gold for verification — held under 5% of visual weight — Inter for UI, Fraunces for display, monospace for addresses) are baked into `app/globals.css`. WCAG AA throughout.

---

## 3. Database schema (`prisma/schema.prisma`)

Six models. SQLite forces some shape choices: scalar arrays are stored as JSON-encoded strings, helpers in `lib/db/json-array.ts` (`parseStrArray`, `stringifyStrArray`, `containsValue`, `expandLawyerProfile`) handle parse/stringify and let SQLite filter inside JSON columns.

### 3.1 `User`
- `id` (cuid), `walletAddress` (unique) — the **stable identifier** for session resolution; cuid can go stale across DB resets
- `role` ("CLIENT" | "LAWYER")
- `email?`, `name?`, `avatarUrl?`
- `ebsiWalletProvider?` — selected EBSI wallet provider id
- `ageVerifiedAt?` — set when Over18 VC verified (clients only)
- relations: `lawyerProfile` (1:1), `clientBookings` (1:n), `conversations` (n:m), `messages` (1:n)

### 3.2 `Nonce`
- One-time SIWE nonces; `used` boolean prevents replay.

### 3.3 `LawyerProfile`
- `userId` unique → User
- `city`, `headline`, `bio`
- `specialties`, `languages`, `jurisdictions`, `tags`, `credentialDocsUrl` — all JSON-encoded arrays; `tags` is derived from the first three specialties for filterable display
- `pricingKind` ("HOURLY" | "FIXED" | "SUBSCRIPTION" | "SUCCESS"), `pricingHeadline`, `hourlyRateEUR`, `consultationRate30`, `consultationRate60`, `pricingItems` (JSON: `[{title, desc, price, unit}]` for FIXED/SUBSCRIPTION)
- `yearsExperience`
- `verificationStatus` ("PENDING" | "VERIFIED" | "REJECTED")
- `ebsiCredentialId?` — EBSI credential id after successful verification
- `barRegistrationNum`, `barJurisdiction`, `admissionDate`
- `rating`, `reviewCount` (seeded; not yet computed in MVP)
- `availability?` (placeholder, not yet implemented)

### 3.4 `Booking`
- `clientId`, `lawyerProfileId`
- `scheduledAt`, `durationMinutes` (30 or 60)
- `lineItems` (JSON: `[{id, title, description, kind ("hourly"|"fixed"), hours?, ratePerHour?, fixedPrice?, subtotal}]`)
- `deliverables` (JSON: `[{id, title, description}]`)
- `clientAcceptedAt?`, `lawyerAcceptedAt?` — dual-sign timeline
- `consultationFeeEUR`, `platformFeeEUR` (5%)
- `status` ("REQUESTED" | "ACCEPTED" | "DECLINED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "DISPUTED")
- `caseDescription`, `practiceArea`
- `escrowTxHash?`, `escrowReleaseHash?` — stubs return fake hashes; the column is real and ready for chain output
- relations: `client`, `lawyerProfile`, `conversation` (1:1)

### 3.5 `Conversation`
- `bookingId` unique → Booking
- `participants` (n:m → User)

### 3.6 `Message`
- `conversationId`, `senderId`
- `content` (plaintext in MVP — would be ciphertext in production), `attachmentUrl?`, `attachmentType?`
- index `(conversationId, createdAt)` for chronological reads

Enums (`Role`, `VerificationStatus`, `BookingStatus`, `PricingKind`) live as TypeScript constants in `lib/db/enums.ts` because SQLite doesn't support native enums.

---

## 4. Pages and routes

### 4.1 Public

**`/` — Landing.** `MarketingNav`, hero, "How It Works" three-step explainer, trust strip with stats (614 lawyers, 27 jurisdictions, 12,400+ consultations), "Recently Joined" grid showing the three most recently verified lawyers. Signed-in users redirect to their role home.

**`/lawyers` — Directory.** Search by name/headline/bio; filters for practice area (tags), language, pricing kind. Sticky left sidebar; 2-column card grid; ordered by `rating DESC, reviewCount DESC`. SQLite queries use the `containsValue()` helper to filter inside JSON-array columns.

**`/lawyers/[id]` — Public profile.** Tabs (About / Credentials / Reviews / Availability — only About is implemented; the others are placeholder headers waiting for content). Sticky booking sidebar with consultation rates.

**`/connect` — Onboarding.** Multi-stage flow:
1. Role picker (Client / Lawyer)
2. EBSI wallet provider picker — DS, eKibisis, eDiplomas, SSI Auth, PwC-ID, IDENTFY, PrimusMoney
3. (Clients only) Age verification — mocked 1.5s delay; production would do an OID4VP request for an Over18 VC
4. Transaction wallet picker — MetaMask / WalletConnect / Coinbase via RainbowKit (mocked in dev to seeded addresses)

In dev mode the connect flow is bypassable via `/dev/sign-in?wallet=…&role=…&redirect=…`.

**`/verify-lawyer` — Credential submission.** Form for name, email, city, headline, bio, bar registration number, jurisdiction, admission date, specialties, languages, jurisdictions, hourly rate, pricing model, years of experience. File upload zones for credential documents. EBSI badge sidebar explaining the 48-hour verification window. Three-step progress rail (Identity done → Credentials active → Review todo). On submit: `POST /api/verification` creates/updates `LawyerProfile` in PENDING. In dev, `DEV_AUTO_VERIFY_SECONDS` (default 5s) auto-promotes to VERIFIED.

### 4.2 Client routes (gated by `requireClient()` in `/client/layout.tsx`)

**`/client/home` — Dashboard.** Greeting, category chips (All / Family / Property / Employment / Immigration / Business / Tax / Estate), search box, featured active booking with "Join room" button, recommended lawyers grid (6 cards filtered by category tag), category-specific sample services from the `CATEGORY_SERVICES` lookup.

**`/client/cases` — Redirects to `/client/home`.**

**`/client/book/[lawyerId]` — Booking form.** Duration (30/60), date/time, practice area select, case description (required), fee summary (consultation fee + 5% platform fee + total), "Sign & send invoice" CTA. POSTs to `/api/bookings`, which creates the booking in REQUESTED, sets `clientAcceptedAt`, creates the conversation, and redirects.

**`/client/consultation/[bookingId]` — Consultation room (dark mode).** Header with `FirmusLogo`, "Mark Complete" button, practice area + status chip. Video grid (two placeholder tiles). Controls: Mute, Camera, Screen Share, Leave. Right rail (360px): case metadata, funds-in-escrow indicator, scrollable chat with auto-scroll-to-bottom, message input. Messages refresh via `GET /api/messages?conversationId=…` every 5s; sends via POST. Video is stubbed.

**`/client/messages` — Messages list.** Thread index by booking; click to view inline.

### 4.3 Lawyer routes (gated by `requireLawyer()` in `/lawyer/layout.tsx`)

**`/lawyer/dashboard` — Home.** "Good morning, [name]". Four stats: pending requests, upcoming this-week, active consultations, 30-day earnings. Today's schedule. Recent requests (5 most recent REQUESTED). Empty state if no profile, redirecting to `/verify-lawyer`.

**`/lawyer/requests` and `/lawyer/requests/[id]` — Inbox + review.** Anonymous client identifier `#4A · 2f` derived from wallet (the `anonymousClientId()` helper). Practice area, bar jurisdiction, requested time, duration, case description, fee breakdown (consultation, 5% platform, net to lawyer). Invoice preview via `InvoiceCard`. Conflict-check badge (hardcoded pass in MVP). Accept calls `/api/bookings/[id]/accept`, which calls the escrow stub if fee > 0. Decline calls `/api/bookings/[id]/decline`.

**`/lawyer/consultation/[bookingId]` — Mirror of the client room.**

**`/lawyer/profile/edit` — Editor.** Tabs (Bio / Specialties / Availability / Avatar). Form for headline, bio, specialties, languages, jurisdictions, pricing kind/headline, hourly rate. Live preview of the lawyer card. Sticky save bar. PATCHes `/api/lawyer/profile`. Bar info is immutable (would come from credential).

**`/lawyer/messages` — Lawyer-side messages list.**

**`/lawyer/invoices/new` — Ad-hoc invoice creation.** Line items (hourly or fixed), deliverables, total + platform fee preview.

### 4.4 Dev-only

**`/dev/sign-in` — Dev login helper** for Playwright (`devSignIn(page, {wallet, role})` calls it).

---

## 5. API routes

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/[...nextauth]` | — | NextAuth (Credentials: SIWE or dev) |
| `GET` | `/api/lawyers` | — | Directory with filters: `q`, `practice[]`, `lang[]`, `pricing[]`, `minRate`, `maxRate` |
| `GET` | `/api/lawyers/[id]` | — | Single profile |
| `PATCH` | `/api/lawyer/profile` | requireLawyer | Lawyer updates editable fields; bar info immutable |
| `POST` | `/api/bookings` | requireClient | Create booking REQUESTED with `clientAcceptedAt` set, create conversation |
| `GET` | `/api/bookings` | session | Returns user's bookings (clients see theirs; lawyers see those for their profile) |
| `GET` | `/api/bookings/[id]` | session | Single booking (ownership-checked) |
| `POST` | `/api/bookings/[id]/accept` | requireLawyer | Requires `clientAcceptedAt`; calls `createEscrow()` stub if fee > 0; sets ACCEPTED + `lawyerAcceptedAt` + fake `escrowTxHash` |
| `POST` | `/api/bookings/[id]/decline` | requireLawyer | DECLINED; mutual-refund flow seam |
| `POST` | `/api/bookings/[id]/complete` | requireClient | Calls `releaseEscrow()` stub; sets COMPLETED + `escrowReleaseHash` |
| `POST` | `/api/bookings/[id]/sign` | session | Co-signing seam (also referenced by client/lawyer) |
| `GET` | `/api/messages?conversationId=…` | session | Returns messages chronologically; participant check |
| `POST` | `/api/messages` | session | Send `{conversationId, content (1-4000), attachmentUrl?, attachmentType?}` |
| `POST` | `/api/uploads` | requireCurrentUser | multipart `file` + `purpose`; MIME and 10MB limit; writes to `/uploads/{purpose}/{userId}/{ts}-{name}` |
| `GET` | `/api/uploads/[...path]` | session | Serves file with ownership check |
| `POST` | `/api/verification` | requireLawyer | Creates/updates `LawyerProfile` PENDING; calls `verifyLawyerCredentials()` stub; in dev auto-VERIFIED after `DEV_AUTO_VERIFY_SECONDS` |
| `POST` | `/api/admin/verify-lawyer` | `x-admin-key` header == `ADMIN_API_KEY` | Manual status override (mints stub `ebsiCredentialId` on VERIFY) |
| `GET` | `/api/lawyer/invoices` | requireLawyer | Lawyer's invoices/proposals |

All write endpoints validate via Zod on the server in addition to client-side validation.

---

## 6. Auth and sessions

`lib/auth/config.ts` configures NextAuth with a Credentials provider. The flow:

1. Browser collects role + EBSI provider + tx wallet selection through the `/connect` stages.
2. Browser builds the SIWE message: `firmusnovus.com wants you to sign in with your Ethereum account: 0x… Sign in to Firmus Novus as a client. URI: https://… Version: 1 Chain ID: 1 Nonce: <random> Issued At: <ISO>`.
3. Wallet (or mock) signs.
4. POST to `/api/auth/signin` with signature + message.
5. Server parses, calls `SiweMessage.verify(signature)`, looks up nonce in `Nonce` table, marks used.
6. Looks up or creates `User` by `walletAddress` (lowercased), sets `role` and `ebsiWalletProvider` from form values.
7. JWT session: `{id, role, walletAddress, ebsiWalletProvider, name?, email?, image?}`.
8. Session cookie set; redirect to role home.

`lib/auth/session.ts` exposes `requireSession()`, `requireClient()`, `requireLawyer()`, `getCurrentUser()`. Critically, `getCurrentUser()` resolves the user **by wallet address, not by JWT cuid** — because the cuid can go stale across dev DB resets but the wallet address is stable.

`middleware.ts` protects `/client/*`, `/lawyer/*`, `/verify-lawyer` with role checks.

**Dev bypass.** When `NODE_ENV !== "production"` or `ENABLE_MOCK_AUTH === "true"`, a dev-login Credentials provider activates, accepting `wallet` + `role` query params directly. Used by Playwright via the `devSignIn` helper and by `/dev/sign-in`.

---

## 7. Library layout

**`lib/auth/`** — `config.ts` (NextAuth + Credentials + JWT/session callbacks + middleware matcher) and `session.ts` (the require-* helpers).

**`lib/web3/`** — the seams for the future Web3 surface:
- `escrow.ts` — `createEscrow`, `releaseEscrow`, `disputeEscrow` stubs returning fake tx hashes after 1.5–2s delays
- `ebsi.ts` — `EBSI_WALLET_PROVIDERS` list, `requestOver18Credential()` stub, `verifyLawyerCredentials()` stub returning a generated EBSI credential id
- `config.ts` — intentionally empty (wallets mocked)

**`lib/db/`** — `client.ts` (Prisma singleton, lazy-init), `enums.ts` (the four enum constants), `json-array.ts` (the SQLite JSON-array helpers and `expandLawyerProfile()` to narrow strings to union types when reading from the DB).

**`lib/utils/`** — `format.ts` (`formatEUR`, `truncateAddress`, `formatScheduled`, `formatRelativeDay`), `anonymize.ts` (`anonymousClientId()` deriving `#4A · 2f` from wallet, stable per wallet), `cn.ts` (`clsx` + `tailwind-merge`), `booking.ts` (`isJoinableNow`, `joinabilityReason`).

---

## 8. Components

**Primitives (`components/ui/`).** Button, Input, Select, Textarea, Dialog, Tabs, RadioGroup, Checkbox, Label, Toast, Badge — built on Radix + CVA.

**Domain (`components/firmus/`).** `LawyerCard`, `AvatarBubble`, `Stars`, `PricingBadge`, `EBSIBadge`, `FirmusLogo`, `EscrowStatusIndicator`, `InvoiceCard`, `InvoiceEditor`, `NetworkPattern`, `EmptyState`, `Skeleton`, `StatusPill`, `WalletButton`.

**Layout (`components/layout/`).** `MarketingNav`, `AppTopBar`, `Footer`, `AuthShell`.

The design system is intentional: no emoji, lucide icons everywhere, gold reserved for verification badges and held under 5% of visual weight, monospace strictly for addresses.

---

## 9. Seed data

`prisma/seed.ts` populates 12 lawyers across European jurisdictions plus 4 clients and assorted bookings/messages.

Lawyer roster (selected): Maria Chen (Stockholm, Family & Estate, 22y, €240/hr, 4.9 / 184 reviews); Klaus Hoffmann (Berlin, Corporate & M&A, 15y, €480/hr); Sofia Romano (Rome, Property); Lucas Dubois (Paris, Immigration, FIXED €450–€2400, 5.0 / 211); Anya Kowalski (Warsaw, Employment); Margaux Laurent (Paris, Tax & Corporate); Giuseppe Rossi (Milan, Property); Hans Mueller (Vienna, Corporate); Elena Garcia (Madrid, Immigration); Anna de Vries (Amsterdam, Family); Michel Beaumont (Brussels, EU Law); Stefan Novak (Prague, Employment, **PENDING** — to demonstrate verification states). One additional lawyer (Margaux) is also PENDING.

Wallets are seeded deterministically (`0x1111…00X` for lawyers, `0x2222…00X` for clients) so Playwright tests can refer to them by name (`SEEDED.client1`, `SEEDED.lawyer1`).

Bookings cover the full status range — REQUESTED, ACCEPTED, COMPLETED — so every screen has realistic content on first load. Some bookings have messages already exchanged.

---

## 10. Tests

`playwright.config.ts` runs against `next start` on port 3100 — separate from the dev server — with one worker (no parallel races on the seeded DB) and DB auto-reset before each suite via `globalSetup.ts`.

Ten suites under `tests/e2e/`:

1. **`public.spec.ts`** — landing hero, directory, profile cards without auth
2. **`sign-in-out.spec.ts`** — SIWE flow + session persistence
3. **`connect.spec.ts`** — multi-stage onboarding (role → EBSI → age → tx wallet)
4. **`client.spec.ts`** — home, category filtering, booking, consultation room
5. **`lawyer.spec.ts`** — dashboard, request review, accept/decline
6. **`attachments.spec.ts`** — credential upload + retrieval
7. **`invoices.spec.ts`** — line-item editor, deliverables
8. **`stale-session.spec.ts`** — JWT expiry + re-auth
9. **`api-coverage.spec.ts`** — API status code matrix
10. **`dead-button-sweep.spec.ts`** — every button navigates or POSTs without 404/500

Helpers in `tests/e2e/_helpers.ts`: `devSignIn(page, {wallet, role})` for direct sign-in, `reseedDatabase()`, `clickAndExpectSideEffect()`, `SEEDED` constants.

---

## 11. End-to-end flows

### 11.1 Lawyer onboarding

1. `/connect` → role picker → Lawyer
2. Pick EBSI wallet (DS / eKibisis / etc.)
3. Pick transaction wallet (MetaMask / WalletConnect / Coinbase)
4. SIWE message + signature → User row created with role LAWYER
5. Redirect to `/lawyer/dashboard` → empty state because no profile
6. Click → `/verify-lawyer` form
7. Submit credentials + uploaded documents → `POST /api/verification` → `LawyerProfile` PENDING
8. (Dev) After `DEV_AUTO_VERIFY_SECONDS` the profile flips to VERIFIED with stub `ebsiCredentialId`
9. Lawyer now appears in `/lawyers` directory and can edit profile at `/lawyer/profile/edit`

### 11.2 Client booking

1. `/connect` → role picker → Client → EBSI → age check (1.5s mock) → tx wallet → SIWE
2. Browse `/lawyers`, filter by practice/language/pricing
3. Click profile → "Book a consultation"
4. `/client/book/[lawyerId]` → fill form, see fee preview
5. Submit → `POST /api/bookings` creates Booking REQUESTED with `clientAcceptedAt`, creates Conversation
6. Redirect to `/client/cases`

### 11.3 Lawyer accepts

1. `/lawyer/dashboard` shows pending request
2. `/lawyer/requests/[id]` → see anonymous client identifier, fee breakdown, conflict-check pass
3. Click Accept → `POST /api/bookings/[id]/accept`
4. Server checks `clientAcceptedAt` is set, calls `createEscrow()` stub (fake tx hash after 1.5s), sets ACCEPTED + `lawyerAcceptedAt` + `escrowTxHash`

### 11.4 Consultation

1. Both parties open `/client/consultation/[bookingId]` and `/lawyer/consultation/[bookingId]`
2. Chat polls `/api/messages?conversationId=…` every 5s; sends via POST
3. Right-rail shows escrow indicator
4. Client clicks Mark Complete → `POST /api/bookings/[id]/complete` → `releaseEscrow()` stub → COMPLETED + `escrowReleaseHash`

### 11.5 Lawyer profile self-service

1. `/lawyer/profile/edit` with tabs (Bio / Specialties / Availability / Avatar)
2. Form mirrors LawyerProfile shape; sticky save bar shows live preview of the card
3. PATCH `/api/lawyer/profile`; bar info read-only

### 11.6 Admin verification

1. Admin uses `x-admin-key: $ADMIN_API_KEY` header
2. `POST /api/admin/verify-lawyer { lawyerProfileId, status? }`
3. Server flips status; if VERIFY, generates stub `ebsiCredentialId`

---

## 12. What's real vs. stubbed

**Real production code paths.**
- Postgres/SQLite schema with the full data model
- NextAuth + SIWE with real nonce verification
- File upload + access-controlled retrieval
- All bookings, messages, conversations persisted
- Role-gated middleware
- Directory search with JSON-array filtering inside SQLite

**Stubbed (clearly marked TODO).**
- Smart-contract escrow (`lib/web3/escrow.ts` returns fake hashes; column is real, ready for chain)
- EBSI verification (`lib/web3/ebsi.ts` and `/api/verification` return stubbed credential ids; in dev auto-verifies)
- Over18 VC (mocked 1.5s delay in connect flow)
- Video room (placeholder tiles next to real chat)
- File storage (local `/uploads/`; production needs S3/R2)
- Email notifications (none; production needs Resend/Postmark)
- Reviews (data model placeholder; UI not implemented)
- Disputes / juror flow (not in MVP)
- Dedicated admin panel beyond the single API endpoint

---

## 13. Constitutional alignment

The constitution at `/home/kyle/programming/firmusnovus/ethprague/.specify/memory/constitution.md` is the same document that governs System A. This implementation honors many of its principles even when stubbing the substrate:

- **Pseudonymous by Default** — clients are shown to lawyers as `#4A · 2f` (anonymous identifier from wallet); the schema persists only `walletAddress`, `ageVerifiedAt` boolean, and (eventually) country, no name/DOB/document-number.
- **Quiet Web3, Loud Trust** — UI never says "blockchain," "smart contract," "wallet" beyond the necessary connect step; verification badge does the trust work; `formatScheduled` and `truncateAddress` keep the cryptography out of sight.
- **Design Tokens & Visual Discipline** — teal + gold palette, gold under 5%, Inter + Fraunces, lucide icons, WCAG AA — implemented in `app/globals.css` `@theme` block and respected throughout components.
- **Real Persistence, Stubbed Seams** — every model is real Prisma; every stub is a single named module under `lib/web3/`.
- **Asymmetric Mechanisms** — partially modeled: the Booking status enum includes DISPUTED; the schema separates `clientAcceptedAt` from `lawyerAcceptedAt`; the escrow stub functions are split (`createEscrow`, `releaseEscrow`, `disputeEscrow`) so the timing rules can be enforced once a real contract lands.

What this implementation does **not** do (which System A does):
- No actual end-to-end encryption — message `content` is plaintext in SQLite
- No on-chain attestations — `verificationStatus` is a column, not an EAS UID
- No actual ZK conflict-of-interest proof — the conflict-check badge is hardcoded "pass"
- No smart-contract-enforced cooldown — the 30-day asymmetry exists only as a status enum value
- No two-process trust boundary — the issuer concept is collapsed into the same Next.js process

These are scoping choices, not architectural mistakes. The schema columns (`escrowTxHash`, `escrowReleaseHash`, `ebsiCredentialId`) are present and ready to receive real values when the substrate is wired in.

---

## 14. Dependencies

**Runtime.** `next`, `react`, `react-dom`, `prisma`, `@prisma/client`, `next-auth`, `siwe`, `wagmi`, `viem`, `@rainbow-me/rainbowkit`, `tailwindcss`, `@radix-ui/*`, `lucide-react`, `class-variance-authority`, `react-hook-form`, `zod`, `@tanstack/react-query`.

**Dev / test.** Playwright + helpers, TypeScript strict, ESLint flat config, Prisma CLI.

**Stubbed (production).** A Solidity escrow contract on a layer-2 (Polygon / Arbitrum / Base), the EBSI Trusted Issuers Registry + identity wallet apps, a video SDK (Daily / Huddle01 / LiveKit), S3 / Cloudflare R2, an email service.

---

## 15. Networks and deployment

**Local dev.** `npm run dev` (port 3000). Prisma generates client at install; `prisma db push` applies the schema; `prisma db seed` populates the 12 lawyers + 4 clients. `.env` holds `DATABASE_URL`, `NEXTAUTH_SECRET`, `ADMIN_API_KEY`, `DEV_AUTO_VERIFY_SECONDS`.

**Production trajectory.** Standard Next.js deploy (Vercel / Railway / Fly). Migrate SQLite → Postgres (schema is largely portable; some JSON columns become native arrays). Move uploads to S3/R2. Wire RainbowKit to a real chain. Replace the stubs in `lib/web3/` with viem `writeContract` calls. Wire `verifyLawyerCredentials` to a real EBSI Trusted Issuers Registry call.

---

## 16. The system in one sentence

A polished single-Next.js-app rendition of the Firmus Novus product brief — directory, booking, escrow-shaped consultation room, lawyer dashboard, profile editor — with a real auth + persistence + UI substrate and clearly-isolated stubs where the smart contracts, ZK proofs, and EBSI credential exchanges will eventually plug in.
