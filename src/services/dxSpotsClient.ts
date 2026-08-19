import { getDXSpots, type DXSpot } from './backendClient';

export { getDXSpots, type DXSpot };

export const DX_SPOT_BANDS = [
  'All',
  '160m',
  '80m',
  '40m',
  '20m',
  '15m',
  '10m',
  '6m',
  '2m',
] as const;

export type DxSpotBand = (typeof DX_SPOT_BANDS)[number];

export type DxSpotsApiState = {
  spots: DXSpot[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
};

/**
 * Map a backend DX spot into a contact draft pre-fill shape.
 */
export function draftFromDxSpot(spot: DXSpot): {
  callsign: string;
  frequency: string;
  band: string;
  mode: string;
} {
  return {
    callsign: spot.dx_call.trim().toUpperCase(),
    frequency: Number.isFinite(spot.freq) ? spot.freq.toFixed(3) : '',
    band: spot.band?.trim() ?? '',
    mode: spot.mode?.trim() ?? '',
  };
}

/**
 * Format a DX spot timestamp as a relative "time ago" string.
 * The backend returns ISO 8601 or simple UTC time strings; treat unknown
 * strings as already-UTC display values.
 */
export function formatSpotAge(time: string): string {
  if (!time) return '—';

  let parsed: Date | null = null;
  const normalized = time.trim();

  if (/^\d{4}-\d{2}-\d{2}T/.test(normalized) || /Z$/.test(normalized)) {
    parsed = new Date(normalized);
  } else if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(normalized)) {
    const today = new Date().toISOString().slice(0, 10);
    parsed = new Date(`${today}T${normalized}Z`);
  } else if (/^\d{4}$/.test(normalized)) {
    const now = new Date();
    const hours = normalized.slice(0, 2);
    const minutes = normalized.slice(2, 4);
    const today = now.toISOString().slice(0, 10);
    parsed = new Date(`${today}T${hours}:${minutes}:00Z`);
  } else {
    return normalized;
  }

  if (!parsed || Number.isNaN(parsed.getTime())) {
    return normalized;
  }

  const now = new Date();
  const diffMs = now.getTime() - parsed.getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}
