/**
 * Combined issuer SQLite handle. One DB holds both `pid_subjects` (EUDI PID
 * personas) and `bar_subjects` (legal-professional accreditation personas)
 * plus the shared OID4VCI flow tables (`issuer_pre_auth_codes`,
 * `issuer_access_tokens`, `credential_offers`).
 *
 * The OID4VCI helper rows carry a `kind` column (`"pid"` or `"bar"`) so
 * concurrent flows for both credential types coexist in one DB.
 */
import { createDb } from "@firmus/db-toolkit";
import type Database from "better-sqlite3";
import { join } from "node:path";

const DB_PATH = process.env.ISSUER_DB_PATH ?? join(process.cwd(), "data/db.sqlite");
const MIGRATIONS_DIR = join(process.cwd(), "lib/db/migrations");

export function getDb(): Database.Database {
  return createDb({ path: DB_PATH, migrationsDir: MIGRATIONS_DIR });
}
