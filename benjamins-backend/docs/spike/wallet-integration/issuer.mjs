// Minimal OID4VCI issuer for the lex-nova spike — SD-JWT VC variant.
//
// Stands in for "the bar association" issuing a LegalProfessionalAccreditation
// credential (SD-JWT VC, type "dc+sd-jwt") into wwWallet via the
// pre-authorized code grant flow. This is the format wwWallet's OID4VCI
// consume path actually accepts, per the source-code review of wallet-frontend
// (round-9 finding).

import express from "express";
import crypto from "node:crypto";
import { generateKeyPair, exportJWK, base64url } from "jose";
import { SDJwtVcInstance } from "@sd-jwt/sd-jwt-vc";
import { util as keyDidUtil } from "@cef-ebsi/key-did-resolver";

// ----- Configuration ---------------------------------------------------------

const PORT = process.env.PORT ?? 3001;
const ISSUER_URL = process.env.ISSUER_URL ?? `http://localhost:${PORT}`;
const VCT_BAR = "urn:lex-nova:LegalProfessionalAccreditation";
const VCT_PID = "urn:eudi:pid:1";
// kept as alias for any code still importing/using VCT
const VCT = VCT_BAR;

// ----- Issuer key + DID setup -----------------------------------------------

console.log("Generating bar issuer keypair (ES256)...");
const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const issuerPubJwk = await exportJWK(publicKey);
const issuerPrivJwk = await exportJWK(privateKey);
const ISSUER_DID = keyDidUtil.createDid(issuerPubJwk);
const ISSUER_KID = `${ISSUER_DID}#${ISSUER_DID.split(":")[2]}`;

console.log("Issuer DID:", ISSUER_DID);
console.log("Issuer KID:", ISSUER_KID);
console.log("");

// ----- SD-JWT VC instance ----------------------------------------------------

const subtle = crypto.webcrypto.subtle;

const sdjwt = new SDJwtVcInstance({
  signer: async (data) => {
    const key = await subtle.importKey(
      "jwk",
      issuerPrivJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );
    const sig = await subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(data)
    );
    return base64url.encode(new Uint8Array(sig));
  },
  verifier: async (data, sig) => {
    const key = await subtle.importKey(
      "jwk",
      issuerPubJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    const sigBytes = typeof sig === "string" ? base64url.decode(sig) : sig;
    return subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sigBytes,
      new TextEncoder().encode(data)
    );
  },
  signAlg: "ES256",
  hasher: async (data, alg) => {
    const out = await subtle.digest(alg.toUpperCase(), new TextEncoder().encode(data));
    return new Uint8Array(out);
  },
  hashAlg: "sha-256",
  saltGenerator: async () => crypto.randomBytes(16).toString("base64url"),
});

// ----- In-memory state -------------------------------------------------------

const offers = new Map();        // preAuthCode -> { holderJwk?, payload }
const accessTokens = new Map();   // accessToken -> { holderJwk?, payload, cNonce }

// ----- Helpers ---------------------------------------------------------------

