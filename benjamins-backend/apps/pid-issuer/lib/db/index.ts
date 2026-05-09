/**
 * PID issuer's local SQLite handle. Lives at apps/pid-issuer/data/db.sqlite by
 * default — fully separate from the lex-nova platform DB.
 */
import { createDb } from "@lex-nova/db-toolkit";
import type Database from "better-sqlite3";
import { join } from "node:path";

const DB_PATH = process.env.PID_ISSUER_DB_PATH ?? join(process.cwd(), "data/db.sqlite");
const MIGRATIONS_DIR = join(process.cwd(), "lib/db/migrations");

export function getDb(): Database.Database {
  return createDb({ path: DB_PATH, migrationsDir: MIGRATIONS_DIR });
}
