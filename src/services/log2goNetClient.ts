/**
 * Log2Go Net Server Client
 *
 * Talks to the self-hosted Log2Go net server at the Log2Go backend
 * (api.log2goapp.net by default — overridable via loggingState.backendBaseUrl).
 *
 * All endpoints live under /api/v1/nets/ and return JSON. Unlike the
 * NetLogger legacy CGI/XML API, this is a clean REST surface that the
 * Log2Go backend owns end-to-end, so we get fresh AIM + checkins +
 * monitor count in a single /updates poll.
 *
 * Base URL handling mirrors netloggerClient.ts: in local dev/preview we
 * rewrite api.log2goapp.net to the same-origin /log2go-api proxy so
 * the browser can reach the backend through the Vite preview proxy.
 */

// ── Response Types ───────────────────────────────────────────────────

export type Log2GoNet = {
  id: number;
  name: string;
  server_name: string;
  frequency: string;
  mode: string;
  band: string;
  net_control: string;
  logger: string;
  status: string;
  enable_messaging: boolean;
  subscriber_count: number;
};

export type Log2GoActiveNetsResponse = {
  nets: Log2GoNet[];
};

export type Log2GoCheckin = {
  serial_no?: number;
  callsign: string;
  state?: string;
  remarks?: string;
  qsl?: string;
  city?: string;
  first_name?: string;
  status?: string;
  county?: string;
  grid?: string;
  country?: string;
  member_id?: string;
};

export type Log2GoCheckinsResponse = {
  success: boolean;
  checkins: Log2GoCheckin[];
  count?: number;
  error?: string;
};

export type Log2GoAIMMessage = {
  id: number;
  serial: number;
  callsign: string;
  is_net_control?: boolean;
  message: string;
  created_at: string;
  ip_address?: string;
};

export type Log2GoAIMResponse = {
  success: boolean;
  aim_messages: Log2GoAIMMessage[];
  after_serial?: number;
  error?: string;
};

export type Log2GoMonitor = {
  callsign: string;
  display_name: string;
  is_online: boolean;
  is_net_control: boolean;
  is_logger: boolean;
  role: string;
};

export type Log2GoMonitorsResponse = {
  success: boolean;
  monitors: Log2GoMonitor[];
  swl_count?: number;
  count?: number;
  error?: string;
};

export type Log2GoUpdatesResponse = {
  success: boolean;
  aim_messages: Log2GoAIMMessage[];
  monitor_count: number;
  swl_count?: number;
  your_role?: string;
  is_logger?: boolean;
  checkins: Log2GoCheckin[];
  im_serial?: number;
  net_control?: string;
  logger?: string;
  error?: string;
};

export type Log2GoSubscribeResponse = {
  success: boolean;
  error?: string;
};

export type Log2GoOpenNetResponse = {
  net_id: number;
  ncs_token: string;
  name: string;
};

// ── Net Profiles (saved net templates per account) ───────────────────

export type NetProfile = {
  id?: number;
  name: string;
  frequency: string;
  mode: string;
  band: string;
  net_control: string;
  logger: string;
  enable_messaging: boolean;
  is_default: boolean;
};

export type NetProfilesResponse = {
  profiles: NetProfile[];
};

export type Log2GoCloseNetResponse = {
  success: boolean;
  error?: string;
};

export type Log2GoAddCheckinResponse = {
  success: boolean;
  serial_no?: number;
  error?: string;
};

// ── Past Nets (historical/closed nets) ──────────────────────────────

export type PastNetInfo = {
  id: number;
  name: string;
  frequency: string;
  mode: string;
  band: string;
  net_control: string;
  logger: string;
  created_at: string;
  closed_at: string;
  checkin_count: number;
  aim_count: number;
};

export type PastNetsResponse = {
  nets: PastNetInfo[];
};

export type PastNetDetail = {
  id: number;
  name: string;
  frequency: string;
  mode: string;
  band: string;
  net_control: string;
  logger: string;
  created_at: string;
  closed_at: string;
  checkins: Log2GoCheckin[];
  aim_messages: Log2GoAIMMessage[];
  monitors: Log2GoMonitor[];
};

// ── URL helper (mirrors netloggerClient.joinUrl) ─────────────────────

