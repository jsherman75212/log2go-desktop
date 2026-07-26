import test from 'node:test';
import assert from 'node:assert/strict';

const browserStoreModule = require('./browserKeyValueStore.ts');
const persistence = require('../application/persistence.ts');
const loggingFlow = require('../application/loggingFlow.ts');

function installMockLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });

  return data;
}

test('browser localStorage key-value store prefixes keys and persists values', async () => {
  const data = installMockLocalStorage();
  const store = browserStoreModule.createBrowserLocalStorageStore('desktop.test.');

  await store.setItem('contact-state', 'saved');
  assert.equal(await store.getItem('contact-state'), 'saved');
  assert.equal(data.get('desktop.test.contact-state'), 'saved');

  await store.removeItem('contact-state');
  assert.equal(await store.getItem('contact-state'), null);
});

test('desktop persistence stores and restores local contacts without plaintext password in app store', async () => {
  installMockLocalStorage();
  const stores = browserStoreModule.createDesktopPersistenceStores();
  const initial = loggingFlow.createInitialLoggingFlowState({ now: () => '2026-07-06T04:00:00.000Z' });
  const withContact = loggingFlow.logContact({
    ...initial,
    username: 'ke5zqv',
    password: 'not-for-app-store',
    accessToken: 'token-not-for-app-store',
  }, {
    callsign: 'n5abc',
    contactedAt: '2026-07-06T04:05:00.000Z',
    frequencyMhz: '7.195',
    band: '40m',
    mode: 'SSB',
    grid: 'em13be',
    county: 'Wise',
  });

  await persistence.savePersistentLoggingState(withContact, stores);

  const rawAppState = await stores.appStore.getItem('log2go.loggingState.v3');
  assert.ok(rawAppState);
  assert.equal(rawAppState.includes('not-for-app-store'), false);
  assert.equal(rawAppState.includes('token-not-for-app-store'), false);

  const fallback = loggingFlow.createInitialLoggingFlowState({ now: () => '2026-07-06T05:00:00.000Z' });
  const restored = await persistence.loadPersistentLoggingState(fallback, stores);

  assert.equal(restored.contacts.length, 1);
  assert.equal(restored.contacts[0].callsign, 'N5ABC');
  assert.equal(restored.contacts[0].grid, 'EM13BE');
  assert.equal(restored.password, 'not-for-app-store');
  assert.equal(restored.accessToken, 'token-not-for-app-store');
});
