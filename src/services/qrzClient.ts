/**
 * QRZ XML API client.
 *
 * Documentation: https://www.qrz.com/page/current_spec.html
 * Base URL: https://xmldata.qrz.com/xml/current/
 *
 * Flow:
 *   1. login(username, password) → session key
 *   2. lookupCallsign(callsign, key) → Callsign record
 *
 * The session key is cached in memory and must be reused until the server
 * returns a session error, at which point the caller retries with a fresh
 * login. This module keeps at most one in-flight login.
 *
 * The `agent` parameter is required by the QRZ spec; we send the centralized
 * APP_USER_AGENT from src/appVersion.ts.
 */

import { parseXmlToTree, getChildText } from './xmlParser';
import { APP_USER_AGENT } from '../appVersion';

export const QRZ_XML_BASE_URL = 'https://xmldata.qrz.com/xml/current/';
const QRZ_AGENT = APP_USER_AGENT;
const REQUEST_TIMEOUT_MS = 10_000;

export type QrzSessionError = { error: string } | null;

export type QrzSession = {
  key: string;
  count?: number;
  subExp?: string;
  gmTime?: string;
};

export type QrzCallsign = {
  call: string;
  aliases?: string;
  dxcc?: string;
  fname?: string;
  name?: string;
  addr1?: string;
  addr2?: string;
  city?: string;       // addr2 maps to city in QRZ responses
  state?: string;
  zip?: string;
  country?: string;
  ccode?: string;
  lat?: number;
  lon?: number;
  grid?: string;
  county?: string;
  fips?: string;
  class?: string;      // License class code: T, G, E, A, N
  efdate?: string;
  expdate?: string;
  email?: string;
  url?: string;
  cqzone?: number;
  ituzone?: number;
  raw: Record<string, string>; // all fields from <Callsign>, keyed by tag name
};

/**
 * Parse an XML error response or session node and return the error message.
 */
export function parseSessionError(xml: string): QrzSessionError {
  try {
    const root = parseXmlToTree(xml);
    const session = root.children?.find((child) => child.tagName.toLowerCase() === 'session');
    if (!session) return null;

    const errorText = getChildText(session, 'Error') ?? getChildText(session, 'Message');
    if (!errorText) return null;
    return { error: errorText };
  } catch {
    return null;
  }
}

/**
 * Parse a successful login response and return the session key + metadata.
 */
