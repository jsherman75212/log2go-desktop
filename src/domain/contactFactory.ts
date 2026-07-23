import type {
  Contact,
  ContestContext,
  GpsCapture,
  LoggingSession,
  NetLoggerContext,
  PotaContext,
  QrzEnrichment,
  SignalReport,
  StationProfile,
  StationProfileSnapshot,
} from './models';
import {
  formatSessionContactNumber,
  getNextSessionContactNumber,
  incrementSessionContactNumber,
} from './sessionNumbering';
import { calculateMaidenheadGrid } from '../utils/maidenhead';

export type CreateContactFromSessionInput = {
  id?: string;
  stationProfile: StationProfile;
  session: LoggingSession;
  callsign: string;
  contactedAt: string;
  frequencyMhz?: number;
  band?: string;
  mode?: string;
  signalReport?: SignalReport;
  assignContactNumber?: boolean;
  contactNumber?: number;
  contactNumberDisplay?: string;
  operatorName?: string;
  location?: string;
  notes?: string;
  gps?: GpsCapture;
  grid?: string;
  county?: string;
  netLoggerContext?: Partial<NetLoggerContext>;
  contestContext?: Partial<ContestContext>;
  potaContext?: Partial<PotaContext>;
  qrzEnrichment?: QrzEnrichment;
};

export type CreateContactFromSessionResult = {
  contact: Contact;
  nextSession: LoggingSession;
};

type AssignedContactNumber = {
  value: number;
  display: string;
};

export function createContactFromSession(
  input: CreateContactFromSessionInput,
): CreateContactFromSessionResult {
  const assignedContactNumber = resolveContactNumber(input);
  const snapshot = createStationProfileSnapshot(input.stationProfile);
  const grid = resolveGrid(input);

  const contact: Contact = omitUndefined({
    id: input.id ?? createStableContactId(input, assignedContactNumber),
    sessionId: input.session.id,
    callsign: input.callsign.trim().toUpperCase(),
    contactedAt: input.contactedAt,
    frequencyMhz: input.frequencyMhz,
    band: input.band,
    mode: input.mode ?? snapshot.defaultMode,
    signalReport: cloneSignalReport(input.signalReport ?? snapshot.defaultSignalReport),
    contactNumber: assignedContactNumber?.value,
    contactNumberDisplay: assignedContactNumber?.display,
    operatorName: input.operatorName,
    location: input.location,
    maidenheadGrid: grid,
    grid,
    county: input.county,
    notes: input.notes,
    loggingMode: input.session.mode,
    netLoggerContext: mergeOptionalContext(
      input.session.netLoggerContext,
      input.netLoggerContext,
    ),
    contestContext: mergeOptionalContext(
      input.session.contestContext,
      input.contestContext,
    ),
    potaContext: mergePotaContext(input.session.potaContext, input.potaContext),
    gps: cloneGpsCapture(input.gps),
    stationProfileSnapshot: snapshot,
    syncStatus: 'local-only',
    qrzEnrichment: cloneOptionalObject(input.qrzEnrichment),
  });

  return {
    contact,
    nextSession: assignedContactNumber
      ? incrementSessionContactNumber(input.session)
      : input.session,
  };
}

function resolveContactNumber(
  input: CreateContactFromSessionInput,
): AssignedContactNumber | undefined {
  if (input.assignContactNumber === false) {
    return undefined;
  }

  if (input.contactNumber !== undefined) {
    return {
      value: input.contactNumber,
      display: input.contactNumberDisplay ?? formatSessionContactNumber(input.contactNumber),
    };
  }

  const next = getNextSessionContactNumber(input.session);

  return {
    value: next.value,
    display: input.contactNumberDisplay ?? next.formatted,
  };
}

function createStationProfileSnapshot(profile: StationProfile): StationProfileSnapshot {
  return {
    profileName: profile.profileName,
    callsign: profile.callsign,
    operatorName: profile.operatorName,
    country: profile.country,
    dxccEntity: profile.dxccEntity,
    state: profile.state,
    county: profile.county,
    city: profile.city,
    homeGrid: profile.homeGrid,
    mobilePortableStatus: profile.mobilePortableStatus,
    txPowerWatts: profile.txPowerWatts,
    rigInfo: profile.rigInfo,
    notes: profile.notes,
    defaultMode: profile.defaultMode,
    defaultSignalReport: cloneSignalReport(profile.defaultSignalReport),
    active: profile.active,
  };
}

function resolveGrid(input: CreateContactFromSessionInput): string | undefined {
  if (input.grid !== undefined) {
    return input.grid;
  }

  if (input.gps === undefined) {
    return undefined;
  }

  return calculateMaidenheadGrid(input.gps, input.session.defaultGridLength);
}

function mergePotaContext(
  sessionContext: PotaContext | undefined,
  override: Partial<PotaContext> | undefined,
): PotaContext | undefined {
  const merged = mergeOptionalContext(sessionContext, override);

  if (merged === undefined) {
    return undefined;
  }

  return {
    ...merged,
    parkRefs: [...(merged.parkRefs ?? [])],
    huntedParkRefs: merged.huntedParkRefs === undefined
      ? undefined
      : [...merged.huntedParkRefs],
  };
}

function mergeOptionalContext<TContext extends Record<string, unknown>>(
  sessionContext: TContext | undefined,
  override: Partial<TContext> | undefined,
): TContext | undefined {
  if (sessionContext === undefined && override === undefined) {
    return undefined;
  }

  return omitUndefined({
    ...cloneOptionalObject(sessionContext),
    ...cloneOptionalObject(override),
  }) as TContext;
}

function cloneSignalReport(report: SignalReport): SignalReport {
  return {
    sent: report.sent,
    received: report.received,
  };
}

function cloneGpsCapture(gps: GpsCapture | undefined): GpsCapture | undefined {
  if (gps === undefined) {
    return undefined;
  }

  return { ...gps };
}

function cloneOptionalObject<T extends Record<string, unknown>>(
  value: T | undefined,
): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  return { ...value };
}

function createStableContactId(
  input: CreateContactFromSessionInput,
  assignedContactNumber: AssignedContactNumber | undefined,
): string {
  return [
    'local',
    input.session.id,
    input.callsign,
    input.contactedAt,
    assignedContactNumber?.display ?? 'unnumbered',
  ]
    .join('-')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}
