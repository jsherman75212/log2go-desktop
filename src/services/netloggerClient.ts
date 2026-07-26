/**
 * NetLogger API Client
 *
 * Fetches data from the NetLogger REST/XML API at https://www.netlogger.org/api/
 *
 * Endpoints:
 * - GetActiveNets.php — list currently active nets
 * - GetPastNets.php — list recently closed nets
 * - GetCheckins.php — get check-ins for an active net
 * - GetPastNetCheckins.php — get check-ins for a past net
 * - GetAIM.php — get AIM chat messages for a net
 * - GetMonitors.php — get monitor list for a net
 *
 * All responses are XML with a <NetLoggerXML> root element.
 * Polling strategy: nets every 60s, checkins/AIM every 20s, monitors every 30s.
 */

import type {
  ActiveNetsResponse,
  AIMResponse,
  CheckinsResponse,
  MonitorsResponse,
  NetLoggerCheckin,
  NetLoggerAIMMessage,
  NetLoggerMonitor,
  NetLoggerNet,
  NetLoggerPastNet,
  NetLoggerServer,
  PastNetsResponse,
  FlatActiveNet,
  FlatPastNet,
} from '../domain/netloggerTypes';
import { parseXmlToTree, getChildText, getChildren, getChild } from './xmlParser';
import { APP_USER_AGENT, NETLOGGER_CLIENT_VERSION } from '../appVersion';

const BASE_URL = 'https://www.netlogger.org/api';
const LEGACY_BASE_PATH = '/cgi-bin/NetLogger';

const LEGACY_SERVER_HOSTS: Record<string, string> = {
  NETLOGGER: 'www.netlogger.org',
  NETLOGGER1: 'www.netlogger1.org',
  NETLOGGER2: 'www.netlogger2.org',
  NETLOGGER3: 'www.netlogger3.org',
  NETLOGGER4: 'www.netlogger4.org',
};

export type SendAIMMessageResult = {
  responseCode: string;
  error?: string;
  success: boolean;
};

export type Updates3AIMMessage = {
  im_serial: string;
  callsign: string;
  is_net_control: string;
  message: string;
  aim_time: string; // YYYYMMDDHHMMSS
  ip_addr: string;
};

export type Updates3Response = {
  success: boolean;
  im_messages: Updates3AIMMessage[];
  monitor_count: number;
  net_info: string;
  error?: string | null;
};

export type AIMSessionResult = {
  responseCode: string;
  error?: string;
  aimSessionKey?: string;
  success: boolean;
};

export type LegacyNetLoggerResult = {
  responseCode: string;
  error?: string;
  success: boolean;
  raw: string;
};

const USER_AGENT = `${APP_USER_AGENT} (Amateur Radio Mobile Logger)`;
// NetLogger identity version comes from the central appVersion module.
// It must stay on a recognized desktop version string: live testing on
// 2026-07-04 showed arbitrary versions may subscribe onto the monitors
// list while SendInstantMessage silently drops AIM publication.
const LEGACY_CLIENT_VERSION = NETLOGGER_CLIENT_VERSION; // currently 3.1.7W
const LEGACY_IS_NET_CONTROL_FLAG = 'l';

type NetloggerApiLocation = Pick<Location, 'protocol' | 'origin' | 'hostname'>;

function currentBrowserLocation(): NetloggerApiLocation | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.location;
}

function shouldUseSameOriginNetloggerProxy(location?: NetloggerApiLocation): boolean {
  if (!location) return false;
  if (!location.protocol.startsWith('http')) return false;
  return location.hostname !== 'www.netlogger.org';
}

export function buildNetloggerApiUrl(
  endpoint: string,
  params?: Record<string, string>,
  location: NetloggerApiLocation | undefined = currentBrowserLocation(),
): URL {
  const base = shouldUseSameOriginNetloggerProxy(location) && location
    ? new URL(`/netlogger-api/${endpoint}`, location.origin)
    : new URL(`${BASE_URL}/${endpoint}`);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      base.searchParams.set(key, value);
    });
  }

  return base;
}

