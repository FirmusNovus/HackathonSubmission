# Firmus Novus

> Verified Legal Counsel, On-Chain.

A verified-pseudonymous legal-engagement marketplace. Clients prove
they are real EU residents via selective-disclosure of an EU resident
credential; lawyers prove they are admitted to a real EU bar via
selective-disclosure of a bar-membership credential. Engagements are
brokered through escrow on chain; messages between the parties are
end-to-end encrypted with keys derived from their wallets. The
platform stores ciphertext and on-chain attestation references; it
cannot decrypt messages, unseal client identity, or forge a credential.

## Status

MVP slice (US1–US5 + US7) is implemented and verified end-to-end on
local Anvil:

- `forge test` — 23/23 contract tests pass (asymmetric mechanism,
  capability gates, full proposal lifecycle, mutual refund,
  sum-equality split, concurrent-transition revert).
- `scripts/smoke-test.sh` — full demo flow: 6 personas seeded with
  EAS attestations on chain, paid consultation booked + funded +
  accepted + completed, then a separate consultation disputed +
  resolved 50/50 by the operator.

What's wired:

- Marketing landing + verified-lawyer directory + lawyer profile
  with live `hasCapability` check.
- `/connect` role chooser; dev-bypass persona picker at
  `/dev/personas` (writes EAS attestations from operator key).
- Client booking flow that broadcasts
  `openPaidEngagementAndFundConsultation` /  `openFreeEngagement`.
- Lawyer dashboard, request review, accept / decline.
- Consultation room: dark-mode workspace with E2EE chat
  (per-engagement P-256 ECDH + AES-GCM-256 in the browser),
  proposals panel, mark-complete that broadcasts `releaseProposal`.
- Operator dispute queue + resolve form that broadcasts
  `resolveDispute(toLawyer, toClient)` with sum-equality.

What's stubbed for the wwWallet integration session:

- The OID4VCI/OID4VP wire shapes (issuer `.well-known` endpoints,
  verifier request/response routes) are scaffolded in the spec but
  the full wwWallet handshake is exercised via `DEV_BYPASS_EUDI=1`
  for now. Tomorrow's session pairs the `/connect` steppers with
  the live wwWallet.
- US6 multi-proposal UI and US8 avatar upload UI are pending; the
  contract surface and DB schema for both already work.

## Layout

```text
.
├── .specify/                        # Spec Kit toolkit
│   ├── memory/constitution.md         #   project constitution (v1.1.0)
│   ├── templates/                     #   scaffold templates for /speckit-* skills
│   ├── scripts/                       #   bash helpers
│   └── feature.json                   #   pointer at the active feature directory
├── .claude/
│   └── skills/speckit-*/              # /speckit-constitution, /speckit-specify, …
├── specs/
│   └── 001-verified-legal-engagement/ # the active feature spec
│       ├── spec.md                      # what the platform does (8 user stories, 64 FRs)
│       ├── plan.md                      # tech stack + project structure + constitution check
│       ├── research.md                  # 14 technical decisions inside the user-pinned envelope
│       ├── data-model.md                # on-chain + SQLite schemas, state machines, validation rules
│       ├── contracts/                   # interface contracts (Solidity, API, EAS schemas, credential shapes, messaging)
│       ├── quickstart.md                # 10-minute bring-up guide
│       ├── tasks.md                     # 178 numbered tasks across 11 phases
│       └── checklists/requirements.md   # spec-quality validation
├── design/                          # design system (tokens, components, page maps)
│   ├── README.md
│   ├── foundations/                   # color, type, spacing, motion, accessibility, copy
│   ├── css/                           # tokens.css, base.css, components.css, globals.css
│   ├── components.md                  # component catalog
│   └── pages.md                       # all twelve views with layout maps
├── CLAUDE.md                        # agent context — points at the active plan
├── README.md                        # this file
└── .gitignore                       # build artifacts, secrets, local-only state
```

When implementation begins (per `specs/001-verified-legal-engagement/tasks.md`),
the workspace will grow:

```text
├── apps/
│   ├── platform/                    # the application (Next.js, port 3010)
│   ├── issuer/                      # credential issuer (Next.js, port 3001)
│   └── proxy/                       # path-routed reverse proxy (Node, port 3000)
├── packages/
│   ├── crypto/                      # WebCrypto helpers (browser-only)
│   ├── dcql/                        # DCQL builders
│   ├── sd-jwt/                      # SD-JWT VC parse / verify / sign
│   ├── oid4vci/                     # OID4VCI flow helpers
│   └── db-toolkit/                  # better-sqlite3 wrapper
├── contracts/                       # Foundry: AttestationManager, LegalEngagementEscrow, StubZKConflictVerifier
├── circuits/                        # Noir (production trajectory only)
├── scripts/                         # cross-process bring-up, deploy, seed, CI gates
└── pnpm-workspace.yaml
```

