import type { Coordinates } from '../utils/maidenhead';

export type LocationCaptureResult = {
  coordinates: Coordinates;
  accuracyMeters?: number;
  capturedAt: string;
};

export type LocationCaptureError = {
  type: 'permission-denied' | 'unavailable' | 'timeout' | 'unknown';
  message: string;
};

export type LocationCaptureService = {
  captureCurrentLocation(): Promise<LocationCaptureResult>;
};

export const POOR_ACCURACY_THRESHOLD_METERS = 100;

export function isPoorAccuracy(result: LocationCaptureResult): boolean {
  if (result.accuracyMeters === undefined) {
    return true;
  }

  return result.accuracyMeters > POOR_ACCURACY_THRESHOLD_METERS;
}

export const createLocationCapturePlaceholder = (): LocationCaptureService => ({
  async captureCurrentLocation() {
    throw new Error('Location capture is not implemented yet.');
  },
});