// ── XML Parsing ─────────────────────────────────────────────────────

function parseHeader(root: ReturnType<typeof parseXmlToTree>) {
  const header = getChild(root, 'Header');
  if (!header) {
    throw new Error('NetLogger XML response missing <Header> element');
  }
  return {
    creationDateUtc: getChildText(header, 'CreationDateUTC'),
    copyright: getChildText(header, 'Copyright'),
    apiVersion: getChildText(header, 'APIVersion'),
    timeZone: getChildText(header, 'TimeZone'),
  };
}

/**
 * Check for a NetLogger API error response (e.g., rate-limit 429).
 * NetLogger returns <Error>...</Error> and <ResponseCode>429 ...</ResponseCode>
 * in the root instead of the expected data element when rate-limited.
 * Call this before looking for data elements like <MonitorList>, <CheckinList>, etc.
 */
function checkXmlError(root: ReturnType<typeof parseXmlToTree>): void {
  const errorEl = getChild(root, 'Error');
  if (errorEl && typeof errorEl === 'object' && 'text' in errorEl) {
    const errorMsg = (errorEl as { text?: string }).text || 'Unknown NetLogger API error';
    const responseCode = getChildText(root, 'ResponseCode');
    if (responseCode.includes('429') || errorMsg.includes('Max Poll Rate')) {
      throw new Error(`NetLogger API rate-limited (429) — slow down and retry in a minute.`);
    }
    throw new Error(`NetLogger API error: ${errorMsg}`);
  }
}

function parseNet(netEl: ReturnType<typeof parseXmlToTree>): NetLoggerNet {
  return {
    netName: getChildText(netEl, 'NetName'),
    altNetName: getChildText(netEl, 'AltNetName'),
    frequency: getChildText(netEl, 'Frequency'),
    logger: getChildText(netEl, 'Logger'),
    netControl: getChildText(netEl, 'NetControl'),
    date: getChildText(netEl, 'Date'),
    mode: getChildText(netEl, 'Mode'),
    band: getChildText(netEl, 'Band'),
    subscriberCount: parseInt(getChildText(netEl, 'SubscriberCount'), 10) || 0,
  };
}

function parsePastNet(netEl: ReturnType<typeof parseXmlToTree>): NetLoggerPastNet {
  const base = parseNet(netEl);
  return {
    ...base,
    netId: getChildText(netEl, 'NetID'),
    aim: getChildText(netEl, 'AIM') === 'Y',
    updateInterval: parseInt(getChildText(netEl, 'UpdateInterval'), 10) || 0,
    srcIp: getChildText(netEl, 'srcIP'),
    lastActivity: getChildText(netEl, 'LastActivity'),
    inactivityTimer: parseInt(getChildText(netEl, 'InactivityTimer'), 10) || 0,
    closedAt: getChildText(netEl, 'ClosedAt'),
    assassinated: getChildText(netEl, 'Assassinated') === 'Y',
    miscNetParameters: getChildText(netEl, 'MiscNetParameters'),
  };
}

export function parseActiveNetsXml(xml: string): ActiveNetsResponse {
  const root = parseXmlToTree(xml);
  const header = parseHeader(root);
  checkXmlError(root);
  const serverList = getChild(root, 'ServerList');
  if (!serverList) {
    throw new Error('NetLogger XML response missing <ServerList> element');
  }

  const responseCode = getChildText(serverList, 'ResponseCode');
  const serverEls = getChildren(serverList, 'Server');
  const servers: NetLoggerServer<NetLoggerNet>[] = serverEls.map((serverEl) => {
    const serverName = getChildText(serverEl, 'ServerName');
    const activeNetCount = parseInt(getChildText(serverEl, 'ServerActiveNetCount'), 10) || 0;
    const netEls = getChildren(serverEl, 'Net');
    const nets = netEls.map(parseNet);
    return { serverName, activeNetCount, nets };
  });

  return { ...header, servers, responseCode };
}