// Six personas: 5 EU lawyer personas (each carries both a bar profile AND a
// PID profile, since lex-nova's lawyer onboarding presents PID + bar together
// per the spec) plus 1 client persona (john_doe, PID-only — chosen to mirror
// wwWallet's own demo PID exactly so we can swap between issuers).
//
// Bar admission numbers follow each jurisdiction's real conventions (RAK +
// city for DE, Toque + Barreau for FR, Iscrizione N. for IT, ČAK ev. č. for
// CZ). PID payloads are PID-shaped per EUDI ARF (urn:eudi:pid:1) — no `picture`
// field by user request (saves a few KB of base64 in every credential).
const PERSONAS = {
  anna_schmidt: {
    label: "Anna Schmidt — RAK München (DE) [lawyer]",
    kind: "lawyer",
    bar: {
      given_name: "Anna",
      family_name: "Schmidt",
      jurisdiction: "DE",
      bar_admission_date: "2018-09-15",
      bar_admission_number: "RAK-Muenchen-2018-04321",
    },
    pid: {
      given_name: "Anna",
      family_name: "Schmidt",
      birth_given_name: "Anna",
      birth_family_name: "Schmidt",
      birthdate: "1985-04-12",
      age_in_years: 41,
      age_birth_year: 1985,
      age_equal_or_over: { 14: true, 16: true, 18: true, 21: true, 65: false },
      sex: 2,
      nationalities: ["DE"],
      email: "anna.schmidt@kanzlei-schmidt.de",
      phone_number: "+498912345678",
      place_of_birth: { locality: "München", region: "Bayern", country: "DE" },
      address: {
        street_address: "Maximilianstraße",
        house_number: "12",
        postal_code: "80539",
        locality: "München",
        region: "Bayern",
        country: "DE",
        formatted: "Maximilianstraße 12, 80539 München, Bayern, DE",
      },
      personal_administrative_number: "DE-A-19850412-0001",
      document_number: "DE-PID-2023-887421",
      issuing_authority: "Bundesdruckerei",
      issuing_country: "DE",
      issuing_jurisdiction: "DE-BY",
    },
  },
  lukas_weber: {
    label: "Lukas Weber — RAK Berlin (DE) [lawyer]",
    kind: "lawyer",
    bar: {
      given_name: "Lukas",
      family_name: "Weber",
      jurisdiction: "DE",
      bar_admission_date: "2012-03-22",
      bar_admission_number: "RAK-Berlin-2012-01987",
    },
    pid: {
      given_name: "Lukas",
      family_name: "Weber",
      birth_given_name: "Lukas",
      birth_family_name: "Weber",
      birthdate: "1979-08-23",
      age_in_years: 46,
      age_birth_year: 1979,
      age_equal_or_over: { 14: true, 16: true, 18: true, 21: true, 65: false },
      sex: 1,
      nationalities: ["DE"],
      email: "lukas.weber@weber-recht.de",
      phone_number: "+493012345001",
      place_of_birth: { locality: "Berlin", region: "Berlin", country: "DE" },
      address: {
        street_address: "Unter den Linden",
        house_number: "44",
        postal_code: "10117",
        locality: "Berlin",
        region: "Berlin",
        country: "DE",
        formatted: "Unter den Linden 44, 10117 Berlin, DE",
      },
      personal_administrative_number: "DE-B-19790823-0042",
      document_number: "DE-PID-2022-441208",
      issuing_authority: "Bundesdruckerei",
      issuing_country: "DE",
      issuing_jurisdiction: "DE-BE",
    },
  },
  sophie_lefevre: {
    label: "Sophie Lefèvre — Barreau de Paris (FR) [lawyer]",
    kind: "lawyer",
    bar: {
      given_name: "Sophie",
      family_name: "Lefèvre",
      jurisdiction: "FR",
      bar_admission_date: "2015-06-10",
      bar_admission_number: "Toque K0214 — Barreau de Paris",
    },
    pid: {
      given_name: "Sophie",
      family_name: "Lefèvre",
      birth_given_name: "Sophie",
      birth_family_name: "Lefèvre",
      birthdate: "1988-11-30",
      age_in_years: 37,
      age_birth_year: 1988,
      age_equal_or_over: { 14: true, 16: true, 18: true, 21: true, 65: false },
      sex: 2,
      nationalities: ["FR"],
      email: "s.lefevre@cabinet-lefevre.fr",
      phone_number: "+33142567890",
      place_of_birth: { locality: "Lyon", region: "Auvergne-Rhône-Alpes", country: "FR" },
      address: {
        street_address: "Rue de Rivoli",
        house_number: "97",
        postal_code: "75001",
        locality: "Paris",
        region: "Île-de-France",
        country: "FR",
        formatted: "97 Rue de Rivoli, 75001 Paris, FR",
      },
      personal_administrative_number: "FR-1881130-75107",
      document_number: "FR-PID-2024-552310",
      issuing_authority: "Agence nationale des titres sécurisés",
      issuing_country: "FR",
      issuing_jurisdiction: "FR-75",
    },
  },
  marco_rossi: {
    label: "Marco Rossi — Ordine di Milano (IT) [lawyer]",
    kind: "lawyer",
    bar: {
      given_name: "Marco",
      family_name: "Rossi",
      jurisdiction: "IT",
      bar_admission_date: "2009-11-04",
      bar_admission_number: "Iscrizione 2009/A/15487 — Ordine di Milano",
    },
    pid: {
      given_name: "Marco",
      family_name: "Rossi",
      birth_given_name: "Marco",
      birth_family_name: "Rossi",
      birthdate: "1976-02-14",
      age_in_years: 50,
      age_birth_year: 1976,
      age_equal_or_over: { 14: true, 16: true, 18: true, 21: true, 65: false },
      sex: 1,
      nationalities: ["IT"],
      email: "marco.rossi@studiorossi.it",
      phone_number: "+390223456789",
      place_of_birth: { locality: "Milano", region: "Lombardia", country: "IT" },
      address: {
        street_address: "Via Manzoni",
        house_number: "31",
        postal_code: "20121",
        locality: "Milano",
        region: "Lombardia",
        country: "IT",
        formatted: "Via Manzoni 31, 20121 Milano, IT",
      },
      personal_administrative_number: "RSSMRC76B14F205X",
      document_number: "IT-PID-2023-098712",
      issuing_authority: "Istituto Poligrafico e Zecca dello Stato",
      issuing_country: "IT",
      issuing_jurisdiction: "IT-MI",
    },
  },
  eva_novak: {
    label: "Eva Novák — Česká advokátní komora (CZ) [lawyer]",
    kind: "lawyer",
    bar: {
      given_name: "Eva",
      family_name: "Novák",
      jurisdiction: "CZ",
      bar_admission_date: "2020-01-14",
      bar_admission_number: "ČAK ev. č. 18432",
    },
    pid: {
      given_name: "Eva",
      family_name: "Novák",
      birth_given_name: "Eva",
      birth_family_name: "Svobodová",
      birthdate: "1992-06-05",
      age_in_years: 33,
      age_birth_year: 1992,
      age_equal_or_over: { 14: true, 16: true, 18: true, 21: true, 65: false },
      sex: 2,
      nationalities: ["CZ"],
      email: "eva.novak@advokat-novak.cz",
      phone_number: "+420224567890",
      place_of_birth: { locality: "Praha", region: "Hlavní město Praha", country: "CZ" },
      address: {
        street_address: "Národní třída",
        house_number: "20",
        postal_code: "11000",
        locality: "Praha",
        region: "Hlavní město Praha",
        country: "CZ",
        formatted: "Národní třída 20, 11000 Praha, CZ",
      },
      personal_administrative_number: "920605/4321",
      document_number: "CZ-PID-2024-117055",
      issuing_authority: "Ministerstvo vnitra ČR",
      issuing_country: "CZ",
      issuing_jurisdiction: "CZ-10",
    },
  },
  john_doe: {
    label: "John Doe (US/GR) [client]",
    kind: "client",
    // No bar — clients aren't lawyers.
    pid: {
      given_name: "John",
      family_name: "Doe",
      birth_given_name: "John",
      birth_family_name: "Doe",
      birthdate: "1990-10-15",
      age_in_years: 35,
      age_birth_year: 1990,
      age_equal_or_over: { 14: true, 16: true, 18: true, 21: true, 65: false },
      sex: 1,
      nationalities: ["US", "GR"],
      email: "john@sample.com",
      phone_number: "+308388338382",
      place_of_birth: { locality: "Manhattan", region: "New York", country: "US" },
      address: {
        street_address: "Random str.",
        house_number: "3",
        postal_code: "34793",
        locality: "Manhattan",
        region: "New York",
        country: "US",
        formatted: "Random str. 3, 34793 Manhattan, New York, US",
      },
      personal_administrative_number: "123456789",
      document_number: "12313213",
      issuing_authority: "PID:00001",
      issuing_country: "GR",
      issuing_jurisdiction: "GR-F",
    },
  },
};
const DEFAULT_PERSONA = "anna_schmidt";
const lawyerPersonaKeys = () =>
  Object.entries(PERSONAS).filter(([, p]) => p.kind === "lawyer").map(([k]) => k);

