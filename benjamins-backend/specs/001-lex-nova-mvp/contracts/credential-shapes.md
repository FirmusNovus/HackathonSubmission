# Credential Shapes — SD-JWT VC

Both credentials are SD-JWT VC (`vc+sd-jwt` format, also exposed as `dc+sd-jwt`). The issuer signs the JWS with ES256 (P-256) using a private JWK held by that issuer's process — `apps/bar-issuer/data/signing-key.jwk` and `apps/pid-issuer/data/signing-key.jwk` respectively. Holder binding lives in `cnf.jwk` and is checked at presentation time.

## Bar credential

**`vct`**: `urn:lex-nova:LegalProfessionalAccreditation`

**JWS header**:
```json
{ "alg": "ES256", "typ": "vc+sd-jwt", "kid": "did:key:z<bar-issuer>#z<bar-issuer>" }
```

**Payload (selectively-disclosable claims as `_sd` digests)**:
```json
{
  "iss": "https://<bar-issuer-host>",
  "vct": "urn:lex-nova:LegalProfessionalAccreditation",
  "iat": 1714982400,
  "exp": 2030554000,
  "cnf": { "jwk": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." } },
  "_sd_alg": "sha-256",
  "_sd": [
    "<digest of given_name disclosure>",
    "<digest of family_name disclosure>",
    "<digest of jurisdiction disclosure>",
    "<digest of bar_admission_date disclosure>",
    "<digest of bar_admission_number disclosure>",
    "<digest of valid_until disclosure>"
  ]
}
```

Disclosure plaintexts (one per `_sd` entry, base64url-encoded with a salt):
- `["<salt>", "given_name", "Anna"]`
- `["<salt>", "family_name", "Schmidt"]`
- `["<salt>", "jurisdiction", "DE"]`
- `["<salt>", "bar_admission_date", "2018-09-15"]`
- `["<salt>", "bar_admission_number", "RAK-Muenchen-2018-04321"]`
- `["<salt>", "valid_until", "2036-05-06"]`

**Practice area is intentionally absent** from the disclosable claims because bar associations don't certify specialty; they certify admission. A lawyer's stated practice area is a self-declared profile field on lex-nova, not part of the on-chain attestation.

**`iss` must be an HTTPS URL, not the issuer's `did:key`** (validated wwWallet quirk, RFC 9207). The wallet still resolves `kid` to the `did:key` to find the verifying key.

**Card art**: the issuer's metadata `credential_configurations_supported.<id>.display[0].background_image.uri` points at `/api/issuer/bar/card-art.svg` — a per-persona generated SVG showing name + jurisdiction + a bar-style mark. The wallet renders this on the credential card.

**Credential expiry**: 10 years out (per user instruction during the spike — avoids "expired" surprises during repeated demo runs).

## PID

**`vct`**: `urn:eudi:pid:1`

**JWS header**: as for bar, with the PID issuer's `did:key`.

**Payload — disclosable claims**:
```json
{
  "iss": "https://<pid-issuer-host>",
  "vct": "urn:eudi:pid:1",
  "iat": 1714982400,
  "exp": 2030554000,
  "cnf": { "jwk": { ... holder binding ... } },
  "_sd_alg": "sha-256",
  "_sd": [
    "<digest of given_name>",
    "<digest of family_name>",
    "<digest of birth_date>",
    "<digest of nationalities>",
    "<digest of address>",
    "<digest of age_equal_or_over.18>",
    "<digest of place_of_birth>",
    "<digest of sex>"
  ]
}
```

The issuer can hold any subset of these claims; the wallet stores them all and discloses selectively at presentation time. **At presentation, only `given_name`, `family_name`, `nationalities`, `age_equal_or_over.18`, `address.country` are requested by the verifier's DCQL query** (see below). Birth date, document number, full address, place of birth, sex never leave the wallet.

## DCQL queries used by the verifier

### Bar presentation

```json
{
  "credentials": [{
    "id": "lawyer-cred",
    "format": "vc+sd-jwt",
    "meta": { "vct_values": ["urn:lex-nova:LegalProfessionalAccreditation"] },
    "claims": [
      { "path": ["given_name"] },
      { "path": ["family_name"] },
      { "path": ["jurisdiction"] },
      { "path": ["bar_admission_date"] },
      { "path": ["bar_admission_number"] },
      { "path": ["valid_until"] }
    ]
  }]
}
```

### PID presentation

```json
{
  "credentials": [{
    "id": "pid-cred",
    "format": "vc+sd-jwt",
    "meta": { "vct_values": ["urn:eudi:pid:1"] },
    "claims": [
      { "path": ["age_equal_or_over", "18"] },
      { "path": ["address", "country"] }
    ]
  }]
}
```

Notably absent: **everything else, including the client's name, nationalities, birth date, document number, full address, place of birth, sex, email, phone, and so on**. The PID credential carries the full EUDI ARF claim set; our DCQL only requests the two atoms the platform actually persists (age-over-18 and country). The wallet's consent dialog shows the user exactly those two fields are being requested; nothing else is disclosed to lex-nova. This is FR-003 (tightened) at the protocol layer: ask only for what we'll keep, persist only what we asked for.

If a different verifier (a tax portal, a cross-border DAC7 reporter, etc.) wanted name or birth date from the same credential, that verifier would issue its own DCQL with the additional paths and the wallet would prompt the user again, separately. Each verifier's disclosure scope is isolated.

## Holder binding check (verifier-side)

After parsing the SD-JWT VC envelope:

1. Extract `cnf.jwk` from the issuer's payload.
2. Verify the wallet's KB-JWT (key-binding JWT) appended to the SD-JWT is signed by `cnf.jwk`'s key.
3. The KB-JWT's `aud` claim MUST equal the verifier's `client_id` (`x509_san_dns:<hostname>`).
4. The KB-JWT's `nonce` MUST equal the verifier's request nonce.

These checks reject replayed presentations from a different audience.

## Trust anchor

The verifier resolves `kid` → issuer's `did:key` → public key, then checks the JWS signature.

For the MVP: the issuer's public key lives at `/api/issuer/{bar,pid}/.well-known/jwks.json` and the verifier whitelists those two issuer hostnames as trusted. **TIR lookup is production trajectory** — see [research.md](../research.md#decision-9-explicitly-out-of-scope).
