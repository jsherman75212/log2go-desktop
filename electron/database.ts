/**
 * Log2Go Desktop — Local SQLite Database
 *
 * Provides offline-first storage for contacts, nets, and a sync queue.
 * The database lives in the Electron app's userData directory.
 *
 * If better-sqlite3 is not available (e.g. cross-compiled build without
 * native binaries), the module degrades gracefully — getDb() returns
 * null and all IPC handlers report a "database unavailable" error.
 * The renderer falls back to localStorage in that case.
 */

import path from 'node:path';
import { app } from 'electron';

type SqliteDatabase = {
  prepare(sql: string): { run(...params: unknown[]): unknown; get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
  pragma(str: string): void;
  exec(sql: string): void;
  close(): void;
};

let db: SqliteDatabase | null = null;
let dbAvailable = false;

try {
  // Dynamic require so a missing native binary doesn't crash the process
  require('better-sqlite3');
  dbAvailable = true;
} catch {
  console.warn('[log2go] better-sqlite3 not available — offline DB disabled, using localStorage fallback');
}

export function getDb(): SqliteDatabase | null {
  if (!dbAvailable) return null;
  if (db) return db;

  const Database = require('better-sqlite3');
  const dbPath = path.join(app.getPath('userData'), 'log2go-offline.db');
  const instance = new Database(dbPath);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  db = instance as SqliteDatabase;
  initSchema(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function initSchema(database: SqliteDatabase): void {
  database.exec(`
    -- ── Local contacts (offline log) ──────────────────────────────
    CREATE TABLE IF NOT EXISTS local_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_id TEXT NOT NULL UNIQUE,
      callsign TEXT NOT NULL,
      qso_date TEXT,
      time_on TEXT,
      mode TEXT,
      band TEXT,
      freq TEXT,
      rst_sent TEXT,
      rst_rcvd TEXT,
      gridsquare TEXT,
      my_gridsquare TEXT,
      state TEXT,
      county TEXT,
      country TEXT,
      operator_name TEXT,
      net_name TEXT,
      station_callsign TEXT,
      remarks TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      synced INTEGER NOT NULL DEFAULT 0,
      backend_id INTEGER,
      sync_error TEXT
    );

    -- ── Local net sessions (offline-hosted nets) ───────────────────
    CREATE TABLE IF NOT EXISTS local_nets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      frequency TEXT,
      mode TEXT,
      band TEXT,
      net_control TEXT,
      logger TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT,
      synced INTEGER NOT NULL DEFAULT 0,
      backend_net_id INTEGER,
      sync_error TEXT
    );

    -- ── Local checkins (roster for offline nets) ───────────────────
    CREATE TABLE IF NOT EXISTS local_checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_net_id TEXT NOT NULL,
      serial_no INTEGER,
      callsign TEXT NOT NULL,
      first_name TEXT,
      state TEXT,
      county TEXT,
      city TEXT,
      grid TEXT,
      country TEXT,
      status TEXT,
      remarks TEXT,
      qsl TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      synced INTEGER NOT NULL DEFAULT 0,
      backend_id INTEGER,
      sync_error TEXT,
      FOREIGN KEY (local_net_id) REFERENCES local_nets(local_id) ON DELETE CASCADE
    );

    -- ── Local AIM messages (offline net chat) ──────────────────────
    CREATE TABLE IF NOT EXISTS local_aim (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_net_id TEXT NOT NULL,
      callsign TEXT NOT NULL,
      message TEXT NOT NULL,
      is_net_control INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      synced INTEGER NOT NULL DEFAULT 0,
      backend_id INTEGER,
      sync_error TEXT,
      FOREIGN KEY (local_net_id) REFERENCES local_nets(local_id) ON DELETE CASCADE
    );

    -- ── Sync queue (ordered list of pending operations) ────────────
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      local_id TEXT,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_local_contacts_synced ON local_contacts(synced);
    CREATE INDEX IF NOT EXISTS idx_local_nets_synced ON local_nets(synced);
    CREATE INDEX IF NOT EXISTS idx_local_checkins_synced ON local_checkins(synced);
    CREATE INDEX IF NOT EXISTS idx_local_aim_synced ON local_aim(synced);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
  `);
}