export function parsePastNetsXml(xml: string): PastNetsResponse {
  const root = parseXmlToTree(xml);
  const header = parseHeader(root);
  checkXmlError(root);
  const serverList = getChild(root, 'ServerList');
  if (!serverList) {
    throw new Error('NetLogger XML response missing <ServerList> element');
  }

  const responseCode = getChildText(serverList, 'ResponseCode');
  const serverEls = getChildren(serverList, 'Server');
  const servers: NetLoggerServer<NetLoggerPastNet>[] = serverEls.map((serverEl) => {
    const serverName = getChildText(serverEl, 'ServerName');
    const pastNetCount = parseInt(getChildText(serverEl, 'ServerPastNetCount'), 10) || 0;
    const netEls = getChildren(serverEl, 'Net');
    const nets = netEls.map(parsePastNet);
    return { serverName, pastNetCount, nets };
  });

  return { ...header, servers, responseCode };
}

function parseCheckin(el: ReturnType<typeof parseXmlToTree>): NetLoggerCheckin {
  return {
    serialNo: parseInt(getChildText(el, 'SerialNo'), 10) || 0,
    callsign: getChildText(el, 'Callsign'),
    state: getChildText(el, 'State'),
    remarks: getChildText(el, 'Remarks'),
    qslInfo: getChildText(el, 'QSLInfo'),
    cityCountry: getChildText(el, 'CityCountry'),
    firstName: getChildText(el, 'FirstName'),
    status: getChildText(el, 'Status'),
    county: getChildText(el, 'County'),
    grid: getChildText(el, 'Grid'),
    street: getChildText(el, 'Street'),
    zip: getChildText(el, 'Zip'),
    memberId: getChildText(el, 'MemberID'),
    country: getChildText(el, 'Country'),
    dxcc: getChildText(el, 'DXCC'),
    preferredName: getChildText(el, 'PreferredName'),
  };
}

export function parseCheckinsXml(xml: string): CheckinsResponse {
  const root = parseXmlToTree(xml);
  const header = parseHeader(root);
  checkXmlError(root);
  const checkinList = getChild(root, 'CheckinList');
  if (!checkinList) {
    throw new Error('NetLogger XML response missing <CheckinList> element');
  }

  const serverName = getChildText(checkinList, 'ServerName');
  const netName = getChildText(checkinList, 'NetName');
  const responseCode = getChildText(checkinList, 'ResponseCode');
  const checkinCount = parseInt(getChildText(checkinList, 'CheckinCount'), 10) || 0;
  const pointer = parseInt(getChildText(checkinList, 'Pointer'), 10) || 0;
  const checkinEls = getChildren(checkinList, 'Checkin');
  const checkins = checkinEls.map(parseCheckin);

  return { ...header, serverName, netName, responseCode, checkinCount, pointer, checkins };
}

function parseAIMMessage(el: ReturnType<typeof parseXmlToTree>): NetLoggerAIMMessage {
  return {
    id: parseInt(getChildText(el, 'id'), 10) || 0,
    callsign: getChildText(el, 'Callsign'),
    message: getChildText(el, 'Message'),
    aimTime: getChildText(el, 'aim_time'),
    ipAddr: getChildText(el, 'IP_ADDR'),
  };
}