function buildBarPayload(holderJwk, personaKey) {
  const persona = PERSONAS[personaKey] ?? PERSONAS[DEFAULT_PERSONA];
  const bar = persona.bar;
  if (!bar) {
    throw new Error(`persona ${personaKey} has no bar profile (clients can't get bar credentials)`);
  }
  const now = Math.floor(Date.now() / 1000);
  const expSec = now + 10 * 365 * 24 * 3600;
  return {
    // `iss` must be an HTTPS URL so wwWallet's SD-JWT VC parser can fetch
    // <iss>/.well-known/openid-credential-issuer and apply our claim/display
    // metadata on the credential card. The signing key identity lives in the
    // JWT `kid` header (the issuer DID), which the verifier already resolves
    // independently — `iss` is for metadata lookup only.
    iss: ISSUER_URL,
    iat: now,
    exp: expSec,
    vct: VCT_BAR,
    cnf: holderJwk ? { jwk: holderJwk } : undefined,
    given_name: bar.given_name,
    family_name: bar.family_name,
    jurisdiction: bar.jurisdiction,
    bar_admission_date: bar.bar_admission_date,
    bar_admission_number: bar.bar_admission_number,
    valid_until: new Date(expSec * 1000).toISOString().slice(0, 10),
  };
}

function buildPidPayload(holderJwk, personaKey) {
  const persona = PERSONAS[personaKey] ?? PERSONAS[DEFAULT_PERSONA];
  const pid = persona.pid;
  if (!pid) {
    throw new Error(`persona ${personaKey} has no PID profile`);
  }
  const now = Math.floor(Date.now() / 1000);
  const expSec = now + 10 * 365 * 24 * 3600;
  return {
    iss: ISSUER_URL,
    iat: now,
    exp: expSec,
    vct: VCT_PID,
    cnf: holderJwk ? { jwk: holderJwk } : undefined,
    // PID-required claims (per EUDI ARF urn:eudi:pid:1)
    given_name: pid.given_name,
    family_name: pid.family_name,
    birth_given_name: pid.birth_given_name,
    birth_family_name: pid.birth_family_name,
    birthdate: pid.birthdate,
    age_in_years: pid.age_in_years,
    age_birth_year: pid.age_birth_year,
    age_equal_or_over: pid.age_equal_or_over,
    sex: pid.sex,
    nationalities: pid.nationalities,
    email: pid.email,
    phone_number: pid.phone_number,
    place_of_birth: pid.place_of_birth,
    address: pid.address,
    personal_administrative_number: pid.personal_administrative_number,
    document_number: pid.document_number,
    issuing_authority: pid.issuing_authority,
    issuing_country: pid.issuing_country,
    issuing_jurisdiction: pid.issuing_jurisdiction,
    date_of_expiry: new Date(expSec * 1000).toISOString().slice(0, 10),
    date_of_issuance: new Date(now * 1000).toISOString().slice(0, 10),
  };
}

const BAR_DISCLOSURE_FRAME = {
  _sd: [
    "given_name",
    "family_name",
    "jurisdiction",
    "bar_admission_date",
    "bar_admission_number",
    "valid_until",
  ],
};

