# Accessibility

WCAG AA is the floor. The constitution says so; this document spells
out what that means in practice.

## Contrast

Every text-on-background pair is checked. The shipping pairings are in
`color.md` under "Accessibility — the contrast pairings that ship."
The summary:

- **Primary text** (`navy-900` on `white-0`): 17:1 — AAA.
- **Body text** (`slate-700` on `white-0`): 9.6:1 — AAA.
- **Secondary copy** (`slate-500` on `white-0` or `white-50`): 5.7–5.9
  — passes AA for normal text.
- **Primary button label** (white on `teal-500`): 3.4:1 — passes AA
  Large only. We always render the button label at ≥15px (md) or
  ≥17px (lg) so the AA-Large rule applies. Hover (`teal-600`)
  re-clears AA at any size.
- **EBSI badge** (`gold-700` on `gold-100`): 7.4:1 — AAA.

If a new color pair is introduced, run a contrast check before merge.

## Focus

Every interactive element shows a visible focus ring on
`:focus-visible`:

```css
.fn-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-white-0), 0 0 0 4px var(--color-teal-500);
}
```

Or, in Tailwind: `focus-visible:outline-none focus-visible:ring-2
focus-visible:ring-teal-500 focus-visible:ring-offset-2`.

Never use `outline: none` without a replacement ring. Never rely on
hover-only affordances — keyboard users must see the same state.

## Keyboard

Every flow ships fully keyboard-reachable:

- The connect-flow stepper advances by clicking buttons — `Tab` reaches
  Continue, `Enter` activates.
- The lawyer-card grid is composed of `<Link>`s; `Tab` walks them in
  visual order.
- The booking form uses native `<input>` / `<textarea>` so all browser
  shortcuts work.
- The consultation room's video controls (mute / camera / screen share
  / hang up) are real `<button>`s; the chat input accepts `Enter` to
  send.
- Modals trap focus and `Esc` closes them.

The connect-flow stepper, the lawyer-profile tabs, and the booking
filter chips all have a logical tab order — no `tabindex` greater
than 0 anywhere in the codebase.

## Semantics

- Headings nest: one `<h1>` per page, `<h2>` for major sections,
  `<h3>` for cards. We do not skip levels.
- Form controls always have a `<label>` or `aria-label`.
- Decorative icons are `aria-hidden`. Functional icon-only buttons get
  an `aria-label` (the consultation room's mute button: `aria-label=
  "Mute microphone"`).
- The escrow-status indicator carries a single `role="img"
  aria-label="Escrow flow: client funds the smart contract, which
  releases to the lawyer on completion."` so the entire diagram is
  one announceable unit instead of a babble of nodes.

## Wallet addresses

Wallet addresses are decorative metadata, but they're real strings the
user might want to copy. Render them as text with `font-mono` so
screen readers spell out the truncated hex; do not use them as
button labels.

## Anonymized client identifier

In the lawyer's request review (`/lawyer/requests/[id]`), the client
name is replaced with `anonymousClientId(walletAddress)` until the
booking is accepted. The constitution forbids leaking the real name
pre-accept; the accessibility implication is that screen readers also
see the anonymized identifier, not the underlying name.

## Empty states

Every empty state ships with copy and an action. The
`<EmptyState>` component takes `title`, `body`, `ctaLabel`, `ctaHref`
— none are optional, because a list with nothing in it and no path
forward is an accessibility dead end.

## Color is never the only signal

- Stepper "done" steps add a check icon, not just a teal background.
- Form errors add an inline message, not just a red border.
- Status pills (verified / pending / error) include a label, not just
  a color.

A user with monochromatic vision should reach the same conclusion as
a user with full color.

## Reduced motion

`prefers-reduced-motion: reduce` kills the hero drift and skeleton
shimmer (see `motion.md`).

## Forms

- Required fields are marked `required` (not just `*`).
- Validation messages appear adjacent to the field, not in a banner
  far away.
- The case-description field on the booking form has a 20-character
  minimum — when not met, the inline error reads "Please describe
  your case in a sentence or two." not "Field too short."

## Don't

- Don't use placeholder text as a label.
- Don't put critical info in a tooltip without a static fallback.
- Don't use `auto-play` audio anywhere.
- Don't lock the page scroll behind a JavaScript modal without focus
  trap + `Esc`-to-close.