export function parseAIMXml(xml: string): AIMResponse {
  const root = parseXmlToTree(xml);
  const header = parseHeader(root);
  checkXmlError(root);

  // NetLogger returns HTTP 200 with an in-XML rate-limit error instead of
  // a proper HTTP 429. Detect it before looking for <AIMTranscript>.
  const errorText = getChildText(root, 'Error');
  const xmlResponseCode = getChildText(root, 'ResponseCode');
  if (xmlResponseCode.includes('429') || errorText.includes('Max Poll Rate')) {
    throw new Error('NetLogger AIM rate-limited (429 in XML) — poll too fast');
  }

  const transcript = getChild(root, 'AIMTranscript');
  if (!transcript) {
    console.warn('[AIM parse] Unexpected XML (first 500 chars):', xml.substring(0, 500));
    throw new Error('NetLogger XML response missing <AIMTranscript> element');
  }

  const serverName = getChildText(transcript, 'ServerName');
  const netName = getChildText(transcript, 'NetName');
  const aimRequestedId = parseInt(getChildText(transcript, 'AIMRequestedId'), 10) || 0;
  const responseCode = getChildText(transcript, 'ResponseCode');
  const aimMessageCount = parseInt(getChildText(transcript, 'AIMMessageCount'), 10) || 0;
  const messageEls = getChildren(transcript, 'AIMEntry');
  const messages = messageEls.map(parseAIMMessage);

  return { ...header, serverName, netName, aimRequestedId, responseCode, aimMessageCount, messages };
}

export function parseSendAIMMessageXml(xml: string): SendAIMMessageResult {
  const root = parseXmlToTree(xml);
  const responseCode = getChildText(root, 'ResponseCode');
  const error = getChildText(root, 'Error');
  return {
    responseCode,
    error: error || undefined,
    success: responseCode.startsWith('200'),
  };
}

export function parseAIMSessionXml(xml: string): AIMSessionResult {
  const root = parseXmlToTree(xml);
  const session = getChild(root, 'Session');
  const responseCode = getChildText(root, 'ResponseCode') || (session ? getChildText(session, 'ResponseCode') : '');
  const error = getChildText(root, 'Error') || (session ? getChildText(session, 'Error') : '');
  const aimSessionKey =
    getChildText(root, 'AIMSessionKey') ||
    getChildText(root, 'AimSessionKey') ||
    getChildText(root, 'SessionKey') ||
    (session
      ? getChildText(session, 'AIMSessionKey') || getChildText(session, 'AimSessionKey') || getChildText(session, 'SessionKey')
      : '');

  return {
    responseCode,
    error: error || undefined,
    aimSessionKey: aimSessionKey || undefined,
    success: Boolean(aimSessionKey) && (responseCode === '' || responseCode.startsWith('200')),
  };
}

export function parseLegacyNetLoggerResponse(text: string): LegacyNetLoggerResult {
  // The legacy CGI protocol signals outcome with literal '*success*' /
  // '*failure*' markers at the START of the body. Do NOT keyword-scan the
  // rest of the body: successful SubscribeToNet responses embed check-in
  // remarks and AIM transcript text that can legitimately contain words
  // like "Error" or "Failed" (e.g. "Failed to copy KI4YTV").
  const bodyMatch = text.match(/<body>\s*([\s\S]*?)\s*(?:<\/body>|$)/i);
  const body = (bodyMatch ? bodyMatch[1] : text).trimStart();

  const failed = body.startsWith('*failure*');
  const success = body.startsWith('*success*') || (!failed && text.includes('*success*'));

  let error: string | undefined;
  if (failed) {
    // First line after the *failure* marker is the server's reason.
    error = body.slice('*failure*'.length).trimStart().split(/<|\n/)[0]?.trim() || 'NetLogger request failed.';
  } else if (!success) {
    error = 'NetLogger response did not contain a success marker.';
  }

  return {
    responseCode: success ? '200 OK' : '',
    error,
    success,
    raw: text,
  };
}

export function getLegacyServerHost(serverName: string): string {
  return LEGACY_SERVER_HOSTS[serverName.trim().toUpperCase()] || 'www.netlogger.org';
}