// Every leaf claim (and nested object's leaves) is independently disclosable
// so the holder can present, e.g., just `age_equal_or_over.18` without
// revealing date of birth or address.
const PID_DISCLOSURE_FRAME = {
  _sd: [
    "given_name",
    "family_name",
    "birth_given_name",
    "birth_family_name",
    "birthdate",
    "age_in_years",
    "age_birth_year",
    "sex",
    "nationalities",
    "email",
    "phone_number",
    "personal_administrative_number",
    "document_number",
    "issuing_authority",
    "issuing_country",
    "issuing_jurisdiction",
    "date_of_expiry",
    "date_of_issuance",
  ],
  place_of_birth: { _sd: ["locality", "region", "country"] },
  address: {
    _sd: ["formatted", "street_address", "house_number", "postal_code", "locality", "region", "country"],
  },
  age_equal_or_over: { _sd: ["14", "16", "18", "21", "65"] },
};

// ----- Express app -----------------------------------------------------------

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, DPoP");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  // Log every non-OPTIONS request so we never miss anything.
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

// 1. Issuer metadata
//
// `credential_metadata.display` carries the rendering hints wwWallet uses to
// draw the credential card (background image/colour, logo, text colour). The
// schema and rendering pipeline live in wallet-common
// (CredentialConfigurationSupportedSchema.ts -> credential_metadata.display).
//
// `credential_metadata.claims` describes how to label each disclosed claim in
// the wallet UI, keyed by the same SD-JWT path we disclose.
//
// `batch_credential_issuance.batch_size` tells wwWallet how many credential
// instances to request in one go. The wallet generates that many holder
// keypairs and sends N proofs in `proofs.jwt[]`; each instance is then used
// once per verifier for unlinkability (CredentialBatchHelper.ts picks the
// least-used instance via sigCount).
app.get("/.well-known/openid-credential-issuer", (req, res) => {
  // no-store: wwWallet's HttpProxy caches metadata for 30 days by default
  // (HttpProxy.ts default maxAge), which makes iterative spike work miserable.
  // Cache-Control: no-store turns caching off entirely on the wallet side.
  res.setHeader("Cache-Control", "no-store");
  res.json({
    credential_issuer: ISSUER_URL,
    authorization_servers: [ISSUER_URL],
    credential_endpoint: `${ISSUER_URL}/credential`,
    batch_credential_issuance: { batch_size: 5 },
    credential_configurations_supported: {
      LegalProfessionalAccreditation_sdjwt: {
        format: "vc+sd-jwt",
        scope: "LegalProfessionalAccreditation",
        cryptographic_binding_methods_supported: ["did:key", "jwk"],
        credential_signing_alg_values_supported: ["ES256"],
        proof_types_supported: {
          jwt: { proof_signing_alg_values_supported: ["ES256"] },
        },
        vct: VCT_BAR,
        credential_metadata: {
          display: [
            {
              name: "Legal Professional Accreditation",
              description: "Bar association attestation that the holder is admitted to practise law.",
              locale: "en-GB",
              background_color: "#1a2238",
              text_color: "#f5f5f5",
              background_image: { uri: `${ISSUER_URL}/assets/card-bg.svg` },
              logo: { uri: `${ISSUER_URL}/assets/logo.svg`, alt_text: "Bar association seal" },
            },
          ],
          claims: [
            { path: ["given_name"], display: [{ name: "First name", locale: "en-GB" }] },
            { path: ["family_name"], display: [{ name: "Family name", locale: "en-GB" }] },
            { path: ["jurisdiction"], display: [{ name: "Jurisdiction", locale: "en-GB" }] },
            { path: ["bar_admission_date"], display: [{ name: "Admitted to bar", locale: "en-GB" }] },
            { path: ["bar_admission_number"], display: [{ name: "Bar admission no.", locale: "en-GB" }] },
            { path: ["valid_until"], display: [{ name: "Valid until", locale: "en-GB" }] },
          ],
        },
      },
      EudiPid_sdjwt: {
        format: "vc+sd-jwt",
        scope: "EudiPid",
        cryptographic_binding_methods_supported: ["did:key", "jwk"],
        credential_signing_alg_values_supported: ["ES256"],
        proof_types_supported: {
          jwt: { proof_signing_alg_values_supported: ["ES256"] },
        },
        vct: VCT_PID,
        credential_metadata: {
          display: [
            {
              name: "Person Identification Data",
              description: "EUDI Person Identification Data — government-issued identity attestation.",
              locale: "en-GB",
              background_color: "#003399",
              text_color: "#ffffff",
              background_image: { uri: `${ISSUER_URL}/assets/pid-card-bg.svg` },
              logo: { uri: `${ISSUER_URL}/assets/pid-logo.svg`, alt_text: "EU stars emblem" },
            },
          ],
          claims: [
            { path: ["given_name"], display: [{ name: "First name", locale: "en-GB" }] },
            { path: ["family_name"], display: [{ name: "Last name", locale: "en-GB" }] },
            { path: ["birthdate"], display: [{ name: "Date of birth", locale: "en-GB" }] },
            { path: ["birth_given_name"], display: [{ name: "Birth first name", locale: "en-GB" }] },
            { path: ["birth_family_name"], display: [{ name: "Birth last name", locale: "en-GB" }] },
            { path: ["nationalities"], display: [{ name: "Nationalities", locale: "en-GB" }] },
            { path: ["sex"], display: [{ name: "Sex", locale: "en-GB" }] },
            { path: ["email"], display: [{ name: "Email", locale: "en-GB" }] },
            { path: ["phone_number"], display: [{ name: "Mobile", locale: "en-GB" }] },
            { path: ["place_of_birth", "locality"], display: [{ name: "City of birth", locale: "en-GB" }] },
            { path: ["place_of_birth", "region"], display: [{ name: "Region of birth", locale: "en-GB" }] },
            { path: ["place_of_birth", "country"], display: [{ name: "Country of birth", locale: "en-GB" }] },
            { path: ["address", "formatted"], display: [{ name: "Full address", locale: "en-GB" }] },
            { path: ["address", "street_address"], display: [{ name: "Street", locale: "en-GB" }] },
            { path: ["address", "house_number"], display: [{ name: "Street no.", locale: "en-GB" }] },
            { path: ["address", "postal_code"], display: [{ name: "ZIP", locale: "en-GB" }] },
            { path: ["address", "locality"], display: [{ name: "City", locale: "en-GB" }] },
            { path: ["address", "region"], display: [{ name: "State / region", locale: "en-GB" }] },
            { path: ["address", "country"], display: [{ name: "Country", locale: "en-GB" }] },
            { path: ["age_equal_or_over", "14"], display: [{ name: "Age ≥ 14", locale: "en-GB" }] },
            { path: ["age_equal_or_over", "16"], display: [{ name: "Age ≥ 16", locale: "en-GB" }] },
            { path: ["age_equal_or_over", "18"], display: [{ name: "Age ≥ 18", locale: "en-GB" }] },
            { path: ["age_equal_or_over", "21"], display: [{ name: "Age ≥ 21", locale: "en-GB" }] },
            { path: ["age_equal_or_over", "65"], display: [{ name: "Age ≥ 65", locale: "en-GB" }] },
            { path: ["age_in_years"], display: [{ name: "Age", locale: "en-GB" }] },
            { path: ["age_birth_year"], display: [{ name: "Birth year", locale: "en-GB" }] },
            { path: ["personal_administrative_number"], display: [{ name: "Personal ID", locale: "en-GB" }] },
            { path: ["document_number"], display: [{ name: "Document number", locale: "en-GB" }] },
            { path: ["issuing_authority"], display: [{ name: "Issuing authority", locale: "en-GB" }] },
            { path: ["issuing_country"], display: [{ name: "Issuing country", locale: "en-GB" }] },
            { path: ["issuing_jurisdiction"], display: [{ name: "Issuing region", locale: "en-GB" }] },
            { path: ["date_of_expiry"], display: [{ name: "Expiry date", locale: "en-GB" }] },
            { path: ["date_of_issuance"], display: [{ name: "Issue date", locale: "en-GB" }] },
          ],
        },
      },
    },
    display: [
      {
        name: "Lex Nova — Stand-in Bar Issuer",
        locale: "en-GB",
        logo: { uri: `${ISSUER_URL}/assets/logo.svg`, alt_text: "Bar association seal" },
      },
    ],
  });
});

