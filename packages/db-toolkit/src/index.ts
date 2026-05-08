import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface OpenDbOptions {
  readonly?: boolean;
  walMode?: boolean;
  foreignKeys?: boolean;
}

export function openDb(filePath: string, opts: OpenDbOptions = {}): Database.Database {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(filePath, { readonly: opts.readonly ?? false });
  if (opts.walMode !== false) db.pragma('journal_mode = WAL');
  if (opts.foreignKeys !== false) db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  return db;
}

export function runMigrations(db: Database.Database, statements: string[]): void {
  const tx = db.transaction(() => {
    for (const stmt of statements) db.exec(stmt);
  });
  tx();
}
