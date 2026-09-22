import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DB_PATH } from '../config.js';
import { runMigrations } from './migrations.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    if (DB_PATH !== ':memory:') {
      mkdirSync(path.dirname(DB_PATH), { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  }
  return db;
}

/** 仅测试使用 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
