/**
 * Log2Go Desktop — Offline Storage Bridge
 *
 * Provides a TypeScript API for the renderer to interact with the local
 * SQLite database via the Electron preload bridge (window.log2goDesktop).
 *
 * Falls back gracefully when running outside Electron (e.g. in Vite dev
 * preview or the web app) by using localStorage as a degraded store.
 */

// ── Types ────────────────────────────────────────────────────────────

export type LocalContact = {
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

export type LocalNet = {
  local_id?: string;
  name: string;
  frequency?: string;
  mode?: string;
  band?: string;
  net_control?: string;
  logger?: string;
  status?: string;
};

export type LocalCheckin = {
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

export type LocalAim = {
  local_net_id: string;
  callsign: string;
  message: string;
  is_net_control?: number;
};

export type OfflineStats = {
  totalContacts: number;
  unsyncedContacts: number;
  totalNets: number;
  openNets: number;
  pendingSync: number;
};

// ── Bridge detection ─────────────────────────────────────────────────

export type DesktopBridge = {
  contacts: {
    insert: (c: Record<string, unknown>) => Promise<{ local_id: string }>;
    list: () => Promise<Record<string, unknown>[]>;
    listUnsynced: () => Promise<Record<string, unknown>[]>;
    markSynced: (localId: string, backendId: number) => Promise<{ success: boolean }>;
    markSyncError: (localId: string, error: string) => Promise<{ success: boolean }>;
    delete: (localId: string) => Promise<{ success: boolean }>;
    count: () => Promise<number>;
  };
  nets: {
    insert: (n: Record<string, unknown>) => Promise<{ local_id: string }>;
    list: () => Promise<Record<string, unknown>[]>;
    close: (localId: string) => Promise<{ success: boolean }>;
    markSynced: (localId: string, backendNetId: number) => Promise<{ success: boolean }>;
  };
  checkins: {
    insert: (c: Record<string, unknown>) => Promise<{ success: boolean }>;
    list: (localNetId: string) => Promise<Record<string, unknown>[]>;
    markSynced: (id: number, backendId: number) => Promise<{ success: boolean }>;
  };
  aim: {
    insert: (a: Record<string, unknown>) => Promise<{ success: boolean }>;
    list: (localNetId: string) => Promise<Record<string, unknown>[]>;
  };
  queue: {
    add: (action: string, entityType: string, localId: string, payload: string) => Promise<{ success: boolean }>;
    list: () => Promise<Record<string, unknown>[]>;
    count: () => Promise<number>;
    markDone: (id: number) => Promise<{ success: boolean }>;
    markError: (id: number, error: string) => Promise<{ success: boolean }>;
    clear: () => Promise<{ success: boolean }>;
  };
  stats: () => Promise<OfflineStats>;
  isOnline: () => boolean;
  /** Current desktop app version (from package.json). */
  appVersion: string;
};

function getBridge(): DesktopBridge | null {
  if (typeof window !== 'undefined' && 'log2goDesktop' in window) {
    return (window as unknown as { log2goDesktop: DesktopBridge }).log2goDesktop;
  }
  return null;
}

export function isDesktopEnvironment(): boolean {
  return getBridge() !== null;
}

// ── API ──────────────────────────────────────────────────────────────

export const offlineDb = {
  // ── Contacts ──────────────────────────────────────────────────
  async insertContact(contact: LocalContact): Promise<string> {
    const bridge = getBridge();
    if (bridge) {
      const result = await bridge.contacts.insert(contact as Record<string, unknown>);
      return result.local_id;
    }
    // Fallback: localStorage (degraded mode for dev preview)
    return localStorageFallback.insertContact(contact);
  },

  async listContacts(): Promise<Record<string, unknown>[]> {
    const bridge = getBridge();
    if (bridge) return bridge.contacts.list();
    return localStorageFallback.listContacts();
  },

  async listUnsyncedContacts(): Promise<Record<string, unknown>[]> {
    const bridge = getBridge();
    if (bridge) return bridge.contacts.listUnsynced();
    return localStorageFallback.listUnsyncedContacts();
  },

  async markContactSynced(localId: string, backendId: number): Promise<void> {
    const bridge = getBridge();
    if (bridge) await bridge.contacts.markSynced(localId, backendId);
  },

  async markContactSyncError(localId: string, error: string): Promise<void> {
    const bridge = getBridge();
    if (bridge) await bridge.contacts.markSyncError(localId, error);
  },

  async deleteContact(localId: string): Promise<void> {
    const bridge = getBridge();
    if (bridge) await bridge.contacts.delete(localId);
  },

  async countContacts(): Promise<number> {
    const bridge = getBridge();
    if (bridge) return bridge.contacts.count();
    return 0;
  },

  // ── Nets ──────────────────────────────────────────────────────
  async insertNet(net: LocalNet): Promise<string> {
    const bridge = getBridge();
    if (bridge) {
      const result = await bridge.nets.insert(net as Record<string, unknown>);
      return result.local_id;
    }
    return localStorageFallback.insertNet(net);
  },

  async listNets(): Promise<Record<string, unknown>[]> {
    const bridge = getBridge();
    if (bridge) return bridge.nets.list();
    return [];
  },

  async closeNet(localId: string): Promise<void> {
    const bridge = getBridge();
    if (bridge) await bridge.nets.close(localId);
  },

  async markNetSynced(localId: string, backendNetId: number): Promise<void> {
    const bridge = getBridge();
    if (bridge) await bridge.nets.markSynced(localId, backendNetId);
  },

  // ── Checkins ───────────────────────────────────────────────────
  async insertCheckin(checkin: LocalCheckin): Promise<void> {
    const bridge = getBridge();
    if (bridge) await bridge.checkins.insert(checkin as Record<string, unknown>);
  },

  async listCheckins(localNetId: string): Promise<Record<string, unknown>[]> {
    const bridge = getBridge();
    if (bridge) return bridge.checkins.list(localNetId);
    return [];
  },

  async markCheckinSynced(id: number, backendId: number): Promise<void> {
    const bridge = getBridge();
    if (bridge) await bridge.checkins.markSynced(id, backendId);
  },

  // ── AIM ────────────────────────────────────────────────────────
  async insertAim(aim: LocalAim): Promise<void> {
    const bridge = getBridge();
    if (bridge) await bridge.aim.insert(aim as Record<string, unknown>);
  },

  async listAim(localNetId: string): Promise<Record<string, unknown>[]> {
    const bridge = getBridge();
    if (bridge) return bridge.aim.list(localNetId);
    return [];
  },

  // ── Sync Queue ─────────────────────────────────────────────────
  async addToQueue(action: string, entityType: string, localId: string, payload?: unknown): Promise<void> {
    const bridge = getBridge();
    if (bridge) await bridge.queue.add(action, entityType, localId, JSON.stringify(payload ?? {}));
  },

  async listQueue(): Promise<Record<string, unknown>[]> {
    const bridge = getBridge();
    if (bridge) return bridge.queue.list();
    return [];
  },

  async queueCount(): Promise<number> {
    const bridge = getBridge();
    if (bridge) return bridge.queue.count();
    return 0;
  },

  async markQueueDone(id: number): Promise<void> {
    const bridge = getBridge();
    if (bridge) await bridge.queue.markDone(id);
  },

  async markQueueError(id: number, error: string): Promise<void> {
    const bridge = getBridge();
    if (bridge) await bridge.queue.markError(id, error);
  },

  async clearQueue(): Promise<void> {
    const bridge = getBridge();
    if (bridge) await bridge.queue.clear();
  },

  // ── Stats ──────────────────────────────────────────────────────
  async getStats(): Promise<OfflineStats> {
    const bridge = getBridge();
    if (bridge) return bridge.stats();
    return { totalContacts: 0, unsyncedContacts: 0, totalNets: 0, openNets: 0, pendingSync: 0 };
  },

  // ── Online check ───────────────────────────────────────────────
  isOnline(): boolean {
    const bridge = getBridge();
    if (bridge) return bridge.isOnline();
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  },
};

// ── localStorage fallback (for Vite dev preview without Electron) ───

const localStorageFallback = {
  _key: 'log2go-desktop-fallback',
  _read(): Record<string, unknown>[] {
    try {
      return JSON.parse(localStorage.getItem(this._key) || '[]');
    } catch {
      return [];
    }
  },
  _write(data: Record<string, unknown>[]): void {
    try {
      localStorage.setItem(this._key, JSON.stringify(data));
    } catch { /* ignore quota errors */ }
  },

  insertContact(contact: LocalContact): string {
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const items = this._read();
    items.push({ ...contact, local_id: id, synced: 0, created_at: new Date().toISOString() });
    this._write(items);
    return id;
  },

  listContacts(): Record<string, unknown>[] {
    return this._read();
  },

  listUnsyncedContacts(): Record<string, unknown>[] {
    return this._read().filter((c) => !c.synced);
  },

  insertNet(net: LocalNet): string {
    const id = `local-net-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const items = this._read();
    items.push({ ...net, local_id: id, type: 'net', status: 'open', synced: 0, created_at: new Date().toISOString() });
    this._write(items);
    return id;
  },
};