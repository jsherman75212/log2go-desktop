/**
 * NetLogger API Types
 *
 * Type definitions for the NetLogger REST/XML API responses.
 * Base URL: https://www.netlogger.org/api/
 *
 * The NetLogger system is an amateur radio net logging platform.
 * This module covers the READ-ONLY monitoring API — viewing active nets,
 * check-ins, AIM chat messages, and monitor lists.
 */

// ── API Response Envelope ────────────────────────────────────────────

export type NetLoggerApiHeader = {
  creationDateUtc: string;
  copyright: string;
  apiVersion: string;
  timeZone: string;
};

// ── Active & Past Nets ──────────────────────────────────────────────

export type NetLoggerNet = {
  netName: string;
  altNetName: string;
  frequency: string; // MHz or text like "REF091 C"
  logger: string; // e.g., "KI4YTV-SPECIAL ED - v3.1.7W"
  netControl: string; // NCS callsign
  date: string; // net start time, e.g., "2026-06-28 23:00:10"
  mode: string; // SSB, FM, CW, D-Star, C4FM, etc.
  band: string; // 40m, 80m, 2m, WIRES-X, etc.
  subscriberCount: number;
};

export type NetLoggerActiveNet = NetLoggerNet & {
  // Active nets have no NetID
};

export type NetLoggerPastNet = NetLoggerNet & {
  netId: string; // unique ID for past nets, e.g., "424852"
  aim: boolean;
  updateInterval: number; // ms
  srcIp: string;
  lastActivity: string;
  inactivityTimer: number; // minutes
  closedAt: string;
  assassinated: boolean;
  miscNetParameters: string;
};

export type NetLoggerServer<TNet extends NetLoggerNet = NetLoggerNet> = {
  serverName: string; // e.g., "NETLOGGER", "NETLOGGER2", etc.
  activeNetCount?: number; // for active servers
  pastNetCount?: number; // for past servers
  nets: TNet[];
};

export type ActiveNetsResponse = NetLoggerApiHeader & {
  servers: NetLoggerServer<NetLoggerNet>[];
  responseCode: string;
};

export type PastNetsResponse = NetLoggerApiHeader & {
  servers: NetLoggerServer<NetLoggerPastNet>[];
  responseCode: string;
};

// ── Check-ins ───────────────────────────────────────────────────────

export type NetLoggerCheckin = {
  serialNo: number; // check-in sequence number
  callsign: string; // e.g., "WA5CAT"
  state: string; // 2-letter state/province, e.g., "NM"
  remarks: string;
  qslInfo: string; // e.g., "Q N QRZ"
  cityCountry: string; // e.g., "Alamogordo"
  firstName: string; // full name, e.g., "Ed J Denton"
  status: string; // e.g., "(nc)", "(rel)", "(a01),(rel)", " "
  county: string; // e.g., "OTERO"
  grid: string; // e.g., "DM72" or "EM71aj"
  street: string;
  zip: string;
  memberId: string; // club member ID, e.g., "11055"
  country: string; // e.g., "United States"
  dxcc: string; // DXCC entity number, e.g., "291"
  preferredName: string; // e.g., "ED"
};

export type CheckinsResponse = NetLoggerApiHeader & {
  serverName: string;
  netName: string;
  responseCode: string;
  checkinCount: number;
  pointer: number; // current "highlighted" check-in serial number
  checkins: NetLoggerCheckin[];
};

// ── AIM (Almost Instant Messages) ───────────────────────────────────

export type NetLoggerAIMMessage = {
  id: number; // unique, incrementing message ID
  callsign: string; // sender callsign + name, e.g., "WA5CAT CAT"
  message: string; // may contain BBCode
  aimTime: string; // timestamp, e.g., "2026-06-29 00:22:12"
  ipAddr: string; // sender IP
};

export type AIMResponse = NetLoggerApiHeader & {
  serverName: string;
  netName: string;
  aimRequestedId: number; // the requestedId from the query
  responseCode: string;
  aimMessageCount: number;
  messages: NetLoggerAIMMessage[];
};

// ── Monitors ────────────────────────────────────────────────────────

export type NetLoggerMonitor = {
  callsign: string; // full string with name + version, e.g., "WA5CAT CAT - v3.1.7W"
  lastUpdate: string; // e.g., "2026-06-29 00:21:43"
  monitorIndex: number;
  operator: string; // e.g., "WA5CAT CAT"
  version: string; // e.g., "v3.1.7W"
  aimGroupIgnoreStatus: boolean;
  offlineStatus: boolean;
  role?: string; // Log2Go role: NCS, CO_NCS, LOGGER, RELAY, MONITOR
};

