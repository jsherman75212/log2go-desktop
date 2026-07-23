import {
  applySyncFailure,
  applySyncSuccess,
  beginSync,
  type LoggingFlowState,
} from './loggingFlow';
import {
  login as backendLogin,
  syncContacts as backendSyncContacts,
  type BackendSyncResponse,
  type LoginTokenResponse,
} from '../services/backendClient';
import type { Contact } from '../domain/models';

export type LoginAndSyncDeps = {
  login?: (
    baseUrl: string,
    username: string,
    password: string,
  ) => Promise<LoginTokenResponse>;
  syncContacts?: (
    baseUrl: string,
    token: string,
    contacts: Contact[],
  ) => Promise<BackendSyncResponse>;
};

export type LoginAndSyncResult = {
  state: LoggingFlowState;
  message: string;
};

export async function loginAndSync(
  state: LoggingFlowState,
  deps: LoginAndSyncDeps = {},
): Promise<LoginAndSyncResult> {
  const login = deps.login ?? backendLogin;
  const syncContacts = deps.syncContacts ?? backendSyncContacts;
  const backendBaseUrl = state.backendBaseUrl.trim();

  if (backendBaseUrl.length === 0) {
    return {
      state,
      message: 'Enter a backend URL before syncing.',
    };
  }

  if (state.username.trim().length === 0 || state.password.length === 0) {
    return {
      state,
      message: 'Enter a username and password before syncing.',
    };
  }

  // Always log in fresh — the server token store is in-memory
  // and tokens are lost on restart, so we can't rely on cached tokens.
  let accessToken: string;
  try {
    const loginResponse = await login(backendBaseUrl, state.username.trim(), state.password);
    accessToken = loginResponse.access_token.trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      state,
      message: `Login failed: ${detail}`,
    };
  }

  if (accessToken.length === 0) {
    return {
      state,
      message: 'Login did not return an access token.',
    };
  }

  const syncingState = beginSync({
    ...state,
    accessToken,
  });
  const contactsToSync = syncingState.contacts.filter(
    (contact) => contact.syncStatus === 'syncing',
  );

  if (contactsToSync.length === 0) {
    return {
      state: {
        ...state,
        accessToken,
      },
      message: 'No queued contacts to sync.',
    };
  }

  try {
    const response = await syncContacts(backendBaseUrl, accessToken, contactsToSync);
    const syncedState = applySyncSuccess(syncingState, {
      ...response,
      accessToken,
    });
    const syncedCount = syncedState.contacts.filter(
      (contact) =>
        contact.syncStatus === 'synced' &&
        contactsToSync.some((syncedContact) => syncedContact.id === contact.id),
    ).length;

    return {
      state: syncedState,
      message:
        syncedCount === 1
          ? 'Synced 1 contact.'
          : `Synced ${syncedCount} contacts.`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      state: applySyncFailure(syncingState),
      message: `Sync failed: ${detail}`,
    };
  }
}
