# Voice & Copy

Firmus Novus's voice is **calm, exact, and lawyerly without being stiff**.
The visual system whispers; the words match.

## The "quiet Web3" rule

Crypto vocabulary is forbidden from headlines, CTAs, and section
intros. It is allowed in:

- Helper text inside the connect-flow age-check ("Boolean · proves age
  ≥ 18 without revealing DOB").
- Footnotes on the booking page ("Funds are released to the lawyer
  only when the consultation completes.").
- Code comments and README docs.

The trust signal that *is* loud is **EBSI verification** — the gold
seal, the badge, the "Verified through EBSI & Blockchain" label.
Crypto is the plumbing; EBSI is the brand promise.

### Forbidden words (in user-facing copy)

| Forbidden | Use instead |
|---|---|
| smart contract | secure payment / escrow |
| smart-contract escrow | secure payment held until your consultation completes |
| blockchain (in headlines) | EBSI / verified on-chain |
| ETH / ether / crypto | EUR / payment |
| gas fees | (don't surface — pay them server-side) |
| dApp / web3 | (don't surface) |
| seed phrase | (never) |
| wallet provider (raw) | "identity wallet" or "transaction wallet" |

### Approved phrasings

- "Verified Legal Counsel, On-Chain." (hero — *On-Chain* is allowed
  here as the stylistic punchline; it is the only crypto word that
  makes the marquee.)
- "Verified through EBSI & Blockchain" (trust strip, hero badge).
- "Pay into escrow. Funds release on completion." (booking).
- "Secure payment held until your consultation completes." (booking,
  client home).
- "Connect your identity wallet." / "Connect your transaction wallet."
- "Issued by your country's eIDAS-conformant identity provider."

## Headline voice

- Use a period. The brand sounds confident, not breathless.
- Use sentence case unless quoting a proper noun. Title Case Reads
  Loud.
- Prefer concrete numerals: "Three quiet steps." not "Several quiet
  steps."
- Use the second person sparingly — but it appears on directly-
  addressed pages: "Welcome to Firmus Novus.", "Verify you're 18 or
  older."

### Headline patterns that recur

| Pattern | Example |
|---|---|
| Eyebrow + serif title | "How it works" / "Three quiet steps to verified counsel." |
| Greeting + page goal | "Welcome to Firmus Novus." / "Choose how you'd like to begin." |
| Declarative trust | "Verified Legal Counsel, *On-Chain.*" |

## Microcopy

**Buttons.**

- Primary: imperative + arrow → "Find a Lawyer →"
- Secondary: imperative neutral → "How It Works"
- Onboarding next: imperative + visible state → "Continue", "Share
  Over18 credential", "Connect MetaMask"
- Destructive: explicit verb → "Decline" not "No"

**Loading states.**

- "Connecting to MetaMask…" (specific, names the brand).
- "Awaiting wallet approval…" (during a VC request).
- "Signing in…" (during SIWE).
- Avoid "Loading…" alone — always name what is happening.

**Errors.**

- Lead with the recovery, not the cause: "Mock sign-in failed: <reason>.
  Click Try again to retry." — never just "Error 500."
- Form errors are sentence-cased: "Please describe your case in a
  sentence or two." not "DESCRIPTION TOO SHORT."

**Empty states.**

- Title in Fraunces, body in Inter, single CTA.
- Title is imperative *or* declarative: "Finish your verification.",
  "No active consultations yet.", "Your messages will appear here."
- Body is one sentence explaining what to do next.

## Anonymity copy

When a lawyer reviews a request, the client's identifier is:

```
Client 0x4f02…2c1a
Anonymous identifier · wallet verified
```

Never: "Client #1234", "Anonymous user," or anything that implies
either the client is hiding from the lawyer or that the client is a
serial number. The brand promise is privacy by design — the copy
reflects that with neutral, technical specificity.

## Money copy

Always render through `formatEUR()`. The output looks like `€240`,
`€890 / mo`, `from €450`. Never:

- `EUR 240` (currency code first reads as accounting software).
- `240 €` (right-side currency reads as Eurozone but visually
  wobbly in narrow columns).
- `0.07 ETH`, `~€240`, `~240 EUR`.

Pricing-headline strings (set by lawyers themselves) are free-form but
guided in the editor:

| `pricingKind` | Headline pattern | Example |
|---|---|---|
| HOURLY | `€{rate} / hr` | `€240 / hr` |
| FIXED  | `from €{starting}` | `from €450` |
| SUBSCRIPTION | `€{rate} / mo` | `€890 / mo` |
| SUCCESS | `No win, no fee.` | `No win, no fee.` |

## Wallet language

- "Identity wallet" (EBSI-conformant, holds VCs).
- "Transaction wallet" (MetaMask et al, signs SIWE + funds escrow).
- Never "the wallet" without one of those modifiers — they are two
  different things.

## Timestamps

- Schedules: `formatScheduled(date)` → "Tue, May 14 · 10:30 CET"
- Created-at: `formatRelative(date)` → "2 hours ago"
- Never raw ISO strings in user-facing surfaces.

## Don't

- Don't say "we" pretentiously — "Firmus Novus matches you with…"
  beats "We here at Firmus Novus believe that…"
- Don't apologize for the demo state — the demo banner explains it
  factually ("wallet connections and signatures are simulated") and
  the copy moves on.
- Don't use exclamation marks. The brand does not exclaim.
- Don't use emoji as decorations. Lucide icons only.
