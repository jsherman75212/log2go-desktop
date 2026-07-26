/**
 * Log2Go Desktop — IPC Handlers for Local Database
 *
 * Exposes local DB operations to the renderer process via IPC.
 * All operations are synchronous from the renderer's perspective
 * (using ipcRenderer.invoke / ipcMain.handle).
 *
 * If the SQLite database is unavailable (native module missing),
 * all handlers throw a descriptive error so the renderer can fall
 * back to its localStorage store.
 */

import { ipcMain } from 'electron';
import { getDb } from './database';

/** Throw a consistent error when the DB is not available. */
function requireDb() {
  const db = getDb();
  if (!db) throw new Error('Database unavailable (native module not loaded)');
  return db;
}

export function registerIpcHandlers(): void {
  // ── Contacts ────────────────────────────────────────────────────

  ipcMain.handle('db:contacts:insert', (_event, contact: LocalContact) => {
    const db = requireDb();
    const localId = contact.local_id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`
      INSERT INTO local_contacts (local_id, callsign, qso_date, time_on, mode, band, freq,
        rst_sent, rst_rcvd, gridsquare, my_gridsquare, state, county, country,
        operator_name, net_name, station_callsign, remarks)
      VALUES (@local_id, @callsign, @qso_date, @time_on, @mode, @band, @freq,
        @rst_sent, @rst_rcvd, @gridsquare, @my_gridsquare, @state, @county, @country,
        @operator_name, @net_name, @station_callsign, @remarks)
    `).run({ ...contact, local_id: localId });
    return { local_id: localId };
  });

  ipcMain.handle('db:contacts:list', () => {
    const db = requireDb();
    return db.prepare('SELECT * FROM local_contacts ORDER BY created_at DESC').all();
  });

  ipcMain.handle('db:contacts:listUnsynced', () => {
    const db = requireDb();
    return db.prepare('SELECT * FROM local_contacts WHERE synced = 0 ORDER BY created_at ASC').all();
  });

  ipcMain.handle('db:contacts:markSynced', (_event, localId: string, backendId: number) => {
    const db = requireDb();
    db.prepare('UPDATE local_contacts SET synced = 1, backend_id = ?, sync_error = NULL, updated_at = datetime(\'now\') WHERE local_id = ?')
      .run(backendId, localId);
    return { success: true };
  });

  ipcMain.handle('db:contacts:markSyncError', (_event, localId: string, error: string) => {
    const db = requireDb();
    db.prepare('UPDATE local_contacts SET sync_error = ?, updated_at = datetime(\'now\') WHERE local_id = ?')
      .run(error, localId);
    return { success: true };
  });

  ipcMain.handle('db:contacts:delete', (_event, localId: string) => {
    const db = requireDb();
    db.prepare('DELETE FROM local_contacts WHERE local_id = ?').run(localId);
    return { success: true };
  });

  ipcMain.handle('db:contacts:count', () => {
    const db = requireDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM local_contacts').get() as { count: number };
    return row.count;
  });

  // ── Nets ────────────────────────────────────────────────────────

  ipcMain.handle('db:nets:insert', (_event, net: LocalNet) => {
    const db = requireDb();
    const localId = net.local_id || `local-net-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`
      INSERT INTO local_nets (local_id, name, frequency, mode, band, net_control, logger, status)
      VALUES (@local_id, @name, @frequency, @mode, @band, @net_control, @logger, @status)
    `).run({ ...net, local_id: localId });
    return { local_id: localId };
  });

  ipcMain.handle('db:nets:list', () => {
    const db = requireDb();
    return db.prepare('SELECT * FROM local_nets ORDER BY created_at DESC').all();
  });

  ipcMain.handle('db:nets:close', (_event, localId: string) => {
    const db = requireDb();
    db.prepare('UPDATE local_nets SET status = ?, closed_at = datetime(\'now\') WHERE local_id = ?')
      .run('closed', localId);
    return { success: true };
  });

  ipcMain.handle('db:nets:markSynced', (_event, localId: string, backendNetId: number) => {
    const db = requireDb();
    db.prepare('UPDATE local_nets SET synced = 1, backend_net_id = ?, sync_error = NULL WHERE local_id = ?')
      .run(backendNetId, localId);
    return { success: true };
  });

  // ── Checkins ────────────────────────────────────────────────────

  ipcMain.handle('db:checkins:insert', (_event, checkin: LocalCheckin) => {
    const db = requireDb();
    db.prepare(`
      INSERT INTO local_checkins (local_net_id, serial_no, callsign, first_name, state, county, city, grid, country, status, remarks, qsl)
      VALUES (@local_net_id, @serial_no, @callsign, @first_name, @state, @county, @city, @grid, @country, @status, @remarks, @qsl)
    `).run(checkin);
    return { success: true };
  });

  ipcMain.handle('db:checkins:list', (_event, localNetId: string) => {
    const db = requireDb();
    return db.prepare('SELECT * FROM local_checkins WHERE local_net_id = ? ORDER BY serial_no ASC').all(localNetId);
  });

  ipcMain.handle('db:checkins:markSynced', (_event, id: number, backendId: number) => {
    const db = requireDb();
    db.prepare('UPDATE local_checkins SET synced = 1, backend_id = ?, sync_error = NULL WHERE id = ?')
      .run(backendId, id);
    return { success: true };
  });

  // ── AIM ─────────────────────────────────────────────────────────

  ipcMain.handle('db:aim:insert', (_event, aim: LocalAim) => {
    const db = requireDb();
    db.prepare(`
      INSERT INTO local_aim (local_net_id, callsign, message, is_net_control)
      VALUES (@local_net_id, @callsign, @message, @is_net_control)
    `).run(aim);
    return { success: true };
  });

  ipcMain.handle('db:aim:list', (_event, localNetId: string) => {
    const db = requireDb();
    return db.prepare('SELECT * FROM local_aim WHERE local_net_id = ? ORDER BY created_at ASC').all(localNetId);
  });

  // ── Sync Queue ──────────────────────────────────────────────────

  ipcMain.handle('db:queue:add', (_event, action: string, entityType: string, localId: string, payload: string) => {
    const db = requireDb();
    db.prepare('INSERT INTO sync_queue (action, entity_type, local_id, payload) VALUES (?, ?, ?, ?)')
      .run(action, entityType, localId, payload);
    return { success: true };
  });

  ipcMain.handle('db:queue:list', () => {
    const db = requireDb();
    return db.prepare('SELECT * FROM sync_queue WHERE status = ? ORDER BY created_at ASC').all('pending');
  });

  ipcMain.handle('db:queue:count', () => {
    const db = requireDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM sync_queue WHERE status = ?').get('pending') as { count: number };
    return row.count;
  });

  ipcMain.handle('db:queue:markDone', (_event, id: number) => {
    const db = requireDb();
    db.prepare('UPDATE sync_queue SET status = ?, last_attempt_at = datetime(\'now\') WHERE id = ?')
      .run('done', id);
    return { success: true };
  });

  ipcMain.handle('db:queue:markError', (_event, id: number, error: string) => {
    const db = requireDb();
    db.prepare('UPDATE sync_queue SET attempts = attempts + 1, last_attempt_at = datetime(\'now\'), error = ? WHERE id = ?')
      .run(error, id);
    return { success: true };
  });

  ipcMain.handle('db:queue:clear', () => {
    const db = requireDb();
    db.prepare('DELETE FROM sync_queue WHERE status = ?').run('done');
    return { success: true };
  });

  // ── Stats ───────────────────────────────────────────────────────

  ipcMain.handle('db:stats', () => {
    const db = requireDb();
    const contacts = db.prepare('SELECT COUNT(*) as c FROM local_contacts').get() as { c: number };
    const unsyncedContacts = db.prepare('SELECT COUNT(*) as c FROM local_contacts WHERE synced = 0').get() as { c: number };
    const nets = db.prepare('SELECT COUNT(*) as c FROM local_nets').get() as { c: number };
    const openNets = db.prepare('SELECT COUNT(*) as c FROM local_nets WHERE status = ?').get('open') as { c: number };
    const queueItems = db.prepare('SELECT COUNT(*) as c FROM sync_queue WHERE status = ?').get('pending') as { c: number };
    return {
      totalContacts: contacts.c,
      unsyncedContacts: unsyncedContacts.c,
      totalNets: nets.c,
      openNets: openNets.c,
      pendingSync: queueItems.c,
    };
  });
}

// ── Types ────────────────────────────────────────────────────────────

type LocalContact = {
  local_id?: string;
  callsign: string;
  qso_date?: string;
  time_on?: string;
  mode?: string;
  band?: string;
  freq?: string;
  rst_sent?: string;
  rst_rcvd?: string;
  gridsquare?: string;
  my_gridsquare?: string;
  state?: string;
  county?: string;
  country?: string;
  operator_name?: string;
  net_name?: string;
  station_callsign?: string;
  remarks?: string;
};

type LocalNet = {
  local_id?: string;
  name: string;
  frequency?: string;
  mode?: string;
  band?: string;
  net_control?: string;
  logger?: string;
  status?: string;
};

type LocalCheckin = {
  local_net_id: string;
  serial_no?: number;
  callsign: string;
  first_name?: string;
  state?: string;
  county?: string;
  city?: string;
  grid?: string;
  country?: string;
  status?: string;
  remarks?: string;
  qsl?: string;
};

type LocalAim = {
  local_net_id: string;
  callsign: string;
  message: string;
  is_net_control?: number;
};