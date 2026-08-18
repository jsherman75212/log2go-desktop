/**
 * Log2Go Desktop — Preload Script
 *
 * Exposes a safe, minimal API to the renderer process via contextBridge.
 * The renderer can only call the specific IPC channels listed here.
 *
 * All IPC calls are wrapped to reject gracefully if the database is
 * unavailable, so the renderer's offlineDb module can fall back to
 * its localStorage store.
 */

import { app, contextBridge, ipcRenderer } from 'electron';

/** Wrap an IPC invoke so it rejects with a clear error on failure. */
function safeInvoke(channel: string, ...args: unknown[]) {
  return ipcRenderer.invoke(channel, ...args).catch((err) => {
    throw new Error(`DB error: ${err instanceof Error ? err.message : String(err)}`);
  });
}

const api = {
  // ── Contacts ──────────────────────────────────────────────────
  contacts: {
    insert: (contact: Record<string, unknown>) => safeInvoke('db:contacts:insert', contact),
    list: () => safeInvoke('db:contacts:list'),
    listUnsynced: () => safeInvoke('db:contacts:listUnsynced'),
    markSynced: (localId: string, backendId: number) => safeInvoke('db:contacts:markSynced', localId, backendId),
    markSyncError: (localId: string, error: string) => safeInvoke('db:contacts:markSyncError', localId, error),
    delete: (localId: string) => safeInvoke('db:contacts:delete', localId),
    count: () => safeInvoke('db:contacts:count'),
  },
  // ── Nets ───────────────────────────────────────────────────────
  nets: {
    insert: (net: Record<string, unknown>) => safeInvoke('db:nets:insert', net),
    list: () => safeInvoke('db:nets:list'),
    close: (localId: string) => safeInvoke('db:nets:close', localId),
    markSynced: (localId: string, backendNetId: number) => safeInvoke('db:nets:markSynced', localId, backendNetId),
  },
  // ── Checkins ───────────────────────────────────────────────────
  checkins: {
    insert: (checkin: Record<string, unknown>) => safeInvoke('db:checkins:insert', checkin),
    list: (localNetId: string) => safeInvoke('db:checkins:list', localNetId),
    markSynced: (id: number, backendId: number) => safeInvoke('db:checkins:markSynced', id, backendId),
  },
  // ── AIM ────────────────────────────────────────────────────────
  aim: {
    insert: (aim: Record<string, unknown>) => safeInvoke('db:aim:insert', aim),
    list: (localNetId: string) => safeInvoke('db:aim:list', localNetId),
  },
  // ── Sync Queue ─────────────────────────────────────────────────
  queue: {
    add: (action: string, entityType: string, localId: string, payload: string) =>
      safeInvoke('db:queue:add', action, entityType, localId, payload),
    list: () => safeInvoke('db:queue:list'),
    count: () => safeInvoke('db:queue:count'),
    markDone: (id: number) => safeInvoke('db:queue:markDone', id),
    markError: (id: number, error: string) => safeInvoke('db:queue:markError', id, error),
    clear: () => safeInvoke('db:queue:clear'),
  },
  // ── Stats ─────────────────────────────────────────────────────
  stats: () => ipcRenderer.invoke('db:stats'),
  // ── Online/Offline detection ──────────────────────────────────
  isOnline: () => navigator.onLine,
  // ── Feedback ─────────────────────────────────────────────────
  feedback: {
    onOpen: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('app:openFeedback', handler);
      return () => ipcRenderer.off('app:openFeedback', handler);
    },
  },
  // ── App version ─────────────────────────────────────────────────
  appVersion: app.getVersion(),
};

contextBridge.exposeInMainWorld('log2goDesktop', api);