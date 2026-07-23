import { logContact, type LoggingFlowState, type LogContactInput } from './loggingFlow';
import type { Contact } from '../domain/models';
import { createContact as backendCreateContact, type BackendContactResponse } from '../services/backendClient';

export type WebLoggingDeps = {
  createContact?: (baseUrl: string, token: string, contact: Contact) => Promise<BackendContactResponse>;
};

export type WebLoggingResult = {
  state: LoggingFlowState;
  message: string;
  backendContact?: BackendContactResponse;
};

export async function logWebContact(
  state: LoggingFlowState,
  input: LogContactInput,
  deps: WebLoggingDeps = {},
): Promise<WebLoggingResult> {
  const createContact = deps.createContact ?? backendCreateContact;
  const nextState = logContact(state, input);
  const contact = nextState.contacts[nextState.contacts.length - 1];
  const call = contact.callsign;
  const backendBaseUrl = nextState.backendBaseUrl.trim();
  const token = nextState.accessToken?.trim();
  // If there is no backend endpoint or token, keep the state as local‑only.
  // The generic logContact flow marks the contact as queued for sync, but when the
  // user is not logged in we want to indicate that no backend sync will happen.
  // Adjust the syncState (and the session syncStatus for UI consistency) to
  // "local-only" before returning.
  if (!backendBaseUrl || !token) {
    const localState: typeof nextState = {
      ...nextState,
      syncState: 'queued',
      session: { ...nextState.session, syncStatus: 'local-only' },
    };
    return {
      state: localState,
      message: `${call} is saved in local browser state only. Log in to save it durably to the Log2Go backend before closing this session.`,
    };
  }
  try {
    const backendContact = await createContact(backendBaseUrl, token, contact);
    return {
      state: markLatestContact(nextState, contact.id, 'synced'),
      message: `Saved ${call} to Log2Go backend for review.`,
      backendContact,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      state: markLatestContact(nextState, contact.id, 'failed'),
      message: `${call} was logged locally but not saved to backend: ${detail}`,
    };
  }
}

function markLatestContact(
  state: LoggingFlowState,
  contactId: string,
  syncStatus: Contact['syncStatus'],
): LoggingFlowState {
  const contacts = state.contacts.map((contact) =>
    contact.id === contactId ? { ...contact, syncStatus } : contact,
  );
  const hasFailed = contacts.some((contact) => contact.syncStatus === 'failed');
  const hasQueued = contacts.some((contact) => contact.syncStatus === 'queued');

  return {
    ...state,
    contacts,
    session: {
      ...state.session,
      syncStatus: hasFailed ? 'failed' : hasQueued ? 'queued' : 'synced',
    },
    syncState: hasFailed ? 'failed' : hasQueued ? 'queued' : 'synced',
  };
}
