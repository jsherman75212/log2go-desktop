/**
 * US amateur radio band plan with license class privileges.
 *
 * Source: FCC Part 97 §97.301, §97.303, §97.305 (current as of 2024).
 * Frequencies in MHz.
 *
 * Each segment is a [startMHz, endMHz] range (inclusive).
 *
 * License classes (FCC codes from QRZ <class> field):
 *   T = Technician
 *   G = General
 *   E = Amateur Extra
 *   A = Advanced (legacy, treated as General)
 *   C = Club station (uses control operator's class — we skip validation)
 *
 * Note: Novice (N) licenses were deprecated; no new Novice licenses issued since 2000.
 */

export type LicenseClass = 'T' | 'G' | 'E' | 'A' | 'C';

export type FrequencySegment = [startMHz: number, endMHz: number];

/**
 * Privilege table: frequency band → permitted license classes.
 * Listed in ascending frequency order for readability.
 *
 * A frequency is allowed for a class if the class appears in the array
 * for a segment containing that frequency. Lower classes accumulate upward:
 * Tech gets Tech segments, General gets General+Tech, Extra gets all.
 */
export type BandPrivileges = {
  bandLabel: string;
  segments: {
    range: FrequencySegment;
    classes: LicenseClass[];
  }[];
};

export const US_BAND_PRIVILEGES: BandPrivileges[] = [
  // --- MF/HF bands ---
  {
    bandLabel: '160m',
    segments: [
      { range: [1.8, 2.0], classes: ['T', 'G', 'E', 'A'] }, // Tech: CW only
    ],
  },
  {
    bandLabel: '80m',
    segments: [
      // Tech: CW/data 3.5-3.6 only
      { range: [3.5, 3.6], classes: ['T'] },
      // General: phone 3.6-3.8, 3.85-4.0
      { range: [3.6, 3.8], classes: ['G'] },
      { range: [3.85, 4.0], classes: ['G', 'E', 'A'] },
    ],
  },
  {
    bandLabel: '60m',
    segments: [
      // Channelized USB only — General+
      { range: [5.3305, 5.4064], classes: ['G', 'E', 'A'] },
    ],
  },
  {
    bandLabel: '40m',
    segments: [
      // Tech: CW/data 7.0-7.125 only
      { range: [7.0, 7.125], classes: ['T'] },
      // General: phone 7.125-7.3
      { range: [7.125, 7.3], classes: ['G', 'E', 'A'] },
    ],
  },
  {
    bandLabel: '30m',
    segments: [
      // CW/data only, no Tech
      { range: [10.1, 10.15], classes: ['G', 'E', 'A'] },
    ],
  },
  {
    bandLabel: '20m',
    segments: [
      // Tech: CW/data 14.0-14.15 only
      { range: [14.0, 14.15], classes: ['T'] },
      // General: phone 14.15-14.25
      { range: [14.15, 14.25], classes: ['G'] },
      // Extra: phone 14.25-14.35
      { range: [14.25, 14.35], classes: ['E', 'A'] },
    ],
  },
  {
    bandLabel: '17m',
    segments: [
      { range: [18.068, 18.168], classes: ['G', 'E', 'A'] },
    ],
  },
  {
    bandLabel: '15m',
    segments: [
      // Tech: CW/data 21.0-21.075, 21.075-21.225
      { range: [21.0, 21.225], classes: ['T'] },
      // General: phone 21.225-21.45
      { range: [21.225, 21.45], classes: ['G', 'E', 'A'] },
    ],
  },
  {
    bandLabel: '12m',
    segments: [
      { range: [24.89, 24.99], classes: ['G', 'E', 'A'] },
    ],
  },
  {
    bandLabel: '10m',
    segments: [
      { range: [28.0, 29.7], classes: ['T', 'G', 'E', 'A'] },
    ],
  },
  // --- VHF bands ---
  {
    bandLabel: '6m',
    segments: [
      { range: [50.0, 54.0], classes: ['T', 'G', 'E', 'A'] },
    ],
  },
  {
    bandLabel: '2m',
    segments: [
      { range: [144.0, 148.0], classes: ['T', 'G', 'E', 'A'] },
    ],
  },
  {
    bandLabel: '1.25m',
    segments: [
      { range: [222.0, 225.0], classes: ['T', 'G', 'E', 'A'] },
    ],
  },
  // --- UHF bands ---
  {
    bandLabel: '70cm',
    segments: [
      { range: [420.0, 450.0], classes: ['T', 'G', 'E', 'A'] },
    ],
  },
  {
    bandLabel: '33cm',
    segments: [
      { range: [902.0, 928.0], classes: ['T', 'G', 'E', 'A'] },
    ],
  },
  // --- Microwave ---
  {
    bandLabel: '23cm',
    segments: [
      { range: [1240.0, 1300.0], classes: ['T', 'G', 'E', 'A'] },
    ],
  },
  {
    bandLabel: '13cm',
    segments: [
      { range: [2300.0, 2450.0], classes: ['T', 'G', 'E', 'A'] },
    ],
  },
];

