import { createContactFromSession } from '../domain/contactFactory';
import { createKe5zqvInitialStationProfile } from '../domain/defaults';
import type {
  Contact,
  ContestContext,
  LoggingMode,
  LoggingSession,
  SignalReport,
  StationProfile,
  StationProfileCollection,
} from '../domain/models';
import {
  activateProfile as activateProfileInCollection,
  addProfile as addProfileToCollection,
  deleteProfile as deleteProfileFromCollection,
  getActiveProfile,
  updateProfile as updateProfileInCollection,
} from '../domain/stationProfiles';
import type { CreateProfileInput, UpdateProfileInput } from '../domain/stationProfiles';
import {
  markContactsQueued,
  markContactsSynced,
  markContactsSyncing,
} from '../domain/syncQueue';
import type { BackendSyncResponse } from '../services/backendClient';

export type LoggingFlowSyncState = 'idle' | 'queued' | 'syncing' | 'synced' | 'failed';

export type AccountCredentials = {
  qrzUsername?: string;
  qrzPassword?: string;
  lotwUsername?: string;
  lotwPassword?: string;
  eqslUsername?: string;
  eqslPassword?: string;
};

/**
 * Keys for storing sensitive credentials in SecureStore.
 * These are stored separately from AsyncStorage for security.
 */
export const SECURE_CREDENTIAL_KEYS = {
  qrzUsername: 'log2go.credentials.qrz.username.v1',
  qrzPassword: 'log2go.credentials.qrz.password.v1',
  lotwUsername: 'log2go.credentials.lotw.username.v1',
  lotwPassword: 'log2go.credentials.lotw.password.v1',
  eqslUsername: 'log2go.credentials.eqsl.username.v1',
  eqslPassword: 'log2go.credentials.eqsl.password.v1',
  licenseClass: 'log2go.credentials.licenseClass.v1',
} as const;

export type SecureCredentialKey = keyof typeof SECURE_CREDENTIAL_KEYS;

export type LicenseClass = 'T' | 'G' | 'E' | 'A' | 'N' | null;

export type Settings = {
  autoSync: boolean;
  accounts: AccountCredentials;
};

export type LoggingFlowState = {
  stationProfile: StationProfile;
  profileCollection: StationProfileCollection;
  session: LoggingSession;
  contacts: Contact[];
  syncState: LoggingFlowSyncState;
  backendBaseUrl: string;
  username: string;
  password: string;
  accessToken?: string;
  settings: Settings;
  licenseClass?: LicenseClass;
};

export type BackendSettings = {
  backendBaseUrl?: string;
  username?: string;
  password?: string;
  accessToken?: string;
};

export type ApplySyncSuccessResponse = BackendSyncResponse & {
  accessToken?: string;
};

export type CreateInitialLoggingFlowStateOptions = {
  now?: () => string;
};

export type LogContactInput = {
  callsign: string;
  contactedAt?: string;
  loggingMode?: LoggingMode;
  mode?: string;
  band?: string;
  frequencyMhz?: string | number;
  signalReport?: SignalReport;
  operatorName?: string;
  location?: string;
  grid?: string;
  county?: string;
  notes?: string;
  gps?: import('../domain/models').GpsCapture;
  netLoggerContext?: import('../domain/models').NetLoggerContext;
  contestContext?: Partial<ContestContext>;
  potaContext?: Partial<import('../domain/models').PotaContext>;
};

export type UpdateContactInput = Partial<Omit<LogContactInput, 'contactedAt'>>;

export function createInitialSettings(): Settings {
  return {
    autoSync: false,
    accounts: {},
  };
}

export function createInitialLoggingFlowState(
  options: CreateInitialLoggingFlowStateOptions = {},
): LoggingFlowState {
  const now = options.now ?? createIsoTimestamp;
  const stationProfile = createKe5zqvInitialStationProfile();
  const startedAt = now();
  const profileCollection: StationProfileCollection = {
    profiles: [stationProfile],
    activeProfileId: stationProfile.id,
  };

  return {
    stationProfile,
    profileCollection,
    session: createInitialLoggingSession(stationProfile, startedAt),
    contacts: [],
    syncState: 'idle',
    backendBaseUrl: 'https://api.log2goapp.net',
    username: '',
    password: '',
    settings: createInitialSettings(),
  };
}

