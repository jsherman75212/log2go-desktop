import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  fetchActiveNets,
  fetchAIM,
  fetchCheckins,
  fetchMonitors,
  fetchUpdates3,
  flattenActiveNets,
  requestAIMSessionKey,
  cancelDelayedUnsubscribe,
  scheduleDelayedUnsubscribeBeacon,
  sendAIMMessage,
  unsubscribeFromNet,
} from './services/netloggerClient';
import {
  fetchLog2GoNets,
  getLog2GoMonitors,
  getLog2GoUpdates,
  sendLog2GoAIM,
  subscribeLog2GoNet,
  unsubscribeLog2GoNet,
  addLog2GoCheckin,
  promoteUser,
  removeLog2GoCheckin,
  fetchPastNets,
  fetchNetHistory,
  openLog2GoNet,
  fetchNetProfiles,
  saveNetProfile,
  closeLog2GoNet,
  type Log2GoCheckin as Log2GoRosterCheckin,
  type Log2GoAIMMessage as Log2GoAIMMsg,
  type Log2GoMonitor as Log2GoMon,
  type Log2GoNet as Log2GoActiveNet,
  type PastNetInfo,
  type PastNetDetail,
  type NetProfile,
} from './services/log2goNetClient';
import type {
  FlatActiveNet,
  NetLoggerAIMMessage,
  NetLoggerCheckin,
  NetLoggerMonitor,
  NetSource,
  SelectedNet,
} from './domain/netloggerTypes';
import { createInitialLoggingFlowState } from './application/loggingFlow';
import type { LoggingFlowState } from './application/loggingFlow';
import { logInDesktopAccount, logOutDesktopAccount } from './application/desktopAccountSession';
import { logWebContact } from './application/webLogging';
import { loadPersistentLoggingState, savePersistentLoggingState } from './application/persistence';
import { APP_VERSION } from './appVersion';
import { FeedbackModal } from './components/FeedbackModal';
import { createDesktopPersistenceStores } from './services/browserKeyValueStore';
import {
  createContact,
  getAccountProfile,
  getStationProfiles,
  listContacts,
  login,
  exportAdif,
  listApiKeys,
  saveApiKey,
  deleteApiKey,
  listServiceCredentials,
  saveServiceCredential,
  updateServiceCredential,
  disableServiceCredential,
  qrzLookup,
  saveStationProfiles,
  fetchArrlContests,
  updateContact as backendUpdateContact,
  deleteContact as backendDeleteContact,
  uploadToServices,
  importAdif,
  updateAccountPassword,
  type ServiceSyncReport,
  checkLotwCertificate,
  uploadLotwCertificate,
  type LotwCertStatus,
  getSubscriptionPrices,
  getSubscriptionStatus,
  createCheckoutSession,
  createPortalSession,
} from './services/backendClient';
import type { AccountProfile, BackendContactResponse, ApiKeyOut, ContestCalendarEvent, ServiceCredentialOut, QrzLookupResult, SubscriptionPrice, SubscriptionStatus } from './services/backendClient';
import {
  draftFromCheckin,
  emptyDraft,
  rosterDensityClass,
  rosterDensityOptions,
  rosterRowKey,
  sortRosterCheckins,
  statusClass,
  toSelectedNet,
  workedFlag,
  type ContactDraft,
  type RosterDensity,
} from './application/desktopNetloggerGlue';
import {
  desktopSettingsSections,
  generalLogFieldGroups,
} from './application/desktopTabContent';
import {
  addProfile as addProfileAction,
  activateProfile as activateProfileAction,
  deleteProfile as deleteProfileAction,
  updateProfile as updateProfileAction,
} from './application/loggingFlow';
import type {
  CreateProfileInput,
  UpdateProfileInput,
} from './domain/stationProfiles';
import { getActiveProfile } from './domain/stationProfiles';
import type { Contact, StationProfile, StationProfileCollection, MobilePortableStatus } from './domain/models';
import { AuthGate } from './application/authGate';
import { MatrixClock } from './application/matrixClock';
import { useOfflineStatus, type OfflineStatus } from './application/useOfflineStatus';
import { offlineDb, type DesktopBridge } from './services/offlineDb';
import { setBackendSettings } from './application/loggingFlow';
import './styles.css';

// NetLogger parity features
import { ContextMenu, buildRosterMenu, buildMonitorMenu, type MenuItem, type RosterMenuContext, type MonitorMenuContext } from './components/ContextMenu';
import { usePreferences, PreferencesModal, DEFAULT_PREFERENCES, type Log2GoPreferences } from './components/Preferences';
import { useKeyboardShortcuts, useStationHighlighter, parseSlashCodes, type HighlighterMode } from './components/NetLoggerShortcuts';
import { renderAimText, getAimMessageClass } from './components/AimMessageRenderer';
import { DashboardTab } from './dashboard';
import { DxSpotsPanel } from './components/DxSpotsPanel';
import { draftFromDxSpot, type DXSpot } from './services/dxSpotsClient';

// Desktop-only imports


type AppTab = 'dashboard' | 'netlogger' | 'general' | 'contest' | 'logbook' | 'settings' | 'dxspots';

const desktopPersistenceStores = createDesktopPersistenceStores();
const APP_TAB_KEY = 'log2go.web.activeTab.v1';
const CONTEST_SESSION_KEY = 'log2go.web.contestSession.v1';
const NETLOGGER_SESSION_KEY = 'log2go.web.netloggerSession.v1';
const BROWSER_SESSION_KEY = 'log2go.web.browserSessionId.v1';
const ACTIVITY_AWAY_UNSUBSCRIBE_MS = 60_000;
const NETLOGGER_JOINED_POLL_DELAY_MS = 15_000;
const NETLOGGER_JOINED_POLL_CYCLE_MS = 45_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ProfileValidationResult =
  | { ok: true }
  | { ok: false; reason: 'no-profiles' | 'incomplete-profile'; message: string };

