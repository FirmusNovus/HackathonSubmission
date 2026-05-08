# Spacing & Layout

## The 4-pixel grid

All spacing is a multiple of 4px. Tailwind's default scale already
follows this (`gap-2` = 8, `gap-3` = 12, `gap-4` = 16, `gap-5` = 20,
`gap-6` = 24, `gap-7` = 28, `gap-8` = 32, `gap-10` = 40, `gap-12` =
48). Use it; do not invent half-step values.

| Step | Px | Common use |
|---|---|---|
| 1 | 4  | Tight inline gap (icon + label) |
| 1.5 | 6 | Badge inner gap |
| 2 | 8  | Stepper item gap |
| 2.5 | 10 | Chip / badge horizontal padding |
| 3 | 12 | Compact card row gap |
| 3.5 | 14 | Lawyer-card avatar-to-text gap |
| 4 | 16 | Default card row gap |
| 5 | 20 | Marketing nav gap-between-sections |
| 6 | 24 | Card padding (resting) |
| 7 | 28 | Card padding (large surfaces) |
| 8 | 32 | Onboarding card padding |
| 10 | 40 | Top-bar internal gap |
| 12 | 48 | Hero internal column gap |

## Containers

Three repeating max-widths cover every page in the MVP:

| Width | Where |
|---|---|
| `max-w-[600px]` | Empty-states, focused single-column pages |
| `max-w-[720px]` | Onboarding card (`/connect`), lawyer-verification form |
| `max-w-[880px]` | Hero headline column |
| `max-w-[1100px]` | Lawyer request review |
| `max-w-[1180px]` | Marketing pages (landing, How It Works, recently joined) |
| `max-w-[1280px]` | App pages (dashboard, directory, profile editor) |

Page horizontal padding follows a responsive pattern:
`px-6 lg:px-12` for marketing surfaces, `px-6 lg:px-8` for app surfaces.

## Page rhythm — vertical spacing

Marketing pages alternate `py-24` (96px) hero and content sections with
`py-14` (56px) trust-strip rows. App pages use `py-10` (40px) main
padding to keep more content above the fold on a 13" laptop.

```text
Landing (/)
├── header                       (py-5  = 20px)
├── hero                         (pt-20 pb-24 = 80/96)
├── how-it-works                 (py-24 = 96)
├── trust-strip                  (py-14 = 56)
├── recently-joined              (py-24 = 96)
└── footer                       (py-12 = 48)

App page (/lawyer/dashboard)
├── app-top-bar                  (py-4  = 16)
└── main                         (py-10 = 40, lg:px-8)
```

## Card rhythm

Card surfaces follow these resting metrics:

| Card type | Padding | Border-radius | Border | Shadow |
|---|---|---|---|---|
| Compact (in lists) | `p-4` (16) | `rounded-xl` (12px) | `slate-100` | `none` |
| Default (UI) | `p-6` (24) | `rounded-xl` (12px) | `slate-100` | `shadow-sm` |
| Large (feature) | `p-7` (28) | `rounded-2xl` (16px) | `slate-100` | `shadow-md` on hover |
| Onboarding (`/connect`) | `p-8 sm:p-12` (32→48) | `rounded-2xl` (16px) | `slate-100` | `shadow-md` always |

Hover state for any card-as-link adds `hover:border-slate-200
hover:shadow-[var(--shadow-md)]`.

## The booking-page layout

`/client/book/[lawyerId]` runs a two-column grid:

```text
grid lg:grid-cols-[1fr_360px] gap-8

┌──────────────────────────────┐ ┌────────────────┐
│  Booking form                │ │ Fee summary +  │
│  (lawyer header, datetime,   │ │ Escrow status  │
│   duration, practice area,   │ │ Sticky on lg   │
│   case description)          │ │                │
└──────────────────────────────┘ └────────────────┘
```

The right rail is `360px` fixed; on `lg` it sticks at `top: 96px`
(below the app top bar).

## The lawyer-profile layout

`/lawyers/[id]` runs a similar split with a wider rail because the
booking sidebar is the conversion target:

```text
grid lg:grid-cols-[1fr_400px] gap-10

┌──────────────────────────────┐ ┌──────────────────┐
│  Tabs (About / Credentials / │ │ Booking sidebar: │
│   Reviews / Availability)    │ │ pricing headline,│
│                              │ │ 30/60-min rates, │
│                              │ │ "Book" CTA,      │
│                              │ │ EBSI seal +      │
│                              │ │ wallet address   │
└──────────────────────────────┘ └──────────────────┘
```

## The dashboard layout

`/lawyer/dashboard` is a single column with three stacked sections:

```text
max-w-[1280px] py-10

┌─ greeting + four stat cards (grid-cols-4) ────────┐
├─ today's schedule (single column)                 ┤
└─ recent requests (list of five)                   ┘
```

Stat cards are `p-6 rounded-xl border-slate-100` with a Fraunces 28px
number and a 12px slate-500 label.

## The consultation-room layout

`/client/consultation/[id]` and its lawyer mirror swap to dark mode
and split the chrome:

```text
flex flex-col bg-navy-950 text-white

┌─ consultation top bar (px-6 py-4) ────────────────┐
├─ video stage (flex-1, placeholder canvas) ────────┤
├─ controls bar (mute / camera / share / hang up) ──┤
└─ chat side panel (lg only, w-[360px]) ────────────┘
```

On mobile the chat panel collapses behind a tab-like toggle.

## Z-index ladder

| Z | Used by |
|---|---|
| 0  | Default content |
| 10 | NetworkPattern (decorative SVG behind hero) — though set via `inset-0` not z-stacking |
| 20 | Sticky inline elements (the lawyer-profile booking rail) |
| 30 | Top bars (marketing-nav, app-top-bar, consultation-bar) |
| 40 | Toasts |
| 50 | Modals / dialogs |

## Don't

- Don't introduce a `1px` or `2px` grid offset — break to the next 4px
  step instead.
- Don't deepen card border-radius beyond `16px`. The brand language is
  composed and quiet, not pillowy.
- Don't stack two `shadow-md`s — escalate to `shadow-lg` instead.