export function createInitialLoggingSession(
  stationProfile: StationProfile,
  startedAt = createIsoTimestamp(),
): LoggingSession {
  const sessionCallsign = stationProfile.callsign.trim();

  return {
    id: createStableSessionId(stationProfile.id, startedAt),
    stationProfileId: stationProfile.id,
    mode: 'nets',
    startedAt,
    title: sessionCallsign ? `${sessionCallsign} net session` : 'New net session',
    startingContactNumber: 1,
    currentContactNumber: 1,
    defaultGridLength: 6,
    backendSyncEnabled: true,
    syncStatus: 'local-only',
    contactIds: [],
  };
}

export function logContact(
  state: LoggingFlowState,
  input: LogContactInput,
): LoggingFlowState {
  const callsign = input.callsign.trim();

  if (callsign.length === 0) {
    throw new Error('Callsign is required to log a contact.');
  }

  const sessionForContact = input.loggingMode === undefined
    ? state.session
    : {
      ...state.session,
      mode: input.loggingMode,
    };

  const { contact, nextSession } = createContactFromSession({
    stationProfile: state.stationProfile,
    session: sessionForContact,
    callsign,
    contactedAt: input.contactedAt ?? createIsoTimestamp(),
    mode: input.mode?.trim() === '' ? undefined : input.mode,
    band: normalizeOptionalText(input.band)?.toLowerCase(),
    frequencyMhz: parseOptionalFrequencyMhz(input.frequencyMhz),
    signalReport: input.signalReport,
    operatorName: normalizeOptionalText(input.operatorName),
    location: normalizeOptionalText(input.location),
    grid: normalizeOptionalText(input.grid)?.toUpperCase(),
    county: normalizeOptionalText(input.county),
    notes: normalizeOptionalText(input.notes),
    gps: input.gps,
    netLoggerContext: input.netLoggerContext,
    contestContext: input.contestContext,
    potaContext: input.potaContext,
  });

  const queuedContacts = markContactsQueued([...state.contacts, contact]);

  return {
    ...state,
    session: {
      ...nextSession,
      contactIds: [...state.session.contactIds, contact.id],
      syncStatus: 'queued',
    },
    contacts: queuedContacts,
    syncState: 'queued',
  };
}

export function updateContact(
  state: LoggingFlowState,
  contactId: string,
  input: UpdateContactInput,
): LoggingFlowState {
  let found = false;
  const contacts = state.contacts.map((contact) => {
    if (contact.id !== contactId) {
      return contact;
    }

    found = true;
    const callsign = input.callsign === undefined ? contact.callsign : input.callsign.trim();

    if (callsign.length === 0) {
      throw new Error('Callsign is required to update a contact.');
    }

    return {
      ...contact,
      callsign: callsign.toUpperCase(),
      mode: input.mode === undefined ? contact.mode : (input.mode.trim() || contact.mode),
      band:
        input.band === undefined
          ? contact.band
          : normalizeOptionalText(input.band)?.toLowerCase(),
      frequencyMhz:
        input.frequencyMhz === undefined
          ? contact.frequencyMhz
          : parseOptionalFrequencyMhz(input.frequencyMhz),
      signalReport: input.signalReport ?? contact.signalReport,
      grid:
        input.grid === undefined
          ? contact.grid
          : normalizeOptionalText(input.grid)?.toUpperCase(),
      county: input.county === undefined ? contact.county : normalizeOptionalText(input.county),
      syncStatus: 'queued' as const,
    };
  });

  if (!found) {
    throw new Error(`Contact not found: ${contactId}`);
  }

  return {
    ...state,
    contacts,
    session: {
      ...state.session,
      syncStatus: 'queued',
    },
    syncState: 'queued',
  };
}

export function setBackendSettings(
  state: LoggingFlowState,
  settings: BackendSettings,
): LoggingFlowState {
  return {
    ...state,
    backendBaseUrl:
      settings.backendBaseUrl === undefined
        ? state.backendBaseUrl
        : settings.backendBaseUrl.trim(),
    username: settings.username === undefined ? state.username : settings.username.trim(),
    password: settings.password === undefined ? state.password : settings.password,
    accessToken:
      settings.accessToken === undefined ? state.accessToken : settings.accessToken.trim(),
  };
}

export function beginSync(state: LoggingFlowState): LoggingFlowState {
  const syncingContacts = markContactsSyncing(state.contacts);
  const hasSyncingContacts = syncingContacts.some(
    (contact) => contact.syncStatus === 'syncing',
  );

  return {
    ...state,
    session: {
      ...state.session,
      syncStatus: hasSyncingContacts ? 'syncing' : state.session.syncStatus,
    },
    contacts: syncingContacts,
    syncState: hasSyncingContacts ? 'syncing' : state.syncState,
  };
}