export type MonitorsResponse = NetLoggerApiHeader & {
  serverName: string;
  netName: string;
  responseCode: string;
  monitorCount: number;
  monitors: NetLoggerMonitor[];
};

// ── Flat (display) helpers ──────────────────────────────────────────

export type NetSource = 'log2go' | 'netlogger';

export type FlatActiveNet = NetLoggerNet & {
  serverName: string;
  /** Which net server hosts this net. Defaults to 'netlogger' for legacy entries. */
  source?: NetSource;
  /** Log2Go numeric net id (present when source === 'log2go'). */
  net_id?: number;
};

export type FlatPastNet = NetLoggerPastNet & { serverName: string };

// ── App-level State ─────────────────────────────────────────────────

export type NetLoggerMode = 'idle' | 'browsing' | 'monitoring';

export type SelectedNet = {
  serverName: string;
  netName: string;
  netId?: string; // for past nets
  frequency: string;
  mode: string;
  band: string;
  netControl: string;
  logger: string;
  /** Which net server hosts this net ('log2go' | 'netlogger'). Defaults to 'netlogger'. */
  source?: NetSource;
  /** Log2Go numeric net id (present when source === 'log2go'). */
  net_id?: number;
};

export type NetLoggerPollingConfig = {
  netsRefreshInterval: number; // ms, default 60000
  checkinsRefreshInterval: number; // ms, default 20000
  aimRefreshInterval: number; // ms, default 20000
  monitorsRefreshInterval: number; // ms, default 30000
};

export const DEFAULT_POLLING_CONFIG: NetLoggerPollingConfig = {
  netsRefreshInterval: 60_000, // 1 minute
  checkinsRefreshInterval: 10_000, // 10 seconds
  aimRefreshInterval: 10_000, // 10 seconds
  monitorsRefreshInterval: 30_000, // 30 seconds
};

/**
 * Parse NetLogger status string into structured flags.
 * Status can contain: (nc), (log), (rel), (vip), (c/o), (n/r), (u), (a01), etc.
 * Also: M/P indicators, award codes.
 */
export function parseCheckinStatus(status: string): {
  isCurrentlyOperating: boolean;
  isNetControl: boolean;
  isLogger: boolean;
  isRelay: boolean;
  isVip: boolean;
  isCheckedOut: boolean;
  isNotHeard: boolean;
  isNeeded: boolean;
  isNeededNext: boolean;
  isWorked: boolean;
  isNotResponding: boolean;
  isUnavailable: boolean;
  isOperatorStation: boolean;
  mobilePortableStatus: 'mobile' | 'portable' | undefined;
  rawStatus: string;
} {
  const s = status.toLowerCase().trim();
  const has = (token: string) => s.includes(token);
  return {
    // Current-operating usually comes from the CheckinList pointer rather than
    // a status token, but accept common explicit forms if a feed includes them.
    isCurrentlyOperating: has('(cur)') || has('(operating)'),
    // Accept both NetLogger-style "(nc)" and Log2Go bare "NCS" / "Co-NCS"
    isNetControl: has('(nc)') || s === 'ncs' || has('co-ncs') || has('co_ncs'),
    isLogger: has('(log)') || s === 'logger',
    isRelay: has('(rel)') || s === 'relay',
    isVip: has('(vip)'),
    isCheckedOut: has('(c/o)'),
    isNotHeard: has('(n/h)'),
    isNeeded: has('(n)') && !has('(nxt)') && !has('(n/h)') && !has('(n/r)'),
    isNeededNext: has('(nxt)'),
    isWorked: has('(w)'),
    isNotResponding: has('(n/r)'),
    isUnavailable: has('(u)'),
    isOperatorStation: has('(op)'),
    mobilePortableStatus: has('/m')
      ? 'mobile'
      : has('/p')
        ? 'portable'
        : undefined,
    rawStatus: status,
  };
}

/**
 * Parse NetLogger frequency string to a number in MHz.
 * Most frequencies are numeric (e.g., "7.185", "14.272", "3916.00").
 * Some are text (e.g., "REF091 C", "RM28941", "skywarnyouth.net") for digital modes.
 * Returns undefined for non-numeric frequencies.
 */
export function parseFrequencyMHz(frequency: string): number | undefined {
  const num = parseFloat(frequency);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}