// SVG card artwork served from the issuer host so wwWallet's image proxy
// can fetch it through the same public URL it already trusts.
const CARD_BG_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a2238"/>
      <stop offset="100%" stop-color="#2a3858"/>
    </linearGradient>
  </defs>
  <rect width="320" height="200" fill="url(#bg)"/>
  <text x="20" y="38" fill="#d4af37" font-family="Georgia, serif" font-size="13" font-weight="bold" letter-spacing="2">BAR ASSOCIATION</text>
  <text x="20" y="56" fill="#a0a8b8" font-family="Georgia, serif" font-size="10">Munich Chamber of Lawyers</text>
  <text x="280" y="190" fill="#d4af37" font-family="serif" font-size="48" text-anchor="middle">⚖</text>
  <text x="20" y="170" fill="#ffffff" font-family="Georgia, serif" font-size="15" font-weight="bold">Legal Professional</text>
  <text x="20" y="188" fill="#a0a8b8" font-family="Georgia, serif" font-size="11">Accreditation Credential</text>
</svg>`;

const LOGO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="8" fill="#1a2238"/>
  <text x="32" y="48" fill="#d4af37" font-family="serif" font-size="44" text-anchor="middle">⚖</text>
</svg>`;

app.get("/assets/card-bg.svg", (req, res) => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(CARD_BG_SVG);
});

app.get("/assets/logo.svg", (req, res) => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(LOGO_SVG);
});

// PID card artwork: classic EU navy/gold (Reflex Blue + Yellow per the EU
// flag spec). Twelve stars in a circle approximated via discrete coordinates
// since SVG arithmetic in static strings is awkward.
const PID_CARD_BG_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200">
  <defs>
    <linearGradient id="pidbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#003399"/>
      <stop offset="100%" stop-color="#1a4db5"/>
    </linearGradient>
  </defs>
  <rect width="320" height="200" fill="url(#pidbg)"/>
  <g fill="#ffcc00" font-family="serif" font-size="14" text-anchor="middle">
    <text x="262" y="105">★</text>
    <text x="259" y="121">★</text>
    <text x="251" y="135">★</text>
    <text x="238" y="143">★</text>
    <text x="222" y="143">★</text>
    <text x="208" y="135">★</text>
    <text x="200" y="121">★</text>
    <text x="197" y="105">★</text>
    <text x="200" y="89">★</text>
    <text x="208" y="75">★</text>
    <text x="222" y="67">★</text>
    <text x="238" y="67">★</text>
    <text x="251" y="75">★</text>
    <text x="259" y="89">★</text>
  </g>
  <text x="20" y="38" fill="#ffcc00" font-family="Georgia, serif" font-size="13" font-weight="bold" letter-spacing="2">EUROPEAN UNION</text>
  <text x="20" y="56" fill="#a0c0ff" font-family="Georgia, serif" font-size="10">Person Identification Data</text>
  <text x="20" y="170" fill="#ffffff" font-family="Georgia, serif" font-size="15" font-weight="bold">Identity Card</text>
  <text x="20" y="188" fill="#a0c0ff" font-family="Georgia, serif" font-size="11">Issued by member-state authority</text>
