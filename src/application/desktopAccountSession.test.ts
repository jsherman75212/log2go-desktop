import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialLoggingFlowState } from './loggingFlow';
import { logInDesktopAccount, logOutDesktopAccount } from './desktopAccountSession';

test('desktop account session logs in and stores shared backend token/profile state', async () => {
  const state = {
    ...createInitialLoggingFlowState(),
    backendBaseUrl: 'https://api.example.test',
    username: 'jody',
    password: 'test-password-not-real',
  };
  const calls: string[] = [];

  const result = await logInDesktopAccount(state, {
    deviceId: 'desktop-device-1',
    async login(baseUrl, username, password, deviceId) {
      calls.push(`login:${baseUrl}:${username}:${password}:${deviceId}`);
      return { access_token: 'mock-test-token-not-real', user_id: 7, device_id: 'desktop-device-1' };
    },
    async getAccountProfile(baseUrl, token) {
      calls.push(`profile:${baseUrl}:${token}`);
      return { id: 7, callsign: 'KE5ZQV', email: 'jody@example.test', username: 'jody' };
    },
  });

  assert.deepEqual(calls, [
    'login:https://api.example.test:jody:test-password-not-real:desktop-device-1',
    'profile:https://api.example.test:mock-test-token-not-real',
  ]);
  assert.equal(result.state.accessToken, 'mock-test-token-not-real');
  assert.equal(result.accountProfile?.callsign, 'KE5ZQV');
  assert.equal(result.message, 'Logged in as KE5ZQV.');
});

test('desktop account session rejects missing login settings before calling backend', async () => {
  const state = createInitialLoggingFlowState();
  let loginCalled = false;

  const result = await logInDesktopAccount(state, {
    async login() {
      loginCalled = true;
      return { access_token: 'mock-test-token-not-real' };
    },
    async getAccountProfile() {
      throw new Error('should not fetch profile without credentials');
    },
  });

  assert.equal(loginCalled, false);
  assert.equal(result.state, state);
  assert.match(result.message, /backend url, username, and password are required/i);
});

test('desktop account session logs out by clearing token and password while preserving backend URL and username', () => {
  const state = {
    ...createInitialLoggingFlowState(),
    backendBaseUrl: 'https://api.example.test',
    username: 'jody',
    password: 'test-password-not-real',
    accessToken: 'mock-test-token-not-real',
  };

  const result = logOutDesktopAccount(state);

  assert.equal(result.backendBaseUrl, 'https://api.example.test');
  assert.equal(result.username, 'jody');
  assert.equal(result.password, '');
  assert.equal(result.accessToken, undefined);
});
