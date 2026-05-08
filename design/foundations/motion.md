# Motion

Firmus Novus has three categories of motion. They are all quiet — the
brand voice is "verified counsel," not "consumer fintech," so animations
inform; they don't perform.

## 1. Background drift (hero pattern)

The teal node-pattern SVG behind the hero (and the onboarding card
backdrop) drifts diagonally on an 8-second loop, alternating direction.

```css
@keyframes firmus-drift {
  0%   { transform: translate3d(0, 0, 0); }
  100% { transform: translate3d(-40px, -40px, 0); }
}
.firmus-pattern-drift {
  animation: firmus-drift 8s linear infinite alternate;
}
```

- **Duration**: 8s
- **Easing**: linear
- **Direction**: alternating (no jump-back)
- **Composite**: GPU only — `translate3d`, never animate `top` / `left`.
- **Opacity**: the pattern is rendered at `0.55` so the drift is
  subliminal; the user notices motion only on a deliberate look.

## 2. Skeleton shimmer (loading)

A 1.4-second left-to-right gradient sweep on grey blocks — used while
data is in flight.

```css
@keyframes firmus-shimmer {
  0%   { background-position: -200px 0; }
  100% { background-position: calc(200px + 100%) 0; }
}
.skeleton {
  background: linear-gradient(90deg, var(--color-slate-100) 0%, var(--color-slate-50) 40%, var(--color-slate-100) 80%);
  background-size: 200px 100%;
  background-repeat: no-repeat;
  animation: firmus-shimmer 1.4s infinite linear;
  border-radius: 6px;
}
```

- **Duration**: 1.4s
- **Easing**: linear
- **When**: any data-fetch placeholder. Always pair with `aria-busy`
  on the wrapping container so screen readers announce the wait.

## 3. State transitions (micro-interactions)

All other UI motion is a state change at one of three speeds.

| Tier | Duration | Easing | Where |
|---|---|---|---|
| **Instant** | 100ms | `ease-out` | Hover color shifts, focus rings |
| **Quick**   | 180ms | `ease-out` | Default for buttons, links, card hovers |
| **Considered** | 300ms | `cubic-bezier(0.16, 1, 0.3, 1)` | Stage transitions in the connect flow, dialog open |

Tailwind utility `transition-colors` defaults to ~150ms which is fine —
treat it as the "Quick" tier.

```tsx
className="transition-colors hover:bg-teal-600"
```

For the "Considered" tier, use `transition-all duration-300 ease-out`.
Avoid easing curves that overshoot — the brand voice is calm; bouncy
springs read as flippant on a legal product.

## Spinner

The connecting / signing spinner is a 16×16 ring that rotates:

```tsx
<span className="h-4 w-4 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
```

- 1s rotation
- Used during wallet connect and signing simulation in `/connect`.

## Pulse — live-indicator dot

A `2×2` green dot in the consultation top bar pulses to indicate the
session is live:

```tsx
<span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
```

Tailwind's `animate-pulse` is acceptable here — the only place the
brand uses opacity-based pulse.

## What we never do

- No bounce, overshoot, or elastic easing on UI elements. A bar
  serves clients, not toy stores.
- No motion longer than 1.5s for a one-shot transition.
- No infinite-spin loaders in the page body — always pair with helper
  copy ("Connecting to MetaMask…") so the spinner has context.
- No motion on data tables, lists, or filter chips when filters change
  — instant swap is calmer than a stagger.

## Reduced motion

`prefers-reduced-motion: reduce` disables `firmus-pattern-drift` and
`skeleton` shimmer (see `css/base.css`). Spinners stay because they
are an explicit affordance; transitions stay because they are short
enough not to bother motion-sensitive users.

```css
@media (prefers-reduced-motion: reduce) {
  .firmus-pattern-drift,
  .skeleton {
    animation: none;
  }
}
```