</svg>`;

const PID_LOGO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="8" fill="#003399"/>
  <g fill="#ffcc00" font-family="serif" font-size="11" text-anchor="middle">
    <text x="48" y="34">★</text>
    <text x="44" y="44">★</text>
    <text x="32" y="48">★</text>
    <text x="20" y="44">★</text>
    <text x="16" y="34">★</text>
    <text x="20" y="24">★</text>
    <text x="32" y="20">★</text>
    <text x="44" y="24">★</text>
  </g>
</svg>`;

app.get("/assets/pid-card-bg.svg", (req, res) => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(PID_CARD_BG_SVG);
});

app.get("/assets/pid-logo.svg", (req, res) => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(PID_LOGO_SVG);
});

// 2. Authorization server metadata.
//    Advertise dpop_signing_alg_values_supported so wwWallet's DPoP setup
//    block runs (otherwise it dereferences a null `dpopParams.current` at
//    TokenRequest.ts:215 — wwWallet bug). We accept the DPoP header on
//    /token without strict validation; this is a spike.
app.get("/.well-known/oauth-authorization-server", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    issuer: ISSUER_URL,
    token_endpoint: `${ISSUER_URL}/token`,
    grant_types_supported: ["urn:ietf:params:oauth:grant-type:pre-authorized_code"],
    "pre-authorized_grant_anonymous_access_supported": true,
    dpop_signing_alg_values_supported: ["ES256"],
  });
});

// 3. Generate a credential offer URL.
//    We expose the offer at /credential-offer/:id and reference it via
//    credential_offer_uri (not inline credential_offer). Why: wwWallet's
//    CredentialOfferSchema (in wallet-common) doesn't include the
//    pre-authorized_code grant in its zod object, so when wwWallet
//    parses an inline credential_offer it strips our pre-auth grant
//    and falls back to the auth-code path. Going via credential_offer_uri
//    bypasses the zod schema (httpProxy.get(...).data is not validated).
const offerObjects = new Map(); // id -> credential_offer JSON

app.post("/offer", (req, res) => {
  const preAuthCode = crypto.randomBytes(16).toString("hex");
  const offerId = crypto.randomBytes(8).toString("hex");
  const personaKey = req.body?.persona && PERSONAS[req.body.persona]
    ? req.body.persona
    : DEFAULT_PERSONA;
  const credentialType = req.body?.credential_type === "pid" ? "pid" : "bar";
  const persona = PERSONAS[personaKey];

  // Clients (kind=client) have no bar profile; reject the combination explicitly
  // rather than silently fall through to a confusing "no bar profile" error
  // at /credential time.
  if (credentialType === "bar" && persona.kind !== "lawyer") {
    return res.status(400).json({
      error: "invalid_persona_for_credential",
      detail: `persona ${personaKey} is a client; bar credentials are lawyers-only.`,
    });
  }

  let payload, disclosureFrame, configId;
  if (credentialType === "pid") {
    payload = buildPidPayload(null, personaKey);
    disclosureFrame = PID_DISCLOSURE_FRAME;
    configId = "EudiPid_sdjwt";
  } else {
    payload = buildBarPayload(null, personaKey);
    disclosureFrame = BAR_DISCLOSURE_FRAME;
    configId = "LegalProfessionalAccreditation_sdjwt";
  }
  offers.set(preAuthCode, { payload, personaKey, credentialType, disclosureFrame });

  const offer = {
    credential_issuer: ISSUER_URL,
    credential_configuration_ids: [configId],
    grants: {
      "urn:ietf:params:oauth:grant-type:pre-authorized_code": {
        "pre-authorized_code": preAuthCode,
      },
    },
  };
  offerObjects.set(offerId, offer);

  console.log(`[/offer] minted offer ${offerId} type=${credentialType} persona=${personaKey} (${persona.label})`);
  const offerUri = `${ISSUER_URL}/credential-offer/${offerId}`;
  const offerUrl = `openid-credential-offer://?credential_offer_uri=${encodeURIComponent(offerUri)}`;
  res.json({ offerUrl, offerUri, preAuthCode, persona: personaKey, credentialType });
});

// 3b. Serve the offer JSON for credential_offer_uri lookups.
app.get("/credential-offer/:id", (req, res) => {
  const offer = offerObjects.get(req.params.id);
  if (!offer) return res.status(404).json({ error: "offer_not_found" });
  // Don't delete — wwWallet may fetch it more than once during dev.
  res.json(offer);
});

