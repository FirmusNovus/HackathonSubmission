# Component Catalog

Every component in the MVP, in one place. For each: anatomy, props,
states, where it ships, and a pointer to its CSS in
`css/components.css`.

The parent repo composes these via Tailwind utility classes; the
`fn-*` class names in `components.css` are the framework-agnostic
equivalent.

---

## Primitives (`components/ui/*`)

These are Radix-based + CVA-variant primitives. They have no Firmus
branding beyond their tokens.

### Button

`components/ui/button.tsx` — `.fn-button`

**Variants** — `primary` (teal CTA, default), `outline` (teal border,
white fill), `ghost` (transparent, slate text), `subtle` (slate-50
fill), `danger` (red), `nav` (navy, used inside the dark nav).

**Sizes** — `sm` (36px / 13px), `md` (44px / 15px, default), `lg`
(52px / 17px).

**Anatomy**

```
[ icon? ] [ label ] [ icon? ]
gap-2     font-medium  rounded-lg
```

**States** — hover deepens by one teal step (500 → 600 → 700);
focus-visible shows a 2px teal ring offset 2px; disabled is `opacity:
0.5` and `pointer-events: none`.

**Examples**

```tsx
<Button variant="primary" size="lg">
  Find a Lawyer <ArrowRight className="h-4 w-4" aria-hidden />
</Button>

<Button variant="ghost" onClick={() => setStage("role")}>Back</Button>

<Button variant="outline" size="sm">Try again</Button>
```

**Don't** use Button for in-content text links — use `<Link>` styled
with `text-teal-600 hover:underline`.

---

### Badge

`components/ui/badge.tsx` — `.fn-badge`

A 24-px-tall pill with uppercase 11px label.

| Kind | Background | Text | Used for |
|---|---|---|---|
| `verified` | `gold-100` | `gold-700` | EBSI verified status |
| `success`  | `green-50` | `#1A8A5C` | Completed states |
| `pending`  | `amber-50` | `#B7770F` | Awaiting / under review |
| `error`    | `red-50`   | `#B62525` | Rejected, failed |
| `info`     | `teal-50`  | `teal-700` | Default informational |
| `neutral`  | `slate-50` | `slate-700` | Tags, generic |

```tsx
<Badge kind="info" className="mb-7">
  ★ EBSI · European Blockchain Services Infrastructure
</Badge>

<Badge kind="pending">Awaiting your response</Badge>
```

---

### Input / Textarea / Label

`components/ui/{input,textarea,label}.tsx` — `.fn-input`, `.fn-textarea`, `.fn-label`

44-px tall input with `rounded-lg` border. On focus the border turns
teal-500 and a 2px teal-50 ring blooms. Placeholder is `slate-300`.

```tsx
<Label className="mb-2 block">Date & time</Label>
<Input type="datetime-local" value={…} onChange={…} />

<Textarea rows={6} placeholder="Briefly describe your situation…" />
```

---

### Card

`components/ui/card.tsx` — `.fn-card`

A bordered white surface. The default ships at `rounded-lg
border-slate-100 shadow-sm`. The "feature card" variant
(`p-7 rounded-2xl shadow-md`) is used for onboarding, booking, and
verification surfaces.

---

### Chip

`components/ui/chip.tsx` — `.fn-chip`

A 28-px filter / tag pill. `slate-50` resting, `teal-50` when active.
Used in the directory's `directory-filters.tsx` and on the
recently-joined section.

---

### Tabs

`components/ui/tabs.tsx` — Radix-based.

Used on the lawyer profile (`About / Credentials / Reviews /
Availability`) and the profile editor. The active tab gets a 2px
teal-500 underline.

---

### Radio Group

`components/ui/radio-group.tsx`

Used on the booking form for the 30 / 60-minute duration choice. The
active radio is a teal-500 dot inside a teal-500 ring; the row
container becomes `border-teal-500 bg-teal-50`.

---

### Dialog

`components/ui/dialog.tsx` — Radix.

Used sparingly — only modal flows are credential preview and
disconnect-wallet confirmation (the latter is a v1.1 detail).

---

## Firmus components (`components/firmus/*`)