function joinUrl(baseUrl: string, path: string): string {
  if (typeof window !== 'undefined' && baseUrl.includes('api.log2goapp.net')) {
    const origin = window.location.origin;
    const isLocalDev =
      origin.includes('localhost') ||
      origin.includes('127.0.0.1') ||
      origin.includes(':54337');
    if (isLocalDev) {
      return `/log2go-api${path}`;
    }
  }
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

// ── Internal fetch wrapper ───────────────────────────────────────────

async function log2goJsonFetch<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(joinUrl(baseUrl, path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, */*',
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }
  if (!response.ok) {
    const detail =
      body && typeof body === 'object' && 'detail' in body && typeof (body as { detail?: string }).detail === 'string'
        ? (body as { detail: string }).detail
        : text;
    throw new Error(detail || `Log2Go net API ${path} failed with status ${response.status}`);
  }
  return body as T;
}

function postJson(baseUrl: string, path: string, payload: unknown): Promise<unknown> {
  return log2goJsonFetch<unknown>(baseUrl, path, {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  });
}

/**
 * Authenticated fetch wrapper for endpoints that require a Bearer token
 * (e.g. per-account net profiles). Mirrors backendClient.ts's requestJson
 * pattern: sends Authorization: Bearer <token> and parses JSON.
 */
async function log2goAuthFetch<T>(
  baseUrl: string,
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(joinUrl(baseUrl, path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, */*',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }
  if (!response.ok) {
    const detail =
      body && typeof body === 'object' && 'detail' in body && typeof (body as { detail?: string }).detail === 'string'
        ? (body as { detail: string }).detail
        : text;
    throw new Error(detail || `Log2Go net API ${path} failed with status ${response.status}`);
  }
  return body as T;
}

// ── Public API ───────────────────────────────────────────────────────

export async function fetchLog2GoNets(baseUrl: string): Promise<Log2GoActiveNetsResponse> {
  // The backend returns either { nets: [...] } or a bare array; accept both.
  const data = await log2goJsonFetch<Log2GoActiveNetsResponse | Log2GoNet[]>(
    baseUrl,
    '/api/v1/nets/active',
  );
  if (Array.isArray(data)) {
    return { nets: data };
  }
  return data;
}

export async function subscribeLog2GoNet(
  baseUrl: string,
  netId: number,
  callsign: string,
  operatorName?: string,
): Promise<Log2GoSubscribeResponse> {
  const data = await postJson(baseUrl, `/api/v1/nets/${netId}/subscribe`, {
    callsign,
    operator_name: operatorName,
  });
  return data as Log2GoSubscribeResponse;
}

export async function unsubscribeLog2GoNet(
  baseUrl: string,
  netId: number,
  callsign: string,
  operatorName?: string,
): Promise<Log2GoSubscribeResponse> {
  const data = await postJson(baseUrl, `/api/v1/nets/${netId}/unsubscribe`, {
    callsign,
    operator_name: operatorName,
  });
  return data as Log2GoSubscribeResponse;
}

export async function sendLog2GoAIM(
  baseUrl: string,
  netId: number,
  callsign: string,
  operatorName: string | undefined,
  message: string,
): Promise<Log2GoSubscribeResponse> {
  const data = await postJson(baseUrl, `/api/v1/nets/${netId}/aim`, {
    callsign,
    operator_name: operatorName,
    message,
  });
  return data as Log2GoSubscribeResponse;
}

export async function getLog2GoUpdates(
  baseUrl: string,
  netId: number,
  callsign: string,
  operatorName: string | undefined,
  imSerial: number,
): Promise<Log2GoUpdatesResponse> {
  const data = await postJson(baseUrl, `/api/v1/nets/${netId}/updates`, {
    callsign,
    operator_name: operatorName,
    im_serial: imSerial,
  });
  return data as Log2GoUpdatesResponse;
}

export async function getLog2GoMonitors(
  baseUrl: string,
  netId: number,
): Promise<Log2GoMonitorsResponse> {
  return log2goJsonFetch<Log2GoMonitorsResponse>(baseUrl, `/api/v1/nets/${netId}/monitors`);
}

export async function getLog2GoCheckins(
  baseUrl: string,
  netId: number,
): Promise<Log2GoCheckinsResponse> {
  return log2goJsonFetch<Log2GoCheckinsResponse>(baseUrl, `/api/v1/nets/${netId}/checkins`);
}

export async function getLog2GoAIM(
  baseUrl: string,
  netId: number,
  afterSerial: number = 0,
): Promise<Log2GoAIMResponse> {
  const path = `/api/v1/nets/${netId}/aim?after_serial=${encodeURIComponent(String(afterSerial))}`;
  return log2goJsonFetch<Log2GoAIMResponse>(baseUrl, path);
}

export async function openLog2GoNet(
  baseUrl: string,
  name: string,
  frequency: string,
  mode: string,
  band: string,
  netControl: string,
  logger: string,
  enableMessaging: boolean = true,
  ncsProfile?: {
    first_name?: string;
    state?: string;
    grid?: string;
    county?: string;
    city?: string;
    country?: string;
  },
): Promise<Log2GoOpenNetResponse> {
  const data = await postJson(baseUrl, '/api/v1/nets', {
    name,
    frequency,
    mode,
    band,
    net_control: netControl,
    logger,
    enable_messaging: enableMessaging,
    ncs_first_name: ncsProfile?.first_name ?? '',
    ncs_state: ncsProfile?.state ?? '',
    ncs_grid: ncsProfile?.grid ?? '',
    ncs_county: ncsProfile?.county ?? '',
    ncs_city: ncsProfile?.city ?? '',
    ncs_country: ncsProfile?.country ?? '',
  });
  return data as Log2GoOpenNetResponse;
}

export async function closeLog2GoNet(
  baseUrl: string,
  netId: number,
  ncsCallsign: string,
): Promise<Log2GoCloseNetResponse> {
  const data = await postJson(baseUrl, `/api/v1/nets/${netId}/close`, {
    ncs_callsign: ncsCallsign,
  });
  return data as Log2GoCloseNetResponse;
}

export async function addLog2GoCheckin(
  baseUrl: string,
  netId: number,
  ncsCallsign: string,
  checkinData: Record<string, unknown>,
): Promise<Log2GoAddCheckinResponse> {
  const data = await postJson(baseUrl, `/api/v1/nets/${netId}/checkins`, {
    ncs_callsign: ncsCallsign,
    ...checkinData,
  });
  return data as Log2GoAddCheckinResponse;
}

export type Log2GoPromoteResponse = {
  success: boolean;
  callsign: string;
  role: string;
  label: string;
};

/**
 * Promote/demote a monitor on a Log2Go net to a different role.
 * `role` must be one of: "NCS", "CO_NCS", "LOGGER", "RELAY", "MONITOR".
 */
export async function promoteUser(
  baseUrl: string,
  netId: number,
  ncsCallsign: string,
  targetCallsign: string,
  role: string,
): Promise<Log2GoPromoteResponse> {
  const data = await postJson(baseUrl, `/api/v1/nets/${netId}/promote`, {
    ncs_callsign: ncsCallsign,
    target_callsign: targetCallsign,
    role,
  });
  return data as Log2GoPromoteResponse;
}

export type Log2GoRemoveCheckinResponse = {
  success: boolean;
  serial_no: number;
  callsign: string;
};

/**
 * Remove a checkin from the roster by serial_no.
 * Only the acting NCS (or token holder who opened the net) can remove checkins.
 */
export async function removeLog2GoCheckin(
  baseUrl: string,
  netId: number,
  serialNo: number,
  ncsCallsign: string,
): Promise<Log2GoRemoveCheckinResponse> {
  const data = await postJson(baseUrl, `/api/v1/nets/${netId}/checkins/${serialNo}/remove`, {
    ncs_callsign: ncsCallsign,
  });
  return data as Log2GoRemoveCheckinResponse;
}

// ── Past Nets (historical/closed nets) ──────────────────────────────

export async function fetchPastNets(baseUrl: string): Promise<PastNetsResponse> {
  const data = await log2goJsonFetch<PastNetsResponse | PastNetInfo[]>(
    baseUrl,
    '/api/v1/nets/past',
  );
  if (Array.isArray(data)) {
    return { nets: data };
  }
  return data;
}

export async function fetchNetHistory(
  baseUrl: string,
  netId: number,
): Promise<PastNetDetail> {
  return log2goJsonFetch<PastNetDetail>(baseUrl, `/api/v1/nets/${netId}/history`);
}

// ── Net Profiles (per-account saved net templates) ──────────────────

export async function fetchNetProfiles(
  baseUrl: string,
  token: string,
): Promise<NetProfilesResponse> {
  const data = await log2goAuthFetch<NetProfilesResponse | NetProfile[]>(
    baseUrl,
    '/api/v1/nets/profiles',
    token,
    { method: 'GET' },
  );
  if (Array.isArray(data)) {
    return { profiles: data };
  }
  return data;
}

export async function saveNetProfile(
  baseUrl: string,
  token: string,
  profile: NetProfile,
): Promise<NetProfile> {
  return log2goAuthFetch<NetProfile>(baseUrl, '/api/v1/nets/profiles', token, {
    method: 'POST',
    body: JSON.stringify(profile),
  });
}

export async function deleteNetProfile(
  baseUrl: string,
  token: string,
  profileId: number,
): Promise<void> {
  await log2goAuthFetch<unknown>(
    baseUrl,
    `/api/v1/nets/profiles/${profileId}`,
    token,
    { method: 'DELETE' },
  );
}