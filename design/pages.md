# Pages

The twelve views shipped in the MVP, each with: layout map, key
components, copy hooks, and the design moments that matter.

For functional behavior see the corresponding `specs/NNN-*/spec.md`.

---

## 1. Landing — `/`

**Spec**: `001-marketing-and-discovery`
**Surface**: marketing
**Goal**: land the EBSI trust message; route to the directory.

```text
┌─ MarketingNav (sticky, white) ────────────────────┐

┌─ HERO ─────────────────────────────────────────── pt-20 pb-24
│   [Badge info: ★ EBSI · European Blockchain …]
│
│   Verified Legal Counsel,
│   On-Chain.            ← Fraunces 76px, "On-Chain." teal italic
│
│   Firmus Novus connects you with EBSI-verified
│   lawyers across Europe. Trust, verified on the
│   blockchain.         ← Inter 17–20px slate-500
│
│   [Find a Lawyer →]   [How It Works]
│
│   [EBSI seal] Verified through EBSI & Blockchain
│   ↑ pill on white-0/70 backdrop-blur
└─────────────────────────────────────────────────────

┌─ HOW IT WORKS ──────────────── border-y slate-100, py-24
│   Eyebrow "How it works" / serif title "Three quiet steps…"
│
│   01 [MessageSquare]   02 [ShieldCheck]   03 [Lock]
│   Describe Need        Match with…        Connect Securely
└─────────────────────────────────────────────────────

┌─ TRUST STRIP ───────────────── bg-white-50 py-14
│   [EBSI seal 32] · 614 Verified lawyers · 27 EU jurisdictions ·
│   12,400+ Consultations completed
└─────────────────────────────────────────────────────

┌─ RECENTLY JOINED ─────────────── py-24
│   Eyebrow + serif title
│   Three LawyerCards (default)
└─────────────────────────────────────────────────────

┌─ Footer (slate-100 hairline, three cols + logo) ──┐
```

**Background** — the hero has a `NetworkPattern opacity={0.55}` drifting
behind. The other sections are flat.

**Components** — `MarketingNav`, `Badge` (kind=info), `Button`
(primary lg + ghost lg), `EBSIBadge` (variant=seal),
`NetworkPattern`, `LawyerCard`, `Footer`.

**Copy moments**

- The hero's "On-Chain." italic is the only italic in the system.
- The "Three quiet steps" subhead is the brand voice in one phrase.

---

## 2. Lawyer Directory — `/lawyers`

**Spec**: `001-marketing-and-discovery`
**Surface**: marketing
**Goal**: filter by need; click into a profile.

```text
┌─ MarketingNav active="lawyers" ────────────────┐

┌─ Header (max-w-1280, py-10) ───────────────────
│   Eyebrow "Counsel directory"
│   Find your counsel.    ← Fraunces 36px navy-900
│   614 verified lawyers across 27 EU jurisdictions.
└─

┌─ Filters (sticky below nav, py-4 border-b) ────
│   [Specialty ▾] [Language ▾] [Pricing ▾]   [Sort ▾]
│   ↑ Chips, teal-50 when applied
└─

┌─ Grid (md:cols-2 lg:cols-3, gap-5) ────────────
│   LawyerCard × N (default size, with bio + tags)
└─
```

**Components** — `MarketingNav`, `Chip` (active variant),
`LawyerCard`, `Stars`, `PricingBadge`.

**Empty state** — `EmptyState` with title "No matching counsel.",
body "Try removing a filter.", `ctaLabel="Clear filters"`.

---

## 3. Lawyer Profile — `/lawyers/[id]`

**Spec**: `001-marketing-and-discovery`
**Surface**: marketing
**Goal**: convince the visitor; route to booking.

