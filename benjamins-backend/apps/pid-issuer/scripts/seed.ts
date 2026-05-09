/**
 * PID issuer seed. Populates the local `subjects` table with the natural
 * persons the stand-in PID provider knows about + ensures a signing key exists
 * + writes per-subject card art SVGs.
 *
 * Idempotent. Run from the pid-issuer app dir:
 *   pnpm -F @lex-nova/pid-issuer seed
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import { generateKeyPair, exportJWK } from "jose";
import { type Address } from "viem";
import { mnemonicToAccount } from "viem/accounts";

const APP_ROOT = join(__dirname, "..");
const DATA_DIR = join(APP_ROOT, "data");
const DB_PATH = process.env.PID_ISSUER_DB_PATH ?? join(DATA_DIR, "db.sqlite");
const KEY_PATH = process.env.PID_ISSUER_KEY_PATH ?? join(DATA_DIR, "signing-key.jwk");
const MIGRATIONS_DIR = join(APP_ROOT, "lib/db/migrations");
const CARD_ART_DIR = join(APP_ROOT, "public/card-art");

const ANVIL_MNEMONIC =
  process.env.ANVIL_MNEMONIC ?? "test test test test test test test test test test test junk";

interface PidSubjectSpec {
  index: number;
  display_name: string;
  given_name: string;
  family_name: string;
  birth_given_name: string;
  birth_family_name: string;
  birthdate: string;
  sex: number;
  email: string;
  phone_number: string;
  nationalities: string[];
  place_of_birth: { locality: string; region: string; country: string };
  address: {
    street_address: string;
    house_number: string;
    postal_code: string;
    locality: string;
    region: string;
    country: string;
    formatted: string;
  };
  personal_administrative_number: string;
  document_number: string;
  issuing_authority: string;
  issuing_country: string;
  issuing_jurisdiction: string;
  card_art_color: string;
}

// Lawyers also have PIDs (they're EU residents too). Plus the client persona.
const SUBJECTS: PidSubjectSpec[] = [
  {
    index: 1,
    display_name: "Anna Schmidt",
    given_name: "Anna",
    family_name: "Schmidt",
    birth_given_name: "Anna",
    birth_family_name: "Schmidt",
    birthdate: "1985-04-12",
    sex: 2,
    email: "anna.schmidt@kanzlei-schmidt.de",
    phone_number: "+498912345678",
    nationalities: ["DE"],
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
    card_art_color: "#1e3a8a",
  },
  {
    index: 2,
    display_name: "Carlos García",
    given_name: "Carlos",
    family_name: "García",
    birth_given_name: "Carlos",
    birth_family_name: "García",
    birthdate: "1981-07-08",
    sex: 1,
    email: "carlos.garcia@garcia-abogados.es",
    phone_number: "+34915557788",
    nationalities: ["ES"],
    place_of_birth: { locality: "Madrid", region: "Comunidad de Madrid", country: "ES" },
    address: {
      street_address: "Calle de Serrano",
      house_number: "47",
      postal_code: "28001",
      locality: "Madrid",
      region: "Comunidad de Madrid",
      country: "ES",
      formatted: "Calle de Serrano 47, 28001 Madrid, Comunidad de Madrid, ES",
    },
    personal_administrative_number: "ES-A-19810708-0073",
    document_number: "ES-PID-2022-115502",
    issuing_authority: "Ministerio del Interior",
    issuing_country: "ES",
    issuing_jurisdiction: "ES-MD",
    card_art_color: "#7c2d12",
  },
  {
    index: 3,
    display_name: "Dieter Müller",
    given_name: "Dieter",
    family_name: "Müller",
    birth_given_name: "Dieter",
    birth_family_name: "Müller",
    birthdate: "1976-11-23",
    sex: 1,
    email: "dieter.mueller@gdpr-mueller.de",
    phone_number: "+493012345001",
    nationalities: ["DE"],
    place_of_birth: { locality: "Berlin", region: "Berlin", country: "DE" },
    address: {
      street_address: "Unter den Linden",
      house_number: "44",
      postal_code: "10117",
      locality: "Berlin",
      region: "Berlin",
      country: "DE",
      formatted: "Unter den Linden 44, 10117 Berlin, Berlin, DE",
    },
    personal_administrative_number: "DE-B-19761123-0042",
    document_number: "DE-PID-2022-441208",
    issuing_authority: "Bundesdruckerei",
    issuing_country: "DE",
    issuing_jurisdiction: "DE-BE",
    card_art_color: "#0f766e",
  },
  {
    index: 4,
    display_name: "Sofia Rossi",
    given_name: "Sofia",
    family_name: "Rossi",
    birth_given_name: "Sofia",
    birth_family_name: "Rossi",
    birthdate: "1988-02-14",
    sex: 2,
    email: "sofia.rossi@studiolegale-rossi.it",
    phone_number: "+390652207788",
    nationalities: ["IT"],
    place_of_birth: { locality: "Roma", region: "Lazio", country: "IT" },
    address: {
      street_address: "Via del Corso",
      house_number: "112",
      postal_code: "00186",
      locality: "Roma",
      region: "Lazio",
      country: "IT",
      formatted: "Via del Corso 112, 00186 Roma, Lazio, IT",
    },
    personal_administrative_number: "IT-A-19880214-0089",
    document_number: "IT-CIE-2023-RM-554210",
    issuing_authority: "Ministero dell'Interno",
    issuing_country: "IT",
    issuing_jurisdiction: "IT-RM",
    card_art_color: "#9d174d",
  },
  {
    index: 5,
    display_name: "Eva Novák",
    given_name: "Eva",
    family_name: "Novák",
    birth_given_name: "Eva",
    birth_family_name: "Novák",
    birthdate: "1983-09-30",
    sex: 2,
    email: "eva.novak@novak-pravo.cz",
    phone_number: "+420224567890",
    nationalities: ["CZ"],
    place_of_birth: { locality: "Praha", region: "Hlavní město Praha", country: "CZ" },
    address: {
      street_address: "Národní třída",
      house_number: "26",
      postal_code: "11000",
      locality: "Praha 1",
      region: "Hlavní město Praha",
      country: "CZ",
      formatted: "Národní třída 26, 11000 Praha 1, Hlavní město Praha, CZ",
    },
    personal_administrative_number: "CZ-A-19830930-0017",
    document_number: "CZ-OP-2024-PR-883104",
    issuing_authority: "Ministerstvo vnitra",
    issuing_country: "CZ",
    issuing_jurisdiction: "CZ-PR",
    card_art_color: "#581c87",
  },
  {
    index: 6,
    display_name: "Marta Sánchez",
    given_name: "Marta",
    family_name: "Sánchez",
    birth_given_name: "Marta",
    birth_family_name: "Sánchez",
    birthdate: "1991-04-22",
    sex: 2,
    email: "marta.sanchez@founderstartup.es",
    phone_number: "+34910123456",
    nationalities: ["ES"],
    place_of_birth: { locality: "Barcelona", region: "Catalunya", country: "ES" },
    address: {
      street_address: "Carrer de Bailèn",
      house_number: "5",
      postal_code: "08010",
      locality: "Barcelona",
      region: "Catalunya",
      country: "ES",
      formatted: "Carrer de Bailèn 5, 08010 Barcelona, Catalunya, ES",
    },
    personal_administrative_number: "ES-A-19910422-0042",
    document_number: "ES-PID-2023-887421",
    issuing_authority: "Ministerio del Interior",
    issuing_country: "ES",
    issuing_jurisdiction: "ES-CT",
    card_art_color: "#0c4a6e",
  },
];

async function main() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);

  await ensureKey();

  if (!existsSync(CARD_ART_DIR)) mkdirSync(CARD_ART_DIR, { recursive: true });

  // Use `eth_address` (not `address`) here because PidSubjectSpec already has
  // an `address` field for the EUDI address object — collision would shadow.
  const subjectsWithAddr = SUBJECTS.map((s) => ({
    ...s,
    eth_address: mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: s.index }).address,
  }));

  for (const s of subjectsWithAddr) {
    writeFileSync(join(CARD_ART_DIR, `${slug(s.display_name)}.svg`), buildCardArt(s));
  }

  const upsert = db.prepare(`
    INSERT INTO subjects (
      id, display_name, eth_address, given_name, family_name, birth_given_name,
      birth_family_name, birthdate, sex, email, phone_number, nationalities,
      place_of_birth, address, personal_administrative_number, document_number,
      issuing_authority, issuing_country, issuing_jurisdiction
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name=excluded.display_name,
      eth_address=excluded.eth_address,
      given_name=excluded.given_name,
      family_name=excluded.family_name,
      birth_given_name=excluded.birth_given_name,
      birth_family_name=excluded.birth_family_name,
      birthdate=excluded.birthdate,
      sex=excluded.sex,
      email=excluded.email,
      phone_number=excluded.phone_number,
      nationalities=excluded.nationalities,
      place_of_birth=excluded.place_of_birth,
      address=excluded.address,
      personal_administrative_number=excluded.personal_administrative_number,
      document_number=excluded.document_number,
      issuing_authority=excluded.issuing_authority,
      issuing_country=excluded.issuing_country,
      issuing_jurisdiction=excluded.issuing_jurisdiction
  `);

  for (const s of subjectsWithAddr) {
    upsert.run(
      s.index,
      s.display_name,
      s.eth_address,
      s.given_name,
      s.family_name,
      s.birth_given_name,
      s.birth_family_name,
      s.birthdate,
      s.sex,
      s.email,
      s.phone_number,
      JSON.stringify(s.nationalities),
      JSON.stringify(s.place_of_birth),
      JSON.stringify(s.address),
      s.personal_administrative_number,
      s.document_number,
      s.issuing_authority,
      s.issuing_country,
      s.issuing_jurisdiction
    );
  }
  console.log(`✓ pid-issuer seeded with ${subjectsWithAddr.length} subjects (DB at ${DB_PATH})`);
}

async function ensureKey(): Promise<void> {
  if (existsSync(KEY_PATH)) return;
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(privateKey);
  jwk.kid = "pid-issuer-key-1";
  jwk.alg = "ES256";
  jwk.use = "sig";
  writeFileSync(KEY_PATH, JSON.stringify(jwk, null, 2));
  console.log(`✓ Generated pid-issuer signing key at ${KEY_PATH}`);
}

function applyMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (filename TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);`);
  const fs = require("node:fs");
  if (!existsSync(MIGRATIONS_DIR)) return;
  const applied = new Set(
    db.prepare("SELECT filename FROM _migrations").all().map((r: any) => r.filename)
  );
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f: string) => f.endsWith(".sql")).sort();
  const insert = db.prepare("INSERT INTO _migrations (filename, applied_at) VALUES (?, ?)");
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    db.transaction(() => {
      db.exec(sql);
      insert.run(file, Math.floor(Date.now() / 1000));
    })();
  }
}

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildCardArt(s: PidSubjectSpec & { eth_address: Address }): string {
  const subtitle = `EU resident · ${s.address.country}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250">
  <rect width="100%" height="100%" fill="${s.card_art_color}"/>
  <rect x="0" y="0" width="400" height="40" fill="rgba(255,255,255,0.08)"/>
  <text x="20" y="28" fill="white" font-family="sans-serif" font-size="14" font-weight="600">EUDI PID</text>
  <text x="20" y="100" fill="white" font-family="sans-serif" font-size="22" font-weight="700">${escapeXml(s.display_name)}</text>
  <text x="20" y="128" fill="rgba(255,255,255,0.85)" font-family="sans-serif" font-size="14">${escapeXml(subtitle)}</text>
  <text x="20" y="220" fill="rgba(255,255,255,0.6)" font-family="ui-monospace, monospace" font-size="10">${s.eth_address}</text>
</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
