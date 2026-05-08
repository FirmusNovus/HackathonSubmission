# Credential Shapes — SD-JWT VC

Both credentials are SD-JWT VC (`vc+sd-jwt` format, also exposed as
`dc+sd-jwt`). The issuer signs the JWS with ES256 (P-256) using a
private JWK held by that issuer process —
`apps/issuer/data/pid-signing-key.jwk` and
`apps/issuer/data/bar-signing-key.jwk` respectively. Holder binding
lives in `cnf.jwk` and is checked at presentation time.

## EU resident credential (PID)

**`vct`**: `urn:eudi:pid:1`

**JWS header**:

```json
{ "alg": "ES256", "typ": "vc+sd-jwt", "kid": "did:key:z<pid-issuer>#z<pid-issuer>" }
```

**Payload (selectively-disclosable claims as `_sd` digests)**:

```json
{
  "iss": "https://<issuer-host>",
  "vct": "urn:eudi:pid:1",
  "iat": 1714982400,
  "exp": 2030554000,
  "cnf": { "jwk": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." } },
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

The issuer can hold any subset of these claims; the wallet stores
them all and discloses selectively at presentation time. **At
presentation, only `age_equal_or_over.18` and `address.country` are
requested by the platform's verifier** (see DCQL below). Birth date,
document number, full address, place of birth, sex never leave the
wallet on a presentation to this platform.

**`iss` MUST be an HTTPS URL, not the issuer's `did:key`** (validated
wwWallet quirk). The wallet still resolves `kid` to the `did:key` to
find the verifying key.

**Credential expiry**: 10 years out — avoids "expired" surprises
during repeated demo runs.

## Bar credential

**`vct`**: `urn:firmus-novus:LegalProfessionalAccreditation`

**JWS header**: as for PID, with the bar issuer's signing JWK and
distinct `kid`.

**Payload — disclosable claims**:

```json
{
  "iss": "https://<issuer-host>",
  "vct": "urn:firmus-novus:LegalProfessionalAccreditation",
  "iat": 1714982400,
  "exp": 2030554000,
  "cnf": { "jwk": { ... holder binding ... } },
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

Disclosure plaintexts (one per `_sd` entry, base64url-encoded with a
salt):

- `["<salt>", "given_name", "Anna"]`
- `["<salt>", "family_name", "Schmidt"]`
- `["<salt>", "jurisdiction", "DE"]`
- `["<salt>", "bar_admission_date", "2018-09-15"]`
- `["<salt>", "bar_admission_number", "RAK-Muenchen-2018-04321"]`
- `["<salt>", "valid_until", "2036-05-06"]`

**Practice area is intentionally absent** from the disclosable claims
because bar associations don't certify specialty; they certify
admission. A lawyer's stated practice area is a self-declared profile
field on the platform, not part of the on-chain attestation.

## DCQL queries used by the verifier

### EU resident credential presentation

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

Notably absent: **everything else**, including the client's name,
nationalities, birth date, document number, full address, place of
birth, sex, email, phone. The wallet's consent dialog shows the user
exactly those two fields are being requested; nothing else is
disclosed to the platform. This is FR-002 + Constitution II at the
protocol layer: ask only for what we'll keep, persist only what we
asked for.

If a different verifier (a tax portal, a cross-border DAC7 reporter,
etc.) wanted name or birth date from the same credential, that
verifier would issue its own DCQL with the additional paths and the
wallet would prompt the user again, separately. Each verifier's
disclosure scope is isolated.

### Bar credential presentation

```json
{
  "credentials": [{
    "id": "lawyer-cred",
    "format": "vc+sd-jwt",
    "meta": { "vct_values": ["urn:firmus-novus:LegalProfessionalAccreditation"] },
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

## Holder binding check (verifier-side)

After parsing the SD-JWT VC envelope:

1. Extract `cnf.jwk` from the issuer's payload.
2. Verify the wallet's KB-JWT (key-binding JWT) appended to the
   SD-JWT is signed by `cnf.jwk`'s key.
3. The KB-JWT's `aud` claim MUST equal the verifier's `client_id`
   (`x509_san_dns:<hostname>`).
4. The KB-JWT's `nonce` MUST equal the verifier's request nonce.
5. The KB-JWT's binding key MUST match the SIWE-bound address — i.e.
   the wallet that signed in is the same wallet that holds the
   credential. Spec FR-007 + FR-009.

These checks reject replayed presentations from a different audience
and credential thefts ("you can't present my credential from your
wallet").

## Trust anchor

The verifier resolves `kid` → issuer's `did:key` → public key, then
checks the JWS signature.

For the MVP: the issuer's public key lives at
`/api/issuer/{pid,bar}/.well-known/jwks.json` and the verifier
whitelists those two issuer hostnames as trusted. **TIR lookup is
production trajectory** — the operator's manual review at
attestation time stands in for the Trusted Issuers Registry gate.
