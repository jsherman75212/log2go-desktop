/**
 * Single source of truth for the Log2Go app version.
 *
 * APP_VERSION mirrors the "version" field in app.json / package.json —
 * bump all of them together on release (see scripts or release checklist).
 *
 * NETLOGGER_CLIENT_VERSION is the version string used in NetLogger legacy
 * CGI identities ("<CALLSIGN>[-<NAME>] - v<version>"). MUST be a recognized
 * desktop version string (e.g. "3.1.7W") — the server accepts arbitrary
 * versions onto the monitors list, but SendInstantMessage SILENTLY DROPS
 * AIM messages from sessions subscribed with unrecognized versions (returns
 * *success* but never delivers). Verified 2026-07-04: v1.0.0a subscribed
 * fine but AIM was silently dropped; v3.1.7W works.
 */

export const APP_VERSION = '1.0.2';

/**
 * NetLogger identity version — must impersonate a known desktop version.
 * The 'W' suffix = Windows per NetLogger convention. Do NOT change this
 * to a Log2Go-specific version without live-verifying AIM still publishes.
 */
export const NETLOGGER_CLIENT_VERSION = '3.1.7W';

/** User-Agent for Log2Go's own HTTP calls (public XML API, Nominatim, QRZ agent). */
export const APP_USER_AGENT = `Log2Go/${APP_VERSION}`;