```text
┌─ MarketingNav (sticky) ─────────────────────────┐

┌─ Profile header (max-w-1280, py-10) ────────────
│   [avatar 96, verified ring]   Maria Chen
│                                Tax & Corporate · Berlin
│                                ★★★★★ 4.9 (124)
│                                [EBSI Verified]
└─

┌─ Two-column body grid lg:[1fr_400px] gap-10 ────
│  ┌ TABS (About / Credentials / Reviews / Availability)
│  │
│  │  About          → bio paragraphs, specialties, languages, jurisdictions
│  │  Credentials    → bar registration, admission date, EBSI credential ID,
│  │                   pricing kind, pricing items[] (for non-hourly)
│  │  Reviews        → empty-state placeholder (constitution scope)
│  │  Availability   → simple weekday × hours grid
│  └
│
│  ┌ BOOKING SIDEBAR (sticky lg:top-24, p-7 rounded-2xl shadow-md)
│  │   Pricing headline (Fraunces 28)        ← e.g. "€240 / hr"
│  │   ─────
│  │   30-min consultation        €120
│  │   60-min consultation        €240
│  │   ─────
│  │   [Book a consultation →]    primary lg
│  │   [Send a message]           ghost
│  │   ─────
│  │   [EBSI seal] Verified through EBSI
│  │   wallet 0x4f02…2c1a (font-mono)
│  └
└─
```

**Components** — `MarketingNav`, `AvatarBubble`, `Stars`, `Tabs`,
`PricingBadge`, `Button`, `EBSIBadge`, `EmptyState` (Reviews tab).

---

## 4. Connect Wallet + Role — `/connect`

**Spec**: `002-onboarding-and-auth`
**Surface**: auth shell
**Goal**: route the user through the dual-wallet onboarding.

```text
┌─ AuthShell (white-50 bg, NetworkPattern opacity 0.3) ─┐

┌─ Stepper (centered, mb-7) ────────────────────────────
│   [1 Role] ─── [2 Identity wallet] ─── [3 Age check] ─── [4 Transaction wallet]
└─

┌─ Onboarding card (max-w-720, p-8 sm:p-12 rounded-2xl shadow-md) ─

  STAGE = role:
    Welcome to Firmus Novus.       ← Fraunces 32–40
    Choose how you'd like to begin.
    [RoleCard "I need legal help" │ RoleCard "I'm a lawyer"]
    ──
    ℹ️ Firmus Novus uses two wallets… (info card, white-50 bg)
    🟡 Demo mode: wallet connections are simulated. (amber inset)
    [Continue →]

  STAGE = ebsi:
    [Stage pill: gold-100 "EBSI · STEP 1 OF 3"]
    Connect your identity wallet.
    Choose an EBSI-conformant wallet…
    [WalletOption × 7 — DS / eKibis / eDip / SSI / PwC / IDENTFY / Primus]
    [Back]   [Connect <name> →]

  STAGE = age (clients only):
    [Stage pill: gold "EBSI · STEP 2 OF 3"]
    Verify you're 18 or older.
    Legal counsel is reserved for adults…
    ┌─ Credential request card (white-50 inset rounded-xl) ─
    │ [Shield] Credential request
    │   From: Firmus Novus · To: <picked wallet>
    │
    │ ┌── Over18 attestation                        [VC] ──┐
    │ │   Boolean · proves age ≥ 18 without DOB           │
    │ └────────────────────────────────────────────────────┘
    │ 🔒 Issued by your country's eIDAS-conformant identity provider
    └─
    [Back]   [Share Over18 credential] OR [Continue →]

  STAGE = tx:
    [Stage pill: teal-50 "PAYMENTS · STEP 3 OF 3"]
    Connect your transaction wallet.
    This is where you'll fund consultations…
    ✅ Identity wallet connected (white-50 inset row)
    [WalletOption × 3 — MetaMask / WalletConnect / Coinbase]
    🔒 Demo mode: no real wallet is opened — sign-in is simulated.
    [spinner] Connecting to <wallet>… / Signing in…
    [Back]
└─
```

**Stage-pill colors**

- `EBSI · …` → `gold-100` background, `gold-700` text.
- `PAYMENTS · …` → `teal-50` background, `teal-700` text.