export function parseSessionResponse(xml: string): QrzSession | QrzSessionError {
  try {
    const root = parseXmlToTree(xml);
    const db = root.children?.find((child) => child.tagName.toLowerCase() === 'qrzdatabase');
    if (!db) return { error: 'Malformed QRZ response: missing QRZDatabase root' };

    const session = db.children?.find((child) => child.tagName.toLowerCase() === 'session');
    if (!session) return { error: 'Malformed QRZ response: missing Session node' };

    const errorText = getChildText(session, 'Error');
    if (errorText) return { error: errorText };

    const key = getChildText(session, 'Key');
    if (!key) return { error: 'Malformed QRZ response: missing session Key' };

    return {
      key: key.trim(),
      count: getChildText(session, 'Count') ? Number(getChildText(session, 'Count')) : undefined,
      subExp: getChildText(session, 'SubExp') ?? undefined,
      gmTime: getChildText(session, 'GMTime') ?? undefined,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to parse QRZ login response' };
  }
}

/**
 * Parse a callsign lookup response. Returns the callsign record, or a session
 * error if the session expired / lookup failed.
 */
export function parseCallsignResponse(xml: string): QrzCallsign | QrzSessionError {
  try {
    const root = parseXmlToTree(xml);
    const db = root.children?.find((child) => child.tagName.toLowerCase() === 'qrzdatabase');
    if (!db) return { error: 'Malformed QRZ response' };

    // Check for session error before anything else
    const session = db.children?.find((child) => child.tagName.toLowerCase() === 'session');
    if (session) {
      const errorText = getChildText(session, 'Error');
      if (errorText) return { error: errorText };
    }

    const callsignNode = db.children?.find((child) => child.tagName.toLowerCase() === 'callsign');
    if (!callsignNode) return { error: 'Callsign not found in response' };

    const raw: Record<string, string> = {};
    for (const child of callsignNode.children) {
      if (child.children.length === 0) {
        raw[child.tagName] = child.textContent.trim();
      }
    }

    const pick = (tag: string): string | undefined => raw[tag] ?? undefined;
    const pickNum = (tag: string): number | undefined => {
      const v = raw[tag];
      if (v === undefined) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };

    return {
      call: pick('call') ?? '',
      aliases: pick('aliases'),
      dxcc: pick('dxcc'),
      fname: pick('fname'),
      name: pick('name'),
      addr1: pick('addr1'),
      addr2: pick('addr2'),
      city: pick('addr2'), // QRZ uses addr2 as city
      state: pick('state'),
      zip: pick('zip'),
      country: pick('country'),
      ccode: pick('ccode'),
      lat: pickNum('lat'),
      lon: pickNum('lon'),
      grid: pick('grid'),
      county: pick('county'),
      fips: pick('fips'),
      class: pick('class'),
      efdate: pick('efdate'),
      expdate: pick('expdate'),
      email: pick('email'),
      url: pick('url'),
      cqzone: pickNum('cqzone'),
      ituzone: pickNum('ituzone'),
      raw,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to parse QRZ callsign response' };
  }
}

/**
 * Perform an HTTP GET to the QRZ XML API.
 *
 * On RN, `fetch` does not accept AbortSignal.timeout natively in every OS
 * version, so we use an explicit AbortController.
 */
async function qrzFetch(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`QRZ XML HTTP error: ${res.status} ${res.statusText}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Login to QRZ and retrieve a session key.
 */
export async function login(username: string, password: string): Promise<QrzSession | QrzSessionError> {
  if (!username || !password) {
    return { error: 'QRZ username and password are required' };
  }

  const params = new URLSearchParams({
    username: username.trim(),
    password: password.trim(),
    agent: QRZ_AGENT,
  });
  const url = `${QRZ_XML_BASE_URL}?${params.toString()}`;

  const xml = await qrzFetch(url);
  return parseSessionResponse(xml);
}

/**
 * Lookup a callsign given a valid session key.
 */
export async function lookupCallsign(
  sessionKey: string,
  callsign: string,
): Promise<QrzCallsign | QrzSessionError> {
  if (!sessionKey) {
    return { error: 'Session key is required for callsign lookup' };
  }
  if (!callsign.trim()) {
    return { error: 'Callsign is required' };
  }

  const params = new URLSearchParams({
    s: sessionKey,
    callsign: callsign.trim().toUpperCase(),
  });
  const url = `${QRZ_XML_BASE_URL}?${params.toString()}`;

  const xml = await qrzFetch(url);
  return parseCallsignResponse(xml);
}

/**
 * Convenience: lookup with automatic re-login on session expiry.
 * Stores the session key in memory only — caller is responsible for
 * persisting credentials (username/password) via SecureStore.
 */
export class QrzClient {
  private sessionKey: string | null = null;
  private loginPromise: Promise<QrzSession | QrzSessionError> | null = null;

  async loginAndRemember(username: string, password: string): Promise<QrzSession | QrzSessionError> {
    // Only one login in flight at a time
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = login(username, password).finally(() => {
      this.loginPromise = null;
    });
    const result = await this.loginPromise;
    if (result && 'key' in result) {
      this.sessionKey = result.key;
    }
    return result ?? { error: 'Login returned null' };
  }

  hasSession(): boolean {
    return this.sessionKey !== null;
  }

  clearSession(): void {
    this.sessionKey = null;
  }

  async lookup(
    callsign: string,
    username: string,
    password: string,
    forceRelogin = false,
  ): Promise<QrzCallsign | QrzSessionError> {
    if (forceRelogin) this.clearSession();

    if (!this.sessionKey) {
      const loginResult = await this.loginAndRemember(username, password);
      if (!loginResult || 'error' in loginResult) return loginResult ?? { error: 'Login failed' };
    }

    const result = await lookupCallsign(this.sessionKey!, callsign);
    if (result && 'error' in result && this.isSessionError(result.error)) {
      // Session expired → single retry with fresh login
      this.clearSession();
      const retryLogin = await this.loginAndRemember(username, password);
      if (!retryLogin || 'error' in retryLogin) return retryLogin ?? { error: 'Login failed' };
      return lookupCallsign(this.sessionKey!, callsign);
    }
    return result ?? { error: 'Lookup returned null' };
  }

  private isSessionError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes('session') ||
      lower.includes('invalid key') ||
      lower.includes('timeout')
    );
  }
}

/** Convenience singleton, lazily constructed. */
let _defaultClient: QrzClient | null = null;
export function getDefaultQrzClient(): QrzClient {
  if (!_defaultClient) _defaultClient = new QrzClient();
  return _defaultClient;
}
