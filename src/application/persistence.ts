import type { LoggingFlowState, AccountCredentials, LicenseClass } from './loggingFlow';
import { validateBackendUrl } from './loggingFlow';
import type { NetLoggerState } from './netloggerState';
import { createInitialNetLoggerState } from './netloggerState';

export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type PersistenceStores = {
  appStore: KeyValueStore;
  secretStore: KeyValueStore;
};

/**
 * SecureStore keys for sensitive credential fields.
 */
const SECURE_KEYS = {
  backendPassword: 'log2go.backendPassword.v1',
  backendToken: 'log2go.backendAccessToken.v1',
  qrzUsername: 'log2go.qrz.username.v1',
  qrzPassword: 'log2go.qrz.password.v1',
  lotwUsername: 'log2go.lotw.username.v1',
  lotwPassword: 'log2go.lotw.password.v1',
  eqslUsername: 'log2go.eqsl.username.v1',
  eqslPassword: 'log2go.eqsl.password.v1',
} as const;

/**
 * v3 persisted state: excludes backend password, access token,
 * and all service credentials (those go in SecureStore separately).
 */
type PersistedLoggingStateV3 = Omit<LoggingFlowState, 'password' | 'accessToken' | 'settings' | 'licenseClass'> & {
  version: 3;
  settings: Omit<LoggingFlowState['settings'], 'accounts'>;
  licenseClass?: LicenseClass;
};

/**
 * v2 persisted state: older format without settings grouping.
 */
type PersistedLoggingStateV2 = Omit<LoggingFlowState, 'password' | 'accessToken' | 'settings' | 'licenseClass'> & {
  version: 2;
  autoSync: boolean;
};

type PersistedNetLoggerState = {
  version: 1;
  mode: 'idle' | 'browsing' | 'monitoring';
  selectedNet?: {
    serverName: string;
    netName: string;
    netId?: string;
    frequency: string;
    mode: string;
    band: string;
    netControl: string;
    logger: string;
  };
};

const APP_STATE_KEY = 'log2go.loggingState.v3';
const LEGACY_V2_KEY = 'log2go.loggingState.v2';
const LEGACY_V1_KEY = 'log2go.loggingState.v1';
const NETLOGGER_STATE_KEY = 'log2go.netloggerState.v1';

export async function savePersistentLoggingState(
  state: LoggingFlowState,
  stores: PersistenceStores,
): Promise<void> {
  const { secretStore, appStore } = stores;

  // Save credentials to SecureStore
  await saveSecret(secretStore, SECURE_KEYS.backendPassword, state.password);
  await saveSecret(secretStore, SECURE_KEYS.backendToken, state.accessToken);
  await saveSecret(secretStore, SECURE_KEYS.qrzUsername, state.settings.accounts.qrzUsername);
  await saveSecret(secretStore, SECURE_KEYS.qrzPassword, state.settings.accounts.qrzPassword);
  await saveSecret(secretStore, SECURE_KEYS.lotwUsername, state.settings.accounts.lotwUsername);
  await saveSecret(secretStore, SECURE_KEYS.lotwPassword, state.settings.accounts.lotwPassword);
  await saveSecret(secretStore, SECURE_KEYS.eqslUsername, state.settings.accounts.eqslUsername);
  await saveSecret(secretStore, SECURE_KEYS.eqslPassword, state.settings.accounts.eqslPassword);

  // Save non-sensitive state to AsyncStorage
  const { password, accessToken, settings, ...rest } = state;
  const persisted: PersistedLoggingStateV3 = {
    version: 3,
    ...rest,
    licenseClass: state.licenseClass,
    settings: {
      autoSync: settings.autoSync,
      // accounts are intentionally omitted — they live in SecureStore
    },
  };

  await appStore.setItem(APP_STATE_KEY, JSON.stringify(persisted));
}