**Wallet options** — `WalletOption` is a left-aligned 2-px-bordered
button, 16-px gap. Initial badge (10×10 colored square with two-letter
initials) on the left, name + org on the right, radio dot far right.
Active state is `border-teal-500 bg-teal-50`. EBSI providers carry a
small inline gold "EBSI" pill next to the wallet name.

**Components** — `Stepper` (inline), `Button`, `EBSIBadge`,
`NetworkPattern`.

---

## 5. Lawyer Verification — `/verify-lawyer`

**Spec**: `003-lawyer-verification`
**Surface**: auth shell
**Goal**: collect bar credentials and queue verification.

```text
┌─ AuthShell ───────────────────────────────────────┐

┌─ Two-column grid lg:[1fr_360px] gap-10, max-w-1180

  ┌ FORM (max-w-720, p-8 rounded-2xl shadow-md)
  │   Verify your credentials.    ← Fraunces 32
  │   Submit once. We'll cross-check against the EBSI
  │   Trusted Issuers Registry within 48 hours.
  │
  │   [Full name        ] [City              ]
  │   [Email (optional) ] [Years experience  ]
  │   [Headline                                ]
  │   [Bio (textarea, 6 rows, ≥40 chars)       ]
  │   ────────
  │   Bar registration
  │   [Bar reg. number ] [Bar jurisdiction   ]
  │   [Admission date  ] [Jurisdictions list ]
  │   [Specialties     ] [Languages          ]
  │   ────────
  │   Pricing
  │   [Pricing kind ▾]  [Hourly rate (EUR)   ]
  │   [Pricing headline                       ]
  │   {if non-HOURLY} pricingItems editor:
  │     ┌── Title ── Description ── Price ── Unit ── ✕ ──┐
  │     [+ Add a service package]
  │   ────────
  │   Documents
  │   ┌── Drop zone (dashed slate-200, p-7) ──┐
  │   [thumbnail] [thumbnail] [+ Add another]
  │   ────────
  │   [Submit for verification →]
  └

  ┌ EBSI RAIL (sticky lg:top-24, p-7 rounded-2xl shadow-md)
  │   [EBSI seal 32]
  │   How verification works.
  │
  │   1. Bar registration cross-check
  │      via the EBSI Trusted Issuers Registry.
  │   2. Optional university / specialization VCs
  │      surfaced from your identity wallet.
  │   3. On success, a Verifiable Credential is
  │      issued back to your identity wallet.
  │   4. You appear in the public directory.
  │
  │   ⏱ Typical turnaround: 24–48 hours.
  └
└─
```

**Stub disclosure** — in dev a small slate inset reads "Dev mode:
verification will auto-complete in ~5 seconds." That copy is hidden in
production.

**Components** — `Input`, `Textarea`, `Label`, `Button`, `EBSIBadge`.

---

## 6. Client Home — `/client/home`

**Spec**: `004-booking-and-escrow`
**Surface**: app
**Goal**: greet, surface active work, recommend lawyers.

```text
┌─ AppTopBar (white-0, slate-100 hairline) ─────────┐

┌─ Greeting (max-w-1280, py-10) ───────────────────
│   Welcome back, Sarah.    ← Fraunces 36
│   Tell us what you need help with.
└─

┌─ Categories (px chips, gap-3, scroll-x) ─────────
│   [Family] [Estate] [Property] [Employment]
│   [Immigration] [Business] [Tax] [IP]
│   ↑ Each is a Link to /lawyers?specialty=…
└─

┌─ ACTIVE consultation (only if exists) ───────────
│   ┌── Card (rounded-2xl, p-7, gradient subtle) ──┐
│   │ [Avatar verified] Maria Chen
│   │   60-min consultation · Tue, May 14 · 10:30 CET
│   │   [Status pill: ACCEPTED]
│   │
│   │ [Open consultation room →]   primary
│   └
└─

┌─ Recommended for you ─────────────────────────────
│   Eyebrow + serif title "Recently joined counsel."
│   Three LawyerCards (compact mode)
└─
```