## Bring-up (local)

```bash
# 1. Install
pnpm install

# 2. Bring up the chain + deploy contracts + seed
cp .env.example .env             # then edit .env if needed
set -a; source .env; set +a
anvil --block-time 2 --accounts 10 --balance 100 \
      --gas-price 0 --base-fee 0 \
      --mnemonic "$ANVIL_MNEMONIC" &
bash scripts/deploy.sh

# 3. Run the apps (proxy on 3000 fronts platform on 3010 + issuer on 3001)
pnpm dev

# 4. (Optional) front the proxy with ngrok for wwWallet access
ngrok http --domain=$(echo $PUBLIC_HOSTNAME | sed 's|https://||') 3000

# 5. Demo flow — open the browser, hit /dev/personas, pick "Demo Client",
#    book a consultation with Anna Schmidt, switch persona to Anna and
#    accept, switch back to client and mark complete.
#    Or run the headless smoke test:
bash scripts/smoke-test.sh
```

## How to use this from Claude Code

1. From inside this directory, start Claude Code.
2. Read [the constitution](.specify/memory/constitution.md) — the
   nine principles + seven invariants are the project's
   non-negotiables.
3. Read [the active spec](specs/001-verified-legal-engagement/spec.md)
   for the user-facing requirements.
4. Read [the plan](specs/001-verified-legal-engagement/plan.md) for
   the tech stack, project structure, and constitution-check table.
5. Read [the quickstart](specs/001-verified-legal-engagement/quickstart.md)
   for the 10-minute bring-up flow.

## Specification workflow used

This spec set was produced via the Spec Kit workflow:

1. `/speckit-specify` — captured the unified spec from four input
   sets (a frontend, a backend, customer journeys, a prior merged
   spec set). Five mismatches were resolved with the user before
   writing.
2. `/speckit-clarify` — asked five targeted questions on remaining
   ambiguities (concurrency, chain availability, localization,
   consultation timeout, GDPR scope) and integrated the answers as
   FR-058..FR-061, FR-015a/b, FR-055a, plus an Out-of-Scope item.
3. `/speckit-plan` — wrote the cross-feature plan, Phase 0 research
   (14 decisions), and Phase 1 design artifacts (data model + four
   interface contracts + quickstart). Updated CLAUDE.md.
4. `/speckit-tasks` — generated 178 numbered tasks across 11 phases,
   organized by user story for independent implementation.

## Constraints worth knowing before reading the spec

- **Single-wallet** SIWE + selective-disclosure VC for both clients
  and lawyers.
- **ETH-only** on chain AND in user-facing copy. (No fiat / EUR.)
- **Two separate processes**: `apps/issuer/` (issues credentials) is
  separate from `apps/platform/` (verifies, hosts the application).
  Process boundary is enforced at the filesystem level (separate
  signing keys, separate DBs).
- **Asymmetric dispute mechanism**: client may dispute any funded /
  delivered proposal immediately; lawyer may only escalate after a
  30-day cooldown. Contract-enforced, not policy-enforced.
- **End-to-end-encrypted messaging**: server holds ciphertext only;
  no decryption code path exists in any server bundle.
- **ngrok** is the dev hosting target — single hostname, path-routed
  to issuer / platform.
- **Trunk-only branching**: commits land on `main`. No feature
  branches.

## Project workflow

- `main` is the only long-lived branch.
- All changes land on `main` directly.
- CI gates that run on every push (per [the constitution](.specify/memory/constitution.md)
  Engineering Rules + Phase 2 task T077):
  - `forge test` — Solidity invariants (asymmetric mechanism, escrow
    flow, capability gates, sum-equality on resolve, cooldowns).
  - `pnpm test` — vitest unit tests on crypto / credential paths.
  - `pnpm madge --circular apps/platform/` — no import cycles
    (Constitution Inv 7).
  - `scripts/check-feature-isolation.sh` — sibling features never
    import each other.
  - `scripts/check-no-server-decryption.sh` — server bundles never
    import the crypto/client/ helpers (Constitution Inv 1).
  - `scripts/check-isolation.sh` — issuer + platform bring up
    independently and the platform reaches the issuer only via
    HTTPS JWKS (Constitution Inv 4).
  - `scripts/check-brand-mentions.sh` — exactly one brand mention
    in spec + plan title lines, zero elsewhere; zero references to
    the alternative names from prior drafts.

## Where things are not

- There are no feature branches. The "Feature Branch:" header in
  spec.md is a Spec Kit slot identifier (a directory name), not a
  literal git branch.

## License

(Add a license before publishing.)
