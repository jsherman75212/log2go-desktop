/**
 * Log2Go Desktop — Offline Status Hook
 *
 * Tracks online/offline state and sync queue count.
 * Polls the local DB for stats and listens for browser online/offline events.
 */

import { useState, useEffect, useCallback } from 'react';
import { offlineDb, type OfflineStats } from '../services/offlineDb';
import { runSync, type SyncResult } from '../services/syncEngine';

export type OfflineStatus = {
  isOnline: boolean;
  isDesktop: boolean;
  stats: OfflineStats;
  syncing: boolean;
  lastSyncResult: SyncResult | null;
  syncNow: () => Promise<void>;
  refreshStats: () => Promise<void>;
};

export function useOfflineStatus(
  backendBaseUrl: string,
  accessToken: string,
): OfflineStatus {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [stats, setStats] = useState<OfflineStats>({
    totalContacts: 0,
    unsyncedContacts: 0,
    totalNets: 0,
    openNets: 0,
    pendingSync: 0,
  });
  const [syncing, setSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);

  const refreshStats = useCallback(async () => {
    const s = await offlineDb.getStats();
    setStats(s);
  }, []);

  const syncNow = useCallback(async () => {
    if (syncing) return;
    if (!isOnline) return;
    setSyncing(true);
    try {
      const result = await runSync(backendBaseUrl, accessToken);
      setLastSyncResult(result);
      await refreshStats();
    } catch (error) {
      setLastSyncResult({
        totalProcessed: 0,
        succeeded: 0,
        failed: 1,
        errors: [error instanceof Error ? error.message : String(error)],
      });
    } finally {
      setSyncing(false);
    }
  }, [syncing, isOnline, backendBaseUrl, accessToken, refreshStats]);

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Auto-sync when coming back online
      void syncNow();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncNow]);

  // Refresh stats on mount and periodically
  useEffect(() => {
    void refreshStats();
    const interval = setInterval(() => void refreshStats(), 30_000);
    return () => clearInterval(interval);
  }, [refreshStats]);

  return {
    isOnline,
    isDesktop: typeof window !== 'undefined' && 'log2goDesktop' in window,
    stats,
    syncing,
    lastSyncResult,
    syncNow,
    refreshStats,
  };
}