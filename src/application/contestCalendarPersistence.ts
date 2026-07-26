import type { ContestCalendarEvent } from '../services/backendClient';
import type { KeyValueStore } from './persistence';

export type PersistedContestCalendar = {
  version: 1;
  fetchedAt: string;
  contests: ContestCalendarEvent[];
};

const CONTEST_CALENDAR_KEY = 'log2go.contestCalendar.v1';

export async function saveContestCalendar(
  store: KeyValueStore,
  calendar: PersistedContestCalendar,
): Promise<void> {
  await store.setItem(CONTEST_CALENDAR_KEY, JSON.stringify(calendar));
}

export async function loadContestCalendar(
  store: KeyValueStore,
): Promise<PersistedContestCalendar | undefined> {
  const raw = await store.getItem(CONTEST_CALENDAR_KEY);
  if (raw === null) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.contests)) {
      return undefined;
    }

    return {
      version: 1,
      fetchedAt: typeof parsed.fetchedAt === 'string' ? parsed.fetchedAt : '',
      contests: parsed.contests,
    };
  } catch {
    return undefined;
  }
}
