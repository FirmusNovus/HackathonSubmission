/**
 * Platform-side SQLite connection. Thin wrapper over @lex-nova/db-toolkit
 * pinned to the platform's database path + migrations directory.
 *
 * Future issuer apps (apps/bar-issuer, apps/pid-issuer) will have their own
 * equivalent file pointing at their own DB; the toolkit ensures connection
 * caching is per-path so a Node process can hold multiple SQLite handles
 * without interference.
 */
import { createDb } from "@lex-nova/db-toolkit";
import type Database from "better-sqlite3";
import { join } from "node:path";

const DB_PATH = process.env.DATABASE_PATH ?? join(process.cwd(), "data/lexnova.db");
const MIGRATIONS_DIR = join(process.cwd(), "lib/db/migrations");

export function getDb(): Database.Database {
  return createDb({ path: DB_PATH, migrationsDir: MIGRATIONS_DIR });
}
