import {
  type BackendContactIn,
  mapContactToBackendContactIn,
} from '../domain/backendContactMapper';
import type { Contact } from '../domain/models';
import type { StationProfileCollection } from '../domain/models';

export type LoginTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  user_id?: number | null;
  device_id?: string | null;
};

export type BackendContactResponse = Record<string, unknown>;

export type BackendSyncSuccess = {
  local_id: string;
  backend_id?: string;
};

export type BackendSyncFailure = {
  local_id: string;
  error?: string;
};

export type BackendSyncResponse = {
  contacts?: BackendContactResponse[];
  synced?: BackendSyncSuccess[];
  failed?: BackendSyncFailure[];
  [key: string]: unknown;
};

export type ContestCalendarEvent = {
  name: string;
  start_date: string;
  end_date: string;
  url?: string | null;
  source: string;
  active: boolean;
};

export type ContestCalendarResponse = {
  source: string;
  source_url: string;
  fetched_at: string;
  today: string;
  contests: ContestCalendarEvent[];
};

export type AccountProfile = {
  id: number;
  callsign: string;
  email: string;
  username: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly responseText: string;
  readonly responseBody: unknown;

  constructor(status: number, responseText: string, responseBody: unknown) {
    super(`Backend API request failed with status ${status}.`);
    this.name = 'ApiError';
    this.status = status;
    this.responseText = responseText;
    this.responseBody = responseBody;
  }
}

export async function login(
  baseUrl: string,
  username: string,
  password: string,
  deviceId?: string,
): Promise<LoginTokenResponse> {
  return requestJson<LoginTokenResponse>(baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, device_id: deviceId }),
  });
}

export async function getAccountProfile(baseUrl: string, token: string): Promise<AccountProfile> {
  return requestJson<AccountProfile>(baseUrl, '/api/v1/account', {
    method: 'GET',
    token,
  });
}

