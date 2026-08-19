import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ApiError,
  getAccountProfile,
  getStationProfiles,
  listContacts,
  login,
  saveStationProfiles,
} from './backendClient';

function installFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test('desktop backend client logs in with username password and optional device id', async () => {
  const restore = installFetch((url, init) => {
    assert.equal(url, 'https://api.example.test/auth/login');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.headers && (init.headers as Record<string, string>)['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      username: 'ke5zqv',
      password: 'test-password-not-real',
      device_id: 'desktop-device-1',
    });
    return Response.json({ access_token: 'mock-test-token-not-real', token_type: 'bearer', user_id: 7, device_id: 'desktop-device-1' });
  });

  try {
    const response = await login('https://api.example.test/', 'ke5zqv', 'secret', 'desktop-device-1');
    assert.equal(response.access_token, 'mock-test-token-not-real');
    assert.equal(response.user_id, 7);
  } finally {
    restore();
  }
});

test('desktop backend client sends bearer token for account-wide app data', async () => {
  const calls: string[] = [];
  const restore = installFetch((url, init) => {
    calls.push(`${init?.method} ${url} ${(init?.headers as Record<string, string>).Authorization}`);
    if (url.endsWith('/api/v1/account')) {
      return Response.json({ id: 7, callsign: 'KE5ZQV', email: 'jody@example.test', username: 'jody' });
    }
    return Response.json([]);
  });

  try {
    const profile = await getAccountProfile('https://api.example.test', 'mock-test-token-not-real');
    const contacts = await listContacts('https://api.example.test', 'mock-test-token-not-real');
    assert.equal(profile.callsign, 'KE5ZQV');
    assert.deepEqual(contacts, []);
    assert.deepEqual(calls, [
      'GET https://api.example.test/api/v1/account Bearer mock-test-token-not-real',
      'GET https://api.example.test/api/v1/contacts Bearer mock-test-token-not-real',
    ]);
  } finally {
    restore();
  }
});

test('desktop backend client loads and saves station profiles through account endpoint', async () => {
  const calls: string[] = [];
  const collection = {
    activeProfileId: 'truck-mobile',
    profiles: [{
      id: 'truck-mobile',
      profileName: 'Truck',
      callsign: 'KE5ZQV',
      defaultMode: 'SSB',
      defaultSignalReport: { sent: '59', received: '59' },
      active: true,
    }],
  };
  const restore = installFetch((url, init) => {
    calls.push(`${init?.method} ${url} ${(init?.headers as Record<string, string>).Authorization}`);
    if (init?.method === 'PUT') {
      assert.deepEqual(JSON.parse(String(init.body)), collection);
    }
    return Response.json(collection);
  });

  try {
    const loaded = await getStationProfiles('https://api.example.test', 'mock-test-token-not-real');
    const saved = await saveStationProfiles('https://api.example.test', 'mock-test-token-not-real', collection);
    assert.equal(loaded.activeProfileId, 'truck-mobile');
    assert.equal(saved.profiles[0].callsign, 'KE5ZQV');
    assert.deepEqual(calls, [
      'GET https://api.example.test/api/v1/account/station-profiles Bearer mock-test-token-not-real',
      'PUT https://api.example.test/api/v1/account/station-profiles Bearer mock-test-token-not-real',
    ]);
  } finally {
    restore();
  }
});

test('desktop backend client preserves backend error details', async () => {
  const restore = installFetch(() => new Response(JSON.stringify({ detail: 'Invalid login' }), { status: 401 }));

  try {
    await assert.rejects(
      () => login('https://api.example.test', 'bad', 'wrong'),
      (error) => {
        assert.equal(error instanceof ApiError, true);
        assert.equal((error as ApiError).status, 401);
        assert.deepEqual((error as ApiError).responseBody, { detail: 'Invalid login' });
        return true;
      },
    );
  } finally {
    restore();
  }
});