**Components** — `AppTopBar`, `LawyerCard` (compact), `StatusPill`,
`Chip`.

---

## 7. Booking & Payment — `/client/book/[lawyerId]`

**Spec**: `004-booking-and-escrow`
**Surface**: app
**Goal**: schedule + describe + fund.

```text
┌─ AppTopBar ────────────────────────────────────────┐

┌─ Two-column grid lg:[1fr_360px] gap-8, max-w-1280

  ┌ FORM (rounded-2xl bg-white-0 p-7 border-slate-100)
  │   [Avatar verified 48]  Maria Chen
  │                         Tax & Corporate · Berlin
  │   ──────
  │   Date & time
  │   [datetime-local input, default = tomorrow 10:30]
  │
  │   Duration
  │   [○ 30-minute   €120]   [● 60-minute   €240]
  │     ↑ Active row gets border-teal-500 bg-teal-50
  │
  │   Practice area
  │   [Family ▾]   ← native select, lg
  │
  │   Briefly describe your case (≥20 chars)
  │   [Textarea, 6 rows]
  │
  │   ⚠ inline error if <20 chars
  └

  ┌ FEE SIDEBAR (sticky lg:top-24, gap-5)
  │   ┌── Card "Fee summary" (rounded-xl p-6) ──┐
  │   │  Consultation fee          €240.00      │
  │   │  Platform fee (5%)          €12.00      │
  │   │  ────                                   │
  │   │  Total                     €252.00      │
  │   └
  │
  │   ┌── EscrowStatusIndicator (rounded-xl p-4) ──┐
  │   │  [You] → [Smart contract] → [Lawyer]      │
  │   │  ↑ teal highlight on Smart contract when   │
  │   │    funded; aria-label describes flow      │
  │   └
  │
  │   🔒 Funds release to the lawyer only when the
  │      consultation is marked complete.
  │
  │   [Confirm and fund →]   primary lg w-full
  └
```

**Submit choreography**

1. Click → button enters loading state ("Funding escrow…").
2. Server creates Booking + Conversation, simulates `createEscrow`
   (2-second delay), returns `escrowTxHash`.
3. EscrowStatusIndicator transitions from `idle` → `funded`.
4. Hard-navigate to `/client/consultation/[bookingId]`.

**Components** — `AppTopBar`, `Input`, `Textarea`, `Label`,
`RadioGroup`, `Button`, `EscrowStatusIndicator`, `AvatarBubble`.

---

## 8. Consultation Room — `/client/consultation/[bookingId]`

**Spec**: `005-consultation-and-messaging`
**Surface**: in-session (DARK MODE)
**Goal**: meet, chat, mark complete.

```text
┌─ Consultation top bar (navy-900, white text, py-4) ──
│   [FirmusLogo light]                ● live    🔒 secure
└

┌─ Two-column grid lg:[1fr_360px] flex-1 ──────────────

  ┌ STAGE (bg-navy-950, flex-col)
  │   ┌── Video placeholder canvas (flex-1) ──┐
  │   │   [Avatar 80, verified]                │
  │   │   Maria Chen                           │
  │   │   Tax & Corporate · Berlin             │
  │   │   ▒▒▒▒▒▒  audio waveform stub  ▒▒▒▒▒  │
  │   └
  │
  │   ┌── Controls bar (px-6 py-4 border-t white/10) ──
  │   │   [Mic] [Video] [ScreenShare]   [PhoneOff]
  │   │   ↑ each 44-px circular icon-only button
  │   │   ↑ PhoneOff is red-500 always
  │   └
  └

  ┌ CHAT PANEL (border-l white/10, w-360, hidden md:flex)
  │   ┌── Header (px-5 py-4) ──┐
  │   │ Maria Chen             │
  │   │ Tax & Corporate · Berlin│
  │   └
  │   ┌── Messages (flex-1, overflow-y, p-5 gap-3) ──┐
  │   │   [Message bubble, slate-700/10 bg]          │
  │   │   [Message bubble, teal-600 bg, white text   │
  │   │    when sender = currentUser]                │
  │   └
  │   ┌── Composer (px-5 py-4 border-t white/10) ──┐
  │   │ [Input, white/5 bg]            [Send →]    │
  │   └
  └
```

