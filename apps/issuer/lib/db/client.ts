// Owner spec: 001-verified-legal-engagement.

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runSchema } from './schema';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const path = resolve(process.cwd(), process.env.ISSUER_DB ?? 'data/db.sqlite');
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runSchema(db);
  _db = db;
  return db;
}
