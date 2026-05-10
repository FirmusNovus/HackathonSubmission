/**
 * Combined issuer SQLite handle. One DB holds both `pid_subjects` and
 * `bar_subjects` plus the shared OID4VCI flow tables. Each flow row carries a
 * `kind` column ("pid" | "bar") so concurrent flows for both credential types
 * coexist in one DB.
 */
import { createDb } from "@lex-nova/db-toolkit";
import type Database from "better-sqlite3";
import { join } from "node:path";

const DB_PATH = process.env.ISSUER_DB_PATH ?? join(process.cwd(), "data/db.sqlite");
const MIGRATIONS_DIR = join(process.cwd(), "lib/db/migrations");

export function getDb(): Database.Database {
  return createDb({ path: DB_PATH, migrationsDir: MIGRATIONS_DIR });
}
