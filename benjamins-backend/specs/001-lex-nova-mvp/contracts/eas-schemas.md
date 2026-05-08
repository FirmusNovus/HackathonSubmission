# EAS Schema Definitions

Three schemas registered by `AttestationManager.sol` at deploy time. Each schema's UID is computed deterministically by EAS from `(schemaString, resolver, revocable)`. The UIDs are read once at deploy time, written into `lib/chain/addresses.ts` alongside the contract addresses, and referenced from the rest of the app via `SCHEMA_LAWYER`, `SCHEMA_CLIENT`, `SCHEMA_ARBITER`.

## `verified_lawyer`

**Schema string**:
```text
string jurisdiction,string barAdmissionNumber,uint64 admittedAt,uint64 validUntil
```

- `jurisdiction`: ISO country code, e.g. `"DE"`, `"ES"`, `"IT"`, `"CZ"`. Mirrors the SD-JWT VC's `jurisdiction` claim.
- `barAdmissionNumber`: the formal registry identifier the bar association assigned this lawyer (e.g. `"RAK-Muenchen-2018-04321"`, `"ICAM-2014-08327"`, `"ČAK ev. č. 14302"`). The chamber/locality is encoded in the registry number's structure.
- `admittedAt`: unix seconds; the lawyer's actual bar-admission date (a permanent fact about the lawyer, distinct from the credential's `iat`).
- `validUntil`: unix seconds; the SD-JWT VC's `valid_until` mirrored on chain. Lets the directory page filter out expired attestations without a revocation transaction.

**Notably absent**: practice area. Bar associations attest to admission, not specialty. A "I do GDPR work" claim on a lawyer profile is a self-declaration outside the credential — kept on the lex-nova profile surface, never on chain.

**Recipient**: the lawyer's wallet (the address that just presented the credential).
**Attester**: the platform operator.
**Revocable**: yes. Used when the operator manually revokes via the admin page.

**Resolver**: `address(0)` for MVP (no on-attestation custom logic). Production trajectory may add a TIR-lookup resolver that gates attestation on the issuer being TIR-listed.

## `verified_client`

**Schema string**:
```text
string countryOfResidence,bool ageOver18
```

- `countryOfResidence`: ISO 3166-1 alpha-2 (e.g. "ES" for Spain).
- `ageOver18`: derived from PID's `age_equal_or_over.18` claim.

**Recipient**: the client's wallet.
**Attester**: the platform operator.
**Revocable**: yes.

**Why these two and only these two**: they are the on-chain-needed subset of the disclosed attributes. Given/family name and nationalities matter for the in-app display but not for any on-chain gate, so they live in SQLite (`verified_users.disclosed_attrs`) — exposing them on chain would unnecessarily widen the public surface for the same lawyer who already sees them via the engagement page.

## `verified_arbiter`

**Schema string**:
```text
string note
```

- `note`: free-form provenance note set by the operator at promotion time (e.g. "Promoted 2026-05-06 after manual review of bar history"). Useful for the dispute-resolution paper trail.

**Recipient**: the arbiter's wallet (which MUST already hold `verified_lawyer`).
**Attester**: the platform operator.
**Revocable**: yes.

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

`_latestAttestation[subject][schemaId]` is bookkeeping the manager maintains so the read is O(1). When the operator re-attests the same subject + schema (e.g., renewing a credential), the new UID overwrites the old entry but the prior attestation stays in the EAS log for auditability.

## On revocation

A revoke call hits EAS directly via `eas.revoke(...)`. The next `hasCapability` read returns `false` because of the `revocationTime != 0` check. The `LegalEngagementEscrow` contract reads `hasCapability` afresh on every gated action, so revocation takes effect immediately.

In-flight engagements continue (the previously-funded milestones are not retroactively unwound), but no *new* engagement may open against a revoked address (per spec edge case "A wallet's credential expires mid-engagement: ongoing engagements continue").
