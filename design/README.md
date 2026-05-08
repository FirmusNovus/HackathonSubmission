# Firmus Novus — Design System

> Verified Legal Counsel, On-Chain.

This folder is the single source of truth for how Firmus Novus *looks*.
The constitution at `../.specify/memory/constitution.md` declares the
non-negotiables (brand, currency, dual wallet, design tokens, accessibility);
this folder turns those non-negotiables into concrete tokens, CSS, component
specifications, and page layouts.

## Folder map

```
design/
├── README.md                  # this file
├── foundations/
│   ├── color.md               # palette, accent rules, status colors
│   ├── typography.md          # Inter + Fraunces, type scale, hierarchy
│   ├── spacing-layout.md      # 4-px grid, containers, page rhythm
│   ├── motion.md              # drift, shimmer, transitions, durations
│   ├── accessibility.md       # WCAG AA contrast, focus, keyboard
│   └── voice-and-copy.md      # quiet web3, headline patterns, microcopy
├── css/
│   ├── tokens.css             # @theme block — all design tokens
│   ├── base.css               # element resets + body defaults + utilities
│   ├── components.css         # vanilla-CSS reference for every component
│   └── globals.css            # drop-in stylesheet (tokens + base + animations)
├── components.md              # component catalog: anatomy, states, props
└── pages.md                   # all 12 views: layout maps, components used
```

## Two ways to consume this

**Option A — Tailwind v4 application (the parent repo):** the file
`css/globals.css` is a drop-in equivalent of the parent's
`app/globals.css`. The Tailwind `@theme` block exposes every token as a
utility class (`bg-navy-900`, `text-teal-500`, `shadow-[var(--shadow-md)]`)
and as a CSS variable.

**Option B — Vanilla CSS / framework-agnostic:** `css/tokens.css` and
`css/components.css` together work without Tailwind. Import `tokens.css`
once at app entry and the variables become available to any stylesheet.
`components.css` shows the literal CSS for each primitive (Button, Badge,
Input, Card, EBSI Badge, Lawyer Card, Escrow Status, Stepper, …) so the
system can be lifted into any stack.

## The seven non-negotiables (from the constitution)

1. **Brand** — only "Firmus Novus" appears in user-facing strings.
2. **Currency** — tokenized EUR; `formatEUR()` everywhere; no ETH copy.
3. **Dual wallet** — identity wallet first, transaction wallet second.
4. **Quiet Web3** — "secure payment held until your consultation
   completes," not "smart-contract escrow."
5. **Two accent colors only** — teal `#14B8A6` for actions, gold `#C9A961`
   for EBSI; gold under 5% of any view's visual weight.
6. **Type** — Inter for UI, Fraunces for hero / page titles.
7. **Iconography** — `lucide-react` only; no emoji as UI elements.

The rest of this folder is the implementation of those seven rules at
the pixel level.

## How to read this folder when planning a new view

1. Read `foundations/spacing-layout.md` for the page rhythm.
2. Pick the page archetype from `pages.md` (marketing / app / consultation
   / dashboard).
3. Compose from `components.md` — the catalog covers every primitive that
   ships in the MVP.
4. Pull the literal CSS from `css/components.css` if you're rebuilding
   without Tailwind.
5. Check `foundations/accessibility.md` and `foundations/voice-and-copy.md`
   before shipping.