// 4. Token endpoint
app.post("/token", (req, res) => {
  console.log("[/token] received");
  console.log("  body:", JSON.stringify(req.body));
  console.log("  headers:", JSON.stringify({
    authorization: req.headers.authorization,
    "content-type": req.headers["content-type"],
    dpop: req.headers.dpop ? req.headers.dpop.slice(0, 60) + "..." : "(none)",
  }));

  const grantType = req.body.grant_type;
  const preAuthCode = req.body["pre-authorized_code"];

  if (grantType !== "urn:ietf:params:oauth:grant-type:pre-authorized_code") {
    console.log("[/token] unsupported grant_type:", grantType);
    return res.status(400).json({ error: "unsupported_grant_type" });
  }
  const offer = offers.get(preAuthCode);
  if (!offer) {
    console.log("[/token] no offer for code (already consumed or unknown):", preAuthCode);
    return res.status(400).json({ error: "invalid_grant" });
  }
  offers.delete(preAuthCode);

  const accessToken = crypto.randomBytes(32).toString("hex");
  const cNonce = crypto.randomBytes(16).toString("hex");
  accessTokens.set(accessToken, { ...offer, cNonce });

  console.log(`[/token] issued access_token: ${accessToken.slice(0, 16)}... (full length ${accessToken.length})`);
  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    c_nonce: cNonce,
    c_nonce_expires_in: 300,
  });
});

// 5. Credential endpoint — wallet POSTs proof, receives the SD-JWT VC.
app.post("/credential", async (req, res) => {
  console.log("[/credential] received");
  console.log("  authorization:", req.headers.authorization);
  console.log("  body keys:", Object.keys(req.body || {}));
  console.log("  body.format:", req.body?.format);
  console.log("  body.proof?.proof_type:", req.body?.proof?.proof_type);
  console.log("  body.proof?.jwt (first 60):", req.body?.proof?.jwt?.slice(0, 60));
  console.log("  known accessTokens (count, prefixes):",
    accessTokens.size,
    Array.from(accessTokens.keys()).map((k) => k.slice(0, 16) + "..."));

  const authHeader = req.headers.authorization || "";
  const auth = authHeader.replace(/^(Bearer|DPoP)\s+/i, "");
  console.log(`  extracted token (first 16): ${auth.slice(0, 16)}... (full length ${auth.length})`);

  const session = accessTokens.get(auth);
  if (!session) {
    console.log("[/credential] 401 — token not found in map");
    return res.status(401).json({ error: "invalid_token" });
  }
  // Don't delete on first use — wwWallet may retry, and we want to be lenient
  // for the spike. Production would scope this properly.

  // Collect every proof JWT the wallet sent. wwWallet (Draft 14+) sends
  // `proofs.jwt: [<jwt>, <jwt>, ...]` — one per holder keypair when batch
  // issuance is advertised. Self-test still uses the singular `proof.jwt`.
  let proofJwts = [];
  if (req.body?.proofs?.jwt) {
    const arr = req.body.proofs.jwt;
    proofJwts = Array.isArray(arr) ? arr : [arr];
    console.log(`[issuer] using proofs.jwt[] (Draft 14+ shape), count=${proofJwts.length}`);
  } else if (req.body?.proof?.jwt) {
    proofJwts = [req.body.proof.jwt];
    console.log("[issuer] using proof.jwt (singular)");
  } else {
    console.log("[issuer] no proof JWT — falling back to body.holderJwk or session.payload.cnf");
    proofJwts = [null];
  }

  // For each proof, extract the holder JWK from its header and mint a
  // credential bound to that JWK. With batch issuance every instance gets a
  // distinct holder key, which is how wwWallet provides unlinkability across
  // verifiers (it presents a different instance to each one).
  const extractHolderJwk = (proofJwt) => {
    if (!proofJwt) return req.body?.holderJwk ?? null;
    try {
      const headerB64 = proofJwt.split(".")[0];
      const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf-8"));
      if (header.jwk) return header.jwk;
      if (header.kid?.startsWith("did:key:")) {
        console.log(`[issuer] proof has did:key kid (no inline JWK): ${header.kid.slice(0, 60)}...`);
      }
    } catch (e) {
      console.warn("[issuer] could not parse proof JWT:", e.message);
    }
    return null;
  };

  try {
    const credentials = [];
    for (let i = 0; i < proofJwts.length; i++) {
      const holderJwk = extractHolderJwk(proofJwts[i]);
      const payload = {
        ...session.payload,
        cnf: holderJwk ? { jwk: holderJwk } : session.payload.cnf,
      };
      const frame = session.disclosureFrame ?? BAR_DISCLOSURE_FRAME;
      const sdjwtVc = await sdjwt.issue(payload, frame, {
        header: { kid: ISSUER_KID, typ: "dc+sd-jwt" },
      });
      credentials.push(sdjwtVc);
      console.log(`[issuer] minted credential ${i + 1}/${proofJwts.length} (holder jwk: ${holderJwk?.x?.slice(0, 12) ?? "n/a"}...)`);
    }
    // Return both shapes: singular `credential` (self-test, OID4VCI < Draft 13)
    // and `credentials[]` (wwWallet, OID4VCI Draft 14+).
    res.json({
      format: "vc+sd-jwt",
      credential: credentials[0],
      credentials: credentials.map((c) => ({ credential: c })),
    });
  } catch (e) {
    console.error("Credential issuance failed:", e.message);
    res.status(500).json({ error: "credential_issuance_failed", detail: e.message });
  }
});

