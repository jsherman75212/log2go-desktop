/**
 * NetLogger State Management
 *
 * Manages the state for NetLogger monitoring mode:
 * - Browsing active nets
 * - Selecting and monitoring a net
 * - Polling for check-ins, AIM messages, and monitors
 * - Pre-filling contact data from check-in entries
 *
 * This module is designed to be used alongside LoggingFlowState in the App.
 * The UI components will read from this state and dispatch actions to update it.
 */

import type {
  ActiveNetsResponse,
  CheckinsResponse,
  AIMResponse,
  MonitorsResponse,
  NetLoggerCheckin,
  NetLoggerAIMMessage,
  NetLoggerMonitor,
  SelectedNet,
  NetLoggerMode,
  FlatActiveNet,
} from '../domain/netloggerTypes';
import { parseCheckinStatus, parseFrequencyMHz } from '../domain/netloggerTypes';
import { flattenActiveNets } from '../services/netloggerClient';

// ── State Shape ────────────────────────────────────────────────────────

export type NetLoggerPollingState = 'idle' | 'loading' | 'loaded' | 'error';

export type NetLoggerState = {
  /** Current mode: idle (not connected), browsing (viewing nets), monitoring (watching a net) */
  mode: NetLoggerMode;

  /** Last error message, if any */
  error?: string;

  // ── Active Nets ──────────────────────────────────────────────────

  /** All active nets across all servers, flattened for display */
  activeNets: FlatActiveNet[];

  /** Loading state for the active nets list */
  netsLoadingState: NetLoggerPollingState;

  /** Timestamp of last successful nets fetch */
  netsLastFetchedAt?: string;

  // ── Selected/Monitored Net ───────────────────────────────────────

  /** The net we're currently monitoring (null when idle or browsing) */
  selectedNet?: SelectedNet;

  // ── Check-ins ────────────────────────────────────────────────────

  /** Check-in list for the monitored net */
  checkins: NetLoggerCheckin[];

  /** Loading state for check-ins */
  checkinsLoadingState: NetLoggerPollingState;

  /** Timestamp of last successful check-ins fetch */
  checkinsLastFetchedAt?: string;

  // ── AIM Chat ─────────────────────────────────────────────────────

  /** Accumulated AIM messages (newest last) */
  aimMessages: NetLoggerAIMMessage[];

  /** Loading state for AIM messages */
  aimLoadingState: NetLoggerPollingState;

  /** Highest AIM message ID seen so far (for incremental polling) */
  aimLastId: number;

  /** Timestamp of last successful AIM fetch */
  aimLastFetchedAt?: string;

  // ── Monitors ─────────────────────────────────────────────────────

  /** Monitor list for the monitored net */
  monitors: NetLoggerMonitor[];

  /** Loading state for monitors */
  monitorsLoadingState: NetLoggerPollingState;

  /** Timestamp of last successful monitors fetch */
  monitorsLastFetchedAt?: string;
};

// ── Initial State ──────────────────────────────────────────────────────

export function createInitialNetLoggerState(): NetLoggerState {
  return {
    mode: 'idle',
    activeNets: [],
    netsLoadingState: 'idle',
    checkins: [],
    checkinsLoadingState: 'idle',
    aimMessages: [],
    aimLoadingState: 'idle',
    aimLastId: 0,
    monitors: [],
    monitorsLoadingState: 'idle',
  };
}

// ── Actions ────────────────────────────────────────────────────────────

/**
 * Start browsing active nets. Transitions from idle → browsing.
 */
export function startBrowsingNets(state: NetLoggerState): NetLoggerState {
  return {
    ...state,
    mode: 'browsing',
    netsLoadingState: 'loading',
    error: undefined,
  };
}

/**
 * Active nets fetch succeeded. Updates the nets list.
 */
export function activeNetsLoaded(
  state: NetLoggerState,
  response: ActiveNetsResponse,
): NetLoggerState {
  return {
    ...state,
    activeNets: flattenActiveNets(response),
    netsLoadingState: 'loaded',
    netsLastFetchedAt: new Date().toISOString(),
    error: undefined,
  };
}

/**
 * Active nets fetch failed.
 */
export function activeNetsFailed(state: NetLoggerState, error: string): NetLoggerState {
  return {
    ...state,
    netsLoadingState: 'error',
    error,
  };
}

/**
 * Select a net to monitor. Transitions from browsing → monitoring.
 * Resets check-ins, AIM, and monitors for the new net.
 */
export function selectNet(state: NetLoggerState, net: SelectedNet): NetLoggerState {
  return {
    ...state,
    mode: 'monitoring',
    selectedNet: net,
    checkins: [],
    checkinsLoadingState: 'loading',
    aimMessages: [],
    aimLoadingState: 'loading',
    aimLastId: 0,
    monitors: [],
    monitorsLoadingState: 'loading',
    error: undefined,
  };
}

/**
 * Stop monitoring a net. Returns to idle mode.
 */
export function stopMonitoring(state: NetLoggerState): NetLoggerState {
  return {
    ...state,
    mode: 'idle',
    selectedNet: undefined,
    checkins: [],
    checkinsLoadingState: 'idle',
    aimMessages: [],
    aimLoadingState: 'idle',
    aimLastId: 0,
    monitors: [],
    monitorsLoadingState: 'idle',
    error: undefined,
  };
}

/**
 * Check-ins fetch succeeded. Replaces the check-in list.
 */
export function checkinsLoaded(
  state: NetLoggerState,
  response: CheckinsResponse,
): NetLoggerState {
  return {
    ...state,
    checkins: response.checkins,
    checkinsLoadingState: 'loaded',
    checkinsLastFetchedAt: new Date().toISOString(),
  };
}

/**
 * Check-ins fetch failed.
 */
