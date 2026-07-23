import test from 'node:test';
import assert from 'node:assert/strict';

const netloggerClient = require('./netloggerClient.ts');
const client = netloggerClient.default ?? netloggerClient;

test('buildNetloggerApiUrl uses same-origin proxy for browser preview pages', () => {
  const url = client.buildNetloggerApiUrl('GetCheckins.php', {
    ServerName: 'NETLOGGER3',
    NetName: '3905 40m SSB Late Net',
  }, {
    protocol: 'http:',
    origin: 'http://192.168.30.131:54337',
    hostname: '192.168.30.131',
  });

  assert.equal(url.toString(), 'http://192.168.30.131:54337/netlogger-api/GetCheckins.php?ServerName=NETLOGGER3&NetName=3905+40m+SSB+Late+Net');
});

test('buildNetloggerApiUrl uses direct NetLogger API outside same-origin browser preview', () => {
  const url = client.buildNetloggerApiUrl('GetActiveNets.php', undefined, undefined);
  assert.equal(url.toString(), 'https://www.netlogger.org/api/GetActiveNets.php');
});

test('AIM join and send use the Log2Go backend proxy when backend URL is supplied', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, string> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return Response.json({ success: true, response_code: '200 OK' });
  }) as typeof fetch;

  try {
    await client.requestAIMSessionKey({
      serverName: 'NETLOGGER3',
      netName: 'the N0SWR net',
      callsign: 'KE5ZQV',
      operatorName: 'Jody',
      backendBaseUrl: 'https://api.example.test/',
    });
    await client.sendAIMMessage({
      serverName: 'NETLOGGER3',
      netName: 'the N0SWR net',
      callsign: 'KE5ZQV',
      operatorName: 'Jody',
      message: 'Test message',
      backendBaseUrl: 'https://api.example.test/',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls, [
    {
      url: 'https://api.example.test/api/v1/netlogger/subscribe',
      body: { server_name: 'NETLOGGER3', net_name: 'the N0SWR net', callsign: 'KE5ZQV', operator_name: 'Jody' },
    },
    {
      url: 'https://api.example.test/api/v1/netlogger/send-aim',
      body: { server_name: 'NETLOGGER3', net_name: 'the N0SWR net', callsign: 'KE5ZQV', operator_name: 'Jody', message: 'Test message' },
    },
  ]);
});

test('NetLogger delayed unsubscribe cancel uses backend keepalive endpoint', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; keepalive?: boolean; body: Record<string, string> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), keepalive: init?.keepalive, body: JSON.parse(String(init?.body)) });
    return Response.json({ scheduled: false, session_id: 'session-1' });
  }) as typeof fetch;

  try {
    await client.cancelDelayedUnsubscribe({ backendBaseUrl: 'https://api.example.test/', sessionId: 'session-1' });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls, [{
    url: 'https://api.example.test/api/v1/netlogger/cancel-unsubscribe',
    keepalive: true,
    body: { session_id: 'session-1' },
  }]);
});

test('NetLogger delayed unsubscribe schedules via sendBeacon during pagehide', () => {
  const originalNavigator = globalThis.navigator;
  const calls: Array<{ url: string; blobType: string }> = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      sendBeacon: (url: string, blob: Blob) => {
        calls.push({ url, blobType: blob.type });
        return true;
      },
    },
  });

  try {
    const ok = client.scheduleDelayedUnsubscribeBeacon({
      serverName: 'NETLOGGER3',
      netName: 'the N0SWR net',
      callsign: 'KE5ZQV',
      operatorName: 'Jody',
      backendBaseUrl: 'https://api.example.test/',
      sessionId: 'session-2',
      delaySeconds: 60,
    });
    assert.equal(ok, true);
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator });
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.test/api/v1/netlogger/unsubscribe-later');
});
