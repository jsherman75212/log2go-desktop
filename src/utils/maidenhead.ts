export type GridLength = 4 | 6 | 8;

export type Coordinates = {
  latitude: number;
  longitude: number;
};

const FIELD_LETTERS = 'ABCDEFGHIJKLMNOPQR';
const SUBSQUARE_LETTERS = 'abcdefghijklmnopqrstuvwx';

export const DEFAULT_GRID_LENGTH: GridLength = 6;

export function validateCoordinates({ latitude, longitude }: Coordinates): void {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new RangeError('Latitude and longitude must be finite numbers.');
  }

  if (latitude < -90 || latitude >= 90) {
    throw new RangeError('Latitude must be greater than or equal to -90 and less than 90.');
  }

  if (longitude < -180 || longitude >= 180) {
    throw new RangeError('Longitude must be greater than or equal to -180 and less than 180.');
  }
}

export function validateGridLength(length: number): asserts length is GridLength {
  if (length !== 4 && length !== 6 && length !== 8) {
    throw new RangeError('Maidenhead grid length must be 4, 6, or 8 characters.');
  }
}

export function calculateMaidenheadGrid(
  coordinates: Coordinates,
  length: GridLength = DEFAULT_GRID_LENGTH,
): string {
  validateCoordinates(coordinates);
  validateGridLength(length);

  let longitude = coordinates.longitude + 180;
  let latitude = coordinates.latitude + 90;

  const fieldLon = takeIndex(longitude, 20);
  const fieldLat = takeIndex(latitude, 10);
  let grid = FIELD_LETTERS[fieldLon.index] + FIELD_LETTERS[fieldLat.index];

  longitude = fieldLon.remainder;
  latitude = fieldLat.remainder;

  const squareLon = takeIndex(longitude, 2);
  const squareLat = takeIndex(latitude, 1);
  grid += `${squareLon.index}${squareLat.index}`;

  if (length === 4) {
    return grid;
  }

  longitude = squareLon.remainder;
  latitude = squareLat.remainder;

  const subsquareLon = takeIndex(longitude, 2 / 24);
  const subsquareLat = takeIndex(latitude, 1 / 24);
  grid += SUBSQUARE_LETTERS[subsquareLon.index] + SUBSQUARE_LETTERS[subsquareLat.index];

  if (length === 6) {
    return grid;
  }

  longitude = subsquareLon.remainder;
  latitude = subsquareLat.remainder;

  const extendedLon = takeIndex(longitude, 1 / 120);
  const extendedLat = takeIndex(latitude, 1 / 240);
  return `${grid}${extendedLon.index}${extendedLat.index}`;
}

function takeIndex(value: number, size: number): { index: number; remainder: number } {
  const index = Math.floor(value / size);
  return {
    index,
    remainder: value - index * size,
  };
}