function formatLegacyClientCallsign(callsign: string, operatorName?: string): string {
  const base = callsign.trim().toUpperCase();
  // Identity is "<STATION>-<NAME>" where NAME is the OPTIONAL operator name
  // from the active Station Profile. Per Jody (2026-07-04): when the profile's
  // operator name is blank, the identity is the bare callsign — no app-name
  // fallback is appended.
  const name = operatorName?.trim();
  return name ? `${base}-${name}` : base;
}

function formatLegacyMonitorCallsign(callsign: string, operatorName?: string): string {
  return `${formatLegacyClientCallsign(callsign, operatorName)} - v${LEGACY_CLIENT_VERSION}`;
}

export function buildLegacySubscribeUrl({
  serverName,
  netName,
  callsign,
  operatorName,
  imSerial = 0,
  lastExtDataSerial = 0,
}: {
  serverName: string;
  netName: string;
  callsign: string;
  operatorName?: string;
  imSerial?: number;
  lastExtDataSerial?: number;
}): string {
  const host = getLegacyServerHost(serverName);
  const url = new URL(`http://${host}${LEGACY_BASE_PATH}/SubscribeToNet.php`);
  url.searchParams.set('ProtocolVersion', '2.3');
  url.searchParams.set('NetName', netName);
  url.searchParams.set('Callsign', formatLegacyMonitorCallsign(callsign, operatorName));
  url.searchParams.set('IMSerial', String(imSerial));
  url.searchParams.set('LastExtDataSerial', String(lastExtDataSerial));
  return url.toString();
}

export function buildLegacySendInstantMessageBody({
  netName,
  callsign,
  operatorName,
  message,
}: {
  netName: string;
  callsign: string;
  operatorName?: string;
  message: string;
}): string {
  const params = new URLSearchParams();
  params.set('NetName', netName);
  // Per Wireshark capture: AIM send uses the bare client callsign
  // (CALLSIGN-Name) WITHOUT the " - v<version>" suffix.
  params.set('Callsign', formatLegacyClientCallsign(callsign, operatorName));
  params.set('IsNetControl', LEGACY_IS_NET_CONTROL_FLAG);
  params.set('Message', message);
  return params.toString();
}

export function buildLegacyUnsubscribeUrl({
  serverName,
  netName,
  callsign,
  operatorName,
}: {
  serverName: string;
  netName: string;
  callsign: string;
  operatorName?: string;
}): string {
  const host = getLegacyServerHost(serverName);
  const url = new URL(`http://${host}${LEGACY_BASE_PATH}/UnsubscribeFromNet.php`);
  url.searchParams.set('Callsign', formatLegacyMonitorCallsign(callsign, operatorName));
  url.searchParams.set('NetName', netName);
  return url.toString();
}

function parseMonitor(el: ReturnType<typeof parseXmlToTree>): NetLoggerMonitor {
  return {
    callsign: getChildText(el, 'Callsign'),
    lastUpdate: getChildText(el, 'lastupdate'),
    monitorIndex: parseInt(getChildText(el, 'MonitorIndex'), 10) || 0,
    operator: getChildText(el, 'Operator'),
    version: getChildText(el, 'Version'),
    aimGroupIgnoreStatus: getChildText(el, 'AIMGroupIgnoreStatus') === 'TRUE',
    offlineStatus: getChildText(el, 'OfflineStatus') === 'TRUE',
  };
}

export function parseMonitorsXml(xml: string): MonitorsResponse {
  const root = parseXmlToTree(xml);
  const header = parseHeader(root);
  checkXmlError(root);
  const monitorList = getChild(root, 'MonitorList');
  if (!monitorList) {
    throw new Error('NetLogger XML response missing <MonitorList> element');
  }

  const serverName = getChildText(monitorList, 'ServerName');
  const netName = getChildText(monitorList, 'NetName');
  const responseCode = getChildText(monitorList, 'ResponseCode');
  const monitorCount = parseInt(getChildText(monitorList, 'MonitorCount'), 10) || 0;
  const monitorEls = getChildren(monitorList, 'Monitor');
  const monitors = monitorEls.map(parseMonitor);

  return { ...header, serverName, netName, responseCode, monitorCount, monitors };
}