export async function loadPersistentLoggingState(
  fallback: LoggingFlowState,
  stores: PersistenceStores,
): Promise<LoggingFlowState> {
  const { appStore, secretStore } = stores;

  // Load secure credentials first
  const secureResults = await Promise.all([
    secretStore.getItem(SECURE_KEYS.backendPassword),
    secretStore.getItem(SECURE_KEYS.backendToken),
    secretStore.getItem(SECURE_KEYS.qrzUsername),
    secretStore.getItem(SECURE_KEYS.qrzPassword),
    secretStore.getItem(SECURE_KEYS.lotwUsername),
    secretStore.getItem(SECURE_KEYS.lotwPassword),
    secretStore.getItem(SECURE_KEYS.eqslUsername),
    secretStore.getItem(SECURE_KEYS.eqslPassword),
  ]);

  const accounts: AccountCredentials = {
    qrzUsername: secureResults[2] ?? undefined,
    qrzPassword: secureResults[3] ?? undefined,
    lotwUsername: secureResults[4] ?? undefined,
    lotwPassword: secureResults[5] ?? undefined,
    eqslUsername: secureResults[6] ?? undefined,
    eqslPassword: secureResults[7] ?? undefined,
  };

  // Load persisted state from AsyncStorage
  const [appState, legacyV2State, legacyV1State] = await Promise.all([
    appStore.getItem(APP_STATE_KEY),
    appStore.getItem(LEGACY_V2_KEY),
    appStore.getItem(LEGACY_V1_KEY),
  ]);

  const source = appState ?? legacyV2State ?? legacyV1State;

  if (source === null) {
    // No persisted state — use fallback with credentials from SecureStore
    const state = {
      ...fallback,
      password: secureResults[0] ?? fallback.password,
      accessToken: secureResults[1] ?? fallback.accessToken,
      settings: {
        ...fallback.settings,
        accounts,
      },
    };
    // Validate backend URL even for fresh state
    const validatedUrl = await validateBackendUrl(state.backendBaseUrl);
    return validatedUrl !== state.backendBaseUrl ? { ...state, backendBaseUrl: validatedUrl } : state;
  }

  try {
    const parsed = JSON.parse(source);

    if (typeof parsed.version !== 'number') {
      return fallback;
    }

    // v3: current format
    if (parsed.version === 3) {
      const state = {
        ...parsed,
        version: 3,
        password: secureResults[0] ?? parsed.password ?? fallback.password,
        accessToken: secureResults[1] ?? parsed.accessToken ?? fallback.accessToken,
        settings: {
          autoSync: parsed.settings?.autoSync ?? fallback.settings.autoSync,
          accounts,
        },
        licenseClass: parsed.licenseClass,
      };
      const validatedUrl = await validateBackendUrl(state.backendBaseUrl);
      return validatedUrl !== state.backendBaseUrl ? { ...state, backendBaseUrl: validatedUrl } : state;
    }

    // v2: older format without settings grouping
    if (parsed.version === 2) {
      const state = {
        ...parsed,
        version: 3,
        password: secureResults[0] ?? parsed.password ?? fallback.password,
        accessToken: secureResults[1] ?? parsed.accessToken ?? fallback.accessToken,
        settings: {
          autoSync: parsed.autoSync ?? fallback.settings.autoSync,
          accounts,
        },
        licenseClass: undefined,
      };
      const validatedUrl = await validateBackendUrl(state.backendBaseUrl);
      return validatedUrl !== state.backendBaseUrl ? { ...state, backendBaseUrl: validatedUrl } : state;
    }

    // v1: oldest format
    if (parsed.version === 1) {
      const state = {
        ...parsed,
        version: 3,
        password: secureResults[0] ?? parsed.password ?? fallback.password,
        accessToken: secureResults[1] ?? parsed.accessToken ?? fallback.accessToken,
        settings: {
          autoSync: fallback.settings.autoSync,
          accounts,
        },
        licenseClass: undefined,
      };
      const validatedUrl = await validateBackendUrl(state.backendBaseUrl);
      return validatedUrl !== state.backendBaseUrl ? { ...state, backendBaseUrl: validatedUrl } : state;
    }

    return fallback;
  } catch (error) {
    console.error('[persistence] Failed to parse LoggingState:', error);
    return fallback;
  }
}

async function saveSecret(store: KeyValueStore, key: string, value?: string): Promise<void> {
  if (value === undefined || value === null || value === '') {
    await store.removeItem(key);
  } else {
    await store.setItem(key, value);
  }
}

// ───────────────────────────────────────────────────────────────────────
// NetLogger persistence (separate from LoggingState)
// ───────────────────────────────────────────────────────────────────────

export async function saveNetLoggerState(
  state: NetLoggerState,
  store: KeyValueStore,
): Promise<void> {
  // Persist with versioning so we can migrate later
  const toSave = {
    version: 1,
    mode: state.mode,
    selectedNet: state.selectedNet,
  };
  await store.setItem(NETLOGGER_STATE_KEY, JSON.stringify(toSave));
}

export async function loadNetLoggerState(
  store: KeyValueStore,
): Promise<NetLoggerState> {
  const raw = await store.getItem(NETLOGGER_STATE_KEY);
  if (raw === null) return createInitialNetLoggerState();

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1) return createInitialNetLoggerState();

    // On restore, never re-enter monitoring mode directly —
    // user should actively re-select a net they still want to monitor.
    const mode = parsed.mode === 'monitoring' ? 'browsing' : parsed.mode;

    return {
      ...createInitialNetLoggerState(),
      mode,
      selectedNet: parsed.selectedNet,
    };
  } catch {
    return createInitialNetLoggerState();
  }
}
