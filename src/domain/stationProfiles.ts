import type {
  MobilePortableStatus,
  SignalReport,
  StationProfile,
  StationProfileCollection,
} from './models';

export type CreateProfileInput = {
  profileName?: string;
  callsign: string;
  operatorName?: string;
  country?: string;
  dxccEntity?: string;
  state?: string;
  county?: string;
  city?: string;
  homeGrid?: string;
  mobilePortableStatus?: MobilePortableStatus;
  txPowerWatts?: number;
  rigInfo?: string;
  notes?: string;
  defaultMode?: string;
  defaultSignalReport?: SignalReport;
  autoGps?: boolean;
  locationOverride?: boolean;
};

export type UpdateProfileInput = Partial<CreateProfileInput>;

function generateProfileId(): string {
  return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createStationProfile(
  input: CreateProfileInput,
): StationProfile {
  const callsign = input.callsign.trim().toUpperCase();
  return {
    id: generateProfileId(),
    profileName: input.profileName?.trim() || callsign,
    callsign,
    operatorName: input.operatorName?.trim() || undefined,
    country: input.country?.trim() || undefined,
    dxccEntity: input.dxccEntity?.trim() || undefined,
    state: input.state?.trim() || undefined,
    county: input.county?.trim() || undefined,
    city: input.city?.trim() || undefined,
    homeGrid: input.homeGrid?.trim().toUpperCase() || undefined,
    mobilePortableStatus: input.mobilePortableStatus ?? 'fixed',
    txPowerWatts: input.txPowerWatts,
    rigInfo: input.rigInfo?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    defaultMode: input.defaultMode?.trim() || 'FM',
    defaultSignalReport: input.defaultSignalReport ?? { sent: '59', received: '59' },
    autoGps: input.autoGps ?? false,
    locationOverride: input.locationOverride ?? false,
    active: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function addProfile(
  collection: StationProfileCollection,
  input: CreateProfileInput,
): StationProfileCollection {
  const profile = createStationProfile(input);

  // If this is the first profile, make it active
  if (collection.profiles.length === 0) {
    profile.active = true;
  }

  return {
    ...collection,
    profiles: [...collection.profiles, profile],
    activeProfileId:
      collection.activeProfileId ?? (profile.active ? profile.id : undefined),
  };
}

export function updateProfile(
  collection: StationProfileCollection,
  profileId: string,
  input: UpdateProfileInput,
): StationProfileCollection {
  return {
    ...collection,
    profiles: collection.profiles.map((profile) => {
      if (profile.id !== profileId) {
        return profile;
      }

      return {
        ...profile,
        ...(input.profileName !== undefined && {
          profileName: input.profileName.trim(),
        }),
        ...(input.callsign !== undefined && {
          callsign: input.callsign.trim().toUpperCase(),
        }),
        ...(input.operatorName !== undefined && {
          operatorName: input.operatorName?.trim() || undefined,
        }),
        ...(input.country !== undefined && {
          country: input.country?.trim() || undefined,
        }),
        ...(input.dxccEntity !== undefined && {
          dxccEntity: input.dxccEntity?.trim() || undefined,
        }),
        ...(input.state !== undefined && {
          state: input.state?.trim() || undefined,
        }),
        ...(input.county !== undefined && {
          county: input.county?.trim() || undefined,
        }),
        ...(input.city !== undefined && {
          city: input.city?.trim() || undefined,
        }),
        ...(input.homeGrid !== undefined && {
          homeGrid: input.homeGrid?.trim().toUpperCase() || undefined,
        }),
        ...(input.mobilePortableStatus !== undefined && {
          mobilePortableStatus: input.mobilePortableStatus,
        }),
        ...(input.txPowerWatts !== undefined && {
          txPowerWatts: input.txPowerWatts,
        }),
        ...(input.rigInfo !== undefined && {
          rigInfo: input.rigInfo?.trim() || undefined,
        }),
        ...(input.notes !== undefined && {
          notes: input.notes?.trim() || undefined,
        }),
        ...(input.defaultMode !== undefined && {
          defaultMode: input.defaultMode?.trim() || 'FM',
        }),
        ...(input.defaultSignalReport !== undefined && {
          defaultSignalReport: input.defaultSignalReport,
        }),
        ...(input.autoGps !== undefined && {
          autoGps: input.autoGps,
        }),
        ...(input.locationOverride !== undefined && {
          locationOverride: input.locationOverride,
        }),
        updatedAt: new Date().toISOString(),
      };
    }),
  };
}

export function deleteProfile(
  collection: StationProfileCollection,
  profileId: string,
): StationProfileCollection {
  const filtered = collection.profiles.filter(
    (profile) => profile.id !== profileId,
  );

  // If we deleted the active profile, activate the first remaining one
  let activeProfileId = collection.activeProfileId;
  if (activeProfileId === profileId) {
    activeProfileId = filtered.length > 0 ? filtered[0].id : undefined;
  }

  // Mark the new active profile
  const profiles = filtered.map((profile, index) => ({
    ...profile,
    active:
      activeProfileId === profile.id ||
      (activeProfileId === undefined && index === 0),
  }));

  if (activeProfileId === undefined && profiles.length > 0) {
    profiles[0].active = true;
    activeProfileId = profiles[0].id;
  }

  return {
    profiles,
    activeProfileId,
  };
}

export function activateProfile(
  collection: StationProfileCollection,
  profileId: string,
): StationProfileCollection {
  const profileExists = collection.profiles.some(
    (profile) => profile.id === profileId,
  );

  if (!profileExists) {
    return collection;
  }

  return {
    profiles: collection.profiles.map((profile) => ({
      ...profile,
      active: profile.id === profileId,
    })),
    activeProfileId: profileId,
  };
}

export function getActiveProfile(
  collection: StationProfileCollection,
): StationProfile | undefined {
  if (collection.activeProfileId === undefined) {
    return collection.profiles[0];
  }

  return collection.profiles.find(
    (profile) => profile.id === collection.activeProfileId,
  );
}

export function createInitialProfileCollection(): StationProfileCollection {
  // The initial profile is created in defaults.ts for backward compatibility.
  // This returns an empty collection that will be populated on first use.
  return {
    profiles: [],
    activeProfileId: undefined,
  };
}