// ── HTTP Fetch ───────────────────────────────────────────────────────

async function netloggerFetch(endpoint: string, params?: Record<string, string>): Promise<string> {
  const url = buildNetloggerApiUrl(endpoint, params);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Accept': 'application/xml, text/xml, */*',
      'User-Agent': USER_AGENT,
    },
  });

  if (response.status === 429) {
    throw new Error(`NetLogger API rate-limited (429) — too many requests. Back off and retry in a minute.`);
  }

  if (!response.ok) {
    throw new Error(`NetLogger API error: ${response.status} ${response.statusText} for ${endpoint}`);
  }

  return response.text();
}

type LegacyProxyResponse = {
  success: boolean;
  response_code?: string;
  error?: string | null;
};

async function legacyNetloggerFetch(url: string, options?: RequestInit): Promise<string> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Accept': 'www/source, text/html, */*',
      'Content-Type': 'application/x-www-form-urlencoded',
      // NetLogger's legacy CGI endpoints returned 404 when a non-desktop
      // User-Agent was supplied during capture reproduction. Match the desktop
      // client by not setting User-Agent on these legacy requests.
      ...(options?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`NetLogger legacy API error: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function assertLegacySuccess(text: string, action: string): LegacyNetLoggerResult {
  const result = parseLegacyNetLoggerResponse(text);
  if (!result.success) {
    throw new Error(result.error || `NetLogger ${action} failed`);
  }
  return result;
}

function joinUrl(baseUrl: string, path: string): string {
  // Same-origin proxy rewrite only for local dev/preview (see backendClient.ts)
  if (typeof window !== 'undefined' && baseUrl.includes('api.log2goapp.net')) {
    const origin = window.location.origin;
    const isLocalDev = origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes(':54337');
    if (isLocalDev) {
      return `/log2go-api${path}`;
    }
  }
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayFromDetail(detail: string): number | undefined {
  const match = detail.match(/Wait\s+([0-9.]+)s/i);
  if (!match) return undefined;
  return (Number.parseFloat(match[1]) + 0.5) * 1000;
}

async function postLegacyProxy(
  backendBaseUrl: string,
  path: string,
  payload: Record<string, string | undefined>,
  action: string,
): Promise<LegacyNetLoggerResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(joinUrl(backendBaseUrl, path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let body: LegacyProxyResponse | { detail?: string } | undefined;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }

    if (!response.ok) {
      const detail = body && 'detail' in body && typeof body.detail === 'string' ? body.detail : text;
      const retryDelay = response.status === 429 ? retryDelayFromDetail(detail) : undefined;
      if (attempt === 0 && retryDelay !== undefined) {
        await sleep(retryDelay);
        continue;
      }
      throw new Error(detail || `NetLogger ${action} proxy failed with status ${response.status}`);
    }

    const proxy = body as LegacyProxyResponse | undefined;
    if (!proxy?.success) {
      throw new Error(proxy?.error || `NetLogger ${action} failed`);
    }

    return {
      success: true,
      responseCode: proxy.response_code || '200 OK',
      error: proxy.error || undefined,
      raw: text,
    };
  }
  throw new Error(`NetLogger ${action} failed after retry`);
}

// ── Public API ───────────────────────────────────────────────────────

export async function fetchActiveNets(): Promise<ActiveNetsResponse> {
  const xml = await netloggerFetch('GetActiveNets.php');
  return parseActiveNetsXml(xml);
}

export async function fetchPastNets(count?: number): Promise<PastNetsResponse> {
  const params: Record<string, string> = {};
  if (count !== undefined) {
    params.count = String(count);
  }
  const xml = await netloggerFetch('GetPastNets.php', Object.keys(params).length > 0 ? params : undefined);
  return parsePastNetsXml(xml);
}

export async function fetchCheckins(serverName: string, netName: string): Promise<CheckinsResponse> {
  const xml = await netloggerFetch('GetCheckins.php', {
    ServerName: serverName,
    NetName: netName,
  });
  return parseCheckinsXml(xml);
}

export async function fetchPastNetCheckins(
  serverName: string,
  netName: string,
  netId: string,
): Promise<CheckinsResponse> {
  const xml = await netloggerFetch('GetPastNetCheckins.php', {
    ServerName: serverName,
    NetName: netName,
    NetID: netId,
  });
  return parseCheckinsXml(xml);
}

export async function fetchAIM(
  serverName: string,
  netName: string,
  afterId: number = 0,
): Promise<AIMResponse> {
  const xml = await netloggerFetch('GetAIM.php', {
    ServerName: serverName,
    NetName: netName,
    AIMRequestedId: String(afterId),
  });
  return parseAIMXml(xml);
}

/**
 * Fetch live AIM via the subscribed GetUpdates3.php stream (through the backend).
 *
 * Unlike the public GetAIM.php transcript (which is capped and stale), GetUpdates3
 * is the live subscribed update stream that the desktop client uses. It carries
 * fresh AIM in the <!-- IM Start --> section. This should be used while subscribed
 * to a net instead of the public GetAIM.php endpoint.
 */
export async function fetchUpdates3({
  backendBaseUrl,
  serverName,
  netName,
  imSerial = 0,
  lastExtDataSerial = 0,
}: {
  backendBaseUrl: string;
  serverName: string;
  netName: string;
  imSerial?: number;
  lastExtDataSerial?: number;
}): Promise<Updates3Response> {
  const response = await fetch(joinUrl(backendBaseUrl, '/api/v1/netlogger/updates'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      server_name: serverName,
      net_name: netName,
      im_serial: imSerial,
      last_ext_data_serial: lastExtDataSerial,
    }),
  });
  const text = await response.text();
  let body: Updates3Response | { detail?: string } | undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const detail = body && 'detail' in body && typeof body.detail === 'string' ? body.detail : text;
    throw new Error(detail || `NetLogger updates failed with status ${response.status}`);
  }
  return body as Updates3Response;
}

export async function sendAIMMessage({
  serverName,
  netName,
  callsign,
  operatorName,
  message,
  backendBaseUrl,
}: {
  serverName: string;
  netName: string;
  callsign: string;
  operatorName?: string;
  message: string;
  sessionKey?: string;
  backendBaseUrl?: string;
}): Promise<SendAIMMessageResult> {
  const proxyBaseUrl = backendBaseUrl?.trim();
  const result = proxyBaseUrl
    ? await postLegacyProxy(proxyBaseUrl, '/api/v1/netlogger/send-aim', {
      server_name: serverName,
      net_name: netName,
      callsign,
      operator_name: operatorName,
      message,
    }, 'AIM send')
    : await (async () => {
      const host = getLegacyServerHost(serverName);
      const body = buildLegacySendInstantMessageBody({ netName, callsign, operatorName, message });
      const text = await legacyNetloggerFetch(`http://${host}${LEGACY_BASE_PATH}/SendInstantMessage.php`, {
        method: 'POST',
        body,
      });
      return assertLegacySuccess(text, 'AIM send');
    })();
  return {
    responseCode: result.responseCode,
    error: result.error,
    success: result.success,
  };
}