These carry brand meaning beyond the design tokens.

### FirmusLogo

`components/firmus/firmus-logo.tsx`

Two parts:

- **`FirmusLogoMark`** — a 32×32 SVG: four small dots at the corners
  with crossing lines, two teal (top-left, bottom-right) and two
  navy. Reads as a network / handshake.
- **`FirmusLogo`** — `FirmusLogoMark` + the wordmark "Firmus Novus"
  in Fraunces (`font-display`).

Both accept `size` and `light` (true on dark surfaces, e.g. the
consultation room).

```tsx
<FirmusLogo size={22} />              // marketing nav
<FirmusLogo size={18} light />        // consultation room
```

The wordmark is **always** the rebranded "Firmus Novus." The original
Lex Nova mark is forbidden in code, copy, and assets per the
constitution.

---

### EBSIBadge

`components/firmus/ebsi-badge.tsx` — `.fn-ebsi`, `.fn-ebsi-seal`

The marquee trust mark.

**Variants** — `seal` (standalone gold disk with checkmark), `inline`
(seal + "EBSI Verified" label), `small` (compact).

**Anatomy**
- A 28-px circle filled with a `gold-300 → gold-700` linear gradient.
- Inner ring at `r=14` in white at 50% opacity.
- Inner disc at `r=11` filled solid `gold-500`.
- Centered checkmark in white, `stroke-width: 2.5`.

```tsx
<EBSIBadge variant="seal" size={32} />              // hero / trust strip
<EBSIBadge variant="inline" />                       // lawyer card
<EBSIBadge variant="small" size={11} />              // pill chip inside a label
```

**Density rule** — at most one EBSIBadge per atomic component. Never
stack. Per page, gold-shaded surface area stays under 5%.

---

### LawyerCard

`components/firmus/lawyer-card.tsx` — `.fn-lawyer-card`

The directory and recently-joined card.

**Anatomy**

```
┌──────────────────────────────────────────────┐
│ [avatar 64×64]  Name (17 / 600 navy-900)      │
│  with verified  Specialty · City (13 / slate) │
│  gold ring      ★★★★★ · €240 / hr            │
│                 [PricingBadge: Hourly]        │
│                                              │
│ Bio first sentence, line-clamped to 2 lines. │
│                                              │
│ #tag #tag #tag           View profile →      │
└──────────────────────────────────────────────┘
```

**Compact mode** drops the bio + tags row and shrinks padding to
`p-4`. Used inside Lawyer-Dashboard recommended lists.

**States** — hover lifts the border (`slate-100 → slate-200`) and
adds `shadow-md`. The whole card is one `<Link>` so keyboard tabs
land cleanly.

---

### AvatarBubble

`components/firmus/avatar-bubble.tsx` — `.fn-avatar`

A round avatar — initials over slate-50 by default. When `verified`
is true, the bubble gets a 2-px gold-500 outline at 2-px offset (the
single pop of EBSI gold per lawyer card).

```tsx
<AvatarBubble name="Maria Chen" size={64} verified />
```

---

### PricingBadge

`components/firmus/pricing-badge.tsx`

A small chip showing the lawyer's `pricingKind`:

| `pricingKind` | Label | Tone |
|---|---|---|
| HOURLY       | "Hourly"        | neutral |
| FIXED        | "Fixed package" | info |
| SUBSCRIPTION | "Subscription"  | info |
| SUCCESS      | "No win, no fee"| success |

---

### Stars

`components/firmus/stars.tsx`

Five lucide stars filling left-to-right based on a 0–5 float
(`lawyer.rating`). Empty stars are slate-300; filled stars are
amber-500.

---

### EscrowStatusIndicator

`components/firmus/escrow-status-indicator.tsx` — `.fn-escrow`

The three-node "You → Smart contract → Lawyer" diagram on the booking
page. See `css/components.css` for the literal CSS.

**Stages** — `idle` (only You is on), `funded` (You + Smart contract
on, Smart contract gets the teal highlight), `released` (all three
on, gold-tinged completion — though the MVP swaps colors via the
`highlight` flag, not gold).

**Accessibility** — wrapped in `role="img"` with a single descriptive
`aria-label` covering the whole flow.