// 6. Operator UI
app.get("/", (req, res) => {
  // Two dropdowns sharing the same PERSONAS object as a single source of
  // truth: bar credential dropdown lists only lawyers (clients can't have
  // bar credentials); PID dropdown lists everyone.
  const barOptionsHtml = Object.entries(PERSONAS)
    .filter(([, p]) => p.kind === "lawyer")
    .map(([key, p]) => `<option value="${key}"${key === DEFAULT_PERSONA ? " selected" : ""}>${p.label}</option>`)
    .join("");
  const pidOptionsHtml = Object.entries(PERSONAS)
    .map(([key, p]) => `<option value="${key}"${key === DEFAULT_PERSONA ? " selected" : ""}>${p.label}</option>`)
    .join("");
  res.send(`<!doctype html>
<html><head><title>Lex Nova — Spike Issuer (SD-JWT VC)</title>
<style>body{font-family:monospace;max-width:720px;margin:2rem auto;padding:1rem}
input,select,textarea,button{font-family:monospace;width:100%;padding:.5rem;margin:.25rem 0;box-sizing:border-box}
label{display:block;margin-top:1rem;font-size:0.9em;color:#555}
section{border:1px solid #ddd;border-radius:6px;padding:1rem 1.25rem;margin:1.5rem 0}
section h2{margin:0 0 .5rem 0}
.bar-section{border-left:6px solid #1a2238}
.pid-section{border-left:6px solid #003399}
.offer{background:#eee;padding:1rem;word-break:break-all}</style>
</head><body>
<h1>Lex Nova spike issuer (SD-JWT VC)</h1>
<p>Issuer DID: <code style="font-size:0.85em">${ISSUER_DID}</code></p>
<p>Format: <code>vc+sd-jwt</code>. vcts: <code>${VCT_BAR}</code>, <code>${VCT_PID}</code></p>

<section class="bar-section">
  <h2>⚖ Bar credential</h2>
  <p style="margin:.25rem 0 .75rem 0;color:#555">Lawyer-only. Mints a <code>LegalProfessionalAccreditation</code> SD-JWT VC.</p>
  <label for="bar-persona">Persona:</label>
  <select id="bar-persona">${barOptionsHtml}</select>
  <button onclick="makeOffer('bar')">Generate bar credential offer</button>
  <div id="bar-out"></div>
</section>

<section class="pid-section">
  <h2>★ EU PID</h2>
  <p style="margin:.25rem 0 .75rem 0;color:#555">Everyone (lawyers and clients). Mints a Person Identification Data SD-JWT VC.</p>
  <label for="pid-persona">Persona:</label>
  <select id="pid-persona">${pidOptionsHtml}</select>
  <button onclick="makeOffer('pid')">Generate PID offer</button>
  <div id="pid-out"></div>
</section>

<script>
// Compute the API base from the current page's path. Works for both
//   /          (localhost direct)
//   /issuer    (behind path-routing proxy, no trailing slash)
//   /issuer/   (with trailing slash)
const API_BASE = window.location.pathname.replace(/\\/$/, "");
async function makeOffer(credentialType) {
  const dropdownId = credentialType === "pid" ? "pid-persona" : "bar-persona";
  const outId = credentialType === "pid" ? "pid-out" : "bar-out";
  const personaKey = document.getElementById(dropdownId).value;
  const r = await fetch(API_BASE + "/offer", {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({ persona: personaKey, credential_type: credentialType })
  });
  const j = await r.json();
  if (j.error) {
    document.getElementById(outId).innerHTML = '<p style="color:#a00"><strong>Error:</strong> ' + (j.detail || j.error) + '</p>';
    return;
  }
  // wwWallet picks up the offer via credential_offer_uri (so its
  // CredentialOfferSchema doesn't strip our pre-auth grant).
  const wwwalletUrl = "https://demo.wwwallet.org/cb?credential_offer_uri=" + encodeURIComponent(j.offerUri);
  document.getElementById(outId).innerHTML =
    '<h3>Offer for ' + personaKey + ' (' + credentialType + ') ready</h3>' +
    '<p><a href="' + wwwalletUrl + '" target="wwwallet" style="display:inline-block;background:#0070ff;color:white;padding:0.75rem 1.5rem;text-decoration:none;border-radius:4px">→ Open this offer in wwWallet</a></p>' +
    '<details style="margin-top:1rem"><summary>Detail</summary>' +
    '<p>Persona: <code>' + j.persona + '</code></p>' +
    '<p>Credential type: <code>' + j.credentialType + '</code></p>' +
    '<p>Offer URI: <code>' + j.offerUri + '</code></p>' +
    '<p>Pre-auth code: <code>' + j.preAuthCode + '</code></p>' +
    '<p>Raw offer URL: <code style="word-break:break-all">' + j.offerUrl + '</code></p></details>';
}
</script>
</body></html>`);
});

app.listen(PORT, () => {
  console.log(`Spike issuer listening on ${ISSUER_URL}`);
  console.log(`Open ${ISSUER_URL}/ in a browser to drive issuance.`);
});
