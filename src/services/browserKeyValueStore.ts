import type { KeyValueStore, PersistenceStores } from '../application/persistence';

class BrowserLocalStorageStore implements KeyValueStore {
  constructor(private readonly prefix: string) {}

  async getItem(key: string): Promise<string | null> {
    return getBrowserLocalStorage()?.getItem(this.prefixed(key)) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    const storage = getBrowserLocalStorage();
    if (!storage) throw new Error('Browser localStorage is not available.');
    storage.setItem(this.prefixed(key), value);
  }

  async removeItem(key: string): Promise<void> {
    getBrowserLocalStorage()?.removeItem(this.prefixed(key));
  }

  private prefixed(key: string): string {
    return `${this.prefix}${key}`;
  }
}

function getBrowserLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function createBrowserLocalStorageStore(prefix: string): KeyValueStore {
  return new BrowserLocalStorageStore(prefix);
}

export function createDesktopPersistenceStores(): PersistenceStores {
  return {
    appStore: createBrowserLocalStorageStore('log2go.desktop.app.'),
    // First-pass desktop persistence uses localStorage for both stores because
    // this scaffold has no Electron preload/IPC bridge yet. Do not expose
    // credential UI as "secure" until this moves to OS-backed storage.
    secretStore: createBrowserLocalStorageStore('log2go.desktop.secret.'),
  };
}