**Mark Complete** — primary teal button in the controls bar (mobile)
or anchored to the chat panel header (desktop). Click → POST →
redirect to role home.

**Components** — `FirmusLogo` (light), `AvatarBubble`, custom
icon-buttons, `Input`, `Button`.

**Copy** — uses "secure" language, never "smart contract." The lock
icon next to the live indicator is the only crypto signifier.

---

## 9. Messages — `/client/messages` (and lawyer mirror)

**Spec**: `005-consultation-and-messaging`
**Surface**: app
**Goal**: thread list + active conversation.

```text
┌─ AppTopBar ───────────────────────────────────────┐

┌─ Two-column grid lg:[320px_1fr] gap-0 (max-w-1280)

  ┌ THREADS (border-r slate-100, overflow-y)
  │   ┌── Thread row (px-5 py-4, hover slate-50) ──┐
  │   │ [Avatar 40] Maria Chen     2h            │
  │   │             Sounds good — let's chat at … │
  │   │             ● unread dot teal-500         │
  │   └
  │   …
  └

  ┌ ACTIVE THREAD (flex-col, full height)
  │   ┌── Header (px-6 py-5) ──┐
  │   │ [Avatar 40] Maria Chen │
  │   │             Tax & Corp │
  │   └
  │   ┌── Messages (flex-1 overflow-y, p-6 gap-3) ──
  │   │   own bubbles right-aligned, teal-500 bg,
  │   │   white text; counterpart bubbles left,
  │   │   white-0 bg, navy-900 text, slate-100
  │   │   border.
  │   └
  │   ┌── Composer (px-6 py-4 border-t slate-100) ──
  │   │ [Input]              [Send] primary
  │   └
  └
```

**Components** — `AppTopBar`, `AvatarBubble`, `Input`, `Button`.

---

## 10. Lawyer Dashboard — `/lawyer/dashboard`

**Spec**: `006-lawyer-workspace`
**Surface**: app
**Goal**: see the day at a glance.

```text
┌─ AppTopBar (lawyer variant) ──────────────────────┐

┌─ Greeting + nav (max-w-1280, py-10) ─────────────
│   Welcome back, Maria.                ← Fraunces 36
│   Berlin · Tax & Corporate
│   [Edit profile →]   ghost
└─

┌─ STATS — grid-cols-4 gap-5 ───────────────────────
│   ┌ Stat card (rounded-xl p-6 border-slate-100) ─┐
│   │  Pending requests          ← 12 / slate-500
│   │  3                         ← Fraunces 28 navy
│   └
│   …repeated for: Upcoming this week (3), Active (1),
│   30-day net earnings (€4,820)
└

┌─ TODAY'S SCHEDULE ────────────────────────────────
│   Section eyebrow + title "Today."
│   [List of bookings]:
│     [Avatar] [Anonymized client] · 60-min · Tue 10:30
│     [Status pill] [Open →]
└

┌─ RECENT REQUESTS ─────────────────────────────────
│   [Card: anonymous client, practice area, time]
│   [Card: …]   ←  five rows max
└

┌─ EARNINGS SPARK (optional) ───────────────────────
│   30-day line chart, teal-500 stroke, slate-100 grid
└
```

**Empty state (no LawyerProfile)** — `EmptyState "Finish your
verification."` routing to `/verify-lawyer`.

**Components** — `AppTopBar`, `Badge`, `Button`, `AvatarBubble`,
`StatusPill`, `EmptyState`.

---

## 11. Request Review — `/lawyer/requests/[id]`

**Spec**: `006-lawyer-workspace`
**Surface**: app
**Goal**: accept / decline an incoming request.

