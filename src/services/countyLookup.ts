import { APP_USER_AGENT } from '../appVersion';

export type CountyLookupResult = {
  county: string;
  state?: string;
  country?: string;
};

export type CountyLookupService = {
  lookupCounty(coordinates: { latitude: number; longitude: number }): Promise<CountyLookupResult | null>;
};

const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org/reverse';
const NOMINATIM_USER_AGENT = `${APP_USER_AGENT} (https://github.com/ke5zqv/log2go; amateur-radio-logging)`;
const REQUEST_TIMEOUT_MS = 8000;

export async function lookupCountyFromCoordinates(
  coordinates: { latitude: number; longitude: number },
  signal?: AbortSignal,
): Promise<CountyLookupResult | null> {
  const url = new URL(NOMINATIM_BASE_URL);
  url.searchParams.set('lat', String(coordinates.latitude));
  url.searchParams.set('lon', String(coordinates.longitude));
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('zoom', '14');
  url.searchParams.set('accept-language', 'en');

  let response: Response;

  try {
    response = await fetch(url.toString(), {
      headers: { 'User-Agent': NOMINATIM_USER_AGENT },
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return null;
    }

    return null;
  }

  if (!response.ok) {
    return null;
  }

  let data: Record<string, unknown>;

  try {
    data = await response.json() as Record<string, unknown>;
  } catch {
    return null;
  }

  const address = data.address as Record<string, string> | undefined;

  if (!address) {
    return null;
  }

  const county = address.county ?? address.city ?? address.town ?? address.village ?? undefined;

  if (!county) {
    return null;
  }

  return {
    county,
    state: address.state,
    country: address.country,
  };
}

export function createCountyLookupService(): CountyLookupService {
  return {
    async lookupCounty(coordinates) {
      return lookupCountyFromCoordinates(coordinates);
    },
  };
}