export async function requestAIMSessionKey({
  serverName,
  netName,
  callsign,
  operatorName,
  backendBaseUrl,
}: {
  serverName: string;
  netName: string;
  callsign: string;
  operatorName?: string;
  backendBaseUrl?: string;
}): Promise<AIMSessionResult> {
  const proxyBaseUrl = backendBaseUrl?.trim();
  const result = proxyBaseUrl
    ? await postLegacyProxy(proxyBaseUrl, '/api/v1/netlogger/subscribe', {
      server_name: serverName,
      net_name: netName,
      callsign,
      operator_name: operatorName,
    }, 'net subscribe')
    : await (async () => {
      const text = await legacyNetloggerFetch(buildLegacySubscribeUrl({
        serverName,
        netName,
        callsign,
        operatorName,
      }));
      return assertLegacySuccess(text, 'net subscribe');
    })();
  return {
    responseCode: result.responseCode,
    success: result.success,
    error: result.error,
    // The captured desktop protocol did not return a separate AIM key. A successful
    // SubscribeToNet call itself is the write-capable session for SendInstantMessage.
    aimSessionKey: 'legacy-subscribe-ok',
  };
}

export async function unsubscribeFromNet({
  serverName,
  netName,
  callsign,
  operatorName,
  backendBaseUrl,
}: {
  serverName: string;
  netName: string;
  callsign: string;
  operatorName?: string;
  backendBaseUrl?: string;
}): Promise<LegacyNetLoggerResult> {
  const proxyBaseUrl = backendBaseUrl?.trim();
  if (proxyBaseUrl) {
    return postLegacyProxy(proxyBaseUrl, '/api/v1/netlogger/unsubscribe', {
      server_name: serverName,
      net_name: netName,
      callsign,
      operator_name: operatorName,
    }, 'net unsubscribe');
  }
  const text = await legacyNetloggerFetch(buildLegacyUnsubscribeUrl({ serverName, netName, callsign, operatorName }));
  return assertLegacySuccess(text, 'net unsubscribe');
}

