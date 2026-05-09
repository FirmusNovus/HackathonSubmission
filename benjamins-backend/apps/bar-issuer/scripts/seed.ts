/**
 * Bar issuer seed. Populates the local `subjects` table with the lawyers the
 * stand-in bar association has on its roster + ensures a signing key exists +
 * writes per-lawyer card art SVGs.
 *
 * Idempotent. Run from the bar-issuer app dir:
 *   pnpm -F @lex-nova/bar-issuer seed
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import { generateKeyPair, exportJWK } from "jose";
import { type Address } from "viem";
import { mnemonicToAccount } from "viem/accounts";

const APP_ROOT = join(__dirname, "..");
const DATA_DIR = join(APP_ROOT, "data");
const DB_PATH = process.env.BAR_ISSUER_DB_PATH ?? join(DATA_DIR, "db.sqlite");
const KEY_PATH = process.env.BAR_ISSUER_KEY_PATH ?? join(DATA_DIR, "signing-key.jwk");
const MIGRATIONS_DIR = join(APP_ROOT, "lib/db/migrations");
const CARD_ART_DIR = join(APP_ROOT, "public/card-art");

const ANVIL_MNEMONIC =
  process.env.ANVIL_MNEMONIC ?? "test test test test test test test test test test test junk";

interface BarSubjectSpec {
  index: number; // mnemonic addressIndex
  display_name: string;
  given_name: string;
  family_name: string;
  jurisdiction: string;
  bar_admission_date: string;
  bar_admission_number: string;
  card_art_color: string;
}

// Bar admission numbers follow each jurisdiction's actual conventions:
//   DE: "RAK-{city}-{year}-{number}"
//   ES: "ICAM-{year}-{number}" (Ilustre Colegio de Abogados de Madrid)
//   IT: "Iscrizione N. {number} — Albo {city}"
//   CZ: "ČAK ev. č. {number}"
const SUBJECTS: BarSubjectSpec[] = [
  {
    index: 1,
    display_name: "Anna Schmidt",
    given_name: "Anna",
    family_name: "Schmidt",
    jurisdiction: "DE",
    bar_admission_date: "2018-09-15",
    bar_admission_number: "RAK-Muenchen-2018-04321",
    card_art_color: "#1e3a8a",
  },
  {
    index: 2,
    display_name: "Carlos García",
    given_name: "Carlos",
    family_name: "García",
    jurisdiction: "ES",
    bar_admission_date: "2014-03-20",
    bar_admission_number: "ICAM-2014-08327",
    card_art_color: "#7c2d12",
  },
  {
    index: 3,
    display_name: "Dieter Müller",
    given_name: "Dieter",
    family_name: "Müller",
    jurisdiction: "DE",
    bar_admission_date: "2010-11-08",
    bar_admission_number: "RAK-Berlin-2010-01987",
    card_art_color: "#0f766e",
  },
  {
    index: 4,
    display_name: "Sofia Rossi",
    given_name: "Sofia",
    family_name: "Rossi",
    jurisdiction: "IT",
    bar_admission_date: "2016-06-22",
    bar_admission_number: "Iscrizione N. A47912 — Albo Roma",
    card_art_color: "#9d174d",
  },
  {
    index: 5,
    display_name: "Eva Novák",
    given_name: "Eva",
    family_name: "Novák",
    jurisdiction: "CZ",
    bar_admission_date: "2012-04-01",
    bar_admission_number: "ČAK ev. č. 14302",
    card_art_color: "#581c87",
  },
];

async function main() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  // 1. DB
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);

  // 2. Signing key
  await ensureKey();

  // 3. Card art
  if (!existsSync(CARD_ART_DIR)) mkdirSync(CARD_ART_DIR, { recursive: true });

  const subjectsWithAddr = SUBJECTS.map((s) => ({
    ...s,
    address: mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: s.index }).address,
  }));
  for (const s of subjectsWithAddr) {
    writeFileSync(join(CARD_ART_DIR, `${slug(s.display_name)}.svg`), buildCardArt(s));
  }

  // 4. Insert subjects
  const upsert = db.prepare(`
    INSERT INTO subjects (id, display_name, eth_address, given_name, family_name,
                          jurisdiction, bar_admission_date, bar_admission_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name=excluded.display_name,
      eth_address=excluded.eth_address,
      given_name=excluded.given_name,
      family_name=excluded.family_name,
      jurisdiction=excluded.jurisdiction,
      bar_admission_date=excluded.bar_admission_date,
      bar_admission_number=excluded.bar_admission_number
  `);
  for (const s of subjectsWithAddr) {
    upsert.run(
      s.index,
      s.display_name,
      s.address,
      s.given_name,
      s.family_name,
      s.jurisdiction,
      s.bar_admission_date,
      s.bar_admission_number
    );
  }
  console.log(`✓ bar-issuer seeded with ${subjectsWithAddr.length} subjects (DB at ${DB_PATH})`);
}

async function ensureKey(): Promise<void> {
  if (existsSync(KEY_PATH)) return;
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(privateKey);
  jwk.kid = "bar-issuer-key-1";
  jwk.alg = "ES256";
  jwk.use = "sig";
  writeFileSync(KEY_PATH, JSON.stringify(jwk, null, 2));
  console.log(`✓ Generated bar-issuer signing key at ${KEY_PATH}`);
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

function buildCardArt(s: BarSubjectSpec & { address: Address }): string {
  const subtitle = `${s.jurisdiction} · ${s.bar_admission_number}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250">
  <rect width="100%" height="100%" fill="${s.card_art_color}"/>
  <rect x="0" y="0" width="400" height="40" fill="rgba(255,255,255,0.08)"/>
  <text x="20" y="28" fill="white" font-family="sans-serif" font-size="14" font-weight="600">Bar Credential</text>
  <text x="20" y="100" fill="white" font-family="sans-serif" font-size="22" font-weight="700">${escapeXml(s.display_name)}</text>
  <text x="20" y="128" fill="rgba(255,255,255,0.85)" font-family="sans-serif" font-size="14">${escapeXml(subtitle)}</text>
  <text x="20" y="220" fill="rgba(255,255,255,0.6)" font-family="ui-monospace, monospace" font-size="10">${s.address}</text>
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
