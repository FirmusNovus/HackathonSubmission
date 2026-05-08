# EAS Schema Definitions

Two EAS schemas registered by `AttestationManager.sol` at deploy time.
Each schema's UID is computed deterministically by EAS from
`(schemaString, resolver, revocable)`. The UIDs are read once at deploy
time, written into `apps/platform/lib/chain/addresses.ts` alongside
the contract addresses, and referenced from the rest of the app via
`SCHEMA_LAWYER`, `SCHEMA_CLIENT`.

## `verified_lawyer`

**Schema string**:

```text
string jurisdiction,string barAdmissionNumber,uint64 admittedAt,uint64 validUntil
```

- `jurisdiction`: ISO country code (e.g. `"DE"`, `"ES"`, `"IT"`,
  `"CZ"`). Mirrors the SD-JWT VC's `jurisdiction` claim.
- `barAdmissionNumber`: the formal registry identifier the bar
  association assigned this lawyer (e.g. `"RAK-Muenchen-2018-04321"`,
  `"ICAM-2014-08327"`, `"ČAK ev. č. 14302"`). The chamber/locality is
  encoded in the registry number's structure.
- `admittedAt`: unix seconds; the lawyer's actual bar-admission date
  (a permanent fact about the lawyer, distinct from the credential's
  `iat`).
- `validUntil`: unix seconds; the SD-JWT VC's `valid_until` mirrored
  on chain. Lets the directory page filter out expired attestations
  without a revocation transaction.

**Notably absent**: practice area. Bar associations attest to
admission, not specialty. A "I do GDPR work" claim on a lawyer
profile is a self-declaration outside the credential — kept on the
platform's profile surface, never on chain.

**Recipient**: the lawyer's wallet (the address that just presented
the credential).
**Attester**: the platform operator.
**Revocable**: yes. Used when the operator manually revokes via the
admin path (no UI in the MVP — `cast send` against the contract directly).

**Resolver**: `address(0)` for the MVP (no on-attestation custom logic).
Production trajectory may add a TIR-lookup resolver that gates
attestation on the issuer being TIR-listed.

## `verified_client`

**Schema string**:

```text
string countryOfResidence,bool ageOver18
```

- `countryOfResidence`: ISO 3166-1 alpha-2 (e.g. `"ES"` for Spain).
- `ageOver18`: derived from the EU resident credential's
  `age_equal_or_over.18` claim.

**Recipient**: the client's wallet.
**Attester**: the platform operator.
**Revocable**: yes.

**Why these two and only these two**: they are the on-chain-needed
subset of the disclosed attributes. The other parts of the disclosed-
attribute set for clients (which are *only* country + over-18
boolean — no name, no birth date) are exhaustively covered by these
two on-chain fields plus the wallet address. There is nothing about
the client that lives off-chain in `verified_users.disclosed_attrs`
that isn't also in EAS — they are equivalent for clients.

For lawyers the two views differ: EAS holds the practising attributes
(jurisdiction, bar admission number, admission date, validity);
`verified_users.disclosed_attrs` holds those too plus the lawyer's
cleartext name (intentional — lawyers are public-facing professionals
clients vet by name).

## How `AttestationManager` reads them

```solidity
function hasCapability(address subject, bytes32 schemaId) external view returns (bool) {
    Attestation memory a = eas.getAttestation(_latestAttestation[subject][schemaId]);
    if (a.uid == bytes32(0)) return false;
    if (a.revocationTime != 0) return false;
    if (a.expirationTime != 0 && a.expirationTime < block.timestamp) return false;
    return true;
}
```

`_latestAttestation[subject][schemaId]` is bookkeeping the manager
maintains so the read is O(1). When the operator re-attests the same
subject + schema (e.g., renewing a credential), the new UID overwrites
the old entry but the prior attestation stays in the EAS log for
auditability.

## On revocation

A revoke call hits EAS directly via `eas.revoke(...)`. The next
`hasCapability` read returns `false` because of the
`revocationTime != 0` check. The `LegalEngagementEscrow` contract reads
`hasCapability` afresh on every gated action, so revocation takes
effect immediately for *new* engagements; in-flight engagements are
not retroactively unwound (per spec edge case "in-flight engagements
continue to their natural completion"; SC-007).
