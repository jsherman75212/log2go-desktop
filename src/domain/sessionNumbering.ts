import type { LoggingSession } from './models';

export type SessionNumberingState = Pick<
  LoggingSession,
  'startingContactNumber' | 'currentContactNumber'
>;

export type SessionContactNumber = {
  value: number;
  formatted: string;
};

const DEFAULT_CONTACT_NUMBER_WIDTH = 3;

export function createSessionNumberingState(
  startingContactNumber = 1,
): SessionNumberingState {
  validateContactNumber(startingContactNumber);

  return {
    startingContactNumber,
    currentContactNumber: startingContactNumber,
  };
}

export function getNextSessionContactNumber(
  session: SessionNumberingState,
  width = DEFAULT_CONTACT_NUMBER_WIDTH,
): SessionContactNumber {
  validateContactNumber(session.currentContactNumber);

  return {
    value: session.currentContactNumber,
    formatted: formatSessionContactNumber(session.currentContactNumber, width),
  };
}

export function incrementSessionContactNumber<TSession extends SessionNumberingState>(
  session: TSession,
): TSession {
  validateContactNumber(session.currentContactNumber);

  return {
    ...session,
    currentContactNumber: session.currentContactNumber + 1,
  };
}

export function formatSessionContactNumber(
  contactNumber: number,
  width = DEFAULT_CONTACT_NUMBER_WIDTH,
): string {
  validateContactNumber(contactNumber);

  if (!Number.isInteger(width) || width < 1) {
    throw new RangeError('Contact number width must be a positive integer.');
  }

  return contactNumber.toString().padStart(width, '0');
}

function validateContactNumber(contactNumber: number): void {
  if (!Number.isInteger(contactNumber) || contactNumber < 1) {
    throw new RangeError('Contact number must be a positive integer.');
  }
}