```text
┌─ AppTopBar ───────────────────────────────────────┐

┌─ Header (max-w-1100) ─────────────────────────────
│   ← Dashboard
│   New Consultation Request    [Badge pending]
└─

┌─ Two-column grid lg:[1.5fr_1fr] gap-6 ────────────

  ┌ REQUEST DETAILS (rounded-xl p-7 bg-white-0 border)
  │   ┌── Anonymized client header ──┐
  │   │ [?-avatar 56 slate-50]        │
  │   │ Client 0x4f02…2c1a (font-mono)│
  │   │ Anonymous identifier · wallet │
  │   │ verified                      │
  │   └
  │
  │   ┌── 4-up metadata grid (sm:cols-2 gap-5) ──
  │   │ PRACTICE AREA       │  JURISDICTION
  │   │ Tax                 │  Berlin / DE
  │   │
  │   │ REQUESTED TIME      │  DURATION
  │   │ Tue, May 14 · 10:30 │  60 minutes
  │   └
  │
  │   ┌── Case description ──
  │   │ [bio-style paragraph from booking.caseDescription]
  │   └
  │
  │   ─── Conflict-check checkbox row ───
  │   [☐] No conflict of interest with existing clients.
  │
  │   [Decline]  [Accept request →]
  │   ↑ Accept is primary; Decline is danger ghost
  └

  ┌ FEE BREAKDOWN (rounded-xl p-6)
  │   Consultation fee          €240.00
  │   Platform fee (5%)         −€12.00
  │   ────
  │   Net to you                €228.00
  │
  │   🔒 Funds release on completion.
  └
```

**Components** — `AppTopBar`, `Badge`, `Button`, `AvatarBubble`
(?-style anonymous), `Checkbox`.

---

## 12. Profile Editor — `/lawyer/profile/edit`

**Spec**: `006-lawyer-workspace`
**Surface**: app
**Goal**: edit public profile with live preview.

```text
┌─ AppTopBar ───────────────────────────────────────┐

┌─ Tabs (sticky below nav) ─────────────────────────
│   [About] [Credentials] [Pricing] [Availability] [Tags]
└

┌─ Two-column grid lg:[1fr_400px] gap-10, max-w-1280

  ┌ EDITOR (varies by tab)
  │   About tab    → headline, bio, specialties, languages, jurisdictions
  │   Credentials  → barRegistrationNum, barJurisdiction, admissionDate (read-only after verification)
  │   Pricing      → pricingKind, pricingHeadline, hourlyRateEUR,
  │                  consultationRate30/60, pricingItems[] table
  │   Availability → 7×N weekday/hour grid
  │   Tags         → tag chip multi-input
  └

  ┌ LIVE PREVIEW (sticky lg:top-24)
  │   ┌── Mini lawyer profile ──
  │   │ [Avatar verified 80]
  │   │ Maria Chen
  │   │ Tax & Corporate · Berlin
  │   │ ★★★★★ 4.9 (124)
  │   │ [EBSI Verified]
  │   │ ────
  │   │ pricingHeadline (Fraunces 22)
  │   │ 30 min  €120
  │   │ 60 min  €240
  │   │ ────
  │   │ bio first sentence (line-clamp-3)
  │   └
  └
└─

┌─ STICKY SAVE BAR ─────────────────────────────────
│   [shadow-lg, white-0, sticky bottom-0]
│   "You have unsaved changes."     [Discard]  [Save]
└
```

**Components** — `AppTopBar`, `Tabs`, `Input`, `Textarea`, `Label`,
`Button`, `Chip` (tag entry), `EBSIBadge`, `Stars`, `AvatarBubble`,
`PricingBadge`.

---

## Mirrors

The lawyer-side `/lawyer/consultation/[bookingId]` and
`/lawyer/messages` reuse the same `ConsultationRoom` and messages
view as the client routes (page 8 and 9). The only differences:

- **Top-bar state** — `AppTopBar active="messages"` for the lawyer
  variant; the lawyer's own avatar in the right slot.
- **Anonymity** — once a booking is `ACCEPTED`, the lawyer sees the
  client's real name; before acceptance, the request review (page 11)
  is the only surface and the name is anonymized there.
