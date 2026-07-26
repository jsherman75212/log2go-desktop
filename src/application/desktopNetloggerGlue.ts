import type { FlatActiveNet, NetLoggerCheckin, SelectedNet } from '../domain/netloggerTypes';
import { parseCheckinStatus } from '../domain/netloggerTypes';
import type { Contact } from '../domain/models';

export type ContactDraft = {
  callsign: string;
  name: string;
  rstSent: string;
  rstReceived: string;
  frequency: string;
  band: string;
  mode: string;
  grid: string;
  state: string;
  county: string;
  qth: string;
  remarks: string;
};

export type RosterDensity = 'normal' | 'compact' | 'extra-compact';

export type RosterDensityOption = {
  value: RosterDensity;
  label: string;
};

export type RosterSort = {
  key: string;
  dir: 'asc' | 'desc';
};

export const rosterDensityOptions: RosterDensityOption[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'compact', label: 'Compact' },
  { value: 'extra-compact', label: 'Extra compact' },
];

export const emptyDraft: ContactDraft = {
  callsign: '',
  name: '',
  rstSent: '59',
  rstReceived: '59',
  frequency: '',
  band: '',
  mode: 'SSB',
  grid: '',
  state: '',
  county: '',
  qth: '',
  remarks: '',
};

export function toSelectedNet(net: FlatActiveNet): SelectedNet {
  return {
    serverName: net.serverName,
    netName: net.netName,
    frequency: net.frequency,
    mode: net.mode,
    band: net.band,
    netControl: net.netControl,
    logger: net.logger,
    source: net.source ?? 'netlogger',
    net_id: net.net_id,
  };
}

export function draftFromCheckin(checkin: NetLoggerCheckin, selectedNet?: SelectedNet): ContactDraft {
  return {
    callsign: checkin.callsign,
    name: checkin.preferredName || checkin.firstName,
    rstSent: '59',
    rstReceived: '59',
    frequency: selectedNet?.frequency ?? '',
    band: selectedNet?.band ?? '',
    mode: selectedNet?.mode || 'SSB',
    grid: checkin.grid,
    state: checkin.state,
    county: checkin.county,
    qth: checkin.cityCountry,
    remarks: [checkin.remarks, checkin.qslInfo].filter(Boolean).join(' | '),
  };
}

export function statusClass(status: string, isCurrentlyOperating = false): string {
  const parsed = parseCheckinStatus(status);
  if (isCurrentlyOperating || parsed.isCurrentlyOperating) return 'status-current-operating';
  if (parsed.isCheckedOut) return 'status-checked-out';
  if (parsed.isNotHeard) return 'status-not-heard';
  if (parsed.isNeededNext) return 'status-needed-next';
  if (parsed.isNeeded) return 'status-needed';
  if (parsed.isWorked) return 'status-netlogger-worked';
  if (parsed.isUnavailable) return 'status-unavailable';
  if (parsed.isNotResponding) return 'status-not-responding';
  if (parsed.isNetControl) return 'status-nc';
  if (parsed.isLogger) return 'status-logger';
  if (parsed.isRelay) return 'status-relay';
  if (parsed.isVip) return 'status-vip';
  if (parsed.isOperatorStation) return 'status-operator';
  return '';
}

export function rosterRowKey(checkin: Pick<NetLoggerCheckin, 'serialNo' | 'callsign'>): string {
  return `${checkin.serialNo}:${normalizeRosterCallsign(checkin.callsign)}`;
}

export function normalizeRosterCallsign(callsign: string): string {
  return callsign.trim().toUpperCase();
}

export function isCheckinWorked(checkin: NetLoggerCheckin, contacts: Contact[], selectedNet?: SelectedNet): boolean {
  const checkinCallsign = normalizeRosterCallsign(checkin.callsign);
  const selectedNetName = selectedNet?.netName.trim().toLowerCase();

  return contacts.some((contact) => {
    if (normalizeRosterCallsign(contact.callsign) !== checkinCallsign) return false;
    if (!selectedNetName) return true;
    return contact.netLoggerContext?.netName?.trim().toLowerCase() === selectedNetName;
  });
}

export function workedFlag(checkin: NetLoggerCheckin, contacts: Contact[], selectedNet?: SelectedNet): string {
  return isCheckinWorked(checkin, contacts, selectedNet) ? 'W' : '';
}

export function rosterDensityClass(density: RosterDensity): string {
  return `roster-density-${density}`;
}

export function sortRosterCheckins(checkins: NetLoggerCheckin[], sort: RosterSort): NetLoggerCheckin[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...checkins].sort((a, b) => {
    if (sort.key === 'serialNo') {
      return (a.serialNo - b.serialNo) * dir;
    }

    const av = String(a[sort.key as keyof NetLoggerCheckin] ?? '');
    const bv = String(b[sort.key as keyof NetLoggerCheckin] ?? '');
    return av.localeCompare(bv) * dir;
  });
}
