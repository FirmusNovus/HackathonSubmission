# Typography

## Two faces, one role each

| Family | Variable | Used for |
|---|---|---|
| **Inter** | `--font-sans` | All UI text — body, labels, buttons, navigation, form fields |
| **Fraunces** | `--font-serif` | Hero headlines, page titles, large numerals on the dashboard |

Fraunces is loaded with the variable axes `opsz` (optical size) and
`SOFT` (soft cut) for crisp rendering at large sizes. Inter and
Fraunces are both loaded via `next/font/google` so they self-host and
don't ship a flash of fallback type.

> **Production swap flag.** Fraunces is a free substitute for the
> design brief's licensed Tiempos / GT Sectra. Swap before launch.

The monospace family `--font-mono` (`ui-monospace, JetBrains Mono,
SF Mono, Menlo, monospace`) is used **only** for wallet addresses,
truncated tx hashes, and the "VC" tag chip on the credential request
card.

## When to use Fraunces

Apply the `.font-display` utility (or `font-family: var(--font-serif)`)
on:

- Marketing hero headlines (`/`).
- Page titles like "New Consultation Request," "Welcome to Firmus
  Novus.," "Verify you're 18 or older."
- Large numeric stats on the lawyer dashboard (`28px`+).
- The "01 / 02 / 03" step numbers in How It Works.

Never apply Fraunces to:

- Body copy, captions, helper text, button labels.
- Anything below ~24px — the optical size starts to look ornamental.

The `.font-display` class also tightens letter-spacing to `-0.025em`
and pulls line-height down to `1.05` so the serif sits cleanly beside
its sans subhead.

## Type scale

The scale is referenced by raw pixel values in code (`text-[15px]`,
`text-[17px]`, `text-[28px]`) rather than abstract `text-sm`/`text-md`
labels — Tailwind's defaults don't quite match the design's rhythm.
Use these values:

| Px | Family | Weight | Line-height | Used for |
|---|---|---|---|---|
| 11 | Inter | 500 | 1.4 | Eyebrows, badges, uppercase labels (tracking 0.06–0.14em) |
| 12 | Inter | 400–500 | 1.4 | Captions, stepper labels, helper micro-copy |
| 13 | Inter | 400–500 | 1.5 | Helper text, secondary metadata, nav links |
| 14 | Inter | 400–500 | 1.55 | Card body copy, form helper text |
| 15 | Inter | 400 | 1.5 | Body default, inputs |
| 17 | Inter | 600 | 1.4 | Card titles |
| 18–20 | Inter | 600 | 1.3 | Section titles |
| 24 | Inter or Fraunces | 600 / 400 | 1.3 / 1.05 | H2 in app surfaces |
| 28 | Fraunces | 400 | 1.05 | Dashboard stats, "01 / 02 / 03" |
| 32–36 | Fraunces | 400 | 1.05 | Page titles |
| 44–76 | Fraunces | 400 | 1.04 | Hero headline |

## Hierarchy patterns that recur

**The eyebrow + display pattern** — a teal uppercase eyebrow above a
serif heading, used on every section that introduces itself.

```tsx
<span className="text-[12px] font-medium uppercase tracking-[0.14em] text-teal-600">
  How it works
</span>
<h2 className="font-display mt-3 text-3xl text-navy-900 sm:text-4xl">
  Three quiet steps to verified counsel.
</h2>
```

**The page title pattern** — Fraunces title + sentence subhead in
slate-500.

```tsx
<h1 className="font-display text-3xl text-navy-900 sm:text-4xl">
  Welcome to Firmus Novus.
</h1>
<p className="mt-3 text-base text-slate-500">
  Choose how you'd like to begin.
</p>
```

**The metadata-key pattern** — uppercase 11px label above a 14–15px
value, used in the request review and consultation room headers.

```tsx
<div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
  Practice area
</div>
<div className="text-[14px] text-navy-900">Family</div>
```

## Tracking, leading, and italic rules

- Uppercase labels: tracking `0.06em` to `0.14em` depending on size.
- Numeric stats and serif titles: tracking `-0.025em` (negative).
- Body text: tracking 0 (default).
- The hero headline uses italic on the second word for emphasis
  ("Verified Legal Counsel, *On-Chain.*") — but italic is otherwise
  reserved; do not italicize body copy.

## Don't

- Do not use Fraunces in buttons, ever.
- Do not bold Fraunces — its weight is set by `font-weight: 400` and
  the optical-size axis. Bolding muddies it.
- Do not use system serif fallbacks for hero copy — Fraunces is loaded
  with `display: swap` so it arrives quickly; the fallback only runs
  briefly on cold load.
- Do not use monospace for any text other than wallet addresses and
  tx hashes. The "VC" tag is the only branded exception.