---

### NetworkPattern

`components/firmus/network-pattern.tsx` — `.firmus-pattern-drift`

The teal node-pattern SVG layered behind the hero. See
`foundations/motion.md` for animation parameters.

```tsx
<NetworkPattern opacity={0.55} />
```

---

### EmptyState

`components/firmus/empty-state.tsx`

The standard "nothing here yet" block — title in Fraunces, body in
Inter, single CTA. See `foundations/voice-and-copy.md` for the copy
patterns.

```tsx
<EmptyState
  title="Finish your verification."
  body="Submit your bar credentials to start receiving consultation requests."
  ctaLabel="Continue verification"
  ctaHref="/verify-lawyer"
/>
```

---

### StatusPill

`components/firmus/status-pill.tsx`

A larger badge used for booking states: REQUESTED / ACCEPTED /
DECLINED / IN_PROGRESS / COMPLETED / CANCELLED / DISPUTED. Maps to
the standard Badge `kind`s but adds an icon.

---

### Skeleton

`components/firmus/skeleton.tsx` — `.skeleton`

A loading placeholder block with shimmer animation. Composed into
`<SkeletonCard />` and `<SkeletonRow />` helpers. See
`foundations/motion.md`.

---

### WalletButton

`components/firmus/wallet-button.tsx`

Top-bar entry to the connect flow. Two states:

- **Disconnected** — primary teal "Connect" button.
- **Connected** — `0x4f02…2c1a` in monospace plus a chevron drop-down
  (sign out, switch role).

---

## Layout components (`components/layout/*`)

### MarketingNav

`components/layout/marketing-nav.tsx` — `.fn-marketing-nav`

The sticky top bar on `/`, `/lawyers`, `/lawyers/[id]`. Tab items
are: Lawyers / How It Works / For Lawyers. The active item gets a
2px teal-500 underline. The right side is the "Sign In" link + the
WalletButton.

A `dark` prop swaps the bar to navy-900 (used on the consultation
room marketing variant).

---

### AppTopBar

`components/layout/app-top-bar.tsx` — `.fn-app-top-bar`

The in-app top bar on `/client/*` and `/lawyer/*`. Smaller padding
than MarketingNav, a different active set (Home / Messages /
Bookings for clients; Dashboard / Requests / Messages / Profile for
lawyers). Includes the user's avatar bubble + wallet truncation in
the right slot.

---

### Footer

`components/layout/footer.tsx`

Marketing footer. Three columns + the FirmusLogo. Copy is
proprietary-license short: "Proprietary · © Firmus Novus S.A."

---

### AuthShell

`components/layout/auth-shell.tsx`

Wraps `/connect`, `/verify-lawyer`. Centers a single column on a
white-50 page with the NetworkPattern subtly drifting in the
background.

---

## Stepper

The connect-flow stepper is built inline in
`app/connect/connect-flow.tsx` rather than as a primitive — it appears
in only one place. Its CSS is captured under `.fn-stepper*` in
`css/components.css` for any future reuse.

**Anatomy**

```
[1] Role  ─── [2] Identity wallet  ─── [3] Age check  ─── [4] Transaction wallet
```

**Three step states**

- **Done**: 22-px filled teal-500 circle with a white check, label in
  navy-900.
- **Active**: 22-px hollow teal-500 circle with the step number in
  teal-700, label in navy-900.
- **Pending**: 22-px hollow slate-200 circle with the step number in
  slate-300, label in slate-500.

The connectors (28×2 px bars) flip from `slate-100` to `teal-500`
when the preceding step is done.

---

## Consultation video controls

Built in `app/client/consultation/[bookingId]/consultation-room.tsx`.
Four 44-px circular icon buttons in a row, each Lucide-icon-only:

| Icon | Action | Active state |
|---|---|---|
| `Mic` / `MicOff` | Toggle mute | red-50 background when muted |
| `Video` / `VideoOff` | Toggle camera | red-50 background when off |
| `ScreenShare` | Toggle screen share | teal-50 background when on |
| `PhoneOff` | Hang up | always red-500 background |

All four ship with explicit `aria-label`s.
