# Feature Specification: Lawyer Verification

**Feature Branch**: `003-lawyer-verification`
**Created**: 2026-05-08
**Status**: Draft
**Input**: Translation of `app/verify-lawyer/page.tsx`,
`app/verify-lawyer/verify-lawyer-form.tsx`,
`app/api/verification/route.ts`,
`app/api/admin/verify-lawyer/route.ts`, `app/api/uploads/route.ts`,
and `lib/web3/ebsi.ts`'s `verifyLawyerCredentials`.

## User Scenarios & Testing

### User Story 1 — A lawyer submits credentials for EBSI verification (Priority: P1)

A newly authenticated lawyer with no LawyerProfile lands on
`/verify-lawyer`, fills in personal + bar credentials + pricing, drags
in supporting documents, and submits. The system creates a `PENDING`
LawyerProfile and queues an EBSI Trusted Issuers Registry check.

**Why this priority**: Without a verified lawyer pool, the marketplace
has nothing to sell.

**Independent Test**: Sign in as an unverified lawyer, fill the form
with a valid bar registration number, jurisdiction, admission date,
specialties, languages, and at least one credential document, then
submit. A new LawyerProfile row exists with status `PENDING` and the
documents are stored under `/uploads/credentials/<userId>/…`.

**Acceptance Scenarios**:

1. **Given** an authenticated lawyer with no LawyerProfile, **When**
   they visit `/verify-lawyer`, **Then** the form is shown with the
   EBSI verification rail explaining the process.
2. **Given** the form, **When** the lawyer submits with all required
   fields valid, **Then** a LawyerProfile row is created with
   `verificationStatus = PENDING` and the chosen `pricingKind`,
   `pricingHeadline`, and `hourlyRateEUR`.
3. **Given** the form, **When** files are added to the drop zone,
   **Then** they upload to `/uploads/credentials/<userId>/<filename>`
   and their URLs are appended to `credentialDocsUrl[]`.
4. **Given** validation fails (missing bar number, bio < 40 chars,
   etc.), **When** the form submits, **Then** field-level errors are
   surfaced inline and no row is created.

### User Story 2 — Auto-verification fires in dev (Priority: P2)

In dev, a freshly-submitted `PENDING` LawyerProfile is auto-promoted
to `VERIFIED` after `DEV_AUTO_VERIFY_SECONDS` (default 5). Setting the
env to `0` disables the auto-flip.

**Why this priority**: Demos must show the verified state without
hand-running an admin curl in the middle of a stage demo.

**Acceptance Scenarios**:

1. **Given** dev mode with `DEV_AUTO_VERIFY_SECONDS=5`, **When** a
   lawyer submits credentials, **Then** within ~5 seconds the row
   flips to `VERIFIED` and an `ebsiCredentialId` is set.
2. **Given** `DEV_AUTO_VERIFY_SECONDS=0`, **When** a lawyer submits,
   **Then** the row stays `PENDING` until an admin call.

### User Story 3 — Admin verifies a lawyer manually (Priority: P2)

An admin (anyone holding the `ADMIN_API_KEY`) flips a specific
LawyerProfile to `VERIFIED` via a single POST endpoint. This is the
only admin surface in the MVP.

**Why this priority**: There must be a way to verify lawyers in
production before the EBSI Trusted Issuers Registry integration lands.

**Acceptance Scenarios**:

1. **Given** a `PENDING` LawyerProfile, **When** an admin POSTs to
   `/api/admin/verify-lawyer` with the `x-admin-key` header and the
   profile id in the body, **Then** the row flips to `VERIFIED` with
   an `ebsiCredentialId` set.
2. **Given** a request without the admin key, **When** posted,
   **Then** the response is 401 and no state changes.
3. **Given** a verified lawyer, **When** the directory is re-fetched,
   **Then** they appear in the public list.

### Edge Cases

- A lawyer with an existing LawyerProfile revisits `/verify-lawyer` —
  they are redirected to `/lawyer/dashboard`.
- File upload exceeds the size limit — the request fails with a
  user-readable error and no partial files are stored.
- An unauthenticated request hits `/api/uploads/[…]` — it is denied;
  served files are auth-checked.
- A non-image, non-PDF file is uploaded — it is rejected at the API
  boundary.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST gate `/verify-lawyer` to authenticated
  users only (any role); the public-facing page is the form.
- **FR-002**: The form MUST collect: full name, optional email, city,
  headline, bio (≥40 chars), bar registration number, bar
  jurisdiction, admission date, jurisdictions list, specialties list,
  languages list, years of experience, hourly rate in EUR, pricing
  kind (HOURLY / FIXED / SUBSCRIPTION / SUCCESS), and pricing headline
  string.
- **FR-003**: The system MUST allow uploading credential documents to
  a per-user directory under `/uploads/credentials/<userId>/…`.
- **FR-004**: The system MUST auth-check downloads via
  `/api/uploads/[…path]` — only the owning lawyer or an admin can
  fetch their own credential files.
- **FR-005**: A new submission MUST create a LawyerProfile row with
  `verificationStatus = PENDING` and stash the document URLs in
  `credentialDocsUrl[]`.
- **FR-006**: In dev, a profile in `PENDING` MUST flip to `VERIFIED`
  automatically `DEV_AUTO_VERIFY_SECONDS` seconds after creation
  (default 5; 0 disables).
- **FR-007**: The system MUST expose `POST /api/admin/verify-lawyer`,
  which requires the `x-admin-key: $ADMIN_API_KEY` header and a JSON
  body `{ "lawyerProfileId": string }`. On success, the target row
  flips to `VERIFIED` and is assigned an `ebsiCredentialId`.
- **FR-008**: The verification rail MUST visibly explain: bar
  registration cross-check via EBSI Trusted Issuers Registry, optional
  university credential check, issuance of a VC back to the lawyer's
  identity wallet on success.

### Key Entities

- **LawyerProfile** — see spec 001 for the public surface. Verification
  flow adds `verificationStatus` (PENDING | VERIFIED | REJECTED),
  `ebsiCredentialId` (set on verify), `barRegistrationNum`,
  `barJurisdiction`, `admissionDate`, `credentialDocsUrl[]`.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A lawyer can submit credentials end-to-end in under
  three minutes given pre-filled documents.
- **SC-002**: 0 unauthenticated downloads of a credential document
  succeed.
- **SC-003**: In dev, the median time from submit to VERIFIED state
  matches `DEV_AUTO_VERIFY_SECONDS` ± 1s.
- **SC-004**: The admin endpoint rejects 100% of requests missing or
  mismatching the `x-admin-key` header.

## Assumptions

- `verifyLawyerCredentials()` in `lib/web3/ebsi.ts` is a stub that
  always succeeds in dev. Production replaces it with an EBSI Trusted
  Issuers Registry call (see
  https://ec.europa.eu/digital-building-blocks/sites/display/EBSI/EBSI+Trusted+Issuers+Registry).
- File storage is local disk for the MVP. Production migrates to S3
  or Cloudflare R2 with signed URLs (see constitution §VII).
- Admin verification is a single POST endpoint without UI. A real
  admin panel is out of MVP scope.
- The Reviews and Disputes flows are out of MVP scope and do not
  affect this spec.