export function applySyncSuccess(
  state: LoggingFlowState,
  response: ApplySyncSuccessResponse,
): LoggingFlowState {
  const syncedContacts = markContactsSynced(state.contacts, response);
  const hasUnsyncedContacts = syncedContacts.some(
    (contact) => contact.syncStatus === 'queued' || contact.syncStatus === 'syncing',
  );

  return {
    ...state,
    accessToken: response.accessToken?.trim() || state.accessToken,
    session: {
      ...state.session,
      syncStatus: hasUnsyncedContacts ? state.session.syncStatus : 'synced',
    },
    contacts: syncedContacts,
    syncState: hasUnsyncedContacts ? state.syncState : 'synced',
  };
}

export function applySyncFailure(state: LoggingFlowState): LoggingFlowState {
  const failedContacts = state.contacts.map((contact) =>
    contact.syncStatus === 'syncing' ? { ...contact, syncStatus: 'failed' as const } : contact,
  );

  return {
    ...state,
    session: {
      ...state.session,
      syncStatus: 'failed',
    },
    contacts: failedContacts,
    syncState: 'failed',
  };
}

export const startPlaceholderSync = beginSync;

export function getSessionModeLabel(mode: LoggingMode): string {
  switch (mode) {
    case 'nets':
      return 'Net';
    case 'contesting':
      return 'Contest';
    case 'pota':
      return 'POTA';
  }
}

function createStableSessionId(stationProfileId: string, startedAt: string): string {
  return `session-${stationProfileId}-${startedAt}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function parseOptionalFrequencyMhz(value: string | number | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }

  const parsed = typeof value === 'number' ? value : Number.parseFloat(value.trim());

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RangeError('Frequency must be a positive number in MHz.');
  }

  return parsed;
}


export function setAutoSync(state: LoggingFlowState, enabled: boolean): LoggingFlowState {
  return {
    ...state,
    settings: {
      ...state.settings,
      autoSync: enabled,
    },
  };
}

export function updateAccountCredentials(
  state: LoggingFlowState,
  accounts: Partial<AccountCredentials>,
): LoggingFlowState {
  return {
    ...state,
    settings: {
      ...state.settings,
      accounts: {
        ...state.settings.accounts,
        ...accounts,
      },
    },
  };
}

function createIsoTimestamp(): string {
  return new Date().toISOString();
}

// ── Station Profile Management ────────────────────────────────────────

export function addProfile(
  state: LoggingFlowState,
  input: CreateProfileInput,
): LoggingFlowState {
  const updatedCollection = addProfileToCollection(state.profileCollection, input);
  const activeProfile = getActiveProfile(updatedCollection);

  return {
    ...state,
    profileCollection: updatedCollection,
    stationProfile: activeProfile ?? state.stationProfile,
  };
}

export function updateProfile(
  state: LoggingFlowState,
  profileId: string,
  input: UpdateProfileInput,
): LoggingFlowState {
  const updatedCollection = updateProfileInCollection(
    state.profileCollection,
    profileId,
    input,
  );

  // If the updated profile is the active one, refresh stationProfile
  const activeProfile = getActiveProfile(updatedCollection);

  return {
    ...state,
    profileCollection: updatedCollection,
    stationProfile: activeProfile ?? state.stationProfile,
  };
}

export function deleteProfile(
  state: LoggingFlowState,
  profileId: string,
): LoggingFlowState {
  const updatedCollection = deleteProfileFromCollection(
    state.profileCollection,
    profileId,
  );
  const activeProfile = getActiveProfile(updatedCollection);

  return {
    ...state,
    profileCollection: updatedCollection,
    stationProfile: activeProfile ?? state.stationProfile,
  };
}

export function activateProfile(
  state: LoggingFlowState,
  profileId: string,
): LoggingFlowState {
  const updatedCollection = activateProfileInCollection(
    state.profileCollection,
    profileId,
  );
  const activeProfile = getActiveProfile(updatedCollection);

  if (activeProfile === undefined) {
    return state;
  }

  return {
    ...state,
    profileCollection: updatedCollection,
    stationProfile: activeProfile,
  };
}

export function getProfileDisplayName(profile: StationProfile): string {
  const parts = [profile.callsign];

  if (profile.profileName !== profile.callsign) {
    parts.push(profile.profileName);
  }

  if (profile.homeGrid) {
    parts.push(profile.homeGrid);
  }

  if (profile.mobilePortableStatus && profile.mobilePortableStatus !== 'fixed') {
    parts.push(`(${profile.mobilePortableStatus})`);
  }

  return parts.join(' · ');
}
