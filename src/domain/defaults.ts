import type { SignalReport, StationProfile } from './models';

export const DEFAULT_SIGNAL_REPORT: SignalReport = {
  sent: '59',
  received: '59',
};

export const RST_SELECTOR_VALUES = Array.from(
  { length: 59 - 22 + 1 },
  (_, index) => String(index + 22),
);

export function createKe5zqvInitialStationProfile(
  overrides: Partial<StationProfile> = {},
): StationProfile {
  return {
    id: 'default-primary',
    profileName: '',
    callsign: '',
    operatorName: undefined,
    country: undefined,
    dxccEntity: undefined,
    state: undefined,
    county: undefined,
    city: undefined,
    mobilePortableStatus: 'fixed',
    txPowerWatts: undefined,
    rigInfo: undefined,
    notes: undefined,
    defaultMode: 'SSB',
    defaultSignalReport: DEFAULT_SIGNAL_REPORT,
    active: true,
    homeGrid: undefined,
    ...overrides,
  };
}
