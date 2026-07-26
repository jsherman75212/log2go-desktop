export type LoggingMode = 'nets' | 'contesting' | 'pota';

export type SyncStatus =
  | 'local-only'
  | 'queued'
  | 'syncing'
  | 'synced'
  | 'failed';

export type SignalReport = {
  sent: string;
  received: string;
};

export type MobilePortableStatus = 'fixed' | 'mobile' | 'portable';

export type StationProfileSnapshot = {
  profileName: string;
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
  defaultMode: string;
  defaultSignalReport: SignalReport;
  autoGps?: boolean;
  active: boolean;
};

export type StationProfile = StationProfileSnapshot & {
  id: string;
  createdAt?: string;
  updatedAt?: string;
};

export type StationProfileCollection = {
  profiles: StationProfile[];
  activeProfileId?: string;
};

export type GpsCapture = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  capturedAt: string;
};

export type NetLoggerContext = {
  netId?: string;
  netName?: string;
  netControlCallsign?: string;
  netLoggerSequence?: number;
  checkInNumber?: string;
  relayCallsign?: string;
};

export type ContestContext = {
  contestId?: string;
  contestName?: string;
  exchangeSent?: string;
  exchangeReceived?: string;
  serialSent?: string;
  serialReceived?: string;
  section?: string;
  class?: string;
  points?: number;
};

export type PotaContext = {
  activationId?: string;
  activator?: boolean;
  parkRefs: string[];
  huntedParkRefs?: string[];
  parkName?: string;
};

export type LotwCorrectionFlags = {
  needsCorrection: boolean;
  corrected: boolean;
  correctedAt?: string;
  correctionReason?: string;
  correctedFields?: string[];
};

export type QrzEnrichment = {
  qrzId?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  nickname?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  county?: string;
  country?: string;
  dxccEntity?: string;
  grid?: string;
  latitude?: number;
  longitude?: number;
  fetchedAt?: string;
};

export type Contact = {
  id: string;
  sessionId: string;
  callsign: string;
  contactedAt: string;
  frequencyMhz?: number;
  band?: string;
  mode: string;
  signalReport: SignalReport;
  contactNumber?: number;
  contactNumberDisplay?: string;
  operatorName?: string;
  location?: string;
  maidenheadGrid?: string;
  grid?: string;
  county?: string;
  notes?: string;
  loggingMode: LoggingMode;
  netLoggerContext?: NetLoggerContext;
  contestContext?: ContestContext;
  potaContext?: PotaContext;
  gps?: GpsCapture;
  stationProfileSnapshot: StationProfileSnapshot;
  syncStatus: SyncStatus;
  lotwCorrection?: LotwCorrectionFlags;
  qrzEnrichment?: QrzEnrichment;
};

export type QsoContact = Contact;

export type LoggingSession = {
  id: string;
  stationProfileId: string;
  mode: LoggingMode;
  startedAt: string;
  endedAt?: string;
  title?: string;
  activityId?: string;
  activityName?: string;
  activityStartedAt?: string;
  activityResetAt?: string;
  startingContactNumber: number;
  currentContactNumber: number;
  defaultGridLength: 4 | 6 | 8;
  backendSyncEnabled: boolean;
  syncStatus: SyncStatus;
  contactIds: string[];
  netLoggerContext?: NetLoggerContext;
  contestContext?: ContestContext;
  potaContext?: PotaContext;
};
