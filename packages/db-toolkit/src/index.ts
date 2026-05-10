/**
 * Generic SQLite + migration-runner toolkit.
 *
 * Each app owns its own database file and its own migrations directory. This
 * package gives them a uniform way to open the connection and apply
 * migrations idempotently. No app-specific tables or schema knowledge — pure
 * infrastructure.
 *
 * Usage:
 *
 *   import { createDb } from "@firmus/db-toolkit";
 *
 *   const db = createDb({
 *     path: "./data/myapp.db",
 *     migrationsDir: "./lib/db/migrations",
 *   });
 *   const rows = db.prepare("SELECT * FROM ...").all();
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface CreateDbOptions {
  /** Filesystem path to the SQLite file. Created if missing (with parent dirs). */
  path: string;
  /** Directory containing `.sql` migration files. Files applied in lexicographic order. */
  migrationsDir: string;
}

const _connections = new Map<string, Database.Database>();

export function createDb(options: CreateDbOptions): Database.Database {
  const cached = _connections.get(options.path);
  if (cached) return cached;

  const dir = dirname(options.path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(options.path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  applyMigrations(db, options.migrationsDir);

  _connections.set(options.path, db);
  return db;
}

export function applyMigrations(db: Database.Database, migrationsDir: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  INTEGER NOT NULL
    );
  `);

  if (!existsSync(migrationsDir)) return;

  const applied = new Set(
    db
      .prepare("SELECT filename FROM _migrations")
      .all()
      .map((r) => (r as { filename: string }).filename)
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const insert = db.prepare("INSERT INTO _migrations (filename, applied_at) VALUES (?, ?)");

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    db.transaction(() => {
      db.exec(sql);
      insert.run(file, Math.floor(Date.now() / 1000));
    })();
  }
}

export function closeDb(path: string): void {
  const db = _connections.get(path);
  if (db) {
    db.close();
    _connections.delete(path);
  }
}
