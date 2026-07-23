import type {
  Contact,
} from './models';

export type BackendContactIn = {
  local_id: string;
  session_id: string;
  call?: string;
  qso_date?: string;
  time_on?: string;
  mode?: string;
  band?: string;
  freq?: string;
  rst_sent?: string;
  rst_rcvd?: string;
  station_callsign?: string;
  operator?: string;
  my_gridsquare?: string;
  gridsquare?: string;
  logging_mode?: Contact['loggingMode'];
  latitude?: number;
  longitude?: number;
  location_accuracy_meters?: number;
  location_captured_at?: string;
  county?: string;
  state?: string;
  country?: string;
  station_profile_id?: string;
  station_profile_name?: string;
  station_country?: string;
  station_dxcc?: string;
  station_state?: string;
  station_county?: string;
  station_city?: string;
  station_mobile_portable_status?: string;
  station_tx_power_watts?: number;
  station_rig_info?: string;
  station_notes?: string;
  netlogger_net?: string;
  netlogger_checkin_number?: number;
  netlogger_ncs?: string;
  netlogger_member_id?: string;
  contact_number?: number;
  contact_number_display?: string;
  contest_name?: string;
  exchange_sent?: string;
  exchange_received?: string;
  serial_sent?: string;
  serial_received?: string;
  pota_my_refs?: string;
  pota_their_refs?: string;
  qrz_name?: string;
  qrz_grid?: string;
  qrz_county?: string;
  qrz_fetched_at?: string;
};

export function mapContactToBackendContactIn(contact: Contact): BackendContactIn {
  const contactedAt = new Date(contact.contactedAt);

  if (Number.isNaN(contactedAt.getTime())) {
    throw new RangeError('Contact contactedAt must be a valid date string.');
  }

  return omitUndefined({
    local_id: contact.id,
    session_id: contact.sessionId,
    call: contact.callsign,
    qso_date: formatUtcDate(contactedAt),
    time_on: formatUtcTime(contactedAt),
    mode: contact.mode,
    band: contact.band,
    freq: contact.frequencyMhz?.toString(),
    rst_sent: contact.signalReport.sent,
    rst_rcvd: contact.signalReport.received,
    station_callsign: contact.stationProfileSnapshot.callsign,
    operator: contact.stationProfileSnapshot.operatorName,
    my_gridsquare: contact.maidenheadGrid ?? contact.grid,
    gridsquare: contact.maidenheadGrid ?? contact.grid,
    logging_mode: contact.loggingMode,
    latitude: contact.gps?.latitude,
    longitude: contact.gps?.longitude,
    location_accuracy_meters: contact.gps?.accuracyMeters,
    location_captured_at: contact.gps?.capturedAt,
    county: contact.county,
    station_profile_name: contact.stationProfileSnapshot.profileName,
    station_country: contact.stationProfileSnapshot.country,
    station_dxcc: contact.stationProfileSnapshot.dxccEntity,
    station_state: contact.stationProfileSnapshot.state,
    station_county: contact.stationProfileSnapshot.county,
    station_city: contact.stationProfileSnapshot.city,
    station_mobile_portable_status: contact.stationProfileSnapshot.mobilePortableStatus,
    station_tx_power_watts: contact.stationProfileSnapshot.txPowerWatts,
    station_rig_info: contact.stationProfileSnapshot.rigInfo,
    station_notes: contact.stationProfileSnapshot.notes,
    netlogger_net: contact.netLoggerContext?.netName,
    netlogger_checkin_number: parseOptionalInteger(contact.netLoggerContext?.checkInNumber),
    netlogger_ncs: contact.netLoggerContext?.netControlCallsign,
    contact_number: contact.contactNumber,
    contact_number_display: contact.contactNumberDisplay,
    contest_name: contact.contestContext?.contestName,
    exchange_sent: contact.contestContext?.exchangeSent,
    exchange_received: contact.contestContext?.exchangeReceived,
    serial_sent: contact.contestContext?.serialSent,
    serial_received: contact.contestContext?.serialReceived,
    pota_my_refs: joinRefs(contact.potaContext?.parkRefs),
    pota_their_refs: joinRefs(contact.potaContext?.huntedParkRefs),
    qrz_name: contact.qrzEnrichment?.displayName,
    qrz_grid: contact.qrzEnrichment?.grid,
    qrz_county: contact.qrzEnrichment?.county,
    qrz_fetched_at: contact.qrzEnrichment?.fetchedAt,
  });
}

function formatUtcDate(date: Date): string {
  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
  ].join('');
}

function formatUtcTime(date: Date): string {
  return [
    pad2(date.getUTCHours()),
    pad2(date.getUTCMinutes()),
    pad2(date.getUTCSeconds()),
  ].join('');
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }

  return Number.parseInt(value, 10);
}

function joinRefs(refs: string[] | undefined): string | undefined {
  return refs && refs.length > 0 ? refs.join(',') : undefined;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}
