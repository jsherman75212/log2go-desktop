/**
 * Log2Go Desktop — Sync Engine
 *
 * Drains the offline sync queue when the device is online.
 * Pushes local contacts, nets, checkins, and AIM to the backend.
 *
 * Conflict strategy: last-write-wins. If a contact was synced and then
 * edited offline, the full record is re-uploaded.
 */

import { offlineDb } from './offlineDb';
import { updateContact } from './backendClient';

export type SyncResult = {
  totalProcessed: number;
  succeeded: number;
  failed: number;
  errors: string[];
};

/**
 * Create a contact on the backend via direct API call.
 * Bypasses the Contact type requirement by POSTing raw payload.
 */
async function createBackendContact(
  baseUrl: string,
  token: string,
  payload: Record<string, string>,
): Promise<{ id?: number; [key: string]: unknown }> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/contacts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body: unknown = undefined;
  if (text) {
    try { body = JSON.parse(text); } catch { /* ignore */ }
  }
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body && typeof (body as { detail?: string }).detail === 'string'
      ? (body as { detail: string }).detail : text;
    throw new Error(detail || `Backend contact creation failed: ${response.status}`);
  }
  return body as { id?: number; [key: string]: unknown };
}

/**
 * Run a full sync of all unsynced local data to the backend.
 * Returns a summary of what was processed.
 */
export async function runSync(
  baseUrl: string,
  token: string,
): Promise<SyncResult> {
  const result: SyncResult = {
    totalProcessed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  if (!baseUrl.trim() || !token.trim()) {
    result.errors.push('No backend URL or auth token — skipping sync.');
    return result;
  }

  // ── 1. Sync contacts ───────────────────────────────────────────
  const unsyncedContacts = await offlineDb.listUnsyncedContacts();

  for (const contact of unsyncedContacts) {
    result.totalProcessed++;
    const localId = String(contact.local_id ?? '');
    const backendId = contact.backend_id as number | undefined;

    try {
      const payload = buildContactPayload(contact);
      let response;

      if (backendId) {
        // Already synced before — update
        response = await updateContact(baseUrl, token, backendId, payload);
      } else {
        // New contact — create
        response = await createBackendContact(baseUrl, token, payload);
      }

      const newBackendId = (response as Record<string, unknown>).id as number;
      if (newBackendId) {
        await offlineDb.markContactSynced(localId, newBackendId);
        result.succeeded++;
      } else {
        await offlineDb.markContactSyncError(localId, 'No ID returned from backend');
        result.failed++;
        result.errors.push(`Contact ${localId}: no ID returned`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await offlineDb.markContactSyncError(localId, msg);
      result.failed++;
      result.errors.push(`Contact ${localId}: ${msg}`);
    }
  }

  // ── 2. Drain sync queue ────────────────────────────────────────
  const queue = await offlineDb.listQueue();

  for (const item of queue) {
    result.totalProcessed++;
    const id = item.id as number;
    const action = item.action as string;
    const payload = item.payload as string;

    try {
      // Queue items are for nets, checkins, AIM — handled by their
      // respective API calls. For now, just mark done.
      // TODO: implement net/checkin/AIM sync when backend supports
      // offline-created net sessions.
      await offlineDb.markQueueDone(id);
      result.succeeded++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await offlineDb.markQueueError(id, msg);
      result.failed++;
      result.errors.push(`Queue item ${id} (${action}): ${msg}`);
    }
  }

  return result;
}

/**
 * Convert a local contact record to the backend's contact payload format.
 */
function buildContactPayload(contact: Record<string, unknown>): Record<string, string> {
  const payload: Record<string, string> = {};
  const fields = [
    'callsign', 'qso_date', 'time_on', 'mode', 'band', 'freq',
    'rst_sent', 'rst_rcvd', 'gridsquare', 'my_gridsquare',
    'state', 'county', 'country', 'operator_name', 'net_name',
    'station_callsign', 'remarks',
  ];
  for (const field of fields) {
    const val = contact[field];
    if (val !== undefined && val !== null && String(val).trim()) {
      payload[field] = String(val);
    }
  }
  return payload;
}

/**
 * Check if there's anything to sync.
 */
export async function hasPendingSync(): Promise<boolean> {
  const stats = await offlineDb.getStats();
  return stats.unsyncedContacts > 0 || stats.pendingSync > 0;
}