/**
 * Class hierarchy: which classes include all privileges of lower classes.
 * A class 'privileges' includes itself plus all lower classes.
 *
 * Rank order (lowest to highest privilege):
 *   T (Technician) < G (General) < A (Advanced, legacy) < E (Extra)
 *
 * Special case: C (Club) returns allowed:true immediately.
 */
const CLASS_PRIVILEGE_RANK: Record<LicenseClass, number> = {
  T: 0, // Technician
  G: 1, // General
  A: 2, // Advanced (legacy)
  E: 3, // Extra
  C: -1, // Club: skip validation
};

/**
 * Check if a frequency (MHz) is permitted for the given license class.
 * Returns { allowed: true } or { allowed: false, reason } with the band label
 * if known. If the frequency doesn't fall in ANY defined band, we return
 * allowed:false with bandLabel=null (we can't validate).
 *
 * Special case: class 'C' (Club) returns allowed:true immediately — we skip
 * validation since club stations operate under the control operator's license.
 */
export function checkFrequencyPrivilege(
  frequencyMHz: number,
  licenseClass: LicenseClass,
): { allowed: boolean; bandLabel?: string; reason?: string } {
  if (licenseClass === 'C') {
    return { allowed: true };
  }

  const minRank = CLASS_PRIVILEGE_RANK[licenseClass];

  for (const band of US_BAND_PRIVILEGES) {
    for (const seg of band.segments) {
      const [lo, hi] = seg.range;
      if (frequencyMHz < lo || frequencyMHz > hi) continue;

      // Check if any class in this segment meets or beats the user's rank
      const permitted = seg.classes.some(
        (c) => CLASS_PRIVILEGE_RANK[c] <= minRank,
      );

      if (permitted) {
        return { allowed: true, bandLabel: band.bandLabel };
      }
      return {
        allowed: false,
        bandLabel: band.bandLabel,
        reason: `${frequencyMHz} MHz falls within ${band.bandLabel} but requires a higher license class`,
      };
    }
  }

  // Frequency does not appear in any defined band
  return {
    allowed: false,
    reason: `${frequencyMHz} MHz does not fall within any defined amateur band`,
  };
}

/**
 * Parse a "band" label like "20m" or frequency string "14.250" into MHz.
 * Returns the frequency if input is already numeric, or NaN on failure.
 */
export function bandOrFreqToMHz(value: string): number {
  const trimmed = value.trim().toLowerCase();
  // Pure number → treat as MHz
  const asNum = Number(trimmed);
  if (!Number.isNaN(asNum)) return asNum;
  // e.g. "14.250 mhz", "14.250 mHz", "14250 khz"
  const mhzMatch = trimmed.match(/^([0-9.]+)\s*(?:mhz|mh)?$/);
  if (mhzMatch) {
    const n = Number(mhzMatch[1]);
    if (!Number.isNaN(n)) return n;
  }
  const khzMatch = trimmed.match(/^([0-9.]+)\s*khz$/);
  if (khzMatch) {
    const n = Number(khzMatch[1]) / 1000;
    if (!Number.isNaN(n)) return n;
  }
  return NaN;
}

/**
 * Normalize QRZ class codes to our LicenseClass set.
 * Handles unexpected codes by returning null (caller decides handling).
 *
 * QRZ XML class codes: T, G, E, A (Advanced, legacy), C (Club).
 * Note: Novice (N) licenses are no longer issued; we don't include them.
 */
export function normalizeLicenseClass(raw: string): LicenseClass | null {
  const code = raw.trim().toUpperCase();
  if (code === 'T' || code === 'G' || code === 'E' || code === 'A' || code === 'C') {
    return code;
  }
  return null;
}