export async function updateAccountPassword(
  baseUrl: string,
  token: string,
  username: string,
  currentPassword: string,
  newPassword: string,
): Promise<AccountProfile> {
  return requestJson<AccountProfile>(baseUrl, '/api/v1/account', {
    method: 'PUT',
    token,
    body: JSON.stringify({
      username,
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
}

export async function getStationProfiles(
  baseUrl: string,
  token: string,
): Promise<StationProfileCollection> {
  return requestJson<StationProfileCollection>(baseUrl, '/api/v1/account/station-profiles', {
    method: 'GET',
    token,
  });
}

export async function saveStationProfiles(
  baseUrl: string,
  token: string,
  collection: StationProfileCollection,
): Promise<StationProfileCollection> {
  return requestJson<StationProfileCollection>(baseUrl, '/api/v1/account/station-profiles', {
    method: 'PUT',
    token,
    body: JSON.stringify(collection),
  });
}

export async function createContact(
  baseUrl: string,
  token: string,
  contact: Contact,
): Promise<BackendContactResponse> {
  return requestJson<BackendContactResponse>(baseUrl, '/api/v1/contacts', {
    method: 'POST',
    token,
    body: JSON.stringify(mapContactToBackendContactIn(contact)),
  });
}

export async function syncContacts(
  baseUrl: string,
  token: string,
  contacts: Contact[],
): Promise<BackendSyncResponse> {
  const mappedContacts: BackendContactIn[] = contacts.map(mapContactToBackendContactIn);

  return requestJson<BackendSyncResponse>(baseUrl, '/api/v1/contacts/sync', {
    method: 'POST',
    token,
    body: JSON.stringify({ contacts: mappedContacts }),
  });
}

export type ContactsResponse = {
  contacts: BackendContactResponse[];
  total: number;
};

export async function listContacts(
  baseUrl: string,
  token: string,
  limit?: number,
  offset?: number,
): Promise<BackendContactResponse[]> {
  let path = '/api/v1/contacts';
  const params: string[] = [];
  if (limit !== undefined) params.push(`limit=${limit}`);
  if (offset !== undefined) params.push(`offset=${offset}`);
  if (params.length > 0) path += '?' + params.join('&');
  const data = await requestJson<ContactsResponse | BackendContactResponse[]>(baseUrl, path, {
    method: 'GET',
    token,
  });
  // Support new {contacts, total} shape and legacy plain-array shape
  if (Array.isArray(data)) return data;
  return (data as ContactsResponse).contacts ?? [];
}

export async function listContactsByNet(
  baseUrl: string,
  token: string,
  netName: string,
): Promise<BackendContactResponse[]> {
  const params = `?net=${encodeURIComponent(netName)}`;
  const data = await requestJson<ContactsResponse | BackendContactResponse[]>(baseUrl, `/api/v1/contacts${params}`, {
    method: 'GET',
    token,
  });
  if (Array.isArray(data)) return data;
  return (data as ContactsResponse).contacts ?? [];
}

export async function exportAdif(baseUrl: string, token: string): Promise<string> {
  const response = await request(baseUrl, '/api/v1/export/adif', {
    method: 'GET',
    token,
  });

  return response.text();
}

export async function updateContact(
  baseUrl: string,
  token: string,
  contactId: number,
  contact: Partial<BackendContactResponse>,
): Promise<BackendContactResponse> {
  return requestJson<BackendContactResponse>(baseUrl, `/api/v1/contacts/${contactId}`, {
    method: 'PUT',
    token,
    body: JSON.stringify(contact),
  });
}

export async function deleteContact(
  baseUrl: string,
  token: string,
  contactId: number,
): Promise<void> {
  await requestJson<{ success: boolean; id: number }>(baseUrl, `/api/v1/contacts/${contactId}`, {
    method: 'DELETE',
    token,
  });
}

export type DXSpot = {
  spotter: string;
  freq: number;
  dx_call: string;
  mode: string;
  band: string;
  snr: string;
  wpm: string;
  comment: string;
  time: string;
  source: string;
};

export async function getDXSpots(
  baseUrl: string,
  token: string,
  limit: number = 20,
): Promise<DXSpot[]> {
  return requestJson<DXSpot[]>(baseUrl, `/api/v1/dx-spots?limit=${limit}`, {
    method: 'GET',
    token,
  });
}

export type ServiceSyncReport = {
  summary: string;
  total_uploaded: number;
  total_confirmed: number;
  errors: string[];
  uploads: { service: string; uploaded: number; skipped: number; errors: string[] }[];
  confirmations: { service: string; confirmed: number; checked: number; errors: string[] }[];
};

export async function uploadToServices(
  baseUrl: string,
  token: string,
): Promise<ServiceSyncReport> {
  return requestJson<ServiceSyncReport>(baseUrl, '/api/v1/sync-services', {
    method: 'POST',
    token,
  });
}

export type ServiceImportResult = {
  results: { service: string; imported: number; skipped: number; warning: string | null }[];
  total_imported: number;
  errors: string[];
};

export async function importFromServices(
  baseUrl: string,
  token: string,
): Promise<ServiceImportResult> {
  return requestJson<ServiceImportResult>(baseUrl, '/api/v1/import-services', {
    method: 'POST',
    token,
  });
}

export type DedupResult = {
  merged: number;
  details: Array<{ kept: number; deleted: number; call: string; qso_date: string; time_on: string; band: string }>;
};

export async function dedupContacts(
  baseUrl: string,
  token: string,
): Promise<DedupResult> {
  return requestJson<DedupResult>(baseUrl, '/api/v1/contacts/dedup', {
    method: 'POST',
    token,
  });
}

export type LotwCertStatus = {
  has_certificate: boolean;
  cert_files: string[];
  tqsl_home: string;
};

export async function checkLotwCertificate(
  baseUrl: string,
  token: string,
): Promise<LotwCertStatus> {
  return requestJson<LotwCertStatus>(baseUrl, '/api/v1/lotw/certificate', {
    method: 'GET',
    token,
  });
}

export async function uploadLotwCertificate(
  baseUrl: string,
  token: string,
  file: File,
  password?: string,
): Promise<{ success: boolean; message: string }> {
  const formData = new FormData();
  formData.append('file', file);
  if (password) formData.append('password', password);

  const response = await fetch(`${baseUrl}/api/v1/lotw/certificate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData,
  });
  return response.json();
}

export type RegistrationStartResponse = {
  device_id: string;
  email: string;
  callsign: string;
  friendly_name?: string;
  verification_sent: boolean;
  email_status: string;
  verify_url: string;
  expires_at?: string;
  message: string;
};

export type RegistrationStatusResponse = {
  device_id: string;
  status: string;
  username?: string | null;
  callsign?: string | null;
  email?: string | null;
  friendly_name?: string | null;
};

export async function startRegistration(
  baseUrl: string,
  params: { callsign: string; email: string; deviceId?: string; deviceName?: string; deviceType?: string },
): Promise<RegistrationStartResponse> {
  return requestJson<RegistrationStartResponse>(baseUrl, '/api/v1/registration/start', {
    method: 'POST',
    body: JSON.stringify({
      callsign: params.callsign,
      email: params.email,
      device_id: params.deviceId,
      device_name: params.deviceName,
      device_type: params.deviceType,
    }),
  });
}

export async function getRegistrationStatus(
  baseUrl: string,
  deviceId: string,
): Promise<RegistrationStatusResponse> {
  return requestJson<RegistrationStatusResponse>(baseUrl, `/api/v1/registration/status/${encodeURIComponent(deviceId)}`, {
    method: 'GET',
  });
}

export type ApiKeyOut = {
  id: number;
  service_name: string;
  label: string | null;
  has_key: boolean;
  created_at: string;
  updated_at: string;
};

// ── External Service Credentials (LoTW, QRZ, eQSL) ───────────────────

export type ServiceCredentialOut = {
  id: number;
  service_name: string;
  service_username: string;
  label: string | null;
  status: string;
  verified_at: string | null;
  verification_status: string;
  verification_error: string | null;
  last_import_at: string | null;
  last_import_count: number;
  last_import_error: string | null;
  qth_nickname: string | null;
  date_range_start: string | null;
  date_range_end: string | null;
  created_at: string;
  updated_at: string;
};

export async function listServiceCredentials(
  baseUrl: string,
  token: string,
  includeDisabled = false,
): Promise<ServiceCredentialOut[]> {
  const params = includeDisabled ? '?include_disabled=true' : '';
  return requestJson<ServiceCredentialOut[]>(baseUrl, `/api/v1/account/services${params}`, {
    method: 'GET',
    token,
  });
}

export async function saveServiceCredential(
  baseUrl: string,
  token: string,
  credential: { service_name: string; service_username: string; service_password: string; label?: string; qth_nickname?: string; date_range_start?: string; date_range_end?: string },
): Promise<ServiceCredentialOut> {
  return requestJson<ServiceCredentialOut>(baseUrl, '/api/v1/account/services', {
    method: 'POST',
    token,
    body: JSON.stringify(credential),
  });
}

export async function updateServiceCredential(
  baseUrl: string,
  token: string,
  credentialId: number,
  credential: { service_name: string; service_username: string; service_password: string; label?: string; qth_nickname?: string; date_range_start?: string; date_range_end?: string },
): Promise<ServiceCredentialOut> {
  return requestJson<ServiceCredentialOut>(baseUrl, `/api/v1/account/services/${credentialId}`, {
    method: 'PUT',
    token,
    body: JSON.stringify(credential),
  });
}

export async function disableServiceCredential(
  baseUrl: string,
  token: string,
  credentialId: number,
): Promise<ServiceCredentialOut> {
  return requestJson<ServiceCredentialOut>(baseUrl, `/api/v1/account/services/${credentialId}/disable`, {
    method: 'POST',
    token,
  });
}

export async function listApiKeys(baseUrl: string, token: string): Promise<ApiKeyOut[]> {
  return requestJson<ApiKeyOut[]>(baseUrl, '/api/v1/account/api-keys', { method: 'GET', token });
}

export async function saveApiKey(baseUrl: string, token: string, serviceName: string, apiKey: string, label?: string): Promise<ApiKeyOut> {
  return requestJson<ApiKeyOut>(baseUrl, '/api/v1/account/api-keys', {
    method: 'POST',
    token,
    body: JSON.stringify({ service_name: serviceName, api_key: apiKey, label }),
  });
}

export async function deleteApiKey(baseUrl: string, token: string, keyId: number): Promise<void> {
  await request(baseUrl, `/api/v1/account/api-keys/${keyId}`, { method: 'DELETE', token });
}

export async function fetchArrlContests(baseUrl: string): Promise<ContestCalendarResponse> {
  return requestJson<ContestCalendarResponse>(baseUrl, '/api/v1/contests/arrl', {
    method: 'GET',
  });
}

export type QrzLookupResult = {
  callsign: string | null;
  first_name: string | null;
  name: string | null;
  addr1: string | null;
  addr2: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  ccode: string | null;
  grid: string | null;
  county: string | null;
  lat: string | null;
  lon: string | null;
  email: string | null;
  url: string | null;
  license_class: string | null;
  efdate: string | null;
  expdate: string | null;
};

export async function qrzLookup(baseUrl: string, token: string, callsign: string): Promise<QrzLookupResult> {
  const params = `?callsign=${encodeURIComponent(callsign.trim().toUpperCase())}`;
  return requestJson<QrzLookupResult>(baseUrl, `/api/v1/qrz/lookup${params}`, {
    method: 'GET',
    token,
  });
}

type ApiRequestOptions = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  token?: string;
  body?: string;
};

async function requestJson<TResponse>(
  baseUrl: string,
  path: string,
  options: ApiRequestOptions,
): Promise<TResponse> {
  const response = await request(baseUrl, path, options);
  const responseText = await response.text();

  return parseJsonResponse(responseText) as TResponse;
}

async function request(
  baseUrl: string,
  path: string,
  options: ApiRequestOptions,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(joinUrl(baseUrl, path), {
    method: options.method,
    headers,
    body: options.body,
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new ApiError(response.status, responseText, parseJsonResponse(responseText));
  }

  return response;
}

function joinUrl(baseUrl: string, path: string): string {
  // When running in the web preview server (localhost:54337), rewrite the
  // public API URL to use the same-origin /log2go-api/ proxy so the browser
  // doesn't hit CORS issues. In Electron (file:// origin) and in production
  // (log2goapp.net), hit the API URL directly.
  if (typeof window !== 'undefined' && baseUrl.includes('api.log2goapp.net')) {
    const origin = window.location.origin;
    const isFileOrigin = origin.startsWith('file://');
    // Electron loads via file:// — it should hit the API directly (no proxy).
    // Only the web preview server on localhost:54337 has a /log2go-api/ proxy.
    const isWebPreview = !isFileOrigin && (origin.includes('localhost:54337') || origin.includes('127.0.0.1:54337'));
    if (isWebPreview) {
      return `/log2go-api${path}`;
    }
  }
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function parseJsonResponse(responseText: string): unknown {
  if (!responseText) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}