export function checkinsFailed(state: NetLoggerState, error: string): NetLoggerState {
  return {
    ...state,
    checkinsLoadingState: 'error',
    error,
  };
}

/**
 * AIM messages fetch succeeded. Merges messages by ID, preserving older
 * transcript entries and appending newer ones in ascending ID order.
 */
export function aimMessagesLoaded(
  state: NetLoggerState,
  response: AIMResponse,
): NetLoggerState {
  const messagesById = new Map<number, NetLoggerAIMMessage>();
  for (const message of state.aimMessages) {
    messagesById.set(message.id, message);
  }
  for (const message of response.messages) {
    messagesById.set(message.id, message);
  }

  const aimMessages = [...messagesById.values()].sort((a, b) => a.id - b.id);
  const maxId = aimMessages.reduce(
    (max, msg) => Math.max(max, msg.id),
    state.aimLastId,
  );

  return {
    ...state,
    aimMessages,
    aimLoadingState: 'loaded',
    aimLastId: maxId,
    aimLastFetchedAt: new Date().toISOString(),
  };
}

/**
 * AIM fetch failed.
 */
export function aimMessagesFailed(state: NetLoggerState, error: string): NetLoggerState {
  return {
    ...state,
    aimLoadingState: 'error',
    error,
  };
}

/**
 * Monitors fetch succeeded. Replaces the monitor list.
 */
export function monitorsLoaded(
  state: NetLoggerState,
  response: MonitorsResponse,
): NetLoggerState {
  return {
    ...state,
    monitors: response.monitors,
    monitorsLoadingState: 'loaded',
    monitorsLastFetchedAt: new Date().toISOString(),
  };
}

/**
 * Monitors fetch failed.
 */
export function monitorsFailed(state: NetLoggerState, error: string): NetLoggerState {
  return {
    ...state,
    monitorsLoadingState: 'error',
    error,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Convert an active net entry to a SelectedNet for monitoring.
 */
export function activeNetToSelectedNet(net: FlatActiveNet): SelectedNet {
  return {
    serverName: net.serverName,
    netName: net.netName,
    frequency: net.frequency,
    mode: net.mode,
    band: net.band,
    netControl: net.netControl,
    logger: net.logger,
  };
}

/**
 * Pre-fill data from a NetLogger check-in for the Log Contact form.
 * Returns a partial LogContactInput with data from the check-in.
 */
export type CheckinPrefillData = {
  callsign: string;
  name?: string;
  preferredName?: string;
  cityCountry?: string;
  state?: string;
  county?: string;
  grid?: string;
  dxcc?: string;
  country?: string;
  qslInfo?: string;
  remarks?: string;
  memberId?: string;
  frequencyMhz?: number;
  mode?: string;
  band?: string;
  netControl?: string;
  status: ReturnType<typeof parseCheckinStatus>;
};

/**
 * Extract pre-fill data from a NetLogger check-in for Log Contact.
 */
export function extractPrefillFromCheckin(checkin: NetLoggerCheckin): CheckinPrefillData {
  return {
    callsign: checkin.callsign.trim().toUpperCase(),
    name: checkin.firstName.trim() || undefined,
    preferredName: checkin.preferredName.trim() || undefined,
    cityCountry: checkin.cityCountry.trim() || undefined,
    state: checkin.state.trim() || undefined,
    county: checkin.county.trim() || undefined,
    grid: checkin.grid.trim().toUpperCase() || undefined,
    dxcc: checkin.dxcc.trim() || undefined,
    country: checkin.country.trim() || undefined,
    qslInfo: checkin.qslInfo.trim() || undefined,
    remarks: checkin.remarks.trim() || undefined,
    memberId: checkin.memberId.trim() || undefined,
    frequencyMhz: parseFrequencyMHz(checkin.grid) || undefined,
    status: parseCheckinStatus(checkin.status),
  };
}

/**
 * Check if a check-in is currently "available" (not checked out or unavailable).
 */
export function isCheckinAvailable(checkin: NetLoggerCheckin): boolean {
  const status = parseCheckinStatus(checkin.status);
  return !status.isCheckedOut && !status.isUnavailable && !status.isNotResponding;
}

/**
 * Format a net's frequency for display.
 * Shows MHz for numeric frequencies, raw text for digital mode references.
 */
export function formatFrequency(frequency: string): string {
  const mhz = parseFrequencyMHz(frequency);
  if (mhz !== undefined) {
    // Format with appropriate decimal places
    if (mhz >= 1000) {
      return `${mhz.toFixed(0)} kHz`;
    }
    if (Number.isInteger(mhz)) {
      return `${mhz.toFixed(1)} MHz`;
    }
    return `${mhz.toFixed(3)} MHz`;
  }
  return frequency; // non-numeric like "REF091 C" or "skywarnyouth.net"
}

/**
 * Format a net's display name for the Active Nets list.
 * Includes band, frequency, and NCS callsign.
 */
export function formatNetDisplayName(net: FlatActiveNet): string {
  const freq = formatFrequency(net.frequency);
  const ncs = net.netControl ? ` — ${net.netControl}` : '';
  return `${net.netName} (${net.band} ${freq})${ncs}`;
}

/**
 * Get the number of online (non-offline) monitors.
 */
export function getOnlineMonitorCount(monitors: NetLoggerMonitor[]): number {
  return monitors.filter((m) => !m.offlineStatus).length;
}

/**
 * Sort check-ins for display: by serial number (check-in order).
 * Always starts ordered by number — no special grouping.
 */
export function sortCheckinsForDisplay(checkins: NetLoggerCheckin[]): NetLoggerCheckin[] {
  return [...checkins].sort((a, b) => (a.serialNo || 0) - (b.serialNo || 0));
}