function validateStationProfileForLogging(
  state: LoggingFlowState,
): ProfileValidationResult {
  const profiles = state.profileCollection.profiles;
  if (profiles.length === 0) {
    return {
      ok: false,
      reason: 'no-profiles',
      message: 'Create a station profile before logging contacts. Go to Settings to create one.',
    };
  }

  const active = state.stationProfile;
  const hasCallsign = (active.callsign?.trim().length ?? 0) > 0;
  const hasLocation =
    (active.homeGrid?.trim().length ?? 0) > 0 ||
    (active.state?.trim().length ?? 0) > 0 ||
    (active.county?.trim().length ?? 0) > 0;
  const hasAutoGps = active.autoGps ?? false;

  if (!hasCallsign || (!hasLocation && !hasAutoGps && !(active.locationOverride ?? false))) {
    return {
      ok: false,
      reason: 'incomplete-profile',
      message: 'Select a station profile with location info before logging contacts. Go to Settings to select or create one.',
    };
  }

  return { ok: true };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert GetUpdates3 AIM time (YYYYMMDDHHMMSS) to display format (YYYY-MM-DD HH:MM:SS)
 * to match the public GetAIM.php transcript format.
 */
function formatUpdates3AimTime(compact: string): string {
  // YYYYMMDDHHMMSS -> YYYY-MM-DD HH:MM:SS
  if (compact.length >= 14) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)} ${compact.slice(8, 10)}:${compact.slice(10, 12)}:${compact.slice(12, 14)}`;
  }
  return compact;
}

/** Convert a Log2Go net-server checkin into the NetLogger display shape the roster UI expects. */
function log2goCheckinToRoster(c: Log2GoRosterCheckin): NetLoggerCheckin {
  return {
    serialNo: c.serial_no ?? 0,
    callsign: c.callsign,
    state: c.state ?? '',
    remarks: c.remarks ?? '',
    qslInfo: c.qsl ?? '',
    cityCountry: c.city ?? '',
    firstName: c.first_name ?? '',
    status: c.status ?? '',
    county: c.county ?? '',
    grid: c.grid ?? '',
    street: '',
    zip: '',
    memberId: c.member_id ?? '',
    country: c.country ?? '',
    dxcc: '',
    preferredName: c.first_name?.split(' ')[0] ?? '',
  };
}

/** Convert a Log2Go net-server AIM message into the NetLogger display shape. */
function log2goAimToDisplay(m: Log2GoAIMMsg): NetLoggerAIMMessage {
  return {
    id: m.serial,
    callsign: m.callsign,
    message: m.message,
    aimTime: m.created_at,
    ipAddr: m.ip_address ?? '',
  };
}

/** Convert a Log2Go net-server monitor role code into a display label. */
function log2goRoleLabel(role: string | undefined): string {
  switch ((role ?? '').toUpperCase()) {
    case 'NCS': return 'NCS';
    case 'CO_NCS': return 'Co-NCS';
    case 'LOGGER': return 'Logger';
    case 'RELAY': return 'Relay';
    case 'MONITOR': return 'Monitor';
    default: return '';
  }
}

/** Convert a Log2Go net-server monitor into the NetLogger display shape. */
function log2goMonitorToDisplay(m: Log2GoMon): NetLoggerMonitor {
  const baseName = m.display_name || m.callsign;
  const label = log2goRoleLabel(m.role);
  const callsign = label ? `${baseName} [${label}]` : baseName;
  return {
    callsign,
    lastUpdate: '',
    monitorIndex: 0,
    operator: '',
    version: '',
    aimGroupIgnoreStatus: false,
    offlineStatus: !m.is_online,
    role: m.role,
  };
}

/** Map a Log2Go active net (from /api/v1/nets/active) into the flat display shape. */
function log2goNetToFlat(net: Log2GoActiveNet): FlatActiveNet {
  return {
    netName: net.name,
    altNetName: '',
    frequency: net.frequency ?? '',
    logger: net.logger ?? '',
    netControl: net.net_control ?? '',
    date: '',
    mode: net.mode ?? '',
    band: net.band ?? '',
    subscriberCount: net.subscriber_count ?? 0,
    serverName: net.server_name ?? 'log2go',
    source: 'log2go',
    net_id: net.id,
  };
}

function isReloadNavigation(): boolean {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return false;
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return navigation?.type === 'reload';
}

function readInitialTab(): AppTab {
  if (!isReloadNavigation() || typeof localStorage === 'undefined') return 'dashboard';
  const stored = localStorage.getItem(APP_TAB_KEY);
  return stored === 'dashboard' || stored === 'netlogger' || stored === 'general' || stored === 'contest' || stored === 'logbook' || stored === 'settings'
    ? stored
    : 'dashboard';
}

function browserSessionId(): string {
  if (typeof sessionStorage === 'undefined') return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const existing = sessionStorage.getItem(BROWSER_SESSION_KEY);
  if (existing) return existing;
  const next = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sessionStorage.setItem(BROWSER_SESSION_KEY, next);
  return next;
}

function hasConfiguredStationProfile(collection: StationProfileCollection): boolean {
  return collection.profiles.some((profile) => profile.callsign.trim() || profile.profileName.trim() || profile.homeGrid?.trim());
}

/** Check whether a station profile has the minimum fields required for logging. */
function isProfileCompleteForLogging(profile: StationProfile | undefined): boolean {
  if (!profile) return false;
  const hasCallsign = (profile.callsign?.trim().length ?? 0) > 0;
  const hasLocation = (profile.homeGrid?.trim().length ?? 0) > 0 || (profile.state?.trim().length ?? 0) > 0 || (profile.county?.trim().length ?? 0) > 0;
  const hasAutoGps = profile.autoGps ?? false;
  const hasLocationOverride = profile.locationOverride ?? false;
  return hasCallsign && (hasLocation || hasAutoGps || hasLocationOverride);
}

/** Return a descriptive list of missing required fields for a profile. */
function getMissingProfileFields(profile: StationProfile | undefined): string[] {
  if (!profile) return ['Station profile'];
  const missing: string[] = [];
  if (!(profile.callsign?.trim().length ?? 0)) missing.push('Callsign');
  const hasLocation = (profile.homeGrid?.trim().length ?? 0) > 0 || (profile.state?.trim().length ?? 0) > 0 || (profile.county?.trim().length ?? 0) > 0;
  const hasAutoGps = profile.autoGps ?? false;
  const hasLocationOverride = profile.locationOverride ?? false;
  if (!hasLocation && !hasAutoGps && !hasLocationOverride) missing.push('Location (Grid, State/County, or enable Auto GPS)');
  return missing;
}

function applyStationProfileCollection(
  state: LoggingFlowState,
  collection: StationProfileCollection,
): LoggingFlowState {
  const activeProfile = getActiveProfile(collection);
  return {
    ...state,
    profileCollection: collection,
    stationProfile: activeProfile ?? state.stationProfile,
  };
}

function getNextContestContactNumber(contacts: Contact[], contestName: string): number {
  const normalizedContestName = contestName.trim().toLowerCase();
  const lastNumber = contacts
    .filter((contact) => contact.contestContext?.contestName?.trim().toLowerCase() === normalizedContestName)
    .reduce((max, contact) => Math.max(max, contact.contactNumber ?? 0), 0);

  return lastNumber + 1;
}

// ── Editable roster cell ─────────────────────────────────────────────
type EditableCellProps = {
  canEdit: boolean;
  rowKey: string;
  field: string;
  value: string;
  serialNo: number;
  className?: string;
  onEdit: (rowKey: string, field: string, value: string) => void;
  onCommit: (serialNo: number, field: string, value: string) => void;
  editingRowKey: string | null;
  editingFieldName: string | null;
  editingValue: string;
  setEditingRowKey: (v: string | null) => void;
  setEditingFieldName: (v: string | null) => void;
  setEditingValue: (v: string) => void;
};

function EditableCell({ canEdit, rowKey, field, value, serialNo, className, onEdit, onCommit, editingRowKey, editingFieldName, editingValue, setEditingRowKey, setEditingFieldName, setEditingValue }: EditableCellProps) {
  const isEditing = canEdit && editingRowKey === rowKey && editingFieldName === field;
  if (isEditing) {
    return (
      <td className={className} onClick={(e) => e.stopPropagation()}>
        <input
          className="roster-cell-input"
          value={editingValue}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setEditingValue(e.target.value)}
          onBlur={() => {
            onCommit(serialNo, field, editingValue);
            setEditingRowKey(null);
            setEditingFieldName(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onCommit(serialNo, field, editingValue);
              setEditingRowKey(null);
              setEditingFieldName(null);
            }
            if (e.key === 'Escape') {
              setEditingRowKey(null);
              setEditingFieldName(null);
            }
          }}
        />
      </td>
    );
  }
  return (
    <td
      className={className}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        if (canEdit) {
          e.stopPropagation();
          onEdit(rowKey, field, value);
        }
      }}
      title={canEdit ? 'Double-click to edit' : undefined}
      style={canEdit ? { cursor: 'text' } : undefined}
    >{value || '\u00A0'}</td>
  );
}




function App() {
    const [utcTime, setUtcTime] = useState('--:--:--');
  const [utcDate, setUtcDate] = useState('----');
  const [localTime, setLocalTime] = useState('--:--:--');
  const [localDate, setLocalDate] = useState('----');
const [tab, setTab] = useState<AppTab>(() => readInitialTab());

  // ── Clock tick ──
  useEffect(() => {
    function tick() {
      const now = new Date();
      setUtcTime(now.toISOString().slice(11, 19));
      setUtcDate(now.toISOString().slice(0, 10));
      setLocalTime(now.toLocaleTimeString('en-US', { hour12: false }));
      setLocalDate(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Feedback menu listener (desktop) ──
  useEffect(() => {
    const desktop = (window as unknown as { log2goDesktop?: { feedback?: { onOpen: (cb: () => void) => (() => void) } } }).log2goDesktop;
    if (!desktop?.feedback?.onOpen) return;
    const cleanup = desktop.feedback.onOpen(() => setFeedbackOpen(true));
    return cleanup;
  }, []);
  const [loggingState, setLoggingState] = useState<LoggingFlowState>(() => createInitialLoggingFlowState());
  const offlineStatus: OfflineStatus = useOfflineStatus(loggingState.backendBaseUrl, loggingState.accessToken || "");
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [activeNets, setActiveNets] = useState<FlatActiveNet[]>([]);
  const [log2goNets, setLog2GoNets] = useState<FlatActiveNet[]>([]);
  const [selectedNetType, setSelectedNetType] = useState<NetSource | null>(null);
  const [netsStatus, setNetsStatus] = useState('Ready. Refresh active nets to begin.');
  const [selectedNet, setSelectedNet] = useState<SelectedNet | undefined>();
  const [checkins, setCheckins] = useState<NetLoggerCheckin[]>([]);
  const [currentOperatingSerial, setCurrentOperatingSerial] = useState<number>();
  const [aimMessages, setAimMessages] = useState<NetLoggerAIMMessage[]>([]);
  const [monitors, setMonitors] = useState<NetLoggerMonitor[]>([]);
  const [draft, setDraft] = useState<ContactDraft>(emptyDraft);
  const [selectedRosterKey, setSelectedRosterKey] = useState<string>();
  const [commsTab, setCommsTab] = useState<'aim' | 'monitors'>('aim');
  const [showAim, setShowAim] = useState(false);
  const [showMonitors, setShowMonitors] = useState(false);
  const [isNcs, setIsNcs] = useState(false);
  const [myRole, setMyRole] = useState<string>('MONITOR');
  const [amLogger, setAmLogger] = useState(false);
  const prevRoleRef = useRef<string>('MONITOR');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; callsign: string; serialNo?: number } | null>(null);
  const [contextMenuType, setContextMenuType] = useState<'roster' | 'monitors'>('roster');
  const [editingRosterKey, setEditingRosterKey] = useState<string | null>(null);
  const [editingCallsign, setEditingCallsign] = useState('');
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [assignRoleCallsign, setAssignRoleCallsign] = useState('');
  const [assignRoleMenuOpen, setAssignRoleMenuOpen] = useState(false);
  const [rosterQrzLoading, setRosterQrzLoading] = useState(false);
  const showCommsPanel = showAim || showMonitors;
  const [aimDraft, setAimDraft] = useState('');
  const [aimJoined, setAimJoined] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  /** Roster-only monitoring for NetLogger nets (no AIM/monitors/subscribe). */
  const [monitoringRosterOnly, setMonitoringRosterOnly] = useState(false);
  /** Past (closed/historical) nets fetched from the Log2Go backend. */
  const [pastNets, setPastNets] = useState<PastNetInfo[]>([]);
  /** When true, the read-only history view replaces the active nets panel. */
  const [viewingHistory, setViewingHistory] = useState(false);
  /** Detail of the past net currently being viewed in read-only mode. */
  const [historyNet, setHistoryNet] = useState<PastNetDetail | null>(null);
  const [rosterDensity, setRosterDensity] = useState<RosterDensity>('normal');
  const [query, setQuery] = useState('');
  const [accountProfile, setAccountProfile] = useState<AccountProfile>();
  const [busy, setBusy] = useState(false);
  const [appSubStatus, setAppSubStatus] = useState<SubscriptionStatus | null>(null);
  const [logContactModalOpen, setLogContactModalOpen] = useState(false);
  const [modalDraft, setModalDraft] = useState<ContactDraft>(emptyDraft);
  const [authGateVisible, setAuthGateVisible] = useState(false);
  const [allBackendContacts, setAllBackendContacts] = useState<BackendContactResponse[]>([]);
  const [editingContact, setEditingContact] = useState<BackendContactResponse | null>(null);
  const [editContactDraft, setEditContactDraft] = useState<Record<string, string>>({});
  const [editContactSaving, setEditContactSaving] = useState(false);
  const [deleteContactConfirm, setDeleteContactConfirm] = useState<BackendContactResponse | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadReport, setUploadReport] = useState<string | null>(null);
  const [uploadConfirm, setUploadConfirm] = useState(false);
  const [warningContact, setWarningContact] = useState<BackendContactResponse | null>(null);
  const [contestName, setContestName] = useState('');
  const [contestCounter, setContestCounter] = useState('');
  const [contestExchange, setContestExchange] = useState('');
  const [customContestName, setCustomContestName] = useState('');
  const [showCustomContestCreator, setShowCustomContestCreator] = useState(false);
  const [showContestPicker, setShowContestPicker] = useState(false);

  // ── NetLogger parity: preferences, highlighter, find, AIM ignore ────
  const { prefs, update: updatePrefs, reset: resetPrefs } = usePreferences();
  const [showPreferences, setShowPreferences] = useState(false);
  const [highlighterMode, setHighlighterMode] = useState<'manual' | 'automatic'>(
    () => prefs.manualHighlighterStartup ? 'manual' : 'automatic'
  );
  const [highlightedSerial, setHighlightedSerial] = useState<number | null>(null);
  const [findCallsignOpen, setFindCallsignOpen] = useState(false);
  const [findCallsignQuery, setFindCallsignQuery] = useState('');
  const [findCallsignResult, setFindCallsignResult] = useState('');
  const [aimIgnoredCallsigns, setAimIgnoredCallsigns] = useState<Set<string>>(new Set());
  const rosterTableRef = useRef<HTMLTableElement>(null);
  const [rosterHeaderCollapsed, setRosterHeaderCollapsed] = useState(false);
  const [contestOptions, setContestOptions] = useState<ContestCalendarEvent[]>([]);
  const [contestOptionsLoading, setContestOptionsLoading] = useState(false);
  // ── Create Net modal state ──────────────────────────────────────────
  const [createNetModalOpen, setCreateNetModalOpen] = useState(false);
  const [createNetLoading, setCreateNetLoading] = useState(false);
  const [createNetError, setCreateNetError] = useState<string | null>(null);
  const [createNetForm, setCreateNetForm] = useState<NetProfile>({
    name: '',
    frequency: '',
    mode: 'FM',
    band: '2m',
    net_control: '',
    logger: '',
    enable_messaging: true,
    is_default: false,
  });
  const [saveAsProfile, setSaveAsProfile] = useState(true);
  const [makeDefaultProfile, setMakeDefaultProfile] = useState(false);
  const backendWorkedCalls = useMemo(
    () => new Set(
      allBackendContacts
        .map((c) => (c.call as string)?.trim().toUpperCase())
        .filter(Boolean) as string[],
    ),
    [allBackendContacts],
  );
  const [rosterSplitPct, setRosterSplitPct] = useState(55); // roster height % vs recent contacts
  const [showRecentContacts, setShowRecentContacts] = useState(true);
  const [swlCount, setSwlCount] = useState(0);
  const [rosterSort, setRosterSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'serialNo', dir: 'asc' });
  const [recentSort, setRecentSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'qso_date', dir: 'desc' });
  // ── Polling state ──────────────────────────────────────────────────
  const [aimLastId, setAimLastId] = useState(0);
  const [netsListInterval, setNetsListInterval] = useState(20);
  const aimLastIdRef = useRef(0);
  const aimRateLimitCooldownUntilRef = useRef(0);
  const lastExtDataSerialRef = useRef(0);
  const selectedNetRef = useRef<SelectedNet | undefined>(undefined);
  const busyRef = useRef(false);
  const netRefreshInFlightRef = useRef(false);
  const netPresenceRef = useRef<{
    selectedNet?: SelectedNet;
    aimJoined: boolean;
    callsign: string;
    operatorName?: string;
    backendBaseUrl: string;
    sessionId: string;
  }>({ aimJoined: false, callsign: '', backendBaseUrl: '', sessionId: browserSessionId() });
  const modalRstSentRef = useRef<HTMLInputElement | null>(null);
  const restoredNetSessionRef = useRef(false);
  const netSessionHydratedRef = useRef(false);
  const contestSessionHydratedRef = useRef(!isReloadNavigation());

  // Fetch subscription status for logbook sync gate
  useEffect(() => {
    if (!loggingState.accessToken) return;
    getSubscriptionStatus(loggingState.backendBaseUrl, loggingState.accessToken)
      .then(setAppSubStatus)
      .catch(() => {});
  }, [loggingState.accessToken, loggingState.backendBaseUrl]);

  // Keep refs in sync for use inside interval callbacks
  useEffect(() => { aimLastIdRef.current = aimLastId; }, [aimLastId]);
  useEffect(() => { selectedNetRef.current = selectedNet; }, [selectedNet]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => {
    netPresenceRef.current = {
      selectedNet,
      aimJoined,
      callsign: loggingState.stationProfile.callsign.trim().toUpperCase(),
      operatorName: loggingState.stationProfile.operatorName,
      backendBaseUrl: loggingState.backendBaseUrl,
      sessionId: netPresenceRef.current.sessionId,
    };
  }, [aimJoined, loggingState.backendBaseUrl, loggingState.stationProfile.callsign, loggingState.stationProfile.operatorName, selectedNet]);

  useEffect(() => {
    try {
      localStorage.setItem(APP_TAB_KEY, tab);
    } catch {
      // ignore storage failures
    }
  }, [tab]);

  useEffect(() => {
    if (!contestSessionHydratedRef.current) return;
    try {
      if (!contestName && !contestCounter && !contestExchange && !customContestName) {
        localStorage.removeItem(CONTEST_SESSION_KEY);
        return;
      }
      localStorage.setItem(CONTEST_SESSION_KEY, JSON.stringify({
        contestName,
        contestCounter,
        contestExchange,
        customContestName,
        showCustomContestCreator,
        showContestPicker,
      }));
    } catch {
      // ignore storage failures
    }
  }, [contestCounter, contestExchange, contestName, customContestName, showContestPicker, showCustomContestCreator]);

  useEffect(() => {
    if (!isReloadNavigation()) {
      contestSessionHydratedRef.current = true;
      return;
    }
    try {
      const raw = localStorage.getItem(CONTEST_SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<{
        contestName: string;
        contestCounter: string;
        contestExchange: string;
        customContestName: string;
        showCustomContestCreator: boolean;
        showContestPicker: boolean;
      }>;
      setContestName(parsed.contestName ?? '');
      setContestCounter(parsed.contestCounter ?? '');
      setContestExchange(parsed.contestExchange ?? '');
      setCustomContestName(parsed.customContestName ?? '');
      setShowCustomContestCreator(Boolean(parsed.showCustomContestCreator));
      setShowContestPicker(Boolean(parsed.showContestPicker));
    } catch {
      // ignore parse/storage failures
    } finally {
      contestSessionHydratedRef.current = true;
    }
  }, []);

  useEffect(() => {
    const sessionId = netPresenceRef.current.sessionId;
    void cancelDelayedUnsubscribe({ backendBaseUrl: loggingState.backendBaseUrl, sessionId }).catch(() => undefined);
  }, [loggingState.backendBaseUrl]);

  useEffect(() => {
    const scheduleCloseCleanup = () => {
      const presence = netPresenceRef.current;
      if (!presence.aimJoined || !presence.selectedNet || !presence.callsign) return;
      scheduleDelayedUnsubscribeBeacon({
        serverName: presence.selectedNet.serverName,
        netName: presence.selectedNet.netName,
        callsign: presence.callsign,
        operatorName: presence.operatorName,
        backendBaseUrl: presence.backendBaseUrl,
        sessionId: presence.sessionId,
        delaySeconds: 60,
      });
    };

    window.addEventListener('pagehide', scheduleCloseCleanup);
    return () => window.removeEventListener('pagehide', scheduleCloseCleanup);
  }, []);

  const contactsByNewest = useMemo(
    () => [...loggingState.contacts].sort((a, b) => b.contactedAt.localeCompare(a.contactedAt)),
    [loggingState.contacts],
  );

  // ── Sort helpers ──────────────────────────────────────────────────
  const sortedCheckins = useMemo(() => {
    return sortRosterCheckins(checkins, rosterSort);
  }, [checkins, rosterSort]);

  const sortedRecentContacts = useMemo(() => {
    const dir = recentSort.dir === 'asc' ? 1 : -1;
    return [...allBackendContacts].sort((a, b) => {
      const av = String(a[recentSort.key as keyof BackendContactResponse] ?? '');
      const bv = String(b[recentSort.key as keyof BackendContactResponse] ?? '');
      return av.localeCompare(bv) * dir;
    });
  }, [allBackendContacts, recentSort]);

  function toggleRosterSort(key: string) {
    setRosterSort((prev) => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  }
  function toggleRecentSort(key: string) {
    setRecentSort((prev) => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });
  }

  const filteredNets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeNets;
    return activeNets.filter((net) =>
      [net.netName, net.serverName, net.frequency, net.mode, net.band, net.netControl, net.logger]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [activeNets, query]);

  const filteredLog2GoNets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return log2goNets;
    return log2goNets.filter((net) =>
      [net.netName, net.serverName, net.frequency, net.mode, net.band, net.netControl, net.logger]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [log2goNets, query]);

  /** Converted roster/AIM/monitors for the read-only history view (derived from historyNet). */
  const historyCheckins = useMemo<NetLoggerCheckin[]>(() => {
    if (!historyNet) return [];
    return (historyNet.checkins ?? []).map(log2goCheckinToRoster);
  }, [historyNet]);

  const historyAimMessages = useMemo<NetLoggerAIMMessage[]>(() => {
    if (!historyNet) return [];
    return (historyNet.aim_messages ?? []).map(log2goAimToDisplay);
  }, [historyNet]);

  const historyMonitors = useMemo<NetLoggerMonitor[]>(() => {
    if (!historyNet) return [];
    return (historyNet.monitors ?? []).map(log2goMonitorToDisplay);
  }, [historyNet]);

  const sortedHistoryCheckins = useMemo(() => {
    return sortRosterCheckins(historyCheckins, rosterSort);
  }, [historyCheckins, rosterSort]);

  useEffect(() => {
    let cancelled = false;
    const fallback = createInitialLoggingFlowState();
    loadPersistentLoggingState(fallback, desktopPersistenceStores)
      .then((restoredState) => {
        if (!cancelled) {
          setLoggingState(restoredState);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setNetsStatus(`Could not restore saved desktop log; using a fresh session: ${error instanceof Error ? error.message : String(error)}`);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPersistenceReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Auth gate: show modal when persistence is ready and no valid token ─
  useEffect(() => {
    if (!persistenceReady) return;
    if (!loggingState.accessToken) {
      setAuthGateVisible(true);
    }
  }, [persistenceReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch all backend contacts for the recent contacts panel ──────
  useEffect(() => {
    if (!loggingState.accessToken) {
      setAllBackendContacts([]);
      return;
    }
    let cancelled = false;
    listContacts(loggingState.backendBaseUrl, loggingState.accessToken)
      .then((contacts) => {
        if (cancelled) return;
        setAllBackendContacts(contacts);
      })
      .catch(() => { if (!cancelled) { setAllBackendContacts([]); } });
    return () => { cancelled = true; };
  }, [loggingState.accessToken, loggingState.backendBaseUrl]);

  useEffect(() => {
    if (tab !== 'contest') return;
    const backendBaseUrl = loggingState.backendBaseUrl.trim();
    if (!backendBaseUrl || contestOptions.length > 0 || contestOptionsLoading) return;
    setContestOptionsLoading(true);
    fetchArrlContests(backendBaseUrl)
      .then((calendar) => setContestOptions(calendar.contests.filter((contest) => contest.active || contest.end_date >= calendar.today)))
      .catch(() => setContestOptions([]))
      .finally(() => setContestOptionsLoading(false));
  }, [contestOptions.length, contestOptionsLoading, loggingState.backendBaseUrl, tab]);

  useEffect(() => {
    if (contestName.trim()) {
      setContestCounter(String(loggingState.session.currentContactNumber));
    }
  }, [contestName, loggingState.session.currentContactNumber]);

  const applySelectedContest = useCallback((name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const nextCounter = getNextContestContactNumber(loggingState.contacts, trimmedName);
    setContestName(trimmedName);
    setContestCounter(String(nextCounter));
    setContestExchange('');
    setCustomContestName('');
    setShowCustomContestCreator(false);
    setShowContestPicker(false);
    setLoggingState((current) => ({
      ...current,
      session: {
        ...current.session,
        mode: 'contesting',
        currentContactNumber: nextCounter,
      },
    }));
    setNetsStatus(`Contest selected: ${trimmedName}. Next contact #${String(nextCounter).padStart(3, '0')}.`);
  }, [loggingState.contacts]);

  const clearContestSelection = useCallback(() => {
    setContestName('');
    setContestCounter('');
    setContestExchange('');
    setCustomContestName('');
    setShowCustomContestCreator(false);
    setShowContestPicker(false);
    setNetsStatus('Contest activity cleared. Choose Contest or Special to start a new activity.');
  }, []);

  const handleContestCounterChange = useCallback((value: string) => {
    const digitsOnly = value.replace(/[^0-9]/g, '');
    setContestCounter(digitsOnly);
    const nextCounter = Number.parseInt(digitsOnly, 10);
    if (Number.isFinite(nextCounter) && nextCounter > 0) {
      setLoggingState((current) => ({
        ...current,
        session: {
          ...current.session,
          mode: 'contesting',
          currentContactNumber: nextCounter,
        },
      }));
    }
  }, []);

  useEffect(() => {
    if (!persistenceReady) return;

    void savePersistentLoggingState(loggingState, desktopPersistenceStores).catch((error) => {
      setNetsStatus(`Could not save desktop log: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, [loggingState, persistenceReady]);

  const refreshActiveNets = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    if (!silent) setNetsStatus('Fetching active nets from NetLogger and Log2Go net servers...');
    const errors: string[] = [];
    let netloggerCount = 0;
    let log2goCount = 0;
    let pastCount = 0;

    // Fetch NetLogger (public XML), Log2Go active nets, and Log2Go past nets in parallel.
    const [netloggerResult, log2goResult, pastNetsResult] = await Promise.allSettled([
      fetchActiveNets(),
      loggingState.backendBaseUrl.trim()
        ? fetchLog2GoNets(loggingState.backendBaseUrl.trim())
        : Promise.reject(new Error('Log2Go backend URL not configured')),
      loggingState.backendBaseUrl.trim()
        ? fetchPastNets(loggingState.backendBaseUrl.trim())
        : Promise.reject(new Error('Log2Go backend URL not configured')),
    ]);

    if (netloggerResult.status === 'fulfilled') {
      const nets = flattenActiveNets(netloggerResult.value).sort((a, b) => a.netName.localeCompare(b.netName));
      setActiveNets(nets);
      netloggerCount = nets.length;
    } else {
      errors.push(`NetLogger: ${netloggerResult.reason instanceof Error ? netloggerResult.reason.message : String(netloggerResult.reason)}`);
    }

    if (log2goResult.status === 'fulfilled') {
      const nets = (log2goResult.value.nets ?? []).map(log2goNetToFlat).sort((a, b) => a.netName.localeCompare(b.netName));
      setLog2GoNets(nets);
      log2goCount = nets.length;
    } else {
      // Log2Go fetch failing is non-fatal — keep showing NetLogger nets.
      errors.push(`Log2Go: ${log2goResult.reason instanceof Error ? log2goResult.reason.message : String(log2goResult.reason)}`);
      setLog2GoNets([]);
    }

    if (pastNetsResult.status === 'fulfilled') {
      const nets = (pastNetsResult.value.nets ?? []).slice().sort((a, b) => {
        // Most recently closed first (fall back to created_at then name).
        const aKey = a.closed_at || a.created_at || a.name;
        const bKey = b.closed_at || b.created_at || b.name;
        return bKey.localeCompare(aKey);
      });
      setPastNets(nets);
      pastCount = nets.length;
    } else {
      // Past nets fetch failing is non-fatal — keep showing active nets.
      errors.push(`Past Nets: ${pastNetsResult.reason instanceof Error ? pastNetsResult.reason.message : String(pastNetsResult.reason)}`);
      setPastNets([]);
    }

    if (!silent) {
      if (errors.length === 0) {
        setNetsStatus(`Loaded ${netloggerCount} NetLogger net(s), ${log2goCount} Log2Go net(s), and ${pastCount} past net(s).`);
      } else {
        setNetsStatus(`Partial net list: ${netloggerCount} NetLogger, ${log2goCount} Log2Go, ${pastCount} past. Some sources failed: ${errors[0]}`);
      }
    }
    if (!silent) setBusy(false);
  }, [loggingState.backendBaseUrl]);

  const refreshSelectedNet = useCallback(async (net = selectedNet, silent = false) => {
    if (!net) return;
    if (!net.serverName || !net.netName) return; // guard against partial state during transitions
    if (netRefreshInFlightRef.current) return;
    netRefreshInFlightRef.current = true;
    const currentAimId = aimLastIdRef.current;
    const shouldFetchAim = Date.now() >= aimRateLimitCooldownUntilRef.current;
    const source: NetSource = net.source ?? 'netlogger';
    const backendBaseUrl = loggingState.backendBaseUrl?.trim();
    // For NetLogger "Monitor" mode (roster only) we skip AIM/monitors entirely.
    const rosterOnly = source === 'netlogger' && monitoringRosterOnly && !aimJoined;

    if (!silent) setBusy(true);
    if (!silent) setNetsStatus(`Refreshing ${net.netName}...`);

    let checkinsCount = checkins.length;
    let aimCount = aimMessages.length;
    let monitorsCount = monitors.length;
    const errors: string[] = [];

    try {
      if (source === 'log2go') {
        // ── Log2Go net: one POST to /updates carries AIM + checkins + monitor count ──
        if (!net.net_id || !backendBaseUrl) {
          throw new Error('Log2Go net missing net_id or backend URL');
        }
        const callsign = loggingState.stationProfile.callsign.trim().toUpperCase();
        try {
          const updates = await getLog2GoUpdates(
            backendBaseUrl,
            net.net_id,
            callsign,
            loggingState.stationProfile.operatorName,
            currentAimId,
          );
          // Checkins (roster)
          const roster = (updates.checkins ?? []).map(log2goCheckinToRoster);
          setCheckins(roster);
          setCurrentOperatingSerial(undefined);
          checkinsCount = roster.length;
          // AIM
          const newAim = (updates.aim_messages ?? []).map(log2goAimToDisplay);
          if (updates.swl_count !== undefined) setSwlCount(updates.swl_count);
          // Role change detection — notify the user if their role was changed
          if (updates.your_role && updates.your_role !== prevRoleRef.current) {
            const oldRole = prevRoleRef.current;
            const newRole = updates.your_role;
            prevRoleRef.current = newRole;
            setMyRole(newRole);
            setIsNcs(newRole === 'NCS' || newRole === 'CO_NCS');
            if (oldRole !== 'MONITOR' || newRole !== 'MONITOR') {
              const labels: Record<string, string> = { NCS: 'NCS', CO_NCS: 'Co-NCS', LOGGER: 'Logger', RELAY: 'Relay', MONITOR: 'Monitor' };
              if (newRole === 'MONITOR') {
                setNetsStatus(`You have been demoted to ${labels[newRole]}.`);
              } else {
                setNetsStatus(`You have been promoted to ${labels[newRole]}. New actions may now be available.`);
              }
            }
          }
          if (updates.is_logger !== undefined) setAmLogger(updates.is_logger);
          // Update NCS/Logger badges with fresh data from server
          if (updates.net_control !== undefined || updates.logger !== undefined) {
            setSelectedNet((prev) => prev ? {
              ...prev,
              netControl: updates.net_control ?? prev.netControl,
              logger: updates.logger ?? prev.logger,
            } : prev);
          }
          if (currentAimId === 0) {
            setAimMessages(newAim);
            aimCount = newAim.length;
          } else {
            const filtered = newAim.filter((msg) => msg.id > currentAimId);
            setAimMessages((prev) => {
              const merged = filtered.length > 0 ? [...prev, ...filtered] : prev;
              aimCount = merged.length;
              return merged;
            });
          }
          const highestId = newAim.length > 0 ? Math.max(...newAim.map((m) => m.id)) : currentAimId;
          if (highestId > currentAimId) {
            setAimLastId(highestId);
            aimLastIdRef.current = highestId;
          }
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }

        // Monitors panel (separate fetch so it can be toggled independently)
        try {
          const monitorsResponse = await getLog2GoMonitors(backendBaseUrl, net.net_id);
          const mons = (monitorsResponse.monitors ?? []).map(log2goMonitorToDisplay);
          setMonitors(mons);
          if (monitorsResponse.swl_count !== undefined) setSwlCount(monitorsResponse.swl_count);
          monitorsCount = mons.length;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      } else if (rosterOnly) {
        // ── NetLogger "Monitor" mode: roster only, no AIM/monitors/subscribe ──
        try {
          const checkinsResponse = await fetchCheckins(net.serverName, net.netName);
          setCheckins(checkinsResponse.checkins);
          setCurrentOperatingSerial(checkinsResponse.pointer || undefined);
          checkinsCount = checkinsResponse.checkins.length;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      } else {
        // ── NetLogger legacy: subscribed (full features) ──
        try {
          const checkinsResponse = await fetchCheckins(net.serverName, net.netName);
          setCheckins(checkinsResponse.checkins);
          setCurrentOperatingSerial(checkinsResponse.pointer || undefined);
          checkinsCount = checkinsResponse.checkins.length;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }

        await wait(NETLOGGER_JOINED_POLL_DELAY_MS);

        if (shouldFetchAim) {
          // While subscribed, read AIM from the live GetUpdates3 stream via the
          // backend. This carries fresh AIM (seconds old) vs the public GetAIM.php
          // transcript which is capped at 50 messages and can be hours stale.
          // Fall back to public GetAIM.php only if the backend endpoint fails.
          const usedUpdates3 = aimJoined && Boolean(backendBaseUrl);
          if (usedUpdates3) {
            try {
              const updatesResponse = await fetchUpdates3({
                backendBaseUrl: backendBaseUrl!,
                serverName: net.serverName,
                netName: net.netName,
                imSerial: currentAimId,
                lastExtDataSerial: lastExtDataSerialRef.current,
              });
              const newMessages: NetLoggerAIMMessage[] = updatesResponse.im_messages.map((m) => ({
                id: parseInt(m.im_serial, 10) || 0,
                callsign: m.callsign,
                message: m.message,
                aimTime: formatUpdates3AimTime(m.aim_time),
                ipAddr: m.ip_addr,
              }));
              if (currentAimId === 0) {
                setAimMessages(newMessages);
                aimCount = newMessages.length;
              } else {
                setAimMessages((prev) => {
                  const filtered = newMessages.filter((msg) => msg.id > currentAimId);
                  const merged = filtered.length > 0 ? [...prev, ...filtered] : prev;
                  aimCount = merged.length;
                  return merged;
                });
              }
              const highestId = newMessages.length > 0
                ? Math.max(...newMessages.map((msg) => msg.id))
                : currentAimId;
              if (highestId > currentAimId) {
                setAimLastId(highestId);
                aimLastIdRef.current = highestId;
              }
            } catch (error) {
              const aimError = error instanceof Error ? error.message : String(error);
              if (aimError.toLowerCase().includes('rate-limited')) {
                aimRateLimitCooldownUntilRef.current = Date.now() + 60_000;
              } else {
                // Fall back to public GetAIM.php if the backend endpoint fails
                errors.push(aimError);
                try {
                  const aimResponse = await fetchAIM(net.serverName, net.netName, currentAimId);
                  if (currentAimId === 0) {
                    setAimMessages(aimResponse.messages);
                    aimCount = aimResponse.messages.length;
                  } else {
                    setAimMessages((prev) => {
                      const filtered = aimResponse.messages.filter((msg) => msg.id > currentAimId);
                      const merged = filtered.length > 0 ? [...prev, ...filtered] : prev;
                      aimCount = merged.length;
                      return merged;
                    });
                  }
                  const highestId = aimResponse.messages.length > 0
                    ? Math.max(...aimResponse.messages.map((msg) => msg.id))
                    : currentAimId;
                  if (highestId > currentAimId) {
                    setAimLastId(highestId);
                    aimLastIdRef.current = highestId;
                  }
                } catch (fallbackError) {
                  errors.push(error instanceof Error ? error.message : String(fallbackError));
                }
              }
            }
          } else {
            try {
              const aimResponse = await fetchAIM(net.serverName, net.netName, currentAimId);
              if (currentAimId === 0) {
                setAimMessages(aimResponse.messages);
                aimCount = aimResponse.messages.length;
              } else {
                setAimMessages((prev) => {
                  const newMessages = aimResponse.messages.filter((msg) => msg.id > currentAimId);
                  const merged = newMessages.length > 0 ? [...prev, ...newMessages] : prev;
                  aimCount = merged.length;
                  return merged;
                });
              }
              const highestId = aimResponse.messages.length > 0
                ? Math.max(...aimResponse.messages.map((msg) => msg.id))
                : currentAimId;
              if (highestId > currentAimId) {
                setAimLastId(highestId);
                aimLastIdRef.current = highestId;
              }
            } catch (error) {
              const aimError = error instanceof Error ? error.message : String(error);
              if (aimError.toLowerCase().includes('rate-limited')) {
                aimRateLimitCooldownUntilRef.current = Date.now() + 60_000;
              } else {
                errors.push(aimError);
              }
            }
          }
        }

        await wait(NETLOGGER_JOINED_POLL_DELAY_MS);

        try {
          const monitorsResponse = await fetchMonitors(net.serverName, net.netName);
          setMonitors(monitorsResponse.monitors);
          monitorsCount = monitorsResponse.monitors.length;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }

      if (!silent) {
        if (errors.length === 0) {
          setNetsStatus(`Monitoring ${net.netName}: ${checkinsCount} check-ins, ${aimCount} AIM messages, ${monitorsCount} monitors.`);
        } else {
          setNetsStatus(`Partial refresh for ${net.netName}: ${checkinsCount} check-ins, ${aimCount} AIM messages, ${monitorsCount} monitors. Some requests failed: ${errors[0]}`);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!(silent && msg.includes('rate-limited'))) {
        setNetsStatus(`Net refresh failed: ${msg}`);
      }
    } finally {
      netRefreshInFlightRef.current = false;
      if (!silent) setBusy(false);
    }
  }, [aimJoined, aimMessages.length, checkins.length, loggingState.backendBaseUrl, loggingState.stationProfile.callsign, loggingState.stationProfile.operatorName, monitors.length, monitoringRosterOnly, selectedNet]);

  const selectNet = useCallback((net: FlatActiveNet) => {
    const selected = toSelectedNet(net);
    setSelectedNet(selected);
    setSelectedNetType(selected.source ?? 'netlogger');
    setSelectedRosterKey(undefined);
    setAimJoined(false);
    setMonitoringRosterOnly(false);
    setAimDraft('');
    setCheckins([]);
    setAimMessages([]);
    setMonitors([]);
    setAimLastId(0);
    setCurrentOperatingSerial(undefined);
    aimLastIdRef.current = 0;
    lastExtDataSerialRef.current = 0;
    setDraft((current) => ({ ...current, frequency: net.frequency, band: net.band, mode: net.mode || current.mode }));
    if (selected.source === 'log2go') {
      setNetsStatus(`${selected.netName} (Log2Go) selected. Click Subscribe to load the roster, AIM, and monitors.`);
    } else {
      setNetsStatus(`${selected.netName} (NetLogger) selected. Click Monitor to load the roster.`);
    }
  }, []);

  /** NetLogger "Monitor" — roster only, no AIM/monitors/subscribe. */
  const selectAndMonitor = useCallback(async (net: FlatActiveNet) => {
    const selected = toSelectedNet(net);
    setSelectedNet(selected);
    setSelectedNetType(selected.source ?? 'netlogger');
    setSelectedRosterKey(undefined);
    setAimJoined(false);
    setMonitoringRosterOnly(true);
    setShowAim(false);
    setShowMonitors(false);
    setAimDraft('');
    setCheckins([]);
    setAimMessages([]);
    setMonitors([]);
    setAimLastId(0);
    setCurrentOperatingSerial(undefined);
    aimLastIdRef.current = 0;
    lastExtDataSerialRef.current = 0;
    setDraft((current) => ({ ...current, frequency: net.frequency, band: net.band, mode: net.mode || current.mode }));
    setBusy(true);
    setNetsStatus(`Monitoring ${selected.netName} roster (NetLogger — no AIM/monitors)...`);
    try {
      await refreshSelectedNet(selected, true);
      setNetsStatus(`Monitoring ${selected.netName} roster. Roster-only polling is active.`);
    } catch (error) {
      setNetsStatus(`Monitor failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [refreshSelectedNet]);

  const selectAndSubscribe = useCallback(async (net: FlatActiveNet) => {
    const selected = toSelectedNet(net);
    setSelectedNet(selected);
    setSelectedNetType(selected.source ?? 'netlogger');
    setSelectedRosterKey(undefined);
    setMonitoringRosterOnly(false);
    setAimDraft('');
    setCheckins([]);
    setAimMessages([]);
    setMonitors([]);
    setAimLastId(0);
    setCurrentOperatingSerial(undefined);
    aimLastIdRef.current = 0;
    lastExtDataSerialRef.current = 0;
    setDraft((current) => ({ ...current, frequency: net.frequency, band: net.band, mode: net.mode || current.mode }));
    const callsign = loggingState.stationProfile.callsign.trim().toUpperCase();
    if (!callsign) {
      setNetsStatus('Set a station profile callsign before subscribing.');
      return;
    }
    setBusy(true);
    setNetsStatus(`Subscribing to ${selected.netName}...`);
    try {
      if (selected.source === 'log2go') {
        if (!selected.net_id) {
          throw new Error('Log2Go net missing net_id');
        }
        await subscribeLog2GoNet(
          loggingState.backendBaseUrl,
          selected.net_id,
          callsign,
          loggingState.stationProfile.operatorName,
        );
      } else {
        // NetLogger legacy subscribe via backend proxy
        await requestAIMSessionKey({
          serverName: selected.serverName,
          netName: selected.netName,
          callsign,
          operatorName: loggingState.stationProfile.operatorName,
          backendBaseUrl: loggingState.backendBaseUrl,
        });
      }
      setAimJoined(true);
      // Log2Go nets have no rate limiting — refresh immediately.
      // NetLogger nets need a delay to avoid rate limiting on subscribe.
      if (selected.source !== 'log2go') await wait(NETLOGGER_JOINED_POLL_DELAY_MS);
      await refreshSelectedNet(selected, true);
      setNetsStatus(`Subscribed to ${selected.netName} as ${callsign}. Roster/AIM polling is active.`);
    } catch (error) {
      setAimJoined(false);
      setNetsStatus(`Subscribe failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [refreshSelectedNet, loggingState.stationProfile.callsign, loggingState.stationProfile.operatorName, loggingState.backendBaseUrl]);

  // ── Create Net modal ────────────────────────────────────────────────
  const openCreateNetModal = useCallback(async () => {
    const baseUrl = loggingState.backendBaseUrl.trim();
    const token = loggingState.accessToken;
    const callsign = loggingState.stationProfile.callsign.trim().toUpperCase();
    // Reset form to defaults before loading profiles.
    setCreateNetError(null);
    setCreateNetForm({
      name: '',
      frequency: '',
      mode: 'FM',
      band: '2m',
      net_control: callsign,
      logger: callsign,
      enable_messaging: true,
      is_default: false,
    });
    setSaveAsProfile(true);
    setMakeDefaultProfile(false);
    setCreateNetModalOpen(true);
    // If logged in, try to pre-fill from the default net profile.
    if (baseUrl && token) {
      try {
        const { profiles } = await fetchNetProfiles(baseUrl, token);
        const defaultProfile = profiles.find((p) => p.is_default) ?? profiles[0];
        if (defaultProfile) {
          setCreateNetForm({
            name: defaultProfile.name ?? '',
            frequency: defaultProfile.frequency ?? '',
            mode: defaultProfile.mode ?? 'FM',
            band: defaultProfile.band ?? '2m',
            net_control: defaultProfile.net_control || callsign,
            logger: defaultProfile.logger || callsign,
            enable_messaging: defaultProfile.enable_messaging ?? true,
            is_default: defaultProfile.is_default ?? false,
          });
          setMakeDefaultProfile(defaultProfile.is_default ?? false);
        }
      } catch {
        // Non-fatal — keep the defaults above.
      }
    }
  }, [loggingState.backendBaseUrl, loggingState.accessToken, loggingState.stationProfile.callsign]);

  const submitCreateNet = useCallback(async () => {
    const baseUrl = loggingState.backendBaseUrl.trim();
    const token = loggingState.accessToken;
    if (!baseUrl) {
      setCreateNetError('Log2Go backend URL is not configured.');
      return;
    }
    const name = createNetForm.name.trim();
    if (!name) {
      setCreateNetError('Net Name is required.');
      return;
    }
    setCreateNetLoading(true);
    setCreateNetError(null);
    try {
      // 1. Optionally save the form data as a net profile.
      if (saveAsProfile && token) {
        try {
          await saveNetProfile(baseUrl, token, {
            name,
            frequency: createNetForm.frequency.trim(),
            mode: createNetForm.mode,
            band: createNetForm.band,
            net_control: createNetForm.net_control.trim(),
            logger: createNetForm.logger.trim(),
            enable_messaging: createNetForm.enable_messaging,
            is_default: makeDefaultProfile,
          });
        } catch (profileError) {
          // Profile save failure is non-fatal — continue to open the net.
          // Surface it as a soft warning in the status bar.
          setNetsStatus(`Profile save failed: ${profileError instanceof Error ? profileError.message : String(profileError)}`);
        }
      }
      // 2. Create the net (NCS is auto-added as first checkin by backend with profile data).
      const profile = loggingState.stationProfile;
      const opened = await openLog2GoNet(
        baseUrl,
        name,
        createNetForm.frequency.trim(),
        createNetForm.mode,
        createNetForm.band,
        createNetForm.net_control.trim().toUpperCase(),
        createNetForm.logger.trim().toUpperCase(),
        createNetForm.enable_messaging,
        {
          first_name: profile.operatorName || profile.callsign,
          state: profile.state || '',
          grid: profile.homeGrid || '',
          county: profile.county || '',
          city: profile.city || '',
          country: profile.country || '',
        },
      );
      // 3. Build the SelectedNet for the new net and subscribe as NCS.
      const newSelected: SelectedNet = {
        serverName: 'log2go',
        netName: opened.name || name,
        frequency: createNetForm.frequency.trim(),
        mode: createNetForm.mode,
        band: createNetForm.band,
        netControl: createNetForm.net_control.trim().toUpperCase(),
        logger: createNetForm.logger.trim().toUpperCase(),
        source: 'log2go',
        net_id: opened.net_id,
      };
      setSelectedNet(newSelected);
      setSelectedNetType('log2go');
      setSelectedRosterKey(undefined);
      setMonitoringRosterOnly(false);
      setAimDraft('');
      setCheckins([]);
      setAimMessages([]);
      setMonitors([]);
      setAimLastId(0);
      setCurrentOperatingSerial(undefined);
      aimLastIdRef.current = 0;
      lastExtDataSerialRef.current = 0;
      setDraft((current) => ({
        ...current,
        frequency: newSelected.frequency,
        band: newSelected.band,
        mode: newSelected.mode || current.mode,
      }));
      const callsign = loggingState.stationProfile.callsign.trim().toUpperCase();
      try {
        await subscribeLog2GoNet(
          baseUrl,
          opened.net_id,
          callsign,
          loggingState.stationProfile.operatorName,
        );
      } catch {
        // Subscribe failure is non-fatal — the net still exists and we
        // will refresh the roster below to populate it.
      }
      setAimJoined(true);
      setCreateNetModalOpen(false);
      setNetsStatus(`Created and joined net "${newSelected.netName}" as NCS (${newSelected.netControl}).`);
      // Refresh roster/AIM immediately, then refresh the active nets list.
      await refreshSelectedNet(newSelected, true);
      void refreshActiveNets(true);
    } catch (error) {
      setCreateNetError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreateNetLoading(false);
    }
  }, [createNetForm, loggingState.backendBaseUrl, loggingState.accessToken, loggingState.stationProfile.callsign, loggingState.stationProfile.operatorName, makeDefaultProfile, saveAsProfile, refreshSelectedNet, refreshActiveNets]);

  const useRosterCheckin = useCallback((checkin: NetLoggerCheckin) => {
    setSelectedRosterKey(rosterRowKey(checkin));
    setDraft(draftFromCheckin(checkin, selectedNet));
  }, [selectedNet]);

  // ── NCS status check ────────────────────────────────────────────────
  useEffect(() => {
    if (selectedNetType !== 'log2go' || !selectedNet?.net_id) { setIsNcs(false); setMyRole('MONITOR'); prevRoleRef.current = 'MONITOR'; return; }
    const callsign = loggingState.stationProfile.callsign.trim().toUpperCase();
    if (!callsign) { setIsNcs(false); setMyRole('MONITOR'); prevRoleRef.current = 'MONITOR'; return; }
    const baseUrl = loggingState.backendBaseUrl.trim();
    if (!baseUrl) { setIsNcs(false); setMyRole('MONITOR'); prevRoleRef.current = 'MONITOR'; return; }
    fetch(`${baseUrl}/api/v1/nets/${selectedNet.net_id}/ncs-status?callsign=${encodeURIComponent(callsign)}`)
      .then((r) => r.json())
      .then((d: { is_ncs: boolean; role?: string }) => {
        const role = d.role || (d.is_ncs ? 'NCS' : 'MONITOR');
        setMyRole(role);
        prevRoleRef.current = role;
        setIsNcs(d.is_ncs);
      })
      .catch(() => { setIsNcs(false); setMyRole('MONITOR'); prevRoleRef.current = 'MONITOR'; });
  }, [selectedNetType, selectedNet?.net_id, loggingState.stationProfile.callsign, loggingState.backendBaseUrl]);

  // ── Add callsign to roster (NCS only) ───────────────────────────────
  const handleAddToRoster = useCallback(async (callsign: string) => {
    if (!selectedNet?.net_id || !amLogger) return;
    const baseUrl = loggingState.backendBaseUrl.trim();
    if (!baseUrl) return;
    const ncsCallsign = loggingState.stationProfile.callsign.trim().toUpperCase();
    const call = callsign.trim().toUpperCase();
    const token = loggingState.accessToken;
    try {
      setBusy(true);
      // If we have a backend token, try QRZ lookup to populate all fields
      let checkinData: Record<string, unknown> = { callsign: call };
      if (token) {
        try {
          setRosterQrzLoading(true);
          const result = await qrzLookup(baseUrl, token, call);
          const fullName = [result.first_name, result.name].filter(Boolean).join(' ');
          checkinData = {
            callsign: call,
            first_name: fullName || '',
            state: result.state || '',
            grid: result.grid || '',
            county: result.county || '',
            city: result.addr2 || result.addr1 || '',
            country: result.country || '',
          };
        } catch {
          // QRZ lookup failed — still add with just the callsign
        } finally {
          setRosterQrzLoading(false);
        }
      }
      await addLog2GoCheckin(baseUrl, selectedNet.net_id, ncsCallsign, checkinData);
      setNetsStatus(`Added ${call} to the roster${token ? ' (QRZ lookup complete)' : ''}.`);
      void refreshSelectedNet(selectedNet, true);
    } catch (error) {
      setNetsStatus(`Failed to add ${call}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [selectedNet, isNcs, myRole, amLogger, loggingState.backendBaseUrl, loggingState.accessToken, loggingState.stationProfile.callsign, refreshSelectedNet]);

  // ── Promote/demote a monitor (NCS only, Log2Go nets) ────────────────
  const handlePromote = useCallback(async (callsign: string, role: string) => {
    if (!selectedNet?.net_id || !isNcs) return;
    const baseUrl = loggingState.backendBaseUrl.trim();
    const ncsCallsign = loggingState.stationProfile.callsign.trim().toUpperCase();
    try {
      setBusy(true);
      await promoteUser(baseUrl, selectedNet.net_id, ncsCallsign, callsign, role);
      setNetsStatus(`Promoted ${callsign} to ${role}`);
      void refreshSelectedNet(selectedNet, true);
    } catch (error) {
      setNetsStatus(`Promotion failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
    setContextMenu(null);
  }, [selectedNet, isNcs, loggingState, refreshSelectedNet]);

  // ── Remove a checkin from the roster (NCS only, Log2Go nets) ─────────
  const handleRemoveCheckin = useCallback(async (callsign: string, serialNo: number) => {
    if (!selectedNet?.net_id || !amLogger) return;
    const baseUrl = loggingState.backendBaseUrl.trim();
    const ncsCallsign = loggingState.stationProfile.callsign.trim().toUpperCase();
    if (!baseUrl) return;
    try {
      setBusy(true);
      await removeLog2GoCheckin(baseUrl, selectedNet.net_id, serialNo, ncsCallsign);
      setNetsStatus(`Removed ${callsign} (serial ${serialNo}) from the roster.`);
      void refreshSelectedNet(selectedNet, true);
    } catch (error) {
      setNetsStatus(`Failed to remove ${callsign}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
    setContextMenu(null);
  }, [selectedNet, isNcs, myRole, amLogger, loggingState.backendBaseUrl, loggingState.stationProfile.callsign, refreshSelectedNet]);

  // ── Close net (NCS only) ─────────────────────────────────────────────
  const handleCloseNet = useCallback(async () => {
    if (!selectedNet?.net_id || !isNcs) return;
    const baseUrl = loggingState.backendBaseUrl.trim();
    const ncsCallsign = loggingState.stationProfile.callsign.trim().toUpperCase();
    if (!baseUrl) return;
    try {
      setBusy(true);
      // 1. Close the net
      await closeLog2GoNet(baseUrl, selectedNet.net_id, ncsCallsign);
      // 2. Unsubscribe (best effort)
      try {
        await unsubscribeLog2GoNet(baseUrl, selectedNet.net_id, ncsCallsign, loggingState.stationProfile.operatorName);
      } catch { /* non-fatal */ }
      // 3. Clear state and return to active nets list
      setNetsStatus(`Net "${selectedNet.netName}" closed.`);
      setAimJoined(false);
      setShowAim(false);
      setShowMonitors(false);
      setSelectedNet(undefined);
      setSelectedNetType(null);
      setCheckins([]);
      setAimMessages([]);
      setMonitors([]);
      void refreshActiveNets(true);
    } catch (error) {
      setNetsStatus(`Failed to close net: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [selectedNet, isNcs, loggingState.backendBaseUrl, loggingState.stationProfile.callsign, loggingState.stationProfile.operatorName, refreshActiveNets]);

  // ── QRZ lookup + checkin update for editable roster (NCS only) ──────
  const handleRosterQrzLookup = useCallback(async (callsign: string, serialNo?: number) => {
    if (!selectedNet?.net_id || !amLogger) return;
    const baseUrl = loggingState.backendBaseUrl.trim();
    const token = loggingState.accessToken;
    if (!baseUrl || !token) return;
    const call = callsign.trim().toUpperCase();
    if (!call) return;
    const ncsCallsign = loggingState.stationProfile.callsign.trim().toUpperCase();
    try {
      setRosterQrzLoading(true);
      // Find existing checkin data to avoid overwriting edited fields
      const existing = serialNo !== undefined
        ? checkins.find((c) => c.serialNo === serialNo)
        : undefined;
      const isEmpty = (v: string | undefined) => !v || !v.trim();
      // QRZ lookup — only fill fields that are currently empty
      let qrzData: Record<string, unknown> = { callsign: call };
      try {
        const result = await qrzLookup(baseUrl, token, call);
        const fullName = [result.first_name, result.name].filter(Boolean).join(' ');
        qrzData = {
          callsign: call,
          ...(isEmpty(existing?.preferredName || existing?.firstName) ? { first_name: fullName || '' } : {}),
          ...(isEmpty(existing?.state) ? { state: result.state || '' } : {}),
          ...(isEmpty(existing?.grid) ? { grid: result.grid || '' } : {}),
          ...(isEmpty(existing?.county) ? { county: result.county || '' } : {}),
          ...(isEmpty(existing?.cityCountry) ? { city: result.addr2 || result.addr1 || '' } : {}),
        };
      } catch {
        // QRZ lookup failed — still update with just the callsign
      }
      // Update or insert the checkin
      await addLog2GoCheckin(baseUrl, selectedNet.net_id, ncsCallsign, {
        ...qrzData,
        ...(serialNo !== undefined ? { serial_no: serialNo } : {}),
      });
      setNetsStatus(`QRZ lookup complete for ${call}.`);
      void refreshSelectedNet(selectedNet, true);
    } catch (error) {
      setNetsStatus(`QRZ lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRosterQrzLoading(false);
    }
  }, [selectedNet, isNcs, myRole, amLogger, loggingState.backendBaseUrl, loggingState.accessToken, loggingState.stationProfile.callsign, refreshSelectedNet]);

  // ── Update a single roster field (NCS/Co-NCS/Logger) ─────────────────
  const handleRosterFieldUpdate = useCallback(async (serialNo: number, field: string, value: string) => {
    if (!selectedNet?.net_id || !amLogger) return;
    const baseUrl = loggingState.backendBaseUrl.trim();
    if (!baseUrl) return;
    const ncsCallsign = loggingState.stationProfile.callsign.trim().toUpperCase();
    try {
      await addLog2GoCheckin(baseUrl, selectedNet.net_id, ncsCallsign, {
        serial_no: serialNo,
        [field]: value,
      });
      void refreshSelectedNet(selectedNet, true);
    } catch (error) {
      setNetsStatus(`Failed to update ${field}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [selectedNet, isNcs, myRole, amLogger, loggingState.backendBaseUrl, loggingState.stationProfile.callsign, refreshSelectedNet]);

  // ── NetLogger parity: status setting via context menu / F-keys ──────
  const handleSetCheckinStatus = useCallback(async (callsign: string, serialNo: number, status: string) => {
    if (!selectedNet?.net_id) return;
    // Local statuses (n/h, W, n, nxt) are per-user, not transmitted.
    // For Log2Go nets, logger/NCS statuses are written via addLog2GoCheckin.
    const localStatuses = ['n/h', 'W', 'n', 'nxt'];
    if (localStatuses.includes(status)) {
      // Toggle local status in the checkins array (optimistic local update)
      setCheckins((prev) => prev.map((c) => {
        if (c.serialNo !== serialNo) return c;
        // n, nxt, W are mutually exclusive
        const mutuallyExclusive = ['n', 'nxt', 'W'];
        if (mutuallyExclusive.includes(status)) {
          // Clear all mutually exclusive first
          let newStatus = c.status.replace(/\b(n|nxt|W)\b/g, '').trim();
          if (!c.status.includes(status)) newStatus = `${newStatus} ${status}`.trim();
          return { ...c, status: newStatus };
        }
        // Toggle
        if (c.status.includes(status)) return { ...c, status: c.status.replace(new RegExp(`\\b${escapeRegex(status)}\\b`, 'g'), '').trim() };
        return { ...c, status: `${c.status} ${status}`.trim() };
      }));
      return;
    }
    // Non-local statuses (c/o, n/r, u, nc, log, rel, vip, awards) — send to server if Log2Go net
    if (selectedNetType === 'log2go' && amLogger) {
      const baseUrl = loggingState.backendBaseUrl.trim();
      const ncsCallsign = loggingState.stationProfile.callsign.trim().toUpperCase();
      if (!baseUrl) return;
      try {
        await addLog2GoCheckin(baseUrl, selectedNet.net_id, ncsCallsign, {
          serial_no: serialNo,
          status,
        });
        void refreshSelectedNet(selectedNet, true);
      } catch (error) {
        setNetsStatus(`Failed to set status: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }, [selectedNet, selectedNetType, amLogger, loggingState, refreshSelectedNet]);

  const handleClearCheckinStatus = useCallback(async (callsign: string, serialNo: number) => {
    if (!selectedNet?.net_id) return;
    // Clear all status values locally
    setCheckins((prev) => prev.map((c) => c.serialNo === serialNo ? { ...c, status: '' } : c));
    // If Log2Go net and logger, also clear on server
    if (selectedNetType === 'log2go' && amLogger) {
      const baseUrl = loggingState.backendBaseUrl.trim();
      const ncsCallsign = loggingState.stationProfile.callsign.trim().toUpperCase();
      if (!baseUrl) return;
      try {
        await addLog2GoCheckin(baseUrl, selectedNet.net_id, ncsCallsign, {
          serial_no: serialNo,
          status: '',
        });
        void refreshSelectedNet(selectedNet, true);
      } catch (error) {
        setNetsStatus(`Failed to clear status: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }, [selectedNet, selectedNetType, amLogger, loggingState, refreshSelectedNet]);

  // ── Set Mobile/Portable status ─────────────────────────────────────
  const handleSetMobilePortable = useCallback(async (callsign: string, serialNo: number, mp: string) => {
    if (!selectedNet?.net_id || !amLogger || selectedNetType !== 'log2go') return;
    const baseUrl = loggingState.backendBaseUrl.trim();
    const ncsCallsign = loggingState.stationProfile.callsign.trim().toUpperCase();
    if (!baseUrl) return;
    try {
      await addLog2GoCheckin(baseUrl, selectedNet.net_id, ncsCallsign, {
        serial_no: serialNo,
        status: mp || undefined, // M/P is stored in status field
      });
      void refreshSelectedNet(selectedNet, true);
    } catch (error) {
      setNetsStatus(`Failed to set M/P: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [selectedNet, selectedNetType, amLogger, loggingState, refreshSelectedNet]);

  // ── Roster row modifications: clear, delete, insert ─────────────────
  const handleClearRow = useCallback(async (callsign: string, serialNo: number) => {
    if (!selectedNet?.net_id || !amLogger || selectedNetType !== 'log2go') return;
    const baseUrl = loggingState.backendBaseUrl.trim();
    const ncsCallsign = loggingState.stationProfile.callsign.trim().toUpperCase();
    if (!baseUrl) return;
    try {
      await addLog2GoCheckin(baseUrl, selectedNet.net_id, ncsCallsign, {
        serial_no: serialNo,
        callsign: '',
        first_name: '',
        city: '',
        state: '',
        county: '',
        grid: '',
        status: '',
        remarks: '',
        qsl: '',
        member_id: '',
      });
      void refreshSelectedNet(selectedNet, true);
    } catch (error) {
      setNetsStatus(`Failed to clear row: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [selectedNet, selectedNetType, amLogger, loggingState, refreshSelectedNet]);

  const handleDeleteRow = useCallback(async (callsign: string, serialNo: number) => {
    return handleRemoveCheckin(callsign, serialNo);
  }, [handleRemoveCheckin]);

  const handleInsertRow = useCallback(async (callsign: string, serialNo: number) => {
    if (!selectedNet?.net_id || !amLogger || selectedNetType !== 'log2go') return;
    const baseUrl = loggingState.backendBaseUrl.trim();
    const ncsCallsign = loggingState.stationProfile.callsign.trim().toUpperCase();
    if (!baseUrl) return;
    try {
      await addLog2GoCheckin(baseUrl, selectedNet.net_id, ncsCallsign, {
        callsign: '',
      });
      void refreshSelectedNet(selectedNet, true);
    } catch (error) {
      setNetsStatus(`Failed to insert row: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [selectedNet, selectedNetType, amLogger, loggingState, refreshSelectedNet]);

  // ── QRZ web lookup (opens browser) ──────────────────────────────────
  const handleQrzWebLookup = useCallback((callsign: string) => {
    window.open(`https://www.qrz.com/db/${callsign}`, '_blank', 'noopener');
  }, []);

  // ── AIM ignore toggle ──────────────────────────────────────────────
  const handleToggleAimIgnore = useCallback((callsign: string) => {
    setAimIgnoredCallsigns((prev) => {
      const next = new Set(prev);
      const normalized = callsign.trim().toUpperCase();
      if (next.has(normalized)) next.delete(normalized);
      else next.add(normalized);
      return next;
    });
  }, []);

  const handleGroupIgnore = useCallback((callsign: string) => {
    setAimIgnoredCallsigns((prev) => new Set(prev).add(callsign.trim().toUpperCase()));
    setNetsStatus(`Group ignore applied to ${callsign}`);
  }, []);

  // ── Find callsign in roster (Ctrl+F) ────────────────────────────────
  const handleFindCallsign = useCallback(() => {
    setFindCallsignOpen(true);
  }, []);

  const executeFindCallsign = useCallback(() => {
    const query = findCallsignQuery.trim().toUpperCase();
    if (!query) return;
    const match = checkins.find((c) => c.callsign.trim().toUpperCase().includes(query));
    if (match) {
      setHighlightedSerial(match.serialNo);
      setFindCallsignResult(`Found: ${match.callsign} (#${match.serialNo})`);
      if (rosterTableRef.current) {
        const row = rosterTableRef.current.querySelector(`tr[data-serial="${match.serialNo}"]`);
        if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      setFindCallsignResult(`Not found: ${findCallsignQuery}`);
    }
  }, [findCallsignQuery, checkins]);

  // ── Needed Next button ─────────────────────────────────────────────
  const handleNeededNext = useCallback(() => {
    const nxtCheckin = checkins.find((c) => c.status.includes('nxt'));
    if (nxtCheckin) {
      setHighlightedSerial(nxtCheckin.serialNo);
      if (rosterTableRef.current) {
        const row = rosterTableRef.current.querySelector(`tr[data-serial="${nxtCheckin.serialNo}"]`);
        if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      setNetsStatus('No "Needed Next" station found in roster.');
    }
  }, [checkins]);

  // ── Toggle highlighter mode (F2) ────────────────────────────────────
  const handleToggleHighlighter = useCallback(() => {
    setHighlighterMode((prev) => prev === 'manual' ? 'automatic' : 'manual');
  }, []);

  // ── Get selected serial number for F-key shortcuts ──────────────────
  const selectedSerialNo = useMemo(() => {
    if (!selectedRosterKey) return null;
    const match = checkins.find((c) => rosterRowKey(c) === selectedRosterKey);
    return match?.serialNo ?? null;
  }, [selectedRosterKey, checkins]);

  // ── Wire keyboard shortcuts ────────────────────────────────────────
  useKeyboardShortcuts(selectedSerialNo, {
    onSetStatus: (_serialNo, status) => {
      if (selectedSerialNo !== null) {
        const checkin = checkins.find((c) => c.serialNo === selectedSerialNo);
        if (checkin) void handleSetCheckinStatus(checkin.callsign, selectedSerialNo, status);
      }
    },
    onClearStatus: (_serialNo) => {
      if (selectedSerialNo !== null) {
        const checkin = checkins.find((c) => c.serialNo === selectedSerialNo);
        if (checkin) void handleClearCheckinStatus(checkin.callsign, selectedSerialNo);
      }
    },
    onToggleHighlighter: handleToggleHighlighter,
    onFindCallsign: handleFindCallsign,
    onQrzLookup: () => {
      if (selectedSerialNo !== null) {
        const checkin = checkins.find((c) => c.serialNo === selectedSerialNo);
        if (checkin) handleQrzWebLookup(checkin.callsign);
      }
    },
    onNeededNext: handleNeededNext,
  }, tab === 'netlogger');

  const openRosterLogModal = useCallback((checkin: NetLoggerCheckin) => {
    const prefilled = draftFromCheckin(checkin, selectedNet);
    const resolvedMode = prefilled.mode.trim() || loggingState.stationProfile.defaultMode?.trim() || 'SSB';
    const nextDraft: ContactDraft = {
      ...prefilled,
      mode: resolvedMode,
      rstSent: prefilled.rstSent || '59',
      rstReceived: prefilled.rstReceived || '59',
    };
    setSelectedRosterKey(rosterRowKey(checkin));
    setDraft(nextDraft);
    setModalDraft(nextDraft);
    setLogContactModalOpen(true);
  }, [selectedNet, loggingState.stationProfile.defaultMode]);

  useEffect(() => {
    void refreshActiveNets();
  }, [refreshActiveNets]);

  // ── Persist selected net across browser refreshes ───────────────────
  useEffect(() => {
    if (!netSessionHydratedRef.current) return;
    try {
      if (!selectedNet) {
        localStorage.removeItem(NETLOGGER_SESSION_KEY);
        return;
      }
      localStorage.setItem(NETLOGGER_SESSION_KEY, JSON.stringify({
        selectedNet,
        aimJoined,
        selectedNetType,
        showAim,
        showMonitors,
        monitoringRosterOnly,
      }));
    } catch {
      // ignore storage failures
    }
  }, [aimJoined, selectedNet, selectedNetType, showAim, showMonitors, monitoringRosterOnly]);

  // ── Restore selected net/session after page refresh ────────────────
  useEffect(() => {
    if (restoredNetSessionRef.current) return;
    restoredNetSessionRef.current = true;
    try {
      const raw = localStorage.getItem(NETLOGGER_SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        selectedNet?: SelectedNet;
        aimJoined?: boolean;
        selectedNetType?: NetSource;
        showAim?: boolean;
        showMonitors?: boolean;
        monitoringRosterOnly?: boolean;
      };
      if (!parsed.selectedNet?.serverName || !parsed.selectedNet?.netName) return;

      const restored = parsed.selectedNet;
      setSelectedNet(restored);
      setAimJoined(Boolean(parsed.aimJoined));
      setSelectedNetType(parsed.selectedNetType ?? restored.source ?? 'netlogger');
      setShowAim(Boolean(parsed.showAim));
      setShowMonitors(Boolean(parsed.showMonitors));
      setMonitoringRosterOnly(Boolean(parsed.monitoringRosterOnly));
      setSelectedRosterKey(undefined);
      setAimDraft('');
      setAimMessages([]);
      setAimLastId(0);
      setCurrentOperatingSerial(undefined);
      aimLastIdRef.current = 0;
      lastExtDataSerialRef.current = 0;
      setDraft((current) => ({
        ...current,
        frequency: restored.frequency,
        band: restored.band,
        mode: restored.mode || current.mode,
      }));
      if (parsed.aimJoined) {
        void refreshSelectedNet(restored, true);
      }
    } catch {
      // ignore parse/storage failures
    } finally {
      netSessionHydratedRef.current = true;
    }
  }, [refreshSelectedNet]);

  // ── Auto-open net from URL param (?net=ID) ──────────────────────────
  const urlNetOpenedRef = useRef(false);
  useEffect(() => {
    if (urlNetOpenedRef.current) return;
    if (!netSessionHydratedRef.current) return; // wait for session restore first
    const params = new URLSearchParams(window.location.search);
    const netIdParam = params.get('net');
    if (!netIdParam) return;
    const netId = parseInt(netIdParam, 10);
    if (isNaN(netId)) return;
    urlNetOpenedRef.current = true;

    // Switch to netlogger tab
    setTab('netlogger');

    // Fetch the net details from the backend
    const baseUrl = loggingState.backendBaseUrl.trim();
    if (!baseUrl) return;
    fetch(`${baseUrl}/api/v1/nets/active`)
      .then((r) => r.json())
      .then((data: { nets: Log2GoActiveNet[] }) => {
        const net = data.nets?.find((n) => n.id === netId);
        if (!net) {
          setNetsStatus(`Net #${netId} not found or no longer active.`);
          return;
        }
        // Convert to FlatActiveNet and open it
        const flat = log2goNetToFlat(net);
        const selected = toSelectedNet(flat);
        setSelectedNet(selected);
        setSelectedNetType('log2go');
        setMonitoringRosterOnly(false);

        const callsign = loggingState.stationProfile.callsign.trim().toUpperCase();
        const token = loggingState.accessToken;

        if (callsign && token) {
          // Logged in — subscribe and get full features
          setBusy(true);
          setNetsStatus(`Subscribing to ${selected.netName}...`);
          subscribeLog2GoNet(baseUrl, netId, callsign, loggingState.stationProfile.operatorName)
            .then(() => {
              setAimJoined(true);
              void refreshSelectedNet(selected, true);
              setNetsStatus(`Subscribed to ${selected.netName} as ${callsign}.`);
            })
            .catch((err) => {
              setNetsStatus(`Subscribe failed: ${err instanceof Error ? err.message : String(err)}. Monitoring as SWL.`);
              setMonitoringRosterOnly(true);
              void refreshSelectedNet(selected, true);
            })
            .finally(() => setBusy(false));
        } else {
          // Not logged in — SWL mode (monitor only, no subscribe/AIM send)
          setAimJoined(false);
          setMonitoringRosterOnly(true);
          setNetsStatus(`Monitoring ${selected.netName} as SWL (log in to subscribe and send AIM).`);
          void refreshSelectedNet(selected, true);
        }
      })
      .catch(() => setNetsStatus(`Failed to load net #${netId}.`));
  }, [loggingState.backendBaseUrl, loggingState.stationProfile.callsign, loggingState.accessToken, refreshSelectedNet]);

  // ── Re-check join state once station profile callsign is available ──
  useEffect(() => {
    if (!selectedNet) return;
    if (!aimJoined) return;
    if (!loggingState.stationProfile.callsign.trim()) return;
    void refreshSelectedNet(selectedNet, true);
  }, [aimJoined, loggingState.stationProfile.callsign, refreshSelectedNet, selectedNet]);

  // ── Auto-poll: selected net ───────────────────────────────────────
  // Keep NetLogger reads staggered: roster, wait 15s, AIM, wait 15s,
  // monitors. This mirrors the live NOSWR probe that avoided dead AIM.
  // For NetLogger "Monitor" (roster-only) mode we poll less aggressively
  // (60s) since there's no subscription and NetLogger rate-limits hard.
  useEffect(() => {
    if (tab !== 'netlogger') return;
    if (!selectedNet) return;
    if (!aimJoined && !monitoringRosterOnly) return;
    const isLog2Go = selectedNet.source === 'log2go';
    const cycle = isLog2Go ? 5_000 : (monitoringRosterOnly && !aimJoined ? 60_000 : NETLOGGER_JOINED_POLL_CYCLE_MS);
    const interval = setInterval(() => {
      if (busyRef.current) return; // skip if a manual action is in progress
      const net = selectedNetRef.current;
      if (!net) return;
      void refreshSelectedNet(net, true);
    }, cycle);
    return () => clearInterval(interval);
  }, [aimJoined, monitoringRosterOnly, tab, selectedNet, refreshSelectedNet]);

  const handleEditContact = useCallback((qso: BackendContactResponse) => {
    setEditingContact(qso);
    setEditContactDraft({
      call: String(qso.call ?? ''),
      qso_date: String(qso.qso_date ?? ''),
      time_on: String(qso.time_on ?? ''),
      mode: String(qso.mode ?? ''),
      band: String(qso.band ?? ''),
      freq: String(qso.freq ?? ''),
      rst_sent: String(qso.rst_sent ?? ''),
      rst_rcvd: String(qso.rst_rcvd ?? ''),
      gridsquare: String(qso.gridsquare ?? ''),
      my_gridsquare: String(qso.my_gridsquare ?? ''),
      state: String(qso.state ?? ''),
      county: String(qso.county ?? ''),
      netlogger_net: String(qso.netlogger_net ?? ''),
    });
  }, []);

  const handleSaveEditedContact = useCallback(async () => {
    if (!editingContact || editingContact.id == null) return;
    const contactId = Number(editingContact.id);
    const baseUrl = loggingState.backendBaseUrl.trim();
    const token = loggingState.accessToken?.trim();
    if (!baseUrl || !token) return;
    setEditContactSaving(true);
    try {
      const updated = await backendUpdateContact(baseUrl, token, contactId, editContactDraft);
      setAllBackendContacts((prev) => prev.map((c) => c.id === updated.id ? updated : c));
      setEditingContact(null);
      setNetsStatus(`Updated ${String(updated.call ?? 'contact')}.`);
    } catch (error) {
      setNetsStatus(`Update failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setEditContactSaving(false);
    }
  }, [editingContact, editContactDraft, loggingState.backendBaseUrl, loggingState.accessToken]);

  const handleDeleteContact = useCallback(async (contactId: number) => {
    const baseUrl = loggingState.backendBaseUrl.trim();
    const token = loggingState.accessToken?.trim();
    if (!baseUrl || !token) return;
    try {
      await backendDeleteContact(baseUrl, token, contactId);
      setAllBackendContacts((prev) => prev.filter((c) => Number(c.id) !== contactId));
      setDeleteContactConfirm(null);
      setNetsStatus('Contact deleted.');
    } catch (error) {
      setNetsStatus(`Delete failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [loggingState.backendBaseUrl, loggingState.accessToken]);

  const handleUploadToServices = useCallback(async () => {
    const baseUrl = loggingState.backendBaseUrl.trim();
    const token = loggingState.accessToken?.trim();
    if (!baseUrl || !token) return;
    setUploading(true);
    setUploadReport(null);
    setNetsStatus('Uploading contacts to LoTW, eQSL, and QRZ...');
    try {
      const report = await uploadToServices(baseUrl, token);
      setUploadReport(report.summary);
      setNetsStatus(`Upload complete: ${report.total_uploaded} uploaded, ${report.total_confirmed} confirmed.`);
      // Refresh contacts to show updated upload/confirm status
      const contacts = await listContacts(baseUrl, token);
      setAllBackendContacts(contacts);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setUploadReport(`Upload failed: ${msg}`);
      setNetsStatus(`Upload failed: ${msg}`);
    } finally {
      setUploading(false);
    }
  }, [loggingState.backendBaseUrl, loggingState.accessToken]);

  // ── Auto-refresh: active nets list (degrading 20s → 5min) ──────────
  // When no net is selected and the NetLogger tab is active, auto-refresh
  // the active nets list with a degrading interval (20s start, 1.5x each
  // unattended cycle, capped at 5 minutes). Manual refresh resets to 20s.
  useEffect(() => {
    if (tab !== 'netlogger') return;
    if (selectedNet) return; // only auto-refresh the list when no net is selected
    const interval = setInterval(() => {
      if (busyRef.current) return;
      void refreshActiveNets(true);
      setNetsListInterval((prev) => Math.min(Math.round(prev * 1.5), 300));
    }, netsListInterval * 1000);
    return () => clearInterval(interval);
  }, [tab, selectedNet, netsListInterval, refreshActiveNets]);

  const persistDraftContact = useCallback(async (
    draftInput: ContactDraft,
    loggingMode: 'nets' | 'contesting' | 'pota' = 'nets',
    contestDetails?: { contestName: string; exchangeReceived: string },
  ): Promise<boolean> => {
    if (!draftInput.callsign.trim()) {
      setNetsStatus('Contact not logged: callsign is required.');
      return false;
    }
    setBusy(true);
    try {
      const result = await logWebContact(loggingState, {
        callsign: draftInput.callsign.trim().toUpperCase(),
        operatorName: draftInput.name.trim() || undefined,
        frequencyMhz: Number.parseFloat(draftInput.frequency) || undefined,
        band: draftInput.band.trim() || undefined,
        mode: draftInput.mode.trim() || 'SSB',
        signalReport: { sent: draftInput.rstSent || '59', received: draftInput.rstReceived || '59' },
        location: draftInput.qth.trim() || undefined,
        grid: draftInput.grid.trim() || undefined,
        county: draftInput.county.trim() || undefined,
        notes: draftInput.remarks.trim() || undefined,
        loggingMode,
        netLoggerContext: loggingMode === 'nets' && selectedNet
          ? {
              netName: selectedNet.netName,
              netControlCallsign: selectedNet.netControl,
            }
          : undefined,
        contestContext: loggingMode === 'contesting' && contestDetails
          ? { contestName: contestDetails.contestName, exchangeReceived: contestDetails.exchangeReceived }
          : undefined,
        potaContext: loggingMode === 'pota' && draftInput.remarks.trim()
          ? { parkRefs: draftInput.remarks.split(',').map((part) => part.trim()).filter(Boolean) }
          : undefined,
      }, { createContact });
      setLoggingState(result.state);
      setNetsStatus(result.message);
      if (result.backendContact) {
        setAllBackendContacts((prev) => [result.backendContact!, ...prev]);
      }
      setDraft((current) => ({ ...emptyDraft, frequency: current.frequency, band: current.band, mode: current.mode }));
      return true;
    } catch (error) {
      setNetsStatus(`Contact not logged: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [loggingState, selectedNet]);

  const logDraft = useCallback(async (loggingMode: 'nets' | 'contesting' | 'pota' = 'nets') => {
    await persistDraftContact(draft, loggingMode);
  }, [draft, persistDraftContact]);

  // ── DX Spot selected → pre-fill logging draft and open Logging tab ─────
  const handleSelectSpot = useCallback((spot: DXSpot) => {
    const validation = validateStationProfileForLogging(loggingState);
    if (!validation.ok) {
      setNetsStatus(validation.message);
      setTab('settings');
      return;
    }

    const { callsign, frequency, band, mode } = draftFromDxSpot(spot);
    setDraft((current) => ({
      ...emptyDraft,
      callsign,
      frequency,
      band,
      mode,
      rstSent: current.rstSent || '59',
      rstReceived: current.rstReceived || '59',
    }));
    setTab('general');
  }, [loggingState]);

  const logContestDraft = useCallback(async () => {
    if (!contestName.trim()) {
      setNetsStatus('Pick a contest before logging a contest contact.');
      return;
    }
    if (!contestCounter.trim()) {
      setNetsStatus('Set the contest counter before logging a contest contact.');
      return;
    }
    if (!contestExchange.trim()) {
      setNetsStatus('Enter the contact station exchange before logging a contest contact.');
      return;
    }
    const ok = await persistDraftContact(draft, 'contesting', {
      contestName: contestName.trim(),
      exchangeReceived: contestExchange.trim().toUpperCase(),
    });
    if (ok) setContestExchange('');
  }, [contestCounter, contestExchange, contestName, draft, persistDraftContact]);

  const logModalDraft = useCallback(async () => {
    const ok = await persistDraftContact(modalDraft, 'nets');
    if (ok) {
      const focusKey = selectedRosterKey;
      setLogContactModalOpen(false);
      setModalDraft(emptyDraft);
      setTimeout(() => {
        if (!focusKey) return;
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button.log-contact-button[data-roster-key]'));
        const target = buttons.find((button) => button.dataset.rosterKey === focusKey);
        target?.focus();
      }, 0);
    }
  }, [modalDraft, persistDraftContact, selectedRosterKey]);

  // ── Modal UX: focus + keyboard shortcuts ───────────────────────────
  useEffect(() => {
    if (!logContactModalOpen) return;
    const timer = setTimeout(() => {
      modalRstSentRef.current?.focus();
      modalRstSentRef.current?.select();
    }, 0);
    return () => clearTimeout(timer);
  }, [logContactModalOpen]);

  useEffect(() => {
    if (!logContactModalOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!busy) {
          event.preventDefault();
          setLogContactModalOpen(false);
        }
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        const target = event.target as HTMLElement | null;
        if (target?.tagName === 'TEXTAREA') return;
        event.preventDefault();
        if (!busy && modalDraft.callsign.trim()) {
          void logModalDraft();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, logContactModalOpen, logModalDraft, modalDraft.callsign]);

  const updateBackendSetting = useCallback((field: 'backendBaseUrl' | 'username' | 'password', value: string) => {
    setLoggingState((state) => ({ ...state, [field]: value }));
  }, []);

  // ── QRZ XML Lookup on callsign blur/Enter ──────────────────────────
  // When the user enters a callsign and tabs out or hits Enter, look it up
  // via the QRZ XML API (if the user has a verified API key) and populate
  // empty form fields with the returned data. Fields the user already filled
  // are not overwritten. If the callsign matches the user's own station
  // profile callsign, populate from the profile instead.
  const handleCallsignLookup = useCallback(async (callsign: string, target: 'draft' | 'modalDraft') => {
    const call = callsign.trim().toUpperCase();
    if (!call) return;
    const baseUrl = loggingState.backendBaseUrl.trim();
    const token = loggingState.accessToken;
    if (!baseUrl || !token) return;

    // If it's the user's own callsign, fill from station profile
    const myCall = loggingState.stationProfile.callsign.trim().toUpperCase();
    if (call === myCall) {
      const profile = loggingState.stationProfile;
      const enriched: Partial<ContactDraft> = {
        name: profile.operatorName || '',
        grid: profile.homeGrid || '',
        state: profile.state || '',
        county: profile.county || '',
        qth: [profile.city, profile.state].filter(Boolean).join(', ') || '',
      };
      if (target === 'draft') {
        setDraft((prev) => ({
          ...prev,
          name: prev.name || enriched.name || '',
          grid: prev.grid || enriched.grid || '',
          state: prev.state || enriched.state || '',
          county: prev.county || enriched.county || '',
          qth: prev.qth || enriched.qth || '',
        }));
      } else {
        setModalDraft((prev) => ({
          ...prev,
          name: prev.name || enriched.name || '',
          grid: prev.grid || enriched.grid || '',
          state: prev.state || enriched.state || '',
          county: prev.county || enriched.county || '',
          qth: prev.qth || enriched.qth || '',
        }));
      }
      return;
    }

    // QRZ XML lookup for other callsigns
    try {
      const result = await qrzLookup(baseUrl, token, call);
      const fullName = [result.first_name, result.name].filter(Boolean).join(' ');
      const qth = result.addr2 || result.addr1 || '';
      if (target === 'draft') {
        setDraft((prev) => ({
          ...prev,
          name: prev.name || fullName || '',
          grid: prev.grid || result.grid || '',
          state: prev.state || result.state || '',
          county: prev.county || result.county || '',
          qth: prev.qth || qth || '',
        }));
      } else {
        setModalDraft((prev) => ({
          ...prev,
          name: prev.name || fullName || '',
          grid: prev.grid || result.grid || '',
          state: prev.state || result.state || '',
          county: prev.county || result.county || '',
          qth: prev.qth || qth || '',
        }));
      }
    } catch {
      // Silent fail — don't disrupt the user's typing flow
    }
  }, [loggingState.backendBaseUrl, loggingState.accessToken, loggingState.stationProfile]);

  const handleAccountLogin = useCallback(async () => {
    setBusy(true);
    setNetsStatus('Logging in to Log2Go backend...');
    try {
      const result = await logInDesktopAccount(loggingState, { login, getAccountProfile });
      setTab('settings');
      setLoggingState(result.state);
      setAccountProfile(result.accountProfile);
      setNetsStatus(result.message);
      if (result.state.accessToken) {
        void getStationProfiles(result.state.backendBaseUrl, result.state.accessToken)
          .then((serverCollection) => {
            setLoggingState((state) => {
              const serverHasProfiles = hasConfiguredStationProfile(serverCollection);
              const localHasProfiles = hasConfiguredStationProfile(state.profileCollection);
              if (serverHasProfiles) {
                // Server has real profiles — use them
                setNetsStatus(`Loaded ${serverCollection.profiles.length} station profile(s) from Log2Go account.`);
                return applyStationProfileCollection(state, serverCollection);
              }
              if (localHasProfiles && state.accessToken) {
                // Server is empty but local has profiles — push local to server
                void saveStationProfiles(state.backendBaseUrl, state.accessToken, state.profileCollection)
                  .then(() => setNetsStatus('Station profiles saved to Log2Go account.'))
                  .catch((saveError) => setNetsStatus(`Station profile save failed: ${saveError instanceof Error ? saveError.message : String(saveError)}`));
              }
              return state;
            });
          })
          .catch((profileError) => setNetsStatus(`Could not load station profiles from Log2Go account: ${profileError instanceof Error ? profileError.message : String(profileError)}`));
      }
    } catch (error) {
      setNetsStatus(`Log2Go login failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [loggingState]);

  const handleAccountLogout = useCallback(() => {
    setLoggingState((state) => logOutDesktopAccount(state));
    setAccountProfile(undefined);
    setNetsStatus('Logged out of Log2Go backend.');
    setAuthGateVisible(true);
  }, []);

  const persistStationProfileCollection = useCallback((state: LoggingFlowState, reason: string) => {
    if (!state.accessToken) return;
    void saveStationProfiles(state.backendBaseUrl, state.accessToken, state.profileCollection)
      .then(() => setNetsStatus(`Station profiles saved to Log2Go account (${reason}).`))
      .catch((error) => setNetsStatus(`Station profile save failed: ${error instanceof Error ? error.message : String(error)}`));
  }, []);

  // Pull profiles from server periodically (every 60s) when logged in
  useEffect(() => {
    if (!loggingState.accessToken || !loggingState.backendBaseUrl) return;
    const baseUrl = loggingState.backendBaseUrl.trim();
    const token = loggingState.accessToken.trim();
    if (!baseUrl || !token) return;

    const doPull = () => {
      void getStationProfiles(baseUrl, token)
        .then((serverCollection) => {
          const serverHasProfiles = hasConfiguredStationProfile(serverCollection);
          if (serverHasProfiles) {
            const localJson = JSON.stringify(loggingState.profileCollection);
            const serverJson = JSON.stringify(serverCollection);
            if (localJson !== serverJson) {
              setLoggingState((state) => applyStationProfileCollection(state, serverCollection));
            }
          }
        })
        .catch(() => { /* non-fatal */ });
    };

    const interval = setInterval(doPull, 60_000);
    return () => clearInterval(interval);
  }, [loggingState.accessToken, loggingState.backendBaseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auth gate login success handler ──────────────────────────────
  const handleAuthLoginSuccess = useCallback((token: string, profile: AccountProfile, _keepLoggedIn: boolean) => {
    const backendBaseUrl = loggingState.backendBaseUrl;
    setLoggingState((state) => {
      return setBackendSettings(state, {
        backendBaseUrl: state.backendBaseUrl,
        username: profile.username,
        // Web is per-session: token goes in memory for API calls but
        // password is not stored. AuthGate with persistentLogin=false
        // will never try to reuse the token on next visit.
        password: '',
        accessToken: token,
      });
    });
    setAccountProfile(profile);
    setAuthGateVisible(false);
    setTab('settings');
    setNetsStatus(`Logged in as ${profile.callsign || profile.username}. Loading station profiles...`);

    void getStationProfiles(backendBaseUrl, token)
      .then((serverCollection) => {
        setLoggingState((state) => {
          const stateWithToken = setBackendSettings(state, { accessToken: token, username: profile.username, password: '' });
          const serverHasProfiles = hasConfiguredStationProfile(serverCollection);
          const localHasProfiles = hasConfiguredStationProfile(stateWithToken.profileCollection);
          if (serverHasProfiles) {
            setNetsStatus(`Loaded ${serverCollection.profiles.length} station profile(s) from Log2Go account.`);
            return applyStationProfileCollection(stateWithToken, serverCollection);
          }

          if (localHasProfiles) {
            void saveStationProfiles(stateWithToken.backendBaseUrl, token, stateWithToken.profileCollection)
              .then(() => setNetsStatus('Station profiles saved to Log2Go account.'))
              .catch((error) => setNetsStatus(`Station profile save failed: ${error instanceof Error ? error.message : String(error)}`));
            return stateWithToken;
          }

          const seeded = addProfileAction(stateWithToken, {
            callsign: profile.callsign || profile.username,
            profileName: profile.callsign || profile.username,
            defaultMode: 'SSB',
            mobilePortableStatus: 'fixed',
          });
          void saveStationProfiles(seeded.backendBaseUrl, token, seeded.profileCollection)
            .then(() => setNetsStatus('Created and saved default station profile to Log2Go account.'))
            .catch((error) => setNetsStatus(`Station profile save failed: ${error instanceof Error ? error.message : String(error)}`));
          return seeded;
        });
      })
      .catch((error) => setNetsStatus(`Could not load station profiles from Log2Go account: ${error instanceof Error ? error.message : String(error)}`));
  }, [loggingState.backendBaseUrl]);

  // ── Station profile management ─────────────────────────────────────
  const handleActivateProfile = useCallback((profileId: string) => {
    setLoggingState((state) => {
      const next = activateProfileAction(state, profileId);
      persistStationProfileCollection(next, 'active profile changed');
      return next;
    });
  }, [persistStationProfileCollection]);

  const handleAddProfile = useCallback((input: CreateProfileInput) => {
    setLoggingState((state) => {
      const next = addProfileAction(state, input);
      persistStationProfileCollection(next, 'profile added');
      return next;
    });
  }, [persistStationProfileCollection]);

  const handleUpdateProfile = useCallback((profileId: string, input: UpdateProfileInput) => {
    setLoggingState((state) => {
      const next = updateProfileAction(state, profileId, input);
      persistStationProfileCollection(next, 'profile updated');
      return next;
    });
  }, [persistStationProfileCollection]);

  const handleDeleteProfile = useCallback((profileId: string) => {
    setLoggingState((state) => {
      const next = deleteProfileAction(state, profileId);
      persistStationProfileCollection(next, 'profile deleted');
      return next;
    });
  }, [persistStationProfileCollection]);

  const subscribeToNet = useCallback(async () => {
    if (!selectedNet) {
      setNetsStatus('Select a net before subscribing.');
      return;
    }
    const callsign = loggingState.stationProfile.callsign.trim().toUpperCase();
    if (!callsign) {
      setNetsStatus('Set a station profile callsign before subscribing.');
      return;
    }
    setBusy(true);
    setNetsStatus(`Subscribing to ${selectedNet.netName}...`);
    try {
      if (selectedNet.source === 'log2go') {
        if (!selectedNet.net_id) {
          throw new Error('Log2Go net missing net_id');
        }
        await subscribeLog2GoNet(
          loggingState.backendBaseUrl,
          selectedNet.net_id,
          callsign,
          loggingState.stationProfile.operatorName,
        );
      } else {
        // NetLogger legacy subscribe via backend proxy
        await requestAIMSessionKey({
          serverName: selectedNet.serverName,
          netName: selectedNet.netName,
          callsign,
          operatorName: loggingState.stationProfile.operatorName,
          backendBaseUrl: loggingState.backendBaseUrl,
        });
      }
      setAimJoined(true);
      if (selectedNet.source !== 'log2go') await wait(NETLOGGER_JOINED_POLL_DELAY_MS);
      await refreshSelectedNet(selectedNet, true);
      setNetsStatus(`Subscribed to ${selectedNet.netName} as ${callsign}. Roster/AIM polling is active.`);
    } catch (error) {
      setNetsStatus(`Subscribe failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [loggingState.backendBaseUrl, loggingState.stationProfile.callsign, loggingState.stationProfile.operatorName, refreshSelectedNet, selectedNet]);

  const unsubscribeFromSelectedNet = useCallback(async () => {
    const net = selectedNet;
    if (!net) return;
    const callsign = loggingState.stationProfile.callsign.trim().toUpperCase();
    setBusy(true);
    setNetsStatus(`Unsubscribing from ${net.netName}...`);
    try {
      if (net.source === 'log2go') {
        if (!net.net_id) {
          throw new Error('Log2Go net missing net_id');
        }
        await unsubscribeLog2GoNet(
          loggingState.backendBaseUrl,
          net.net_id,
          callsign,
          loggingState.stationProfile.operatorName,
        );
      } else {
        await unsubscribeFromNet({
          serverName: net.serverName,
          netName: net.netName,
          callsign,
          operatorName: loggingState.stationProfile.operatorName,
          backendBaseUrl: loggingState.backendBaseUrl,
        });
      }
      setNetsStatus(`Unsubscribed from ${net.netName}. You can resubscribe or leave the net.`);
    } catch (error) {
      setNetsStatus(`Unsubscribe failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAimJoined(false);
      setBusy(false);
    }
  }, [loggingState.backendBaseUrl, loggingState.stationProfile.callsign, loggingState.stationProfile.operatorName, selectedNet]);

  const sendAimDraft = useCallback(async () => {
    if (!selectedNet) {
      setNetsStatus('Select a net before sending AIM.');
      return;
    }
    if (!aimJoined) {
      setNetsStatus('Join the net first so a write-capable AIM session is active.');
      return;
    }
    const message = aimDraft.trim();
    if (!message) {
      setNetsStatus('Type an AIM message before sending.');
      return;
    }
    const callsign = loggingState.stationProfile.callsign.trim().toUpperCase();
    setBusy(true);
    try {
      if (selectedNet.source === 'log2go') {
        if (!selectedNet.net_id) {
          throw new Error('Log2Go net missing net_id');
        }
        await sendLog2GoAIM(
          loggingState.backendBaseUrl,
          selectedNet.net_id,
          callsign,
          loggingState.stationProfile.operatorName,
          message,
        );
        setAimDraft('');
        setNetsStatus(`AIM sent to ${selectedNet.netName}.`);
        void refreshSelectedNet(selectedNet);
      } else {
        await sendAIMMessage({
          serverName: selectedNet.serverName,
          netName: selectedNet.netName,
          callsign,
          operatorName: loggingState.stationProfile.operatorName,
          message,
          backendBaseUrl: loggingState.backendBaseUrl,
        });
        setAimDraft('');
        setNetsStatus(`AIM sent to ${selectedNet.netName}. NetLogger messages can take 15-20 seconds to appear.`);
        setTimeout(() => void refreshSelectedNet(selectedNet), 20_500);
      }
    } catch (error) {
      setNetsStatus(`AIM send failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [aimDraft, aimJoined, loggingState.backendBaseUrl, loggingState.stationProfile.callsign, loggingState.stationProfile.operatorName, refreshSelectedNet, selectedNet]);

  const leaveNet = useCallback(async () => {
    const net = selectedNet;
    if (!net) return;
    const callsign = loggingState.stationProfile.callsign.trim().toUpperCase();
    setBusy(true);
    setNetsStatus(`Leaving ${net.netName}...`);
    try {
      if (aimJoined) {
        if (net.source === 'log2go' && net.net_id) {
          await unsubscribeLog2GoNet(
            loggingState.backendBaseUrl,
            net.net_id,
            callsign,
            loggingState.stationProfile.operatorName,
          ).catch((error) => console.warn('Log2Go unsubscribe failed:', error));
        } else {
          await unsubscribeFromNet({
            serverName: net.serverName,
            netName: net.netName,
            callsign,
            operatorName: loggingState.stationProfile.operatorName,
            backendBaseUrl: loggingState.backendBaseUrl,
          }).catch((error) => console.warn('NetLogger unsubscribe failed:', error));
        }
      }
    } finally {
      setSelectedNet(undefined);
      setSelectedNetType(null);
      setSelectedRosterKey(undefined);
      setCheckins([]);
      setCurrentOperatingSerial(undefined);
      setAimMessages([]);
      setMonitors([]);
      setAimJoined(false);
      setMonitoringRosterOnly(false);
      setAimDraft('');
      setAimLastId(0);
      setShowAim(false);
      setShowMonitors(false);
      setCurrentOperatingSerial(undefined);
      aimLastIdRef.current = 0;
      lastExtDataSerialRef.current = 0;
      setNetsListInterval(20);
      setNetsStatus('Left net. Select another net or navigate away.');
      setBusy(false);
    }
  }, [aimJoined, loggingState.backendBaseUrl, loggingState.stationProfile.callsign, loggingState.stationProfile.operatorName, selectedNet]);

  /** Open a past (closed) net in read-only history view. */
  const openPastNet = useCallback(async (net: PastNetInfo) => {
    setBusy(true);
    setNetsStatus(`Loading history for ${net.name}...`);
    try {
      const detail = await fetchNetHistory(loggingState.backendBaseUrl.trim(), net.id);
      setHistoryNet(detail);
      setViewingHistory(true);
      setNetsStatus(`Viewing history for ${net.name}: ${detail.checkins.length} check-in(s), ${detail.aim_messages.length} AIM message(s), ${detail.monitors.length} monitor(s).`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setNetsStatus(`Failed to load history for ${net.name}: ${msg}`);
    } finally {
      setBusy(false);
    }
  }, [loggingState.backendBaseUrl]);

  /** Leave the read-only history view and return to the active nets list. */
  const leaveHistory = useCallback(() => {
    setViewingHistory(false);
    setHistoryNet(null);
    setNetsStatus('Returned to active nets list.');
  }, []);

  useEffect(() => {
    if (tab === 'netlogger' || !selectedNet || (!aimJoined && !monitoringRosterOnly)) return;
    const timeout = window.setTimeout(() => {
      void leaveNet();
    }, ACTIVITY_AWAY_UNSUBSCRIBE_MS);
    return () => window.clearTimeout(timeout);
  }, [aimJoined, monitoringRosterOnly, leaveNet, selectedNet, tab]);

  return (
    <main className={`app-shell${tab === "dashboard" ? " dashboard-mode" : ""}`}>


      <div className="top-bar-unified">
        <nav className="tab-bar" aria-label="Log2Go desktop sections">
          {([
            ['dashboard', 'Dashboard'],
            ['netlogger', 'Nets'],
            ['dxspots', 'DX Spots'],
            ['general', 'Logging'],
            ['contest', 'Contest'],
            ['logbook', 'Logbook'],
            ['settings', 'Settings'],
          ] as const).map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} title={label} aria-label={label} onClick={() => {
              const activityTabs = ['netlogger', 'general', 'contest', 'dxspots'];
              if (activityTabs.includes(id)) {
                const validation = validateStationProfileForLogging(loggingState);
                if (!validation.ok) {
                  setNetsStatus(validation.message);
                  setTab('settings');
                  return;
                }
              }
              setTab(id as AppTab);
            }}>
              {label}
            </button>
          ))}
        </nav>
        <div className="tb-center-group">
          <span className="tb-logo">LOG2GO</span>
          <div className="tb-clock-block">
            <div className="tb-clock-label">UTC</div>
            <div className="tb-clock-time">{utcTime}</div>
            <div className="tb-clock-date">{utcDate}</div>
          </div>
          <div className="tb-clock-block">
            <div className="tb-clock-label">LOCAL</div>
            <div className="tb-clock-time">{localTime}</div>
            <div className="tb-clock-date">{localDate}</div>
          </div>
          <span className="tb-page-label">{tab === 'dashboard' ? 'DASHBOARD' : tab === 'netlogger' ? 'NETS' : tab === 'dxspots' ? 'DX SPOTS' : tab === 'general' ? 'LOGGING' : tab === 'contest' ? 'CONTEST' : tab === 'logbook' ? 'LOGBOOK' : 'SETTINGS'}</span>
        </div>
        <div className="tb-divider-ext" />
        <div className="tb-right">
          {loggingState.accessToken ? (
            <span className="tb-callsign">{loggingState.stationProfile?.callsign?.trim() || 'LOG2GO'}</span>
          ) : (
            <button className="tb-login-btn" onClick={() => setAuthGateVisible(true)}>LOG IN</button>
          )}
        </div>
          {!offlineStatus.isOnline && (
            <span style={{ color: '#ff6b6b', marginRight: 8 }} title="Offline — contacts saved locally, will sync when reconnected">
              ⚠ Offline ({offlineStatus.stats.pendingSync} pending)
            </span>
          )}
          {offlineStatus.isOnline && offlineStatus.stats.pendingSync > 0 && (
            <span style={{ color: '#ffa500', marginRight: 8 }} title="Syncing pending contacts">
              ↻ Syncing {offlineStatus.stats.pendingSync} contact(s)…
            </span>
          )}
      </div>

      {tab === 'dashboard' ? (
        <DashboardTab accessToken={loggingState.accessToken} backendBaseUrl={loggingState.backendBaseUrl} accountProfile={accountProfile} stationGrid={loggingState.stationProfile.homeGrid} />
      ) : tab === 'dxspots' ? (
        <DxSpotsPanel
          accessToken={loggingState.accessToken}
          backendBaseUrl={loggingState.backendBaseUrl}
          onSelectSpot={handleSelectSpot}
        />
      ) : tab === 'netlogger' ? (
        <>
        {viewingHistory ? (
          <section className="netlogger-layout history-view">
            <aside className="panel active-nets-panel history-sidebar">
              <div className="panel-heading">
                <h2>Net History</h2>
                <button onClick={() => { setNetsListInterval(20); void refreshActiveNets(); }} disabled={busy} type="button">Refresh</button>
              </div>
              <button className="primary" onClick={leaveHistory} type="button" title="Return to the active nets list">← Back to Active Nets</button>
              {historyNet && (
                <div className="history-net-summary">
                  <h3 className="net-title">{historyNet.name}</h3>
                  <p className="net-meta">Log2Go · {historyNet.frequency || 'freq ?'} · {historyNet.mode || 'mode ?'} · {historyNet.band || 'band ?'}</p>
                  <p className="net-meta">NCS {historyNet.net_control || '?'} · Logger {historyNet.logger || '?'}</p>
                  <p className="net-meta">Created {formatIsoTimestamp(historyNet.created_at)}</p>
                  <p className="net-meta">Closed {formatIsoTimestamp(historyNet.closed_at)}</p>
                  <div className="net-summary-strip">
                    <span><b>Check-ins</b> {historyCheckins.length}</span>
                    <span><b>AIM</b> {historyAimMessages.length}</span>
                    <span><b>Monitors</b> {historyMonitors.length}</span>
                  </div>
                </div>
              )}
            </aside>

            <section className="center-column">
              <div className="roster-pane" style={{ height: '60%' }}>
                <section className="panel roster-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>{historyNet ? historyNet.name : 'Roster'}</h2>
                      <p>{historyNet ? `Log2Go · ${historyNet.frequency || 'freq ?'} · ${historyNet.mode || 'mode ?'} · ${historyNet.band || 'band ?'} · read-only history` : 'Select a past net to view its roster.'}</p>
                    </div>
                  </div>
                  <div className="net-summary-strip">
                    <span><b>NCS</b> {historyNet?.net_control || '—'}</span>
                    <span><b>Logger</b> {historyNet?.logger || '—'}</span>
                    <span><b>Check-ins</b> {historyCheckins.length}</span>
                    <span><b>AIM</b> {historyAimMessages.length}</span>
                    <span><b>Monitors</b> {historyMonitors.length}</span>
                  </div>
                  <div className="roster-toolbar" aria-label="Roster display controls">
                    <span>Density</span>
                    <div className="mini-tabs density-tabs" role="group" aria-label="Roster density">
                      {rosterDensityOptions.map((option) => (
                        <button
                          key={option.value}
                          className={rosterDensity === option.value ? 'active' : ''}
                          type="button"
                          aria-pressed={rosterDensity === option.value}
                          onClick={() => setRosterDensity(option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="roster-table-wrap">
                    <table className={`roster-table ${rosterDensityClass(rosterDensity)}`}>
                      <thead>
                        <tr>
                          <th className="sortable" onClick={() => toggleRosterSort('serialNo')}># {rosterSort.key === 'serialNo' ? (rosterSort.dir === 'asc' ? '▲' : '▼') : ''}</th>
                          <th>W</th>
                          <th className="sortable" onClick={() => toggleRosterSort('callsign')}>Call {rosterSort.key === 'callsign' ? (rosterSort.dir === 'asc' ? '▲' : '▼') : ''}</th>
                          <th className="sortable" onClick={() => toggleRosterSort('firstName')}>Name {rosterSort.key === 'firstName' ? (rosterSort.dir === 'asc' ? '▲' : '▼') : ''}</th>
                          <th>QTH</th>
                          <th className="sortable" onClick={() => toggleRosterSort('state')}>ST {rosterSort.key === 'state' ? (rosterSort.dir === 'asc' ? '▲' : '▼') : ''}</th>
                          <th>County</th>
                          <th className="sortable" onClick={() => toggleRosterSort('grid')}>Grid {rosterSort.key === 'grid' ? (rosterSort.dir === 'asc' ? '▲' : '▼') : ''}</th>
                          <th className="sortable" onClick={() => toggleRosterSort('status')}>Status {rosterSort.key === 'status' ? (rosterSort.dir === 'asc' ? '▲' : '▼') : ''}</th>
                          <th>Remarks</th>
                          <th>QSL</th>
                          <th>ID</th>
                          <th>DXCC</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedHistoryCheckins.length === 0 ? (
                          <tr><td colSpan={13} className="net-list-empty">No check-ins recorded for this net.</td></tr>
                        ) : sortedHistoryCheckins.map((checkin) => {
                          const rowKey = rosterRowKey(checkin);
                          return (
                            <tr
                              key={rowKey}
                              className={statusClass(checkin.status, false)}
                            >
                              <td>{checkin.serialNo}</td>
                              <td className="worked-cell"></td>
                              <td className="callsign"><span>{checkin.callsign}</span></td>
                              <td>{checkin.preferredName || checkin.firstName}</td>
                              <td>{checkin.cityCountry}</td>
                              <td>{checkin.state}</td>
                              <td>{checkin.county}</td>
                              <td>{checkin.grid}</td>
                              <td>{checkin.status}</td>
                              <td className="remarks-cell">{checkin.remarks}</td>
                              <td>{checkin.qslInfo}</td>
                              <td>{checkin.memberId}</td>
                              <td>{checkin.dxcc}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              <div className="pane-divider" role="separator" aria-orientation="horizontal" />

              <div className="recent-contacts-pane" style={{ height: '40%' }}>
                <section className="panel recent-contacts-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>AIM Transcript</h2>
                      <p>Read-only history — {historyAimMessages.length} message(s)</p>
                    </div>
                  </div>
                  <div className="recent-contacts-list">
                    <div className="scroll-box comms-scroll aim-scroll" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
                      {historyAimMessages.length === 0 ? <p>No AIM messages recorded for this net.</p> : historyAimMessages.map((msg) => (
                        <p key={msg.id}><b>{msg.callsign}</b> <span>{msg.aimTime}</span><br />{msg.message}</p>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            </section>

            <aside className="right-stack">
              <section className="panel comms-panel resizable-section resizable-comms">
                <div className="comms-header">
                  <div>
                    <h2>Monitors</h2>
                    <p>{historyMonitors.length} monitor(s) — read-only</p>
                  </div>
                </div>
                <div className="scroll-box compact comms-scroll" role="tabpanel" aria-label="Monitors">
                  {historyMonitors.length === 0 ? <p>No monitors recorded for this net.</p> : historyMonitors.map((monitor, i) => {
                    const roleClass = monitor.role
                      ? monitor.role === 'NCS' ? 'status-nc'
                        : monitor.role === 'CO_NCS' ? 'status-co-ncs'
                        : monitor.role === 'LOGGER' ? 'status-logger'
                        : monitor.role === 'RELAY' ? 'status-relay'
                        : ''
                      : '';
                    return (
                    <p key={`hmon:${i}:${monitor.callsign}`} className={roleClass}>{monitor.offlineStatus ? '○' : '●'} {monitor.callsign}</p>
                    );
                  })}
                </div>
              </section>
            </aside>
          </section>
        ) : (
        <section className={`netlogger-layout ${(aimJoined || monitoringRosterOnly) ? 'net-subscribed' : ''} ${showCommsPanel ? '' : 'comms-hidden'}`}>
          {!aimJoined && !monitoringRosterOnly && (
            <aside className="panel active-nets-panel">
            <div className="panel-heading">
              <h2>Active Nets</h2>
              <div className="panel-heading-actions">
                {loggingState.accessToken && (
                  <button
                    className="primary small-button"
                    onClick={() => void openCreateNetModal()}
                    disabled={busy}
                    type="button"
                    title="Create a new Log2Go net and become NCS"
                  >+ Create Net</button>
                )}
                <button onClick={() => { setNetsListInterval(20); void refreshActiveNets(); }} disabled={busy}>Refresh</button>
              </div>
            </div>
            <input
              className="search-box"
              placeholder="Filter by net, server, band, mode, NCS..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {!selectedNet && netsListInterval > 20 && (
              <p className="auto-refresh-hint">Auto-refresh in {netsListInterval}s</p>
            )}
            <div className="net-list">
              {/* ── Log2Go nets (full features) ── */}
              <div className="net-list-section">
                <h3 className="net-list-section-heading">Log2Go Nets</h3>
                {filteredLog2GoNets.length === 0 ? (
                  <p className="net-list-empty">No active Log2Go nets.</p>
                ) : (
                  filteredLog2GoNets.map((net) => (
                    <div
                      key={`log2go:${net.net_id ?? net.netName}`}
                      className={selectedNet?.net_id === net.net_id && selectedNetType === 'log2go' ? 'net-row selected' : 'net-row'}
                    >
                      <button className="net-row-info" onClick={() => selectNet(net)} type="button">
                        <span className="net-title">{net.netName}</span>
                        <span className="net-meta">Log2Go · {net.frequency || 'freq ?'} · {net.mode || 'mode ?'} · {net.band || 'band ?'}</span>
                        <span className="net-meta">NCS {net.netControl || '?'} · Logger {net.logger || '?'}</span>
                      </button>
                      <button
                        className="net-row-subscribe primary small-button"
                        onClick={() => void selectAndSubscribe(net)}
                        disabled={busy}
                        type="button"
                      >Subscribe{net.subscriberCount > 0 ? ` (${net.subscriberCount})` : ''}</button>
                    </div>
                  ))
                )}
              </div>

              {/* ── NetLogger nets (roster/logging only) ── */}
              <div className="net-list-section">
                <h3 className="net-list-section-heading">NetLogger Nets</h3>
                <p className="net-list-note">Roster and logging only — AIM and Monitors not available for NetLogger nets.</p>
                {filteredNets.length === 0 ? (
                  <p className="net-list-empty">No active NetLogger nets.</p>
                ) : (
                  filteredNets.map((net) => (
                    <div
                      key={`netlogger:${net.serverName}:${net.netName}`}
                      className={selectedNet?.serverName === net.serverName && selectedNet?.netName === net.netName && selectedNetType === 'netlogger' ? 'net-row selected' : 'net-row'}
                    >
                      <button className="net-row-info" onClick={() => selectNet(net)} type="button">
                        <span className="net-title">{net.netName}</span>
                        <span className="net-meta">{net.serverName} · {net.frequency || 'freq ?'} · {net.mode || 'mode ?'} · {net.band || 'band ?'}</span>
                        <span className="net-meta">NCS {net.netControl || '?'} · Logger {net.logger || '?'}</span>
                      </button>
                      <button
                        className="net-row-subscribe primary small-button"
                        onClick={() => void selectAndMonitor(net)}
                        disabled={busy}
                        type="button"
                        title="Load roster only (no AIM, no monitors, no subscribe)"
                      >Monitor</button>
                    </div>
                  ))
                )}
              </div>

              {/* ── Past nets (read-only history) ── */}
              <div className="net-list-section">
                <h3 className="net-list-section-heading">Past Nets</h3>
                <p className="net-list-note">Closed nets — click to view roster, AIM transcript, and monitors (read-only).</p>
                {pastNets.length === 0 ? (
                  <p className="net-list-empty">No past nets available.</p>
                ) : (
                  pastNets.map((net) => (
                    <div
                      key={`past:${net.id}`}
                      className="net-row"
                    >
                      <button
                        className="net-row-info"
                        onClick={() => void openPastNet(net)}
                        type="button"
                        title="View history (read-only)"
                      >
                        <span className="net-title">{net.name}</span>
                        <span className="net-meta">Log2Go · {net.frequency || 'freq ?'} · {net.mode || 'mode ?'} · {net.band || 'band ?'}</span>
                        <span className="net-meta">NCS {net.net_control || '?'} · Logger {net.logger || '?'} · Closed {formatIsoTimestamp(net.closed_at)}</span>
                      </button>
                      <span className="net-row-subscribe net-row-past-counts" title="Check-ins / AIM messages">
                        {net.checkin_count} chk · {net.aim_count} aim
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
          )}

          <section className="center-column">
            <div className="roster-pane" style={{ height: showRecentContacts ? `${rosterSplitPct}%` : '100%' }}>
              <section className="panel roster-panel">
                {rosterHeaderCollapsed ? (
                  <div className="roster-header-collapsed">
                    <button className="roster-collapse-toggle" type="button" title="Expand header" onClick={() => setRosterHeaderCollapsed(false)}>▼</button>
                    <span className="roster-collapsed-netname">{selectedNet?.netName || 'No net selected'}</span>
                    <span className="roster-collapsed-info">{selectedNet ? `${selectedNet.frequency || ''} · ${selectedNet.mode || ''} · ${selectedNet.band || ''}` : ''}</span>
                    <span className="roster-collapsed-info"><b>NCS</b> {selectedNet?.netControl || '—'}</span>
                    <span className="roster-collapsed-info"><b>Chk</b> {checkins.length}</span>
                    <span className="roster-collapsed-info"><b>AIM</b> {aimMessages.length}</span>
                    <span className="roster-collapsed-info"><b>Mon</b> {monitors.length}</span>
                    <span className="roster-collapsed-user">{loggingState.stationProfile.callsign || ''}</span>
                    <div className="roster-collapsed-actions">
                      <button className={`small-button comms-toggle ${showAim ? 'active' : ''}`} disabled={!aimJoined || aimMessages.length === 0} onClick={() => { if (!showAim) setCommsTab('aim'); setShowAim(!showAim); }} type="button" title="Toggle AIM">AIM</button>
                      <button className={`small-button comms-toggle ${showMonitors ? 'active' : ''}`} disabled={!aimJoined || monitors.length === 0} onClick={() => { if (!showMonitors) setCommsTab('monitors'); setShowMonitors(!showMonitors); }} type="button" title="Toggle Monitors">Mon</button>
                      {(aimJoined || monitoringRosterOnly) && <button className="danger small-button" onClick={() => void leaveNet()} disabled={busy} type="button">{monitoringRosterOnly && !aimJoined ? 'Leave' : 'Leave Net'}</button>}
                    </div>
                  </div>
                ) : (
                <>
                <div className="panel-heading roster-heading-3col">
                  <div className="roster-heading-left">
                    <h2>Roster</h2>
                    <p>{selectedNet ? `${selectedNet.source === 'log2go' ? 'Log2Go' : selectedNet.serverName} · ${selectedNet.frequency} · ${selectedNet.mode} · ${selectedNet.band}${aimJoined ? '' : monitoringRosterOnly ? ' · roster-only (no AIM/monitors)' : ' · click Subscribe to load roster/AIM'}` : 'Select a net, then click Subscribe or Monitor to load check-ins.'}</p>
                  </div>
                  {selectedNet && (aimJoined || monitoringRosterOnly) && (
                    <div className="roster-user-banner">
                      <div className="roster-user-netname">{selectedNet.netName}</div>
                      <div className="roster-user-label">Currently Logged in User</div>
                      <div className="roster-user-callsign">{loggingState.stationProfile.callsign || '—'}</div>
                    </div>
                  )}
                  <div className="panel-heading-actions">
                    <button
                      className={`small-button comms-toggle ${showRecentContacts ? 'active' : ''}`}
                      onClick={() => setShowRecentContacts(!showRecentContacts)}
                      type="button"
                      title="Toggle Recent Contacts panel"
                    >
                      Contacts
                    </button>
                    {selectedNetType === 'log2go' && (
                      <>
                        <button
                          className={`small-button comms-toggle ${showAim ? 'active' : ''}`}
                          onClick={() => { if (!showAim) setCommsTab('aim'); setShowAim(!showAim); }}
                          disabled={!aimJoined || aimMessages.length === 0}
                          type="button"
                          title={!aimJoined ? 'Subscribe to a net first' : aimMessages.length === 0 ? 'Waiting for AIM data...' : 'Toggle AIM panel'}
                        >
                          AIM
                        </button>
                        <button
                          className={`small-button comms-toggle ${showMonitors ? 'active' : ''}`}
                          onClick={() => { if (!showMonitors) setCommsTab('monitors'); setShowMonitors(!showMonitors); }}
                          disabled={!aimJoined || monitors.length === 0}
                          type="button"
                          title={!aimJoined ? 'Subscribe to a net first' : monitors.length === 0 ? 'Waiting for monitor data...' : 'Toggle Monitors panel'}
                        >
                          Monitors
                        </button>
                      </>
                    )}
                    {(aimJoined || monitoringRosterOnly) && (
                      <button className="danger small-button" onClick={() => void leaveNet()} disabled={busy} type="button">{monitoringRosterOnly && !aimJoined ? 'Leave Roster' : 'Leave Net'}</button>
                    )}
                    {isNcs && selectedNetType === 'log2go' && aimJoined && (
                      <button className="danger small-button" onClick={() => void handleCloseNet()} disabled={busy} type="button" title="Close this net (NCS only)">Close Net</button>
                    )}
                  </div>
                </div>
                <div className="net-summary-strip">
                  {selectedNetType === 'log2go' && selectedNet?.net_id && (
                    <span className="share-url">
                      <input
                        readOnly
                        value={`https://log2goapp.net/app/?net=${selectedNet.net_id}`}
                        onClick={(e) => { (e.target as HTMLInputElement).select(); navigator.clipboard?.writeText(`https://log2goapp.net/app/?net=${selectedNet.net_id}`); }}
                        title="Click to copy share URL"
                      />
                    </span>
                  )}
                  <span><b>NCS</b> {selectedNet?.netControl || '—'}</span>
                  <span><b>Logger</b> {selectedNet?.logger || '—'}</span>
                  <span><b>Check-ins</b> {checkins.length}</span>
                  <span><b>AIM</b> {aimMessages.length}</span>
                  <span><b>Monitors</b> {monitors.length}</span>
                  {swlCount > 0 && <span><b>SWL</b> {swlCount}</span>}
                  {aimJoined && myRole !== 'MONITOR' && <span className={`role-badge role-badge-${myRole.toLowerCase()}`}>Your role: {myRole === 'CO_NCS' ? 'Co-NCS' : myRole.charAt(0) + myRole.slice(1).toLowerCase()}</span>}
                  {aimJoined && amLogger && myRole !== 'LOGGER' && <span className="role-badge role-badge-logger">Logger</span>}
                </div>
                <div className="roster-toolbar" aria-label="Roster display controls">
                  <button className="roster-collapse-toggle" type="button" title="Collapse header" onClick={() => setRosterHeaderCollapsed(true)}>▲</button>
                  <span>Density</span>
                  <div className="mini-tabs density-tabs" role="group" aria-label="Roster density">
                    {rosterDensityOptions.map((option) => (
                      <button
                        key={option.value}
                        className={rosterDensity === option.value ? 'active' : ''}
                        type="button"
                        aria-pressed={rosterDensity === option.value}
                        onClick={() => setRosterDensity(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <button
                    className="needed-next-btn"
                    type="button"
                    title="Find Needed Next station (nxt)"
                    onClick={handleNeededNext}
                  >
                    <span className="arrow">▼</span> Needed Next
                  </button>
                  <button
                    className="small-button"
                    type="button"
                    title={`Highlighter: ${highlighterMode} (F2 to toggle)`}
                    onClick={handleToggleHighlighter}
                  >
                    {highlighterMode === 'manual' ? 'Manual Highlight' : 'Auto Highlight'}
                  </button>
                  <button
                    className="small-button"
                    type="button"
                    title="Find callsign in roster (Ctrl+F)"
                    onClick={handleFindCallsign}
                  >
                    Find
                  </button>
                  <button
                    className="small-button"
                    type="button"
                    title="Preferences"
                    onClick={() => setShowPreferences(true)}
                  >
                    Preferences
                  </button>
                  {isNcs && selectedNetType === 'log2go' && (
                    <div className="roster-toolbar-assign">
                      <input
                        className="roster-cell-input"
                        placeholder="Assign role to callsign..."
                        value={assignRoleCallsign}
                        onChange={(e) => setAssignRoleCallsign(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && assignRoleCallsign.trim()) setAssignRoleMenuOpen(true); }}
                        style={{ width: '180px' }}
                      />
                      {assignRoleMenuOpen && assignRoleCallsign.trim() && (
                        <div className="assign-role-menu">
                          {['NCS', 'CO_NCS', 'LOGGER', 'RELAY', 'MONITOR'].map((r) => (
                            <button
                              key={r}
                              className="context-menu-item"
                              onClick={() => { void handlePromote(assignRoleCallsign.trim().toUpperCase(), r); setAssignRoleMenuOpen(false); setAssignRoleCallsign(''); }}
                            >
                              {r === 'MONITOR' ? 'Demote to Monitor' : `Promote to ${r === 'CO_NCS' ? 'Co-NCS' : r.charAt(0) + r.slice(1).toLowerCase()}`}
                            </button>
                          ))}
                          <button className="context-menu-item" onClick={() => { setAssignRoleMenuOpen(false); setAssignRoleCallsign(''); }}>Cancel</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                </>
                )}
                {findCallsignOpen && (
                  <div className="find-callsign-bar">
                    <input
                      type="text"
                      placeholder="Find callsign in roster..."
                      value={findCallsignQuery}
                      autoFocus
                      onChange={(e) => setFindCallsignQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') executeFindCallsign(); if (e.key === 'Escape') setFindCallsignOpen(false); }}
                    />
                    <button className="small-button" type="button" onClick={executeFindCallsign}>Find</button>
                    {findCallsignResult && <span className="find-result">{findCallsignResult}</span>}
                    <button className="find-close" type="button" onClick={() => setFindCallsignOpen(false)}>✕</button>
                  </div>
                )}
                <div className="roster-table-wrap">
                  <table className={`roster-table ${rosterDensityClass(rosterDensity)}`} ref={rosterTableRef}>
                    <thead>
                      <tr>
                        <th className="sortable" onClick={() => toggleRosterSort('serialNo')}># {rosterSort.key === 'serialNo' ? (rosterSort.dir === 'asc' ? '▲' : '▼') : ''}</th>
                        <th>W</th>
                        <th className="sortable" onClick={() => toggleRosterSort('callsign')}>Call {rosterSort.key === 'callsign' ? (rosterSort.dir === 'asc' ? '▲' : '▼') : ''}</th>
                        <th className="sortable" onClick={() => toggleRosterSort('firstName')}>Name {rosterSort.key === 'firstName' ? (rosterSort.dir === 'asc' ? '▲' : '▼') : ''}</th>
                        <th>QTH</th>
                        <th className="sortable" onClick={() => toggleRosterSort('state')}>ST {rosterSort.key === 'state' ? (rosterSort.dir === 'asc' ? '▲' : '▼') : ''}</th>
                        <th>County</th>
                        <th className="sortable" onClick={() => toggleRosterSort('grid')}>Grid {rosterSort.key === 'grid' ? (rosterSort.dir === 'asc' ? '▲' : '▼') : ''}</th>
                        <th className="sortable" onClick={() => toggleRosterSort('status')}>Status {rosterSort.key === 'status' ? (rosterSort.dir === 'asc' ? '▲' : '▼') : ''}</th>
                        <th>Remarks</th>
                        <th>QSL</th>
                        <th>ID</th>
                        <th>DXCC</th>
                        <th>Log</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedCheckins.map((checkin) => {
                        const rowKey = rosterRowKey(checkin);
                        const isWorkedLocally = workedFlag(checkin, loggingState.contacts, selectedNet);
                        const isWorkedOnBackend = backendWorkedCalls.has(checkin.callsign.trim().toUpperCase());
                        const workedMark = isWorkedLocally || isWorkedOnBackend ? 'W' : '';
                        const workedClass = workedMark ? 'status-worked' : '';
                        const selectedClass = selectedRosterKey === rowKey ? 'roster-row-selected' : '';
                        const isEditingCallsign = editingRosterKey === rowKey && editingField === 'callsign';
                        const canEdit = amLogger && selectedNetType === 'log2go';
                        return (
                          <tr
                            key={rowKey}
                            className={`${statusClass(checkin.status, checkin.serialNo === currentOperatingSerial)} ${workedClass} ${selectedClass} ${highlightedSerial === checkin.serialNo ? 'station-highlighted' : ''}`.trim()}
                            data-serial={checkin.serialNo}
                            onClick={() => {
                              useRosterCheckin(checkin);
                              if (highlighterMode === 'automatic') setHighlightedSerial(checkin.serialNo);
                            }}
                            onContextMenu={(e) => {
                              if ((isNcs || amLogger) && selectedNetType === 'log2go') {
                                e.preventDefault();
                                setContextMenuType('roster');
                                setContextMenu({ x: e.clientX, y: e.clientY, callsign: checkin.callsign, serialNo: checkin.serialNo });
                              }
                            }}
                          >
                            <td>{checkin.serialNo}</td>
                            <td className="worked-cell">{workedMark}</td>
                            <td
                              className="callsign"
                              onClick={(e) => e.stopPropagation()}
                              onDoubleClick={(e) => {
                                if (canEdit) {
                                  e.stopPropagation();
                                  setEditingRosterKey(rowKey);
                                  setEditingField('callsign');
                                  setEditingCallsign(checkin.callsign);
                                }
                              }}
                              title={canEdit ? 'Double-click to edit callsign' : undefined}
                              style={canEdit ? { cursor: 'text' } : undefined}
                            >
                              {canEdit && isEditingCallsign ? (
                                <input
                                  className="roster-cell-input"
                                  value={editingCallsign}
                                  autoFocus
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => setEditingCallsign(e.target.value)}
                                  onBlur={() => {
                                    if (editingCallsign.trim()) {
                                      void handleRosterQrzLookup(editingCallsign, checkin.serialNo);
                                    }
                                    setEditingRosterKey(null);
                                    setEditingField(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === 'Tab') {
                                      e.preventDefault();
                                      if (editingCallsign.trim()) {
                                        void handleRosterQrzLookup(editingCallsign, checkin.serialNo);
                                      }
                                      setEditingRosterKey(null);
                                      setEditingField(null);
                                    }
                                    if (e.key === 'Escape') {
                                      setEditingRosterKey(null);
                                      setEditingField(null);
                                    }
                                  }}
                                />
                              ) : (
                                checkin.callsign || '\u00A0'
                              )}
                            </td>
                            <EditableCell canEdit={canEdit} rowKey={rowKey} field="first_name" value={checkin.preferredName || checkin.firstName} serialNo={checkin.serialNo} editingRowKey={editingRosterKey} editingFieldName={editingField} editingValue={editingValue} setEditingRowKey={setEditingRosterKey} setEditingFieldName={setEditingField} setEditingValue={setEditingValue} onEdit={(rk, f, v) => { setEditingRosterKey(rk); setEditingField(f); setEditingValue(v); }} onCommit={(sn, f, v) => void handleRosterFieldUpdate(sn, f, v)} />
                            <EditableCell canEdit={canEdit} rowKey={rowKey} field="city" value={checkin.cityCountry} serialNo={checkin.serialNo} editingRowKey={editingRosterKey} editingFieldName={editingField} editingValue={editingValue} setEditingRowKey={setEditingRosterKey} setEditingFieldName={setEditingField} setEditingValue={setEditingValue} onEdit={(rk, f, v) => { setEditingRosterKey(rk); setEditingField(f); setEditingValue(v); }} onCommit={(sn, f, v) => void handleRosterFieldUpdate(sn, f, v)} />
                            <EditableCell canEdit={canEdit} rowKey={rowKey} field="state" value={checkin.state} serialNo={checkin.serialNo} editingRowKey={editingRosterKey} editingFieldName={editingField} editingValue={editingValue} setEditingRowKey={setEditingRosterKey} setEditingFieldName={setEditingField} setEditingValue={setEditingValue} onEdit={(rk, f, v) => { setEditingRosterKey(rk); setEditingField(f); setEditingValue(v); }} onCommit={(sn, f, v) => void handleRosterFieldUpdate(sn, f, v)} />
                            <EditableCell canEdit={canEdit} rowKey={rowKey} field="county" value={checkin.county} serialNo={checkin.serialNo} editingRowKey={editingRosterKey} editingFieldName={editingField} editingValue={editingValue} setEditingRowKey={setEditingRosterKey} setEditingFieldName={setEditingField} setEditingValue={setEditingValue} onEdit={(rk, f, v) => { setEditingRosterKey(rk); setEditingField(f); setEditingValue(v); }} onCommit={(sn, f, v) => void handleRosterFieldUpdate(sn, f, v)} />
                            <EditableCell canEdit={canEdit} rowKey={rowKey} field="grid" value={checkin.grid} serialNo={checkin.serialNo} editingRowKey={editingRosterKey} editingFieldName={editingField} editingValue={editingValue} setEditingRowKey={setEditingRosterKey} setEditingFieldName={setEditingField} setEditingValue={setEditingValue} onEdit={(rk, f, v) => { setEditingRosterKey(rk); setEditingField(f); setEditingValue(v); }} onCommit={(sn, f, v) => void handleRosterFieldUpdate(sn, f, v)} />
                            <EditableCell canEdit={canEdit} rowKey={rowKey} field="status" value={checkin.status} serialNo={checkin.serialNo} editingRowKey={editingRosterKey} editingFieldName={editingField} editingValue={editingValue} setEditingRowKey={setEditingRosterKey} setEditingFieldName={setEditingField} setEditingValue={setEditingValue} onEdit={(rk, f, v) => { setEditingRosterKey(rk); setEditingField(f); setEditingValue(v); }} onCommit={(sn, f, v) => void handleRosterFieldUpdate(sn, f, v)} />
                            <EditableCell canEdit={canEdit} rowKey={rowKey} field="notes" value={checkin.remarks} serialNo={checkin.serialNo} editingRowKey={editingRosterKey} editingFieldName={editingField} editingValue={editingValue} setEditingRowKey={setEditingRosterKey} setEditingFieldName={setEditingField} setEditingValue={setEditingValue} onEdit={(rk, f, v) => { setEditingRosterKey(rk); setEditingField(f); setEditingValue(v); }} onCommit={(sn, f, v) => void handleRosterFieldUpdate(sn, f, v)} className="remarks-cell" />
                            <EditableCell canEdit={canEdit} rowKey={rowKey} field="qsl" value={checkin.qslInfo} serialNo={checkin.serialNo} editingRowKey={editingRosterKey} editingFieldName={editingField} editingValue={editingValue} setEditingRowKey={setEditingRosterKey} setEditingFieldName={setEditingField} setEditingValue={setEditingValue} onEdit={(rk, f, v) => { setEditingRosterKey(rk); setEditingField(f); setEditingValue(v); }} onCommit={(sn, f, v) => void handleRosterFieldUpdate(sn, f, v)} />
                            <EditableCell canEdit={canEdit} rowKey={rowKey} field="member_id" value={checkin.memberId} serialNo={checkin.serialNo} editingRowKey={editingRosterKey} editingFieldName={editingField} editingValue={editingValue} setEditingRowKey={setEditingRosterKey} setEditingFieldName={setEditingField} setEditingValue={setEditingValue} onEdit={(rk, f, v) => { setEditingRosterKey(rk); setEditingField(f); setEditingValue(v); }} onCommit={(sn, f, v) => void handleRosterFieldUpdate(sn, f, v)} />
                            <td>{checkin.dxcc}</td>
                            <td><button className="small-button log-contact-button" data-roster-key={rowKey} onClick={(event) => { event.stopPropagation(); openRosterLogModal(checkin); }}>Log Contact</button></td>
                          </tr>
                        );
                      })}
                      {amLogger && selectedNetType === 'log2go' && (
                        <tr className="roster-new-row">
                          <td></td>
                          <td></td>
                          <td className="callsign">
                            <input
                              className="roster-cell-input"
                              placeholder="Add callsign..."
                              value={editingRosterKey === '__new__' ? editingCallsign : ''}
                              autoFocus={editingRosterKey === '__new__'}
                              onChange={(e) => { setEditingCallsign(e.target.value); setEditingRosterKey('__new__'); }}
                              onBlur={() => {
                                if (editingRosterKey === '__new__' && editingCallsign.trim()) {
                                  void handleRosterQrzLookup(editingCallsign);
                                }
                                setEditingRosterKey(null);
                                setEditingCallsign('');
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Tab') {
                                  e.preventDefault();
                                  if (editingCallsign.trim()) {
                                    void handleRosterQrzLookup(editingCallsign);
                                  }
                                  setEditingRosterKey(null);
                                  setEditingCallsign('');
                                }
                                if (e.key === 'Escape') {
                                  setEditingRosterKey(null);
                                  setEditingCallsign('');
                                }
                              }}
                            />
                          </td>
                          <td colSpan={11} className="roster-new-hint">
                            {rosterQrzLoading ? 'Looking up QRZ...' : 'Type callsign, press Enter to add + QRZ lookup'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            {showRecentContacts && (
              <>
            <div
              className="pane-divider"
              role="separator"
              aria-orientation="horizontal"
              onMouseDown={(e) => {
                e.preventDefault();
                const container = e.currentTarget.parentElement;
                if (!container) return;
                const onMove = (ev: MouseEvent) => {
                  const rect = container.getBoundingClientRect();
                  const pct = ((ev.clientY - rect.top) / rect.height) * 100;
                  setRosterSplitPct(Math.max(20, Math.min(85, pct)));
                };
                const onUp = () => {
                  document.removeEventListener('mousemove', onMove);
                  document.removeEventListener('mouseup', onUp);
                  document.body.style.cursor = '';
                  document.body.style.userSelect = '';
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
                document.body.style.cursor = 'ns-resize';
                document.body.style.userSelect = 'none';
              }}
            />

            <div className="recent-contacts-pane" style={{ height: `${100 - rosterSplitPct}%` }}>
              <section className="panel recent-contacts-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Recent Contacts</h2>
                    <p>All QSOs from your Log2Go backend</p>
                  </div>
                  <div className="recent-contacts-header-actions">
                    <button
                      className="primary small-button"
                      disabled={uploading || !loggingState.accessToken}
                      onClick={() => setUploadConfirm(true)}
                      title="Upload contacts to LoTW, eQSL, and QRZ"
                    >{uploading ? 'Uploading...' : 'Upload'}</button>
                    <span className="auto-refresh-hint">{allBackendContacts.length} total</span>
                  </div>
                </div>
                {uploadReport && (
                  <pre className="upload-report">{uploadReport}</pre>
                )}
                <div className="recent-contacts-list">
                  {sortedRecentContacts.length === 0 ? (
                    <p className="auth-gate-muted">No contacts in your logbook yet.</p>
                  ) : (
                    <table className="roster-table recent-contacts-table">
                      <thead>
                        <tr>
                          <th className="sortable" onClick={() => toggleRecentSort('call')}>Call {recentSort.key === 'call' ? (recentSort.dir === 'asc' ? '▲' : '▼') : ''}</th>,
                          <th className="sortable" onClick={() => toggleRecentSort('qso_date')}>Date {recentSort.key === 'qso_date' ? (recentSort.dir === 'asc' ? '▲' : '▼') : ''}</th>
                          <th>Time</th>
                          <th className="sortable" onClick={() => toggleRecentSort('mode')}>Mode {recentSort.key === 'mode' ? (recentSort.dir === 'asc' ? '▲' : '▼') : ''}</th>
                          <th className="sortable" onClick={() => toggleRecentSort('band')}>Band {recentSort.key === 'band' ? (recentSort.dir === 'asc' ? '▲' : '▼') : ''}</th>
                          <th>Freq</th>
                          <th>Grid</th>
                          <th>ST</th>
                          <th>Net</th>
                          <th>L</th>
                          <th>E</th>
                          <th>Q</th>
                          <th>Warn</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedRecentContacts.slice(0, 200).map((qso, i) => {
                          const valErrors = (qso.validation_errors as string[]) ?? [];
                          const upErrors = (qso.upload_errors as string[]) ?? [];
                          const hasWarnings = valErrors.length > 0 || upErrors.length > 0;
                          return (
                          <tr key={`rc-${String(qso.id ?? i)}`}>
                            <td className="callsign">{qso.call as string ?? '—'}</td>
                            <td>{formatRecentDate(qso.qso_date as string)}</td>
                            <td>{formatRecentTime(qso.time_on as string)}</td>
                            <td>{qso.mode as string ?? '—'}</td>
                            <td>{qso.band as string ?? '—'}</td>
                            <td>{qso.freq as string ?? ''}</td>
                            <td>{qso.gridsquare as string ?? ''}</td>
                            <td>{qso.state as string ?? ''}</td>
                            <td className="rc-net-cell">{qso.netlogger_net as string ?? ''}</td>
                            <td className={qso.lotw_confirmed ? 'confirmed' : qso.lotw_uploaded ? 'uploaded' : ''}>{qso.lotw_confirmed ? '✓' : qso.lotw_uploaded ? '↑' : '—'}</td>
                            <td className={qso.eqsl_confirmed ? 'confirmed' : qso.eqsl_uploaded ? 'uploaded' : ''}>{qso.eqsl_confirmed ? '✓' : qso.eqsl_uploaded ? '↑' : '—'}</td>
                            <td className={qso.qrz_confirmed ? 'confirmed' : qso.qrz_uploaded ? 'uploaded' : ''}>{qso.qrz_confirmed ? '✓' : qso.qrz_uploaded ? '↑' : '—'}</td>
                            <td className="rc-warn-cell">
                              {hasWarnings ? (
                                <button className="warning-icon" onClick={() => setWarningContact(qso)} title="View issues">⚠</button>
                              ) : '—'}
                            </td>
                            <td className="rc-actions-cell">
                              {(qso.lotw_uploaded || qso.eqsl_uploaded || qso.qrz_uploaded) ? (
                                <span className="auth-gate-muted">locked</span>
                              ) : (
                                <>
                                  <button className="small-button" onClick={() => handleEditContact(qso)}>Edit</button>
                                  <button className="small-button danger" onClick={() => setDeleteContactConfirm(qso)}>Delete</button>
                                </>
                              )}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </div>
              </>
            )}
          </section>

          <aside className="right-stack">
            <section className="panel contact-panel resizable-section resizable-contact">
              <h2>Local Contact Draft</h2>
              <div className="form-grid">
                <label>Callsign<input value={draft.callsign} onChange={(e) => setDraft({ ...draft, callsign: e.target.value })} onBlur={(e) => void handleCallsignLookup(e.target.value, 'draft')} onKeyDown={(e) => { if (e.key === 'Enter') void handleCallsignLookup((e.target as HTMLInputElement).value, 'draft'); }} /></label>
                <label>Name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
                <label>RST Sent<input value={draft.rstSent} onChange={(e) => setDraft({ ...draft, rstSent: e.target.value })} /></label>
                <label>RST Rcvd<input value={draft.rstReceived} onChange={(e) => setDraft({ ...draft, rstReceived: e.target.value })} /></label>
                <label>Freq MHz<input value={draft.frequency} onChange={(e) => setDraft({ ...draft, frequency: e.target.value })} /></label>
                <label>Band<input value={draft.band} onChange={(e) => setDraft({ ...draft, band: e.target.value })} /></label>
                <label>Mode<input value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value })} /></label>
                <label>Grid<input value={draft.grid} onChange={(e) => setDraft({ ...draft, grid: e.target.value })} /></label>
                <label>State<input value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value })} /></label>
                <label>County<input value={draft.county} onChange={(e) => setDraft({ ...draft, county: e.target.value })} /></label>
              </div>
              <label>QTH<input value={draft.qth} onChange={(e) => setDraft({ ...draft, qth: e.target.value })} /></label>
              <label>Remarks<textarea value={draft.remarks} onChange={(e) => setDraft({ ...draft, remarks: e.target.value })} /></label>
              <button className="primary" onClick={() => void logDraft('nets')}>Save Contact to Log2Go</button>
            </section>

            {showCommsPanel && (
            <section className="panel comms-panel resizable-section resizable-comms">
              <div className="comms-header">
                <div>
                  <h2>{commsTab === 'aim' ? 'AIM' : 'Monitors'}</h2>
                  <p>{commsTab === 'aim' ? `${aimMessages.length} message(s)` : `${monitors.length} monitor(s)`}</p>
                </div>
                {showAim && showMonitors ? (
                  <div className="mini-tabs" role="tablist" aria-label="Net communication panes">
                    <button className={commsTab === 'aim' ? 'active' : ''} role="tab" aria-selected={commsTab === 'aim'} onClick={() => setCommsTab('aim')}>AIM</button>
                    <button className={commsTab === 'monitors' ? 'active' : ''} role="tab" aria-selected={commsTab === 'monitors'} onClick={() => setCommsTab('monitors')}>Monitors</button>
                  </div>
                ) : (
                  <button className="small-button comms-close" onClick={() => { setShowAim(false); setShowMonitors(false); }} type="button" title="Hide panel">✕</button>
                )}
              </div>
              {commsTab === 'aim' ? (
                <div className="aim-pane" role="tabpanel" aria-label="AIM messages">
                  <div className="scroll-box comms-scroll aim-scroll" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
                    {aimMessages.length === 0 ? <p>No AIM messages loaded for this net yet.</p> : aimMessages.map((msg) => (
                      <p
                        key={msg.id}
                        onContextMenu={(e) => {
                          if (isNcs && selectedNetType === 'log2go') {
                            e.preventDefault();
                            // Extract bare callsign from display name
                            // (e.g. "KE5ZQV-Jody" -> "KE5ZQV")
                            const bare = msg.callsign.split('-')[0].trim();
                            setContextMenuType('roster');
                            setContextMenu({ x: e.clientX, y: e.clientY, callsign: bare });
                          }
                        }}
                      ><b>{msg.callsign}</b> <span>{msg.aimTime}</span><br />{msg.message}</p>
                    ))}
                  </div>
                  <div className="aim-send-box">
                    <textarea
                      value={aimDraft}
                      onChange={(event) => setAimDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          if (aimDraft.trim() && aimJoined && !busy) void sendAimDraft();
                        }
                      }}
                      placeholder="Type AIM message... (Enter to send, Shift+Enter for newline)"
                      disabled={!selectedNet || busy}
                    />
                    <div className="aim-actions">
                      <button className="primary" onClick={() => void sendAimDraft()} disabled={!selectedNet || !aimJoined || !aimDraft.trim() || busy} type="button">
                        Send AIM
                      </button>
                    </div>
                    <p className="aim-note">
                      {aimJoined
                        ? (selectedNetType === 'log2go'
                          ? 'Subscribed to Log2Go net. Messages appear instantly.'
                          : 'Subscribed. AIM send uses the Log2Go backend proxy; messages may take 15-20 seconds to appear.')
                        : 'Click Subscribe above to enable AIM send.'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="scroll-box compact comms-scroll" role="tabpanel" aria-label="Monitors">
                  {monitors.map((monitor) => {
                    const roleClass = monitor.role
                      ? monitor.role === 'NCS' ? 'status-nc'
                        : monitor.role === 'CO_NCS' ? 'status-co-ncs'
                        : monitor.role === 'LOGGER' ? 'status-logger'
                        : monitor.role === 'RELAY' ? 'status-relay'
                        : ''
                      : '';
                    return (
                    <p
                      key={`${monitor.monitorIndex}:${monitor.callsign}`}
                      className={roleClass}
                      onContextMenu={(e) => {
                        if (isNcs && selectedNetType === 'log2go') {
                          e.preventDefault();
                          // Strip optional " [Role]" suffix and "-operatorName" suffix
                          const withoutRole = monitor.callsign.split(' [')[0].trim();
                          const bare = withoutRole.split('-')[0].trim();
                          setContextMenuType('monitors');
                          setContextMenu({ x: e.clientX, y: e.clientY, callsign: bare });
                        }
                      }}
                    >{monitor.offlineStatus ? '○' : '●'} {monitor.callsign}</p>
                    );
                  })}
                  {swlCount > 0 && (
                    <p className="swl-viewer-tally">● {swlCount} SWL viewer{swlCount === 1 ? '' : 's'} (not logged in)</p>
                  )}
                </div>
              )}
            </section>
            )}
          </aside>
        </section>
        )}
        {contextMenu && contextMenuType === 'roster' && (
          <ContextMenu
            items={buildRosterMenu({
              callsign: contextMenu!.callsign,
              serialNo: contextMenu!.serialNo ?? 0,
              currentStatus: checkins.find((c) => c.serialNo === contextMenu!.serialNo)?.status ?? '',
              isNcs,
              isLogger: amLogger,
              netType: selectedNetType ?? 'netlogger',
              onSetStatus: (cs, sn, st) => void handleSetCheckinStatus(cs, sn, st),
              onClearStatus: (cs, sn) => void handleClearCheckinStatus(cs, sn),
              onSetMobilePortable: (cs, sn, mp) => void handleSetMobilePortable(cs, sn, mp),
              onClearRow: (cs, sn) => void handleClearRow(cs, sn),
              onDeleteRow: (cs, sn) => void handleDeleteRow(cs, sn),
              onInsertRow: (cs, sn) => void handleInsertRow(cs, sn),
              onQrzLookup: (cs) => handleQrzWebLookup(cs),
              onAddToRoster: (cs) => void handleAddToRoster(cs),
              onRemoveFromRoster: (cs, sn) => void handleRemoveCheckin(cs, sn),
              onPromote: (cs, r) => void handlePromote(cs, r),
            })}
            position={{ x: contextMenu!.x, y: contextMenu!.y }}
            onClose={() => setContextMenu(null)}
          />
        )}
        {contextMenu && contextMenuType === 'monitors' && (
          <ContextMenu
            items={buildMonitorMenu({
              callsign: contextMenu!.callsign,
              isNcs,
              isLogger: amLogger,
              netType: selectedNetType ?? 'netlogger',
              isIgnored: aimIgnoredCallsigns.has(contextMenu!.callsign.trim().toUpperCase()),
              onPromote: (cs, r) => void handlePromote(cs, r),
              onToggleIgnore: (cs) => handleToggleAimIgnore(cs),
              onGroupIgnore: (cs) => handleGroupIgnore(cs),
            })}
            position={{ x: contextMenu!.x, y: contextMenu!.y }}
            onClose={() => setContextMenu(null)}
          />
        )}
        {showPreferences && (
          <PreferencesModal
            prefs={prefs}
            onUpdate={updatePrefs}
            onClose={() => setShowPreferences(false)}
            onReset={resetPrefs}
          />
        )}
        </>
      ) : tab === 'general' ? (
        <LoggingTab
          title="Logging"
          description="Manual web QSO entry. Saved contacts go to the Log2Go backend when logged in."
          loggingMode="nets"
          draft={draft}
          setDraft={setDraft}
          logDraft={logDraft}
          contacts={contactsByNewest}
          onCallsignLookup={handleCallsignLookup}
        />
      ) : tab === 'contest' ? (
        <ContestTab
          draft={draft}
          setDraft={setDraft}
          logContestDraft={logContestDraft}
          contestName={contestName}
          contestCounter={contestCounter}
          contestExchange={contestExchange}
          customContestName={customContestName}
          showCustomContestCreator={showCustomContestCreator}
          showContestPicker={showContestPicker}
          contestOptions={contestOptions}
          contestOptionsLoading={contestOptionsLoading}
          setContestExchange={setContestExchange}
          setCustomContestName={setCustomContestName}
          setShowCustomContestCreator={setShowCustomContestCreator}
          setShowContestPicker={setShowContestPicker}
          applySelectedContest={applySelectedContest}
          clearContestSelection={clearContestSelection}
          handleContestCounterChange={handleContestCounterChange}
          contacts={contactsByNewest}
          onCallsignLookup={handleCallsignLookup}
        />
      ) : tab === 'logbook' ? (
        <LogbookTab
          loggingState={loggingState}
          accountProfile={accountProfile}
          busy={busy}
          setStatus={setNetsStatus}
          subStatus={appSubStatus}
        />
      ) : tab === 'settings' ? (
        <SettingsTab
          loggingState={loggingState}
          accountProfile={accountProfile}
          busy={busy}
          onBackendSettingChange={updateBackendSetting}
          onLogin={handleAccountLogin}
          onLogout={handleAccountLogout}
          onActivateProfile={handleActivateProfile}
          onAddProfile={handleAddProfile}
          onUpdateProfile={handleUpdateProfile}
          onDeleteProfile={handleDeleteProfile}
          onOpenAuthGate={() => setAuthGateVisible(true)}
        />
      ) : null}

      {logContactModalOpen && (
        <div className="log-contact-overlay" role="dialog" aria-modal="true" aria-label="Log selected roster contact">
          <div className="log-contact-modal panel">
            <div className="panel-heading">
              <div>
                <h2>Log Contact</h2>
                <p>
                  {selectedNet ? `${selectedNet.netName} · ${selectedNet.frequency || 'freq ?'} · ${selectedNet.mode || 'mode ?'} · ${selectedNet.band || 'band ?'}` : 'Selected net not available'}
                </p>
                <p className="auth-gate-muted">
                  Station profile: {loggingState.stationProfile.callsign || 'No callsign'}
                  {loggingState.stationProfile.operatorName ? ` · ${loggingState.stationProfile.operatorName}` : ''}
                </p>
              </div>
            </div>

            <div className="log-contact-form">
              <label>Callsign<input value={modalDraft.callsign} onChange={(e) => setModalDraft({ ...modalDraft, callsign: e.target.value.toUpperCase() })} onBlur={(e) => void handleCallsignLookup(e.target.value, 'modalDraft')} onKeyDown={(e) => { if (e.key === 'Enter') void handleCallsignLookup((e.target as HTMLInputElement).value, 'modalDraft'); }} /></label>

              <div className="rst-top-row">
                <label>RST Sent<input ref={modalRstSentRef} value={modalDraft.rstSent} onChange={(e) => setModalDraft({ ...modalDraft, rstSent: e.target.value })} /></label>
                <label>RST Rcvd<input value={modalDraft.rstReceived} onChange={(e) => setModalDraft({ ...modalDraft, rstReceived: e.target.value })} /></label>
              </div>

              <div className="form-grid">
                <label>Name<input value={modalDraft.name} onChange={(e) => setModalDraft({ ...modalDraft, name: e.target.value })} /></label>
                <label>Freq MHz<input value={modalDraft.frequency} onChange={(e) => setModalDraft({ ...modalDraft, frequency: e.target.value })} /></label>
                <label>Band<input value={modalDraft.band} onChange={(e) => setModalDraft({ ...modalDraft, band: e.target.value })} /></label>
                <label>Mode<input value={modalDraft.mode} onChange={(e) => setModalDraft({ ...modalDraft, mode: e.target.value })} /></label>
                <label>Grid<input value={modalDraft.grid} onChange={(e) => setModalDraft({ ...modalDraft, grid: e.target.value })} /></label>
                <label>State<input value={modalDraft.state} onChange={(e) => setModalDraft({ ...modalDraft, state: e.target.value })} /></label>
                <label>County<input value={modalDraft.county} onChange={(e) => setModalDraft({ ...modalDraft, county: e.target.value })} /></label>
              </div>

              <label>QTH<input value={modalDraft.qth} onChange={(e) => setModalDraft({ ...modalDraft, qth: e.target.value })} /></label>
              <label>Remarks<textarea value={modalDraft.remarks} onChange={(e) => setModalDraft({ ...modalDraft, remarks: e.target.value })} /></label>
            </div>

            <div className="log-contact-actions">
              <button type="button" onClick={() => setLogContactModalOpen(false)} disabled={busy}>Cancel</button>
              <button className="primary" type="button" onClick={() => void logModalDraft()} disabled={busy || !modalDraft.callsign.trim()}>
                {busy ? 'Logging…' : 'Save Contact to Log2Go'}
              </button>
            </div>
          </div>
        </div>
      )}

      {createNetModalOpen && (
        <div className="log-contact-overlay" role="dialog" aria-modal="true" aria-label="Create a new Log2Go net">
          <div className="log-contact-modal panel">
            <div className="panel-heading">
              <div>
                <h2>Create Net</h2>
                <p>Open a new Log2Go net and join as NCS. The backend adds you as the first check-in.</p>
              </div>
            </div>

            <div className="log-contact-form">
              <label>Net Name
                <input
                  value={createNetForm.name}
                  onChange={(e) => setCreateNetForm({ ...createNetForm, name: e.target.value })}
                  placeholder="e.g. KE5ZQV Evening Net"
                  autoFocus
                />
              </label>

              <div className="rst-top-row">
                <label>Frequency
                  <input
                    value={createNetForm.frequency}
                    onChange={(e) => setCreateNetForm({ ...createNetForm, frequency: e.target.value })}
                    placeholder="e.g. 146.520"
                  />
                </label>
                <label>Mode
                  <select
                    value={createNetForm.mode}
                    onChange={(e) => setCreateNetForm({ ...createNetForm, mode: e.target.value })}
                  >
                    {['FM', 'SSB', 'CW', 'AM', 'FT8', 'RTTY', 'Digital', 'Other'].map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="rst-top-row">
                <label>Band
                  <select
                    value={createNetForm.band}
                    onChange={(e) => setCreateNetForm({ ...createNetForm, band: e.target.value })}
                  >
                    {['2m', '70cm', '10m', '12m', '15m', '17m', '20m', '30m', '40m', '60m', '80m', '160m', 'Other'].map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </label>
                <label>Enable Messaging
                  <input
                    type="checkbox"
                    checked={createNetForm.enable_messaging}
                    onChange={(e) => setCreateNetForm({ ...createNetForm, enable_messaging: e.target.checked })}
                  />
                </label>
              </div>

              <div className="rst-top-row">
                <label>Net Control
                  <input
                    value={createNetForm.net_control}
                    onChange={(e) => setCreateNetForm({ ...createNetForm, net_control: e.target.value.toUpperCase() })}
                    placeholder="NCS callsign"
                  />
                </label>
                <label>Logger
                  <input
                    value={createNetForm.logger}
                    onChange={(e) => setCreateNetForm({ ...createNetForm, logger: e.target.value.toUpperCase() })}
                    placeholder="Logger callsign"
                  />
                </label>
              </div>

              <div className="rst-top-row">
                <label>Save as profile
                  <input
                    type="checkbox"
                    checked={saveAsProfile}
                    onChange={(e) => { setSaveAsProfile(e.target.checked); if (!e.target.checked) setMakeDefaultProfile(false); }}
                    title="Save these settings as a reusable net profile on your account"
                  />
                </label>
                <label>Make default profile
                  <input
                    type="checkbox"
                    checked={makeDefaultProfile}
                    disabled={!saveAsProfile}
                    onChange={(e) => setMakeDefaultProfile(e.target.checked)}
                    title="Use this profile as the default for future nets"
                  />
                </label>
              </div>

              {createNetError && (
                <p className="auth-gate-error" role="alert">{createNetError}</p>
              )}
            </div>

            <div className="log-contact-actions">
              <button
                type="button"
                onClick={() => setCreateNetModalOpen(false)}
                disabled={createNetLoading}
              >Cancel</button>
              <button
                className="primary"
                type="button"
                onClick={() => void submitCreateNet()}
                disabled={createNetLoading || !createNetForm.name.trim()}
              >
                {createNetLoading ? 'Creating…' : 'Create Net'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab !== 'dashboard' && (
      <footer className="bottom-bar">
        <span>{netsStatus}</span>
        <span>{loggingState.contacts.length} local contact(s) this session</span>
      </footer>
      )}

      {authGateVisible && (
        <AuthGate
          baseUrl={loggingState.backendBaseUrl}
          onLoginSuccess={handleAuthLoginSuccess}
          onSkipLogin={() => setAuthGateVisible(false)}
          existingToken={loggingState.accessToken}
          deviceType="Web"
          visible={authGateVisible}
          persistentLogin={false}
        />
      )}

      {editingContact && (
        <div className="modal-backdrop" onClick={() => setEditingContact(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Contact #{String(editingContact.id ?? '')} — {String(editingContact.call ?? '')}</h2>
            <div className="form-grid">
              <label>Callsign<input value={editContactDraft.call ?? ''} onChange={(e) => setEditContactDraft({ ...editContactDraft, call: e.target.value.toUpperCase() })} /></label>
              <label>QSO Date (YYYYMMDD)<input value={editContactDraft.qso_date ?? ''} onChange={(e) => setEditContactDraft({ ...editContactDraft, qso_date: e.target.value })} /></label>
              <label>Time On (HHMMSS)<input value={editContactDraft.time_on ?? ''} onChange={(e) => setEditContactDraft({ ...editContactDraft, time_on: e.target.value })} /></label>
              <label>Mode<input value={editContactDraft.mode ?? ''} onChange={(e) => setEditContactDraft({ ...editContactDraft, mode: e.target.value })} /></label>
              <label>Band<input value={editContactDraft.band ?? ''} onChange={(e) => setEditContactDraft({ ...editContactDraft, band: e.target.value })} /></label>
              <label>Freq MHz<input value={editContactDraft.freq ?? ''} onChange={(e) => setEditContactDraft({ ...editContactDraft, freq: e.target.value })} /></label>
              <label>RST Sent<input value={editContactDraft.rst_sent ?? ''} onChange={(e) => setEditContactDraft({ ...editContactDraft, rst_sent: e.target.value })} /></label>
              <label>RST Rcvd<input value={editContactDraft.rst_rcvd ?? ''} onChange={(e) => setEditContactDraft({ ...editContactDraft, rst_rcvd: e.target.value })} /></label>
              <label>Grid<input value={editContactDraft.gridsquare ?? ''} onChange={(e) => setEditContactDraft({ ...editContactDraft, gridsquare: e.target.value.toUpperCase() })} /></label>
              <label>My Grid<input value={editContactDraft.my_gridsquare ?? ''} onChange={(e) => setEditContactDraft({ ...editContactDraft, my_gridsquare: e.target.value.toUpperCase() })} /></label>
              <label>State<input value={editContactDraft.state ?? ''} onChange={(e) => setEditContactDraft({ ...editContactDraft, state: e.target.value })} /></label>
              <label>County<input value={editContactDraft.county ?? ''} onChange={(e) => setEditContactDraft({ ...editContactDraft, county: e.target.value })} /></label>
              <label>Net Name<input value={editContactDraft.netlogger_net ?? ''} onChange={(e) => setEditContactDraft({ ...editContactDraft, netlogger_net: e.target.value })} /></label>
            </div>
            <div className="modal-actions">
              <button className="primary" disabled={editContactSaving} onClick={() => void handleSaveEditedContact()}>{editContactSaving ? 'Saving...' : 'Save Changes'}</button>
              <button onClick={() => setEditingContact(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {deleteContactConfirm && (
        <div className="modal-backdrop" onClick={() => setDeleteContactConfirm(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Contact?</h2>
            <p>Are you sure you want to delete the QSO with <b>{String(deleteContactConfirm.call ?? '')}</b> on {formatRecentDate(deleteContactConfirm.qso_date as string)} at {formatRecentTime(deleteContactConfirm.time_on as string)}?</p>
            <p className="auth-gate-muted">This will remove the contact from your Log2Go backend. If it has already been uploaded to LoTW, eQSL, or QRZ, those copies are not affected.</p>
            <div className="modal-actions">
              <button className="danger" onClick={() => void handleDeleteContact(Number(deleteContactConfirm.id))}>Yes, Delete</button>
              <button onClick={() => setDeleteContactConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {uploadConfirm && (
        <div className="modal-backdrop" onClick={() => setUploadConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Upload to Services?</h2>
            <p>This will upload all unsynced contacts to your subscribed services and fetch confirmation updates.</p>
            <p className="auth-gate-muted">Make sure your contact details are correct before uploading. Once uploaded, contacts cannot be edited or deleted in Log2Go.</p>
            <div className="modal-actions">
              <button className="primary" disabled={uploading} onClick={() => { setUploadConfirm(false); void handleUploadToServices(); }}>{uploading ? 'Uploading...' : 'Yes, Upload'}</button>
              <button onClick={() => setUploadConfirm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {warningContact && (
        <div className="modal-backdrop" onClick={() => setWarningContact(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Contact Issues — {String(warningContact.call ?? '')}</h2>
            {((warningContact.validation_errors as string[]) ?? []).length > 0 && (
              <>
                <h3>Validation Errors</h3>
                <ul className="error-list">
                  {(warningContact.validation_errors as string[]).map((err, idx) => <li key={`ve-${idx}`}>{err}</li>)}
                </ul>
                <p className="auth-gate-muted">These fields must be corrected before this contact can be uploaded to LoTW.</p>
              </>
            )}
            {((warningContact.upload_errors as string[]) ?? []).length > 0 && (
              <>
                <h3>Upload Errors</h3>
                <ul className="error-list">
                  {(warningContact.upload_errors as string[]).map((err, idx) => <li key={`ue-${idx}`}>{err}</li>)}
                </ul>
                <p className="auth-gate-muted">These errors occurred during the last upload attempt. Correct the contact and try again.</p>
              </>
            )}
            <div className="modal-actions">
              <button className="primary" onClick={() => { handleEditContact(warningContact); setWarningContact(null); }}>Edit Contact</button>
              <button onClick={() => setWarningContact(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function formatRecentDate(date?: string): string {
  if (!date) return '—';
  if (date.length === 8) return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  return date;
}

function formatRecentTime(time?: string): string {
  if (!time) return '—';
  const padded = time.padStart(6, '0');
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}:${padded.slice(4, 6)}`;
}

/** Format an ISO 8601 timestamp (e.g. "2026-07-18T12:34:56Z") as a readable date/time. */
function formatIsoTimestamp(ts?: string): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ContestTab({
  draft,
  setDraft,
  logContestDraft,
  contestName,
  contestCounter,
  contestExchange,
  customContestName,
  showCustomContestCreator,
  showContestPicker,
  contestOptions,
  contestOptionsLoading,
  setContestExchange,
  setCustomContestName,
  setShowCustomContestCreator,
  setShowContestPicker,
  applySelectedContest,
  clearContestSelection,
  handleContestCounterChange,
  contacts,
  onCallsignLookup,
}: {
  draft: ContactDraft;
  setDraft: React.Dispatch<React.SetStateAction<ContactDraft>>;
  logContestDraft: () => Promise<void>;
  contestName: string;
  contestCounter: string;
  contestExchange: string;
  customContestName: string;
  showCustomContestCreator: boolean;
  showContestPicker: boolean;
  contestOptions: ContestCalendarEvent[];
  contestOptionsLoading: boolean;
  setContestExchange: React.Dispatch<React.SetStateAction<string>>;
  setCustomContestName: React.Dispatch<React.SetStateAction<string>>;
  setShowCustomContestCreator: React.Dispatch<React.SetStateAction<boolean>>;
  setShowContestPicker: React.Dispatch<React.SetStateAction<boolean>>;
  applySelectedContest: (name: string) => void;
  clearContestSelection: () => void;
  handleContestCounterChange: (value: string) => void;
  contacts: Contact[];
  onCallsignLookup?: (callsign: string, target: 'draft' | 'modalDraft') => void;
}) {
  const contestSelected = contestName.trim().length > 0;

  return (
    <section className="general-log-layout">
      <div className="panel general-entry-panel contest-entry-panel">
        <div className="panel-heading">
          <div>
            <h2>Contest</h2>
            <p>Pick a contest/special activity first, then log contacts with counter and received exchange.</p>
          </div>
          {contestSelected && <button className="primary" onClick={() => void logContestDraft()}>Log Contact</button>}
        </div>

        {!contestSelected ? (
          <fieldset className="field-group contest-activity-panel">
            <legend>Select activity</legend>
            <div className="contest-activity-actions">
              <button className="primary" type="button" onClick={() => { setShowContestPicker(true); setShowCustomContestCreator(false); }}>
                CONTEST
              </button>
              <button type="button" onClick={() => { setShowCustomContestCreator(true); setShowContestPicker(false); }}>
                SPECIAL
              </button>
            </div>
            {showContestPicker && (
              <div className="contest-picker-list">
                {contestOptionsLoading ? <p>Loading contest calendar...</p> : null}
                {contestOptions.length === 0 && !contestOptionsLoading ? <p>No contest calendar entries loaded. Use Special to enter an activity manually.</p> : null}
                {contestOptions.slice(0, 12).map((contest) => (
                  <button key={`${contest.name}-${contest.start_date}`} type="button" onClick={() => applySelectedContest(contest.name)}>
                    <b>{contest.active ? '● ' : ''}{contest.name}</b>
                    <span>{contest.start_date === contest.end_date ? contest.start_date : `${contest.start_date} → ${contest.end_date}`}</span>
                  </button>
                ))}
              </div>
            )}
            {showCustomContestCreator && (
              <div className="contest-custom-row">
                <label>Activity name<input value={customContestName} onChange={(event) => setCustomContestName(event.target.value)} placeholder="Field Day, POTA Sprint, club event..." /></label>
                <button className="primary" type="button" onClick={() => applySelectedContest(customContestName)} disabled={!customContestName.trim()}>
                  Use This Activity
                </button>
              </div>
            )}
          </fieldset>
        ) : (
          <>
            <fieldset className="field-group contest-selected-panel">
              <legend>Selected activity</legend>
              <div className="contest-selected-row">
                <b>{contestName}</b>
                <div>
                  <button type="button" onClick={clearContestSelection}>Change Activity</button>
                  <button type="button" onClick={() => setShowContestPicker((current) => !current)}>Contest Calendar</button>
                  <button className="danger" type="button" onClick={clearContestSelection}>Exit Contest</button>
                </div>
              </div>
              {showContestPicker && (
                <div className="contest-picker-list">
                  {contestOptionsLoading ? <p>Loading contest calendar...</p> : null}
                  {contestOptions.slice(0, 12).map((contest) => (
                    <button key={`${contest.name}-${contest.start_date}`} type="button" onClick={() => applySelectedContest(contest.name)}>
                      <b>{contest.active ? '● ' : ''}{contest.name}</b>
                      <span>{contest.start_date === contest.end_date ? contest.start_date : `${contest.start_date} → ${contest.end_date}`}</span>
                    </button>
                  ))}
                </div>
              )}
            </fieldset>

            <div className="field-groups contest-field-groups">
              <fieldset className="field-group">
                <legend>Contest</legend>
                <div className="form-grid">
                  <label>Contact counter<input inputMode="numeric" value={contestCounter} onChange={(event) => handleContestCounterChange(event.target.value)} placeholder="none" /></label>
                  <label>Exchange<input value={contestExchange} onChange={(event) => setContestExchange(event.target.value.toUpperCase())} placeholder="Their exchange" /></label>
                </div>
              </fieldset>

              <fieldset className="field-group">
                <legend>Contact</legend>
                <div className="form-grid">
                  <DraftField field="Callsign" draft={draft} setDraft={setDraft} onBlur={onCallsignLookup ? (v) => void onCallsignLookup(v, 'draft') : undefined} onKeyDown={onCallsignLookup ? (e) => { if (e.key === 'Enter') void onCallsignLookup((e.target as HTMLInputElement).value, 'draft'); } : undefined} />
                  <DraftField field="Mode" draft={draft} setDraft={setDraft} />
                </div>
              </fieldset>

              <fieldset className="field-group">
                <legend>Band & Signal</legend>
                <div className="form-grid">
                  <DraftField field="Band" draft={draft} setDraft={setDraft} />
                  <DraftField field="Frequency MHz" draft={draft} setDraft={setDraft} />
                  <DraftField field="RST Sent" draft={draft} setDraft={setDraft} />
                  <DraftField field="RST Received" draft={draft} setDraft={setDraft} />
                </div>
              </fieldset>

              <fieldset className="field-group">
                <legend>Station Location</legend>
                <div className="form-grid">
                  <DraftField field="Grid" draft={draft} setDraft={setDraft} />
                  <DraftField field="County" draft={draft} setDraft={setDraft} />
                </div>
              </fieldset>
            </div>
          </>
        )}
      </div>
      <RecentContactsPanel contacts={contacts} />
    </section>
  );
}

function LoggingTab({
  title,
  description,
  loggingMode,
  draft,
  setDraft,
  logDraft,
  contacts,
  onCallsignLookup,
}: {
  title: string;
  description: string;
  loggingMode: 'nets' | 'contesting' | 'pota';
  draft: ContactDraft;
  setDraft: React.Dispatch<React.SetStateAction<ContactDraft>>;
  logDraft: (loggingMode?: 'nets' | 'contesting' | 'pota') => Promise<void>;
  contacts: Contact[];
  onCallsignLookup?: (callsign: string, target: 'draft' | 'modalDraft') => void;
}) {
  return (
    <section className="general-log-layout">
      <div className="panel general-entry-panel">
        <div className="panel-heading">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button className="primary" onClick={() => void logDraft(loggingMode)}>Save Contact to Log2Go</button>
        </div>
        <div className="field-groups">
          {generalLogFieldGroups().map((group) => (
            <fieldset key={group.title} className="field-group">
              <legend>{group.title}</legend>
              <div className="form-grid">
                {group.fields.map((field) => (
                  <DraftField key={field} field={field} draft={draft} setDraft={setDraft} onBlur={field === 'Callsign' && onCallsignLookup ? (v) => void onCallsignLookup(v, 'draft') : undefined} onKeyDown={field === 'Callsign' && onCallsignLookup ? (e) => { if (e.key === 'Enter') void onCallsignLookup((e.target as HTMLInputElement).value, 'draft'); } : undefined} />
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </div>
      <RecentContactsPanel contacts={contacts} />
    </section>
  );
}

function DraftField({
  field,
  draft,
  setDraft,
  onBlur,
  onKeyDown,
}: {
  field: string;
  draft: ContactDraft;
  setDraft: React.Dispatch<React.SetStateAction<ContactDraft>>;
  onBlur?: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const fieldMap: Record<string, keyof ContactDraft> = {
    Callsign: 'callsign',
    Name: 'name',
    'Frequency MHz': 'frequency',
    Band: 'band',
    Mode: 'mode',
    'RST Sent': 'rstSent',
    'RST Received': 'rstReceived',
    Grid: 'grid',
    State: 'state',
    County: 'county',
    QTH: 'qth',
    Remarks: 'remarks',
  };
  const key = fieldMap[field];
  return (
    <label>
      {field}
      {field === 'Remarks' ? (
        <textarea value={draft[key] ?? ''} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} />
      ) : (
        <input
          value={draft[key] ?? ''}
          onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
          onBlur={onBlur ? (e) => onBlur(e.target.value) : undefined}
          onKeyDown={onKeyDown}
        />
      )}
    </label>
  );
}

// ── Station Profiles Section ─────────────────────────────────────────
const MP_OPTIONS: MobilePortableStatus[] = ['fixed', 'mobile', 'portable'];

function StationProfilesSection({
  profiles,
  activeProfileId,
  onActivate,
  onAdd,
  onUpdate,
  onDelete,
  embedded = false,
  profileIncomplete = false,
  missingFields = [],
  accessToken,
  backendBaseUrl,
}: {
  profiles: StationProfile[];
  activeProfileId?: string;
  onActivate: (profileId: string) => void;
  onAdd: (input: CreateProfileInput) => void;
  onUpdate: (profileId: string, input: UpdateProfileInput) => void;
  onDelete: (profileId: string) => void;
  embedded?: boolean;
  profileIncomplete?: boolean;
  missingFields?: string[];
  accessToken?: string;
  backendBaseUrl?: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // Auto-expand add form only when user has no profiles at all
  useEffect(() => {
    if (profiles.length === 0 && !editingId && !isAdding) {
      setIsAdding(true);
      setEditingId(null);
    }
  }, [profiles.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = (id: string) => {
    setEditingId(id);
    setIsAdding(false);
  };
  const startAdd = () => {
    setIsAdding(true);
    setEditingId(null);
  };
  const cancel = () => {
    setEditingId(null);
    setIsAdding(false);
  };
  const editingProfile = profiles.find((profile) => profile.id === editingId);

  // Determine which fields to highlight in the edit form
  const highlightFields = profileIncomplete && editingId === activeProfileId
    ? missingFields
    : [];

  return (
    <section className={embedded ? 'profiles-panel profiles-panel-embedded' : 'panel profiles-panel'}>
      <div className="panel-heading">
        <div>
          <h3>Station Profiles</h3>
          <p className="auto-refresh-hint">Click on a station profile to activate</p>
        </div>
        {!isAdding && !editingId && (
          <button onClick={startAdd} type="button">+ Add Profile</button>
        )}
      </div>

      {profileIncomplete && (
        <div className="profile-warning-banner" role="alert">
          <span className="profile-warning-icon">⚠️</span>
          <div className="profile-warning-text">
            {profiles.length === 0 ? (
              <strong>Create a station profile before logging contacts.</strong>
            ) : (
              <>
                <strong>Your active station profile needs configuration.</strong>
                <span>Missing required field{missingFields.length !== 1 ? 's' : ''}: {missingFields.join(', ')}</span>
              </>
            )}
          </div>
        </div>
      )}

      <div className="profile-list">
        {profiles.map((profile) => (
          <div key={profile.id} className={`profile-row ${profile.id === activeProfileId ? 'profile-active' : ''}`}>
            <div className="profile-info" onClick={() => onActivate(profile.id)} role="button" tabIndex={0}>
              <span className="profile-name-line">
                <b>{profile.profileName || 'Station Profile'}</b>
                <span>{profile.callsign || 'No callsign'}</span>
                {profile.id === activeProfileId && <span className="profile-check">✓ Active</span>}
              </span>
              <span className="profile-qth-line">
                {[profile.city, profile.state, profile.county, profile.homeGrid].filter(Boolean).join(' · ') || 'QTH not configured'}
              </span>
            </div>
            <div className="profile-actions">
              <button className="small-button" onClick={() => startEdit(profile.id)} type="button">Edit</button>
              {profiles.length > 1 && (
                <button className="small-button danger" onClick={() => onDelete(profile.id)} type="button">Delete</button>
              )}
            </div>
          </div>
        ))}

        {(isAdding || editingProfile) && (
          <div className="profile-edit-overlay" role="dialog" aria-modal="true" aria-label={editingProfile ? 'Edit station profile' : 'Add station profile'}>
            <div className="profile-edit-modal panel">
              <div className="panel-heading">
                <div>
                  <h3>{editingProfile ? 'Edit Station Profile' : 'Add Station Profile'}</h3>
                </div>
              </div>
          <ProfileEditForm
                profile={editingProfile}
                onSave={(input) => { editingProfile ? onUpdate(editingProfile.id, input) : onAdd(input); cancel(); }}
            onCancel={cancel}
            highlightFields={highlightFields}
            accessToken={accessToken}
            backendBaseUrl={backendBaseUrl}
          />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ProfileEditForm({
  profile,
  onSave,
  onCancel,
  highlightFields = [],
  accessToken,
  backendBaseUrl,
}: {
  profile?: StationProfile;
  onSave: (input: CreateProfileInput) => void;
  onCancel: () => void;
  highlightFields?: string[];
  accessToken?: string;
  backendBaseUrl?: string;
}) {
  const [callsign, setCallsign] = useState(profile?.callsign ?? '');
  const [profileName, setProfileName] = useState(profile?.profileName ?? '');
  const [operatorName, setOperatorName] = useState(profile?.operatorName ?? '');
  const [homeGrid, setHomeGrid] = useState(profile?.homeGrid ?? '');
  const [state, setState] = useState(profile?.state ?? '');
  const [county, setCounty] = useState(profile?.county ?? '');
  const [city, setCity] = useState(profile?.city ?? '');
  const [mpStatus, setMpStatus] = useState<MobilePortableStatus>(profile?.mobilePortableStatus ?? 'fixed');
  const [defaultMode, setDefaultMode] = useState(profile?.defaultMode ?? 'SSB');
  const [rigInfo, setRigInfo] = useState(profile?.rigInfo ?? '');
  const [autoGps, setAutoGps] = useState(profile?.autoGps ?? false);
  const [locationOverride, setLocationOverride] = useState(profile?.locationOverride ?? false);
  const [gpsCapturing, setGpsCapturing] = useState(false);
  const [showGpsDialog, setShowGpsDialog] = useState(false);
  const [gpsDeviceAvailable, setGpsDeviceAvailable] = useState<boolean | null>(null);

  // Auto-fill states
  const [autoFillSuggestions, setAutoFillSuggestions] = useState<Record<string, string> | null>(null);
  const [autoFillLoading, setAutoFillLoading] = useState(false);
  const [autoFillError, setAutoFillError] = useState('');

  const save = () => {
    if (!callsign.trim()) return;
    onSave({
      callsign: callsign.trim(),
      profileName: profileName.trim() || undefined,
      operatorName: operatorName.trim() || undefined,
      homeGrid: homeGrid.trim() || undefined,
      state: state.trim() || undefined,
      county: county.trim() || undefined,
      city: city.trim() || undefined,
      mobilePortableStatus: mpStatus,
      defaultMode: defaultMode.trim() || undefined,
      rigInfo: rigInfo.trim() || undefined,
      autoGps,
      locationOverride,
    });
  };

  /**
   * On save, check for blank fields that could be auto-filled.
   * If grid is present but city/state/county are empty, reverse-geocode the grid.
   * If callsign is present and we have an access token, try QRZ lookup for operator name.
   * Present suggestions to the user before saving.
   */
  const handleSave = async () => {
    if (!callsign.trim()) return;

    const suggestions: Record<string, string> = {};
    const hasEmptyFields = !state.trim() || !county.trim() || !city.trim();
    const hasGrid = homeGrid.trim().length >= 4;

    // Grid → reverse geocode for city/state/county
    if (hasEmptyFields && hasGrid) {
      setAutoFillLoading(true);
      setAutoFillError('');
      try {
        const { gridToCoordinates: gridToCoords } = await import('./utils/maidenhead');
        const coords = gridToCoords(homeGrid.trim());
        if (coords) {
          const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.latitude}&lon=${coords.longitude}&zoom=10`, {
            headers: { 'Accept-Language': 'en' },
          });
          const data = await resp.json();
          if (data.address) {
            if (!state.trim() && data.address.state) suggestions.state = data.address.state;
            if (!county.trim() && (data.address.county || data.address.state_district)) suggestions.county = data.address.county || data.address.state_district || '';
            if (!city.trim() && (data.address.city || data.address.town || data.address.village || data.address.hamlet)) suggestions.city = data.address.city || data.address.town || data.address.village || data.address.hamlet || '';
          }
        }
      } catch {
        // Non-fatal — just skip auto-fill
      }
      setAutoFillLoading(false);
    }

    // If we have suggestions, show them; otherwise save immediately
    if (Object.keys(suggestions).length > 0) {
      setAutoFillSuggestions(suggestions);
    } else {
      save();
    }
  };

  const acceptAutoFill = () => {
    if (autoFillSuggestions) {
      if (autoFillSuggestions.state) setState(autoFillSuggestions.state);
      if (autoFillSuggestions.county) setCounty(autoFillSuggestions.county);
      if (autoFillSuggestions.city) setCity(autoFillSuggestions.city);
    }
    setAutoFillSuggestions(null);
    // State updates are batched — save after they're applied
    setTimeout(save, 0);
  };

  const rejectAutoFill = () => {
    setAutoFillSuggestions(null);
    save();
  };

  /**
   * Forward-geocode city/state/country to coordinates and calculate grid square.
   * Called when locationOverride is on and the user changes location fields.
   */
  const geocodeManualLocation = async () => {
    if (!locationOverride) return;
    const hasLocationFields = city.trim() || state.trim() || county.trim();
    if (!hasLocationFields) return;
    try {
      const { geocodeLocation, calculateMaidenheadGrid } = await import('./utils/maidenhead');
      const coords = await geocodeLocation({ city: city.trim(), state: state.trim(), county: county.trim(), country: undefined });
      if (coords) {
        const grid = calculateMaidenheadGrid(coords, 6);
        setHomeGrid(grid);
      }
    } catch {
      // Non-fatal — grid just won't auto-fill
    }
  };

  const captureGps = () => {
    if (!navigator.geolocation) {
      setGpsDeviceAvailable(false);
      setShowGpsDialog(true);
      return;
    }
    setGpsCapturing(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setGpsDeviceAvailable(true);
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        // Calculate Maidenhead grid
        const { calculateMaidenheadGrid } = await import('./utils/maidenhead');
        const grid = calculateMaidenheadGrid({ latitude: lat, longitude: lon }, 6);
        setHomeGrid(grid);
        // Reverse geocode for county/state
        try {
          const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14`, {
            headers: { 'Accept-Language': 'en' },
          });
          const data = await resp.json();
          if (data.address) {
            if (data.address.county) setCounty(data.address.county);
            if (data.address.state) setState(data.address.state);
            if (data.address.city) setCity(data.address.city);
            if (data.address.country) setCounty(data.address.county || county);
          }
        } catch { /* non-fatal */ }
        setGpsCapturing(false);
      },
      () => {
        setGpsCapturing(false);
        setGpsDeviceAvailable(false);
        setShowGpsDialog(true);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  };

  const toggleAutoGps = () => {
    if (!autoGps) {
      // Turning on -- check if GPS is available
      if (!navigator.geolocation) {
        setShowGpsDialog(true);
        return;
      }
      setAutoGps(true);
      // Turning on auto GPS disables manual location override
      setLocationOverride(false);
    } else {
      // Turning off
      setAutoGps(false);
    }
  };

  const toggleLocationOverride = () => {
    if (!locationOverride) {
      // Turning on location override — turn off auto GPS since manual location takes priority
      setAutoGps(false);
      setLocationOverride(true);
    } else {
      // Turning off — just disable override
      setLocationOverride(false);
    }
  };

  // Determine which individual fields need highlighting based on missingFields
  const needsCallsign = highlightFields.some((f) => f.includes('Callsign'));
  const needsLocation = highlightFields.some((f) => f.includes('Location'));

  return (
    <div className="profile-edit-form">
      <div className="form-grid">
        <label className={needsCallsign ? 'field-required-highlight' : undefined}>Callsign *<input value={callsign} onChange={(e) => setCallsign(e.target.value)} placeholder="Callsign" /></label>
        <label>Profile Name<input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Profile name" /></label>
        <label>Operator Name<input value={operatorName} onChange={(e) => setOperatorName(e.target.value)} placeholder="Operator name" /></label>
        <label className={needsLocation ? 'field-required-highlight' : undefined}>Grid<input value={homeGrid} onChange={(e) => setHomeGrid(e.target.value)} placeholder="Grid" /></label>
        <label className={needsLocation ? 'field-required-highlight' : undefined}>State<input value={state} onChange={(e) => setState(e.target.value)} placeholder="State" /></label>
        <label className={needsLocation ? 'field-required-highlight' : undefined}>County<input value={county} onChange={(e) => setCounty(e.target.value)} placeholder="County" /></label>
        <label>City<input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" /></label>
        <label>M/P Status
          <select value={mpStatus} onChange={(e) => setMpStatus(e.target.value as MobilePortableStatus)}>
            {MP_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </label>
        <label>Default Mode<input value={defaultMode} onChange={(e) => setDefaultMode(e.target.value)} placeholder="Mode" /></label>
        <label>Rig Info<input value={rigInfo} onChange={(e) => setRigInfo(e.target.value)} placeholder="Rig" /></label>
      </div>
      <div className={`profile-form-gps-section${needsLocation ? ' field-required-highlight' : ''}`}>
        <button type="button" className="small-button" disabled={gpsCapturing} onClick={captureGps}>
          {gpsCapturing ? 'Capturing GPS...' : 'Capture GPS Location'}
        </button>
        <label className={`auto-gps-toggle${needsLocation ? ' field-required-highlight' : ''}`}>
          <input type="checkbox" checked={autoGps} onChange={toggleAutoGps} />
          Auto GPS Tracking
        </label>
        <p className="auth-gate-muted">When enabled, GPS location will be automatically used to fill station location for each contact logged with this profile.</p>
      </div>
      <div className="profile-form-actions">
        <button className="primary" onClick={() => void handleSave()} type="button" disabled={!callsign.trim() || autoFillLoading}>
          {autoFillLoading ? 'Looking up location...' : 'Save'}
        </button>
        <button onClick={onCancel} type="button">Cancel</button>
      </div>
      {showGpsDialog && (
        <div className="modal-backdrop" onClick={() => setShowGpsDialog(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>GPS Device</h2>
            {gpsDeviceAvailable === false ? (
              <p>No GPS device detected. You can connect an external GPS device (e.g. Bluetooth GPS dongle) and refresh, or turn off Auto GPS for this profile.</p>
            ) : (
              <p>Allow access to your GPS device to enable Auto GPS Tracking for this profile.</p>
            )}
            <div className="modal-actions">
              <button className="primary" onClick={() => { setShowGpsDialog(false); captureGps(); }}>Connect GPS Device</button>
              <button onClick={() => { setAutoGps(false); setShowGpsDialog(false); }}>Turn Off Auto GPS</button>
              <button onClick={() => setShowGpsDialog(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {autoFillSuggestions && (
        <div className="modal-backdrop" onClick={() => { setAutoFillSuggestions(null); save(); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Auto-Fill Location</h2>
            <p className="auth-gate-muted">Your grid square maps to these location details. Fill them in automatically?</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0' }}>
              {autoFillSuggestions.state && <li><b>State:</b> {autoFillSuggestions.state}</li>}
              {autoFillSuggestions.county && <li><b>County:</b> {autoFillSuggestions.county}</li>}
              {autoFillSuggestions.city && <li><b>City:</b> {autoFillSuggestions.city}</li>}
            </ul>
            <div className="modal-actions">
              <button className="primary" onClick={acceptAutoFill}>Yes, fill them in</button>
              <button onClick={rejectAutoFill}>No, save as-is</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── QRZ API Key Panel ────────────────────────────────────────────────
// ── External Accounts Panel ────────────────────────────────────────
// Unified panel for LoTW, QRZ (API key + login), and eQSL credentials.
// Credentials are stored and verified on the Log2Go backend — never in
// browser localStorage.

const EXTERNAL_SERVICES = [
  { key: 'lotw', label: 'LoTW', description: 'ARRL Logbook of the World — upload QSOs for award credit.', usernameLabel: 'LoTW Username', help: 'Use your ARRL LoTW username and password. Credentials verified against the LoTW API.' },
  { key: 'qrz', label: 'QRZ.com', description: 'QRZ logbook sync and QSO confirmation.', usernameLabel: 'QRZ Username', help: 'Use your QRZ.com login credentials for QSO import/confirmation.' },
  { key: 'eqsl', label: 'eQSL.cc', description: 'eQSL logbook sync and QSL confirmation.', usernameLabel: 'eQSL Username', help: 'Use your eQSL.cc login credentials for QSL sync.' },
] as const;

function ExternalAccountsPanel({ baseUrl, token, isLoggedIn, isSubscriber }: { baseUrl: string; token?: string; isLoggedIn: boolean; isSubscriber: boolean }) {
  const [credentials, setCredentials] = useState<ServiceCredentialOut[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyOut[]>([]);
  const [showAddForm, setShowAddForm] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [inputService, setInputService] = useState('');
  const [inputUsername, setInputUsername] = useState('');
  const [inputPassword, setInputPassword] = useState('');
  const [inputQrzKey, setInputQrzKey] = useState('');
  const [inputQthNickname, setInputQthNickname] = useState('');
  const [inputDateStart, setInputDateStart] = useState('');
  const [inputDateEnd, setInputDateEnd] = useState('');
  const [showAddApiKeyForm, setShowAddApiKeyForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [certStatus, setCertStatus] = useState<LotwCertStatus | null>(null);
  const [uploadingCert, setUploadingCert] = useState(false);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certPassword, setCertPassword] = useState('');
  const [certStatusMsg, setCertStatusMsg] = useState('');

  const fetchAll = useCallback(async () => {
    if (!token) return;
    try {
      const [creds, keys] = await Promise.all([
        listServiceCredentials(baseUrl, token, true),
        listApiKeys(baseUrl, token),
      ]);
      setCredentials(creds);
      setApiKeys(keys.filter((k) => k.service_name === 'qrz'));
      setLoadError(false);
    } catch (err) {
      console.error('[ExternalAccounts] Failed to load credentials:', err instanceof Error ? err.message : err);
      setLoadError(true);
    }
  }, [baseUrl, token]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const fetchCertStatus = useCallback(async () => {
    if (!token) return;
    try {
      const s = await checkLotwCertificate(baseUrl, token);
      setCertStatus(s);
    } catch { /* non-fatal */ }
  }, [baseUrl, token]);

  useEffect(() => { void fetchCertStatus(); }, [fetchCertStatus]);

  const handleUploadCert = async () => {
    if (!certFile || !token) return;
    setUploadingCert(true);
    setCertStatusMsg('');
    try {
      const result = await uploadLotwCertificate(baseUrl, token, certFile, certPassword || undefined);
      setCertStatusMsg(result.message);
      if (result.success) {
        setCertFile(null);
        setCertPassword('');
        void fetchCertStatus();
      }
    } catch (error) {
      setCertStatusMsg(`Upload failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setUploadingCert(false);
    }
  };

  const resetForm = () => {
    setShowAddForm(null);
    setShowAddApiKeyForm(false);
    setEditId(null);
    setInputService('');
    setInputUsername('');
    setInputPassword('');
    setInputQrzKey('');
    setInputQthNickname('');
    setInputDateStart('');
    setInputDateEnd('');
  };

  const handleSaveCredential = useCallback(async () => {
    if (!token || !inputService.trim() || !inputUsername.trim() || !inputPassword.trim()) return;
    setBusy(true);
    setStatus('');
    try {
      const credPayload = {
        service_name: inputService.trim(),
        service_username: inputUsername.trim(),
        service_password: inputPassword.trim(),
        qth_nickname: inputQthNickname.trim() || undefined,
        date_range_start: inputDateStart.trim() || undefined,
        date_range_end: inputDateEnd.trim() || undefined,
      };
      if (editId !== null) {
        await updateServiceCredential(baseUrl, token, editId, credPayload);
        setStatus(`${inputService.toUpperCase()} credentials updated and verifying.`);
      } else {
        await saveServiceCredential(baseUrl, token, credPayload);
        setStatus(`${inputService.toUpperCase()} credentials saved and verifying.`);
      }
      resetForm();
      void fetchAll();
    } catch (err) {
      setStatus(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [baseUrl, token, inputService, inputUsername, inputPassword, editId, fetchAll]);

  const handleDisableCredential = useCallback(async (credId: number, serviceName: string) => {
    if (!token) return;
    setBusy(true);
    setStatus('');
    try {
      await disableServiceCredential(baseUrl, token, credId);
      setStatus(`${serviceName.toUpperCase()} credentials disabled.`);
      void fetchAll();
    } catch (err) {
      setStatus(`Failed to disable: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [baseUrl, token, fetchAll]);

  const handleSaveQrzKey = useCallback(async () => {
    if (!token || !inputQrzKey.trim()) return;
    setBusy(true);
    setStatus('');
    try {
      await saveApiKey(baseUrl, token, 'qrz', inputQrzKey.trim(), 'QRZ XML Lookup API');
      resetForm();
      setStatus('QRZ API key saved.');
      void fetchAll();
    } catch (err) {
      setStatus(`Failed to save QRZ key: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [baseUrl, token, inputQrzKey, fetchAll]);

  const handleDeleteQrzKey = useCallback(async (keyId: number) => {
    if (!token) return;
    setBusy(true);
    setStatus('');
    try {
      await deleteApiKey(baseUrl, token, keyId);
      setStatus('QRZ API key removed.');
      void fetchAll();
    } catch (err) {
      setStatus(`Failed to remove: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [baseUrl, token, fetchAll]);

  const startEdit = (cred: ServiceCredentialOut) => {
    setEditId(cred.id);
    setShowAddForm(cred.service_name);
    setInputService(cred.service_name);
    setInputUsername(cred.service_username);
    setInputPassword('');
    setInputQthNickname(cred.qth_nickname ?? '');
    setInputDateStart(cred.date_range_start ?? '');
    setInputDateEnd(cred.date_range_end ?? '');
    setStatus('');
  };

  const startAdd = (serviceKey: string) => {
    resetForm();
    setShowAddForm(serviceKey);
    setInputService(serviceKey);
    setStatus('');
  };

  const startAddQrzKey = () => {
    resetForm();
    setShowAddApiKeyForm(true);
    setInputQrzKey('');
    setStatus('');
  };

  if (!isLoggedIn) {
    return (
      <div className="panel service-table-panel">
        <h3>External Accounts</h3>
        <p className="account-storage-warning">Log in to configure LoTW, QRZ, and eQSL accounts.</p>
      </div>
    );
  }

  if (!isSubscriber) {
    return (
      <div className="panel service-table-panel">
        <div className="panel-heading">
          <div>
            <h3>External Accounts</h3>
            <p>LoTW, QRZ.com, and eQSL.cc credentials for QSO sync and confirmation.</p>
          </div>
        </div>
        <div style={{ padding: '20px 16px', background: '#2a1a0a', borderRadius: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: '#ffcc00' }}>
            &#x1F512; Subscription Required
          </div>
          <p style={{ color: '#ccccaa', marginBottom: 12 }}>
            External account integration (LoTW, QRZ.com, eQSL.cc) is available with a paid Log2Go subscription.
          </p>
          <p style={{ color: '#8899aa', fontSize: 14 }}>
            Scroll down to the <strong>Subscription &amp; Billing</strong> section to subscribe and unlock all features.
          </p>
        </div>
      </div>
    );
  }

  const verificationBadge = (cred: ServiceCredentialOut) => {
    if (cred.verification_status === 'verified') return <span className="live-poll-indicator">● Verified</span>;
    if (cred.verification_status === 'error') return <span className="aim-send-error">{cred.verification_error || 'Verification failed'}</span>;
    return <span className="auto-refresh-hint">Unverified</span>;
  };

  return (
    <div className="panel service-table-panel">
      <div className="panel-heading">
        <div>
          <h3>External Accounts</h3>
          <p>LoTW, QRZ.com, and eQSL.cc credentials for QSO sync and confirmation. Stored encrypted on the Log2Go server.</p>
        </div>
      </div>
      {status && <p className="auto-refresh-hint">{status}</p>}
      {loadError && (
        <p className="aim-send-error">Could not load saved credentials. Try logging out and back in — your session may have expired.</p>
      )}

      {/* Service credentials (username/password) — tiled horizontally */}
      <div className="external-service-tiles">
        {EXTERNAL_SERVICES.map((svc) => {
          const svcCreds = credentials.filter((c) => c.service_name === svc.key && c.status === 'active');
          const svcApiKeys = svc.key === 'qrz' ? apiKeys : [];
          return (
            <div key={svc.key} className="external-service-row external-service-tile">
              <div className="external-service-header">
                <div>
                  <b>{svc.label}</b>
                  <span className="auto-refresh-hint">{svc.description}</span>
                </div>
                {!showAddForm && !showAddApiKeyForm && (
                  <button className="small-button primary" onClick={() => startAdd(svc.key)} type="button">Add Account</button>
                )}
                {svc.key === 'qrz' && !showAddForm && !showAddApiKeyForm && (
                  <button className="small-button" onClick={() => startAddQrzKey()} type="button">Add API Key</button>
                )}
              </div>
              {svcCreds.map((cred) => (
                <div key={cred.id} className="qrz-key-row">
                  <span className="qrz-key-label">{cred.service_username}{cred.qth_nickname ? ` — ${cred.qth_nickname}` : cred.label && cred.label !== svc.label ? ` — ${cred.label}` : ''}</span>
                  {cred.date_range_start && cred.date_range_end ? <span className="qrz-key-date">{cred.date_range_start.slice(5,7)}-{cred.date_range_start.slice(8,10)}-{cred.date_range_start.slice(0,4)} to {cred.date_range_end.slice(5,7)}-{cred.date_range_end.slice(8,10)}-{cred.date_range_end.slice(0,4)}</span> : null}
                  {verificationBadge(cred)}
                  <span className="qrz-key-date">Updated {cred.updated_at.slice(0, 10)}</span>
                  <button className="small-button" onClick={() => startEdit(cred)} disabled={busy} type="button">Edit</button>
                  <button className="danger small-button" onClick={() => void handleDisableCredential(cred.id, cred.service_name)} disabled={busy} type="button">Disable</button>
                </div>
              ))}
              {svcApiKeys.map((k) => (
                <div key={`key-${k.id}`} className="qrz-key-row">
                  <span className="qrz-key-label">{k.label || 'QRZ XML Lookup API'}</span>
                  <span className="qrz-key-masked">••••••••••••••••</span>
                  <span className="live-poll-indicator">● Active</span>
                  <span className="qrz-key-date">Updated {k.updated_at.slice(0, 10)}</span>
                  <button className="danger small-button" onClick={() => void handleDeleteQrzKey(k.id)} disabled={busy} type="button">Remove</button>
                </div>
              ))}
              {svc.key === 'lotw' && token && (
                <div className="lotw-cert-section">
                  <div className="lotw-cert-divider" />
                  <div className="lotw-cert-status">
                    {certStatus && (
                      <>
                        <span className={certStatus.has_certificate ? 'confirmed' : ''}>
                          {certStatus.has_certificate ? '✓ Certificate installed' : 'No certificate installed'}
                        </span>
                        {certStatus.cert_files.length > 0 && (
                          <span className="auth-gate-muted">Files: {certStatus.cert_files.join(', ')}</span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="lotw-cert-upload-form">
                    <label>
                      Certificate file (.p12)
                      <input type="file" accept=".p12" onChange={(e) => setCertFile(e.target.files?.[0] ?? null)} />
                    </label>
                    <label>
                      Certificate password (optional)
                      <input type="password" value={certPassword} onChange={(e) => setCertPassword(e.target.value)} placeholder="Leave blank if no password" />
                    </label>
                    <button className="primary" disabled={!certFile || uploadingCert} onClick={() => void handleUploadCert()} type="button">
                      {uploadingCert ? 'Uploading...' : 'Upload Certificate'}
                    </button>
                  </div>
                  {certStatusMsg && <p className="auth-gate-muted">{certStatusMsg}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add/Edit credential form */}
      {showAddForm && (
        <div className="external-add-form">
          <h4>{editId !== null ? `Edit ${showAddForm.toUpperCase()} credentials` : `Add ${showAddForm.toUpperCase()} account`}</h4>
          <div className="account-form-grid">
            <label>Username
              <input
                type="text"
                value={inputUsername}
                onChange={(e) => setInputUsername(e.target.value)}
                placeholder={EXTERNAL_SERVICES.find((s) => s.key === showAddForm)?.usernameLabel || 'Username'}
                disabled={busy}
              />
            </label>
            <label>Password
              <input
                type="password"
                value={inputPassword}
                onChange={(e) => setInputPassword(e.target.value)}
                placeholder="Password (sent to backend for verification)"
                disabled={busy}
              />
            </label>
          </div>
          {showAddForm === 'eqsl' && (
            <div className="account-form-grid">
              <label>QTH Nickname (eQSL)
                <input
                  type="text"
                  value={inputQthNickname}
                  onChange={(e) => setInputQthNickname(e.target.value)}
                  placeholder="e.g. Runaway Bay"
                  disabled={busy}
                />
              </label>
              <label>Date Range Start
                <input
                  type="text"
                  value={inputDateStart}
                  onChange={(e) => setInputDateStart(e.target.value)}
                  placeholder="MM-DD-YYYY"
                  disabled={busy}
                />
              </label>
              <label>Date Range End
                <input
                  type="text"
                  value={inputDateEnd}
                  onChange={(e) => setInputDateEnd(e.target.value)}
                  placeholder="MM-DD-YYYY"
                  disabled={busy}
                />
              </label>
            </div>
          )}
          <div className="qrz-key-input-row">
            <button className="primary" onClick={() => void handleSaveCredential()} disabled={busy || !inputUsername.trim() || !inputPassword.trim()} type="button">
              {busy ? 'Saving…' : editId !== null ? 'Update' : 'Save & Verify'}
            </button>
            <button className="small-button" onClick={resetForm} disabled={busy} type="button">Cancel</button>
          </div>
          <p className="auto-refresh-hint">{EXTERNAL_SERVICES.find((s) => s.key === showAddForm)?.help}</p>
        </div>
      )}

      {/* Add API Key form (QRZ only) */}
      {showAddApiKeyForm && (
        <div className="external-add-form">
          <h4>Add QRZ API Key</h4>
          <div className="qrz-key-input-row">
            <input
              type="password"
              value={inputQrzKey}
              onChange={(e) => setInputQrzKey(e.target.value)}
              placeholder="Paste your QRZ XML Lookup API key here"
              disabled={busy}
              className="qrz-key-input"
            />
            <button className="primary" onClick={() => void handleSaveQrzKey()} disabled={busy || !inputQrzKey.trim()} type="button">
              {busy ? 'Saving…' : 'Save Key'}
            </button>
            <button className="small-button" onClick={resetForm} disabled={busy} type="button">Cancel</button>
          </div>
          <p className="account-storage-warning">
            Get your API key from QRZ.com → Logbook → Settings → API Key. Encrypted and stored on the Log2Go server.
          </p>
        </div>
      )}
    </div>
  );
}
function SubscriptionPanel({
  backendBaseUrl,
  accessToken,
  isLoggedIn,
}: {
  backendBaseUrl: string;
  accessToken: string | null | undefined;
  isLoggedIn: boolean;
}) {
  const [prices, setPrices] = useState<SubscriptionPrice[]>([]);
  const [publishableKey, setPublishableKey] = useState('');
  const [subStatus, setSubStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getSubscriptionPrices(backendBaseUrl)
      .then((data) => {
        setPrices(data.prices);
        setPublishableKey(data.publishable_key);
      })
      .catch(() => setError('Could not load pricing information.'));
  }, [backendBaseUrl]);

  useEffect(() => {
    if (!isLoggedIn || !accessToken) return;
    getSubscriptionStatus(backendBaseUrl, accessToken)
      .then(setSubStatus)
      .catch(() => { });
  }, [backendBaseUrl, accessToken, isLoggedIn]);

  const handleSubscribe = async (priceId: string) => {
    if (!accessToken) return;
    setLoading(true);
    setError('');
    try {
      const successUrl = window.location.origin + '/?checkout=success';
      const cancelUrl = window.location.origin + '/?checkout=canceled';
      const { url } = await createCheckoutSession(backendBaseUrl, accessToken, priceId, successUrl, cancelUrl);
      window.location.href = url;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout.');
    } finally {
      setLoading(false);
    }
  };

  const handleManage = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError('');
    try {
      const { url } = await createPortalSession(backendBaseUrl, accessToken);
      window.location.href = url;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to open billing portal.');
    } finally {
      setLoading(false);
    }
  };

  const formatExpiry = (isoDate: string | null) => {
    if (!isoDate) return '';
    try {
      return new Date(isoDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
      return isoDate;
    }
  };

  const statusLabel = (() => {
    if (!subStatus) return 'Free';
    if (subStatus.subscription_status === 'lifetime_free') return 'Lifetime Free';
    if (subStatus.subscription_status === 'active') return subStatus.plan_name || 'Active';
    if (subStatus.subscription_status === 'none') return 'No Subscription';
    if (subStatus.subscription_status === 'inactive' || subStatus.subscription_status === 'canceled') return 'Expired';
    return subStatus.subscription_status;
  })();

  const isActive = subStatus?.subscription_status === 'active';
  const isFree = !subStatus || subStatus.subscription_status === 'none' || subStatus.subscription_status === 'lifetime_free' || subStatus.subscription_status === 'inactive';

  return (
    <div className="panel subscription-panel">
      <div className="panel-heading">
        <div><h3>Subscription & Billing</h3></div>
        <span className={'account-status ' + (isActive ? 'logged-in' : '')}>
          {statusLabel}
        </span>
      </div>

      {subStatus?.subscription_status === 'lifetime_free' && (
        <div style={{ padding: '12px 16px', background: '#1a3a1a', borderRadius: 6, marginBottom: 12 }}>
          Your account has <strong>Lifetime Free</strong> access. No subscription needed.
        </div>
      )}

      {isActive && subStatus?.current_period_end && (
        <div style={{ padding: '12px 16px', background: '#1a2a3a', borderRadius: 6, marginBottom: 12 }}>
          <div><strong>{subStatus.plan_name}</strong> plan active</div>
          <div style={{ fontSize: 13, color: '#8899aa' }}>
            Renews {formatExpiry(subStatus.current_period_end)}
          </div>
          <button
            className="small-button"
            style={{ marginTop: 8 }}
            onClick={() => void handleManage()}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Manage Billing'}
          </button>
        </div>
      )}

      {isFree && subStatus?.subscription_status !== 'lifetime_free' && (
        <div className="subscription-plans">
          {prices.length > 0 ? (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {prices.map((plan) => (
                <div key={plan.price_id} style={{
                  flex: '1 1 200px',
                  maxWidth: 280,
                  background: '#1a2a3a',
                  borderRadius: 8,
                  padding: '20px 16px',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{plan.display_name}</div>
                  <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 4 }}>{plan.display_price}</div>
                  <div style={{ fontSize: 13, color: '#8899aa', marginBottom: 16 }}>
                    per {plan.interval === 'month' ? 'month' : 'year'}
                  </div>
                  {isLoggedIn ? (
                    <button
                      className="primary"
                      onClick={() => void handleSubscribe(plan.price_id)}
                      disabled={loading}
                      style={{ width: '100%' }}
                    >
                      {loading ? 'Loading...' : 'Subscribe'}
                    </button>
                  ) : (
                    <div style={{ fontSize: 13, color: '#8899aa' }}>Log in to subscribe</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: '#8899aa' }}>{error || 'Loading plans...'}</p>
          )}
        </div>
      )}

      {error && <div className="auth-gate-error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}function SettingsTab({
  loggingState,
  accountProfile,
  busy,
  onBackendSettingChange,
  onLogin,
  onLogout,
  onActivateProfile,
  onAddProfile,
  onUpdateProfile,
  onDeleteProfile,
  onOpenAuthGate,
}: {
  loggingState: LoggingFlowState;
  accountProfile?: AccountProfile;
  busy: boolean;
  onBackendSettingChange: (field: 'backendBaseUrl' | 'username' | 'password', value: string) => void;
  onLogin: () => void;
  onLogout: () => void;
  onActivateProfile: (profileId: string) => void;
  onAddProfile: (input: CreateProfileInput) => void;
  onUpdateProfile: (profileId: string, input: UpdateProfileInput) => void;
  onDeleteProfile: (profileId: string) => void;
  onOpenAuthGate: () => void;
}) {
  const activeProfile = loggingState.stationProfile;
  const isLoggedIn = Boolean(loggingState.accessToken);
  const loginReady = Boolean(loggingState.backendBaseUrl.trim() && loggingState.username.trim() && loggingState.password);

  // Desktop app version surfaced in Settings
  const desktopVersion =
    (typeof window !== 'undefined' &&
      'log2goDesktop' in window &&
      (window as unknown as { log2goDesktop: DesktopBridge }).log2goDesktop?.appVersion) ??
    APP_VERSION;

  // Change password state
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  // Subscription gate — determines if user can access external accounts
  const [subStatus, setSubStatus] = useState<SubscriptionStatus | null>(null);
  const isSubscriber = subStatus?.subscription_status === "active" || subStatus?.subscription_status === "lifetime_free";

  useEffect(() => {
    if (!isLoggedIn || !loggingState.accessToken) return;
    getSubscriptionStatus(loggingState.backendBaseUrl, loggingState.accessToken)
      .then(setSubStatus)
      .catch(() => {});
  }, [loggingState.backendBaseUrl, loggingState.accessToken, isLoggedIn]);

  const handleChangePassword = async () => {
    setPwError('');
    if (!currentPw.trim()) { setPwError('Enter your current password.'); return; }
    if (newPw.length < 8) { setPwError('New password must be at least 8 characters.'); return; }
    if (newPw !== confirmPw) { setPwError('New passwords do not match.'); return; }
    setPwBusy(true);
    try {
      await updateAccountPassword(loggingState.backendBaseUrl, loggingState.accessToken!, loggingState.username, currentPw, newPw);
      setShowChangePassword(false);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setPwError('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Try to extract a more helpful message from API errors
      if (msg.includes('403') || msg.toLowerCase().includes('incorrect')) {
        setPwError('Current password is incorrect.');
      } else if (msg.includes('400')) {
        setPwError('Invalid request. New password must be at least 8 characters.');
      } else {
        setPwError(`Failed to change password: ${msg}`);
      }
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <section className="settings-layout">
      <div className="panel settings-hero settings-combined-hero">
        <div className="settings-hero-block settings-title-block">
          <h2>Settings / Accounts</h2>
          <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)', marginTop: '0.25rem' }}>Log2Go Desktop v{desktopVersion}</span>
          <div className="profile-summary-card">
            <span>Active station profile</span>
            <b>{activeProfile.callsign || 'No callsign set'}</b>
            <span>{[activeProfile.homeGrid, activeProfile.city, activeProfile.state, activeProfile.county].filter(Boolean).join(' · ') || 'Location not configured'}</span>
          </div>
        </div>

        <div className="settings-hero-block account-panel account-hero-block">
          <div className="panel-heading">
            <div>
              <h3>Log2Go Account</h3>
            </div>
            <span className={isLoggedIn ? 'account-status logged-in' : 'account-status'}>
              {isLoggedIn ? 'Logged in' : 'Logged out'}
            </span>
          </div>

          {isLoggedIn ? (
            <div className="logged-in-card">
              <span>Logged in as</span>
              <b>{accountProfile?.callsign || loggingState.username}</b>
              <span>{accountProfile?.email || 'Account profile will refresh after the next login.'}</span>
              <div className="logged-in-actions">
                <button className="danger" onClick={onLogout} type="button">LOG OUT</button>
                <button className="change-password-btn" onClick={() => { setShowChangePassword(true); setPwError(''); }} type="button">Change Password</button>
              </div>
            </div>
          ) : (
            <div className="account-form-grid">
              <label>Backend API URL
                <input
                  value={loggingState.backendBaseUrl}
                  onChange={(event) => onBackendSettingChange('backendBaseUrl', event.target.value)}
                  placeholder="https://api.log2goapp.net"
                />
              </label>
              <label>Username / callsign
                <input
                  value={loggingState.username}
                  onChange={(event) => onBackendSettingChange('username', event.target.value)}
                  placeholder="Your callsign or Log2Go username"
                />
              </label>
              <label>Password
                <input
                  value={loggingState.password}
                  onChange={(event) => onBackendSettingChange('password', event.target.value)}
                  type="password"
                  placeholder="Log2Go password"
                />
              </label>
              <button
                className={loginReady ? 'primary account-login-button' : 'account-login-button'}
                disabled={!loginReady || busy}
                onClick={onLogin}
                type="button"
              >
                LOG IN
              </button>
              <button
                className="account-login-button"
                onClick={onOpenAuthGate}
                type="button"
              >
                LOGIN / REGISTER
              </button>
            </div>
          )}
        </div>

        <StationProfilesSection
          profiles={loggingState.profileCollection.profiles}
          activeProfileId={loggingState.profileCollection.activeProfileId}
          onActivate={onActivateProfile}
          onAdd={onAddProfile}
          onUpdate={onUpdateProfile}
          onDelete={onDeleteProfile}
          embedded
          profileIncomplete={!isProfileCompleteForLogging(loggingState.stationProfile)}
          missingFields={getMissingProfileFields(loggingState.stationProfile)}
          accessToken={loggingState.accessToken}
          backendBaseUrl={loggingState.backendBaseUrl}
        />
      </div>

      <ExternalAccountsPanel
        baseUrl={loggingState.backendBaseUrl}
        token={loggingState.accessToken}
        isLoggedIn={isLoggedIn}
        isSubscriber={isSubscriber}
      />
      <SubscriptionPanel
        backendBaseUrl={loggingState.backendBaseUrl}
        accessToken={loggingState.accessToken}
        isLoggedIn={isLoggedIn}
      />

      {showChangePassword && (
        <div className="modal-backdrop" onClick={() => setShowChangePassword(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Change Password</h2>
            <p className="auth-gate-muted">Update your Log2Go account password. You'll need to enter your current password for security.</p>
            {pwError && <div className="auth-gate-error">{pwError}</div>}
            <div className="auth-gate-form">
              <label>
                Current Password
                <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="Enter current password" autoComplete="current-password" />
              </label>
              <label>
                New Password
                <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
              </label>
              <label>
                Confirm New Password
                <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="Re-enter new password" autoComplete="new-password" />
              </label>
            </div>
            <div className="modal-actions">
              <button className="primary" onClick={() => void handleChangePassword()} disabled={pwBusy || !currentPw.trim() || newPw.length < 8 || newPw !== confirmPw} type="button">
                {pwBusy ? 'Changing...' : 'Change Password'}
              </button>
              <button onClick={() => { setShowChangePassword(false); setCurrentPw(''); setNewPw(''); setConfirmPw(''); setPwError(''); }} type="button">Cancel</button>
            </div>
          </div>
        </div>
      )}

    </section>
  );
}

// ── Logbook tab: account-wide QSO history from backend ───────────────
type BackendQso = {
  id?: number;
  call?: string;
  qso_date?: string;
  time_on?: string;
  mode?: string;
  band?: string;
  freq?: string;
  rst_sent?: string;
  rst_rcvd?: string;
  gridsquare?: string;
  state?: string;
  county?: string;
  operator?: string;
  qso_source?: string;
  lotw_uploaded?: boolean;
  eqsl_uploaded?: boolean;
  qrz_uploaded?: boolean;
  lotw_confirmed?: boolean;
  eqsl_confirmed?: boolean;
  qrz_confirmed?: boolean;
};

function LogbookTab({
  loggingState,
  accountProfile,
  busy,
  setStatus,
  subStatus,
}: {
  loggingState: LoggingFlowState;
  accountProfile?: AccountProfile;
  busy: boolean;
  setStatus: (msg: string) => void;
  subStatus?: SubscriptionStatus | null;
}) {
  const [qsoList, setQsoList] = useState<BackendQso[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showSubModal, setShowSubModal] = useState(false);
  const [sortKey, setSortKey] = useState<'qso_date' | 'call' | 'mode' | 'band'>('qso_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const isLoggedIn = Boolean(loggingState.accessToken);
  const isPaid = subStatus?.subscription_status === 'active' || subStatus?.subscription_status === 'lifetime_free';
  const adifInputRef = useRef<HTMLInputElement>(null);

  const fetchLogbook = useCallback(async () => {
    if (!isLoggedIn) return;
    setLoading(true);
    try {
      const contacts = await listContacts(loggingState.backendBaseUrl, loggingState.accessToken!);
      setQsoList(contacts as BackendQso[]);
      setStatus(`Loaded ${contacts.length} QSOs from Log2Go backend.`);
    } catch (error) {
      setStatus(`Logbook fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn, loggingState.backendBaseUrl, loggingState.accessToken, setStatus]);

  useEffect(() => {
    void fetchLogbook();
  }, [fetchLogbook]);

  const handleExportAdif = useCallback(async () => {
    if (!isLoggedIn) return;
    setLoading(true);
    try {
      const adifText = await exportAdif(loggingState.backendBaseUrl, loggingState.accessToken!);
      const blob = new Blob([adifText], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `log2go-export-${new Date().toISOString().slice(0, 10)}.adi`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus('ADIF export downloaded.');
    } catch (error) {
      setStatus(`ADIF export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn, loggingState.backendBaseUrl, loggingState.accessToken, setStatus]);

  const handleSyncServices = useCallback(async () => {
    if (!isLoggedIn) return;
    if (!isPaid) { setShowSubModal(true); return; }
    setSyncing(true);
    try {
      const report = await uploadToServices(loggingState.backendBaseUrl!, loggingState.accessToken!);
      const parts: string[] = [];
      if (report.total_uploaded > 0) parts.push('Uploaded ' + report.total_uploaded);
      if (report.total_confirmed > 0) parts.push('Confirmed ' + report.total_confirmed);
      if (report.errors.length > 0) parts.push('Errors: ' + report.errors.join(', '));
      if (parts.length === 0) parts.push('No new QSOs to sync.');
      setStatus('Sync complete. ' + parts.join(' · '));
      void fetchLogbook();
    } catch (error) {
      setStatus('Sync failed: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setSyncing(false);
    }
  }, [isLoggedIn, isPaid, loggingState.backendBaseUrl, loggingState.accessToken, setStatus, fetchLogbook]);

  const handleAdifImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const result = await importAdif(loggingState.backendBaseUrl!, loggingState.accessToken!, file);
      setStatus('ADIF import: ' + result.imported + ' imported, ' + result.skipped + ' skipped' + (result.errors.length ? ', errors: ' + result.errors.join(', ') : ''));
      void fetchLogbook();
    } catch (error) {
      setStatus('ADIF import failed: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setLoading(false);
      if (adifInputRef.current) adifInputRef.current.value = '';
    }
  }, [loggingState.backendBaseUrl, loggingState.accessToken, setStatus, fetchLogbook]);

  const sortedQsos = useMemo(() => {
    const sorted = [...qsoList].sort((a, b) => {
      const aVal = a[sortKey] ?? '';
      const bVal = b[sortKey] ?? '';
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [qsoList, sortKey, sortDir]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const formatDate = (date?: string) => {
    if (!date) return '—';
    // QSO_DATE is YYYYMMDD
    if (date.length === 8) {
      return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    }
    return date;
  };

  if (!isLoggedIn) {
    return (
      <section className="logbook-layout">
        <div className="panel">
          <h2>Account Logbook</h2>
          <p>Log in to view your account-wide QSO logbook from the Log2Go backend.</p>
          <p className="account-storage-warning">Local contacts this session: {loggingState.contacts.length}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="logbook-layout">
      <div className="panel logbook-header-panel">
        <div className="panel-heading">
          <div>
            <h2>Account Logbook</h2>
            <p>All QSOs stored for {accountProfile?.callsign || loggingState.username}. Includes Log2Go-created contacts and imported external-service QSOs.</p>
          </div>
          <div className="logbook-actions">
            <button onClick={() => void fetchLogbook()} disabled={loading || syncing || busy}>Refresh</button>
            <button onClick={() => void handleSyncServices()} disabled={loading || syncing || busy}>🔄 Sync Services</button>
            <button className="primary" onClick={() => void handleExportAdif()} disabled={loading || busy}>Export ADIF</button>
            <button onClick={() => adifInputRef.current?.click()} disabled={loading || busy}>📥 Import ADIF</button>
            <input ref={adifInputRef} type="file" accept=".adi,.adif" style={{ display: 'none' }} onChange={(e) => void handleAdifImport(e)} />
          </div>
        </div>
        <div className="logbook-stats">
          <span><b>Total</b> {qsoList.length}</span>
          <span><b>Log2Go</b> {qsoList.filter((q) => q.qso_source === 'log2go').length}</span>
          <span><b>Imported</b> {qsoList.filter((q) => q.qso_source === 'external').length}</span>
        </div>
      </div>
      <div className="panel logbook-table-panel">
        {loading && qsoList.length === 0 ? (
          <p>Loading QSOs from backend...</p>
        ) : qsoList.length === 0 ? (
          <p>No QSOs found in your account logbook yet.</p>
        ) : (
          <table className="logbook-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggleSort('call')}>Call {sortKey === 'call' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                <th className="sortable" onClick={() => toggleSort('qso_date')}>Date {sortKey === 'qso_date' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                <th>Time</th>
                <th className="sortable" onClick={() => toggleSort('mode')}>Mode {sortKey === 'mode' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                <th className="sortable" onClick={() => toggleSort('band')}>Band {sortKey === 'band' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                <th>Freq</th>
                <th>RST</th>
                <th>Grid</th>
                <th>ST</th>
                <th>Source</th>
                <th className="conf-col">L</th>
                <th className="conf-col">E</th>
                <th className="conf-col">Q</th>
              </tr>
            </thead>
            <tbody>
              {sortedQsos.map((qso) => (
                <tr key={qso.id ?? `${qso.call}-${qso.qso_date}-${qso.time_on}`}>
                  <td className="callsign">{qso.call || '—'}</td>
                  <td>{formatDate(qso.qso_date)}</td>
                  <td>{qso.time_on || '—'}</td>
                  <td>{qso.mode || '—'}</td>
                  <td>{qso.band || '—'}</td>
                  <td>{qso.freq || ''}</td>
                  <td>{[qso.rst_sent, qso.rst_rcvd].filter(Boolean).join('/') || '—'}</td>
                  <td>{qso.gridsquare || ''}</td>
                  <td>{qso.state || ''}</td>
                  <td className={qso.qso_source === 'log2go' ? 'source-log2go' : 'source-external'}>
                    {qso.qso_source === 'log2go' ? 'L2G' : 'Ext'}
                  </td>
                  <td className={`conf-col ${qso.lotw_confirmed ? 'confirmed' : qso.lotw_uploaded ? 'uploaded' : ''}`}>{qso.lotw_confirmed ? '✅' : qso.lotw_uploaded ? '↑' : '—'}</td>
                  <td className={`conf-col ${qso.eqsl_confirmed ? 'confirmed' : qso.eqsl_uploaded ? 'uploaded' : ''}`}>{qso.eqsl_confirmed ? '✅' : qso.eqsl_uploaded ? '↑' : '—'}</td>
                  <td className={`conf-col ${qso.qrz_confirmed ? 'confirmed' : qso.qrz_uploaded ? 'uploaded' : ''}`}>{qso.qrz_confirmed ? '✅' : qso.qrz_uploaded ? '↑' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="panel">
        <h3>Legend</h3>
        <p className="logbook-legend">
          <b>L</b> = LoTW &nbsp;
          <b>E</b> = eQSL.cc &nbsp;
          <b>Q</b> = QRZ.com &nbsp;|&nbsp;
          <b>↑</b> = Uploaded, not confirmed &nbsp;|&nbsp;
          <b>✓</b> = Confirmed &nbsp;|&nbsp;
          <b>—</b> = Not uploaded &nbsp;|&nbsp;
          <b className="source-log2go">L2G</b> = Logged by Log2Go &nbsp;
          <b className="source-external">Ext</b> = Imported from external service
        </p>
      </div>
      {showSubModal && (
        <div className="modal-backdrop" onClick={() => setShowSubModal(false)}>
          <div className="modal-content" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ color: '#00b4ff', marginTop: 0 }}>Subscription Required</h2>
            <p style={{ color: '#b0c4d8' }}>Online service sync (LoTW, QRZ.com, eQSL) requires an active Log2Go subscription.</p>
            <p style={{ color: '#8fa8c4', fontSize: 13 }}>ADIF import and export are free for all users. Subscribe to sync QSOs with online services automatically.</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="primary" onClick={() => { setShowSubModal(false); /* Could navigate to settings */ }}>Go to Settings</button>
              <button onClick={() => setShowSubModal(false)} style={{ background: '#1b3a5c', color: '#b0c4d8' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function RecentContactsPanel({ contacts }: { contacts: Contact[] }) {
  return (
    <div className="panel">
      <h2>Recent Contacts</h2>
      <div className="scroll-box">
        {contacts.length === 0 ? <p>No contacts logged in this web session yet.</p> : contacts.map((contact) => (
          <p key={contact.id}><b>{contact.callsign}</b> {contact.mode} {contact.band ?? ''} {contact.netLoggerContext?.netName ?? ''}<br /><span>{contact.contactedAt}</span></p>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