export function scheduleDelayedUnsubscribeBeacon({
  serverName,
  netName,
  callsign,
  operatorName,
  backendBaseUrl,
  sessionId,
  delaySeconds = 60,
}: {
  serverName: string;
  netName: string;
  callsign: string;
  operatorName?: string;
  backendBaseUrl?: string;
  sessionId: string;
  delaySeconds?: number;
}): boolean {
  const proxyBaseUrl = backendBaseUrl?.trim();
  if (!proxyBaseUrl || typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
  const body = JSON.stringify({
    server_name: serverName,
    net_name: netName,
    callsign,
    operator_name: operatorName,
    session_id: sessionId,
    delay_seconds: delaySeconds,
  });
  const blob = new Blob([body], { type: 'application/json' });
  return navigator.sendBeacon(joinUrl(proxyBaseUrl, '/api/v1/netlogger/unsubscribe-later'), blob);
}

export async function cancelDelayedUnsubscribe({
  backendBaseUrl,
  sessionId,
}: {
  backendBaseUrl?: string;
  sessionId: string;
}): Promise<void> {
  const proxyBaseUrl = backendBaseUrl?.trim();
  if (!proxyBaseUrl) return;
  await fetch(joinUrl(proxyBaseUrl, '/api/v1/netlogger/cancel-unsubscribe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
    keepalive: true,
  });
}

export async function fetchMonitors(serverName: string, netName: string): Promise<MonitorsResponse> {
  const xml = await netloggerFetch('GetMonitors.php', {
    ServerName: serverName,
    NetName: netName,
  });
  return parseMonitorsXml(xml);
}

// ── Flat List Helpers ────────────────────────────────────────────────

export function flattenActiveNets(response: ActiveNetsResponse): FlatActiveNet[] {
  const result: FlatActiveNet[] = [];
  for (const server of response.servers) {
    for (const net of server.nets) {
      result.push({ ...net, serverName: server.serverName, source: 'netlogger' });
    }
  }
  return result;
}

export function flattenPastNets(response: PastNetsResponse): FlatPastNet[] {
  const result: FlatPastNet[] = [];
  for (const server of response.servers) {
    for (const net of server.nets) {
      result.push({ ...net, serverName: server.serverName });
    }
  }
  return result;
}