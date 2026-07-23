import type { BackendSyncResponse } from '../services/backendClient';
import type { Contact } from './models';

export function markContactsQueued<TContact extends Contact>(
  contacts: readonly TContact[],
): TContact[] {
  return contacts.map((contact) =>
    contact.syncStatus === 'local-only' || contact.syncStatus === 'failed'
      ? withSyncStatus(contact, 'queued')
      : contact,
  );
}

export function markContactsSyncing<TContact extends Contact>(
  contacts: readonly TContact[],
): TContact[] {
  return contacts.map((contact) =>
    contact.syncStatus === 'queued' ? withSyncStatus(contact, 'syncing') : contact,
  );
}

export function markContactsSynced<TContact extends Contact>(
  contacts: readonly TContact[],
  syncResult: Pick<BackendSyncResponse, 'contacts' | 'synced'>,
): TContact[] {
  const syncedLocalIds = new Set([
    ...(syncResult.synced?.map((result) => result.local_id) ?? []),
    ...(syncResult.contacts?.flatMap((result) =>
      typeof result.local_id === 'string' ? [result.local_id] : [],
    ) ?? []),
  ]);

  return contacts.map((contact) =>
    syncedLocalIds.has(contact.id) ? withSyncStatus(contact, 'synced') : contact,
  );
}

export function markContactsFailed<TContact extends Contact>(
  contacts: readonly TContact[],
  syncResult: Pick<BackendSyncResponse, 'failed'>,
): TContact[] {
  const failedLocalIds = new Set(syncResult.failed?.map((result) => result.local_id) ?? []);

  return contacts.map((contact) =>
    failedLocalIds.has(contact.id) ? withSyncStatus(contact, 'failed') : contact,
  );
}

function withSyncStatus<TContact extends Contact>(
  contact: TContact,
  syncStatus: Contact['syncStatus'],
): TContact {
  return {
    ...contact,
    syncStatus,
  };
}
