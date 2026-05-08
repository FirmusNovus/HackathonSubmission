# Color

## The two-accent rule (NON-NEGOTIABLE)

Firmus Novus uses **exactly two accent colors**:

- **Teal `#14B8A6`** — actions, links, Web3 / crypto signals.
- **Muted gold `#C9A961`** — EBSI verification, never anything else.

Gold MUST stay under 5% of any view's visual weight. Practically: a
single seal, a single chip, or a single pill — never an entire card
background, never a header bar, never a CTA. Gold's purpose is to
draw the eye to a verification marker; it loses that purpose if it
spreads.

## Full palette

### Navy — brand background and primary text

| Token | Hex | Where it goes |
|---|---|---|
| `navy-950` | `#0a1428` | Consultation room background (deepest). |
| `navy-900` | `#0a1f44` | Headings, primary text on light, dark nav. |
| `navy-800` | `#102a4c` | `nav` button hover. |
| `navy-700` | `#1a3666` | Reserved deeper navy. |

### Slate — neutral text and chrome

| Token | Hex | Where it goes |
|---|---|---|
| `slate-900` | `#1a2533` | Reserved deepest neutral. |
| `slate-700` | `#2c3e50` | Body text default. |
| `slate-500` | `#5b6b7c` | Secondary copy, helper text, icon idle. |
| `slate-300` | `#a8b3bf` | Placeholders, inactive icons. |
| `slate-200` | `#cfd6dd` | Inactive borders. |
| `slate-100` | `#e5e9ee` | Default card / input borders. |
| `slate-50`  | `#eef1f4` | Subtle inset surfaces, chip backgrounds. |

### White — page surface scale

| Token | Hex | Where it goes |
|---|---|---|
| `white-50` | `#f4f6f8` | Page background (`<body>`). |
| `white-0`  | `#ffffff` | Card surface, floating UI. |

### Teal — actions and Web3

| Token | Hex | Where it goes |
|---|---|---|
| `teal-50`  | `#e6faf7` | Subtle backdrop for active states. |
| `teal-100` | `#ccf5ef` | Selection highlight. |
| `teal-300` | `#5ee0cd` | Reserved (illustration). |
| `teal-400` | `#00d4c4` | Reserved (illustration). |
| `teal-500` | `#14b8a6` | Primary action button, links, focus ring. |
| `teal-600` | `#0e9488` | Hover state for primary. |
| `teal-700` | `#0b7a70` | Active state for primary. |

### Gold — EBSI only

| Token | Hex | Where it goes |
|---|---|---|
| `gold-100` | `#f5efd9` | Verified-badge background. |
| `gold-300` | `#e0cd93` | Seal gradient stop. |
| `gold-500` | `#c9a961` | EBSI primary. |
| `gold-700` | `#9c7e3f` | Verified-badge text. |

### Status

| Token | Hex | Where it goes |
|---|---|---|
| `green-400` | `#34d399` | Live-indicator dot, success-state ring. |
| `green-50`  | `#e8f8f1` | Success badge background. |
| `amber-500` | `#f59e0b` | Pending dot. |
| `amber-50`  | `#fef4e1` | Pending badge background. |
| `red-500`   | `#ef4444` | Destructive button, error icon. |
| `red-50`    | `#fce9e9` | Error banner background. |

## Accessibility — the contrast pairings that ship

All pairings below are WCAG AA at minimum. Anything not on this list
needs a contrast check before shipping.

| Foreground | On background | Ratio | Use |
|---|---|---|---|
| `navy-900` | `white-0`  | 17.0 | Headings, primary text |
| `slate-700` | `white-0` | 9.6  | Body text |
| `slate-500` | `white-0` | 5.9  | Secondary copy |
| `slate-500` | `white-50`| 5.7  | Secondary copy on page bg |
| `teal-700`  | `teal-50` | 6.8  | Pills / chips |
| `teal-600`  | `white-0` | 4.7  | Link text |
| `gold-700`  | `gold-100`| 7.4  | Verified badge |
| `#fff`      | `teal-500`| 3.4  | Primary button label — passes AA Large only; we ship at ≥15 px |
| `#fff`      | `teal-600`| 4.6  | Primary hover state — passes AA |

When teal is used as text on white, prefer `teal-600` over `teal-500`.

## Shadow language

Shadows are navy-tinted, never neutral grey. They imply lift on a
white surface, not a chemical drop on a grey one.

```css
--shadow-sm: 0 1px 2px rgba(10, 31, 68, 0.04), 0 1px 3px rgba(10, 31, 68, 0.06);
--shadow-md: 0 4px 8px rgba(10, 31, 68, 0.06), 0 8px 24px rgba(10, 31, 68, 0.08);
--shadow-lg: 0 12px 24px rgba(10, 31, 68, 0.08), 0 24px 48px rgba(10, 31, 68, 0.12);
```

| Token | Where |
|---|---|
| `shadow-sm` | Default card resting state |
| `shadow-md` | Card hover, primary onboarding card, lawyer-card hover |
| `shadow-lg` | Modal / dialog |

## Forbidden combinations

- Gold on teal, or teal on gold.
- Pure black (`#000000`) anywhere — use `navy-950` or `navy-900`.
- Saturated greens / reds outside the status palette.
- Any new accent color not listed here. Adding a third accent is a
  brand decision, not a feature decision.
