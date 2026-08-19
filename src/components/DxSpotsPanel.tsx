import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DX_SPOT_BANDS,
  draftFromDxSpot,
  formatSpotAge,
  getDXSpots,
  type DXSpot,
} from '../services/dxSpotsClient';

type DxSpotsPanelProps = {
  accessToken?: string;
  backendBaseUrl?: string;
  onSelectSpot: (spot: DXSpot) => void;
};

const REFRESH_INTERVAL_MS = 60_000;

export function DxSpotsPanel({ accessToken, backendBaseUrl, onSelectSpot }: DxSpotsPanelProps) {
  const [spots, setSpots] = useState<DXSpot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedBand, setSelectedBand] = useState<(typeof DX_SPOT_BANDS)[number]>('All');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadSpots = useCallback(async () => {
    if (!backendBaseUrl || !accessToken) {
      setError('Log in to load DX spots.');
      setSpots([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const fresh = await getDXSpots(backendBaseUrl, accessToken, 50);
      setSpots(fresh);
      setLastUpdated(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load DX spots';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [backendBaseUrl, accessToken]);

  useEffect(() => {
    void loadSpots();
  }, [loadSpots]);

  useEffect(() => {
    const id = setInterval(() => void loadSpots(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadSpots]);

  const filteredSpots = useMemo(() => {
    if (selectedBand === 'All') return spots;
    return spots.filter((spot) => spot.band === selectedBand);
  }, [spots, selectedBand]);

  return (
    <section className="dx-spots-layout">
      <div className="panel dx-spots-panel">
        <div className="panel-heading">
          <div>
            <h2>📡 DX Spots</h2>
            <p>
              Live DX cluster spots · Auto-refresh every 60s
              {lastUpdated && (
                <span className="dx-spots-updated"> · Updated {formatSpotAge(lastUpdated.toISOString())}</span>
              )}
            </p>
          </div>
          <div className="panel-heading-actions">
            <button
              className="small-button"
              onClick={() => void loadSpots()}
              disabled={loading || !accessToken}
              type="button"
              title="Refresh now"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        <div className="dx-spots-filter" role="group" aria-label="Band filter">
          {DX_SPOT_BANDS.map((band) => (
            <button
              key={band}
              className={`small-button ${selectedBand === band ? 'active' : ''}`}
              onClick={() => setSelectedBand(band)}
              type="button"
              aria-pressed={selectedBand === band}
            >
              {band}
            </button>
          ))}
        </div>

        {loading && spots.length === 0 && (
          <div className="dx-spots-status">
            <span className="dx-spots-loading" />
            Loading DX spots…
          </div>
        )}

        {error && (
          <div className="dx-spots-status dx-spots-error" role="alert">
            ⚠ {error}
          </div>
        )}

        {!loading && !error && filteredSpots.length === 0 && (
          <div className="dx-spots-status dx-spots-empty">
            {selectedBand === 'All'
              ? 'No DX spots available. Click Refresh to try again.'
              : `No ${selectedBand} spots available.`}
          </div>
        )}

        {filteredSpots.length > 0 && (
          <div className="dx-spots-list scroll-box">
            {filteredSpots.map((spot, index) => {
              const draft = draftFromDxSpot(spot);
              return (
                <button
                  key={`${spot.dx_call}-${spot.freq}-${spot.time}-${index}`}
                  className="dx-spot-row"
                  onClick={() => onSelectSpot(spot)}
                  type="button"
                  title="Click to pre-fill contact form"
                >
                  <span className="dx-spot-call">{draft.callsign}</span>
                  <span className="dx-spot-freq">{draft.frequency} MHz</span>
                  <span className="dx-spot-band" style={{ color: bandColor(spot.band) }}>
                    {spot.band}
                  </span>
                  <span className="dx-spot-spotter">{spot.spotter}</span>
                  <span className="dx-spot-time">{formatSpotAge(spot.time)}</span>
                  {spot.comment && (
                    <span className="dx-spot-comment">{spot.comment}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function bandColor(band: string): string {
  const colors: Record<string, string> = {
    '160m': '#ff6666',
    '80m': '#ffcc66',
    '40m': '#ffcc66',
    '30m': '#66ffcc',
    '20m': '#66ff99',
    '17m': '#66ffcc',
    '15m': '#66ccff',
    '12m': '#9966ff',
    '10m': '#ff66ff',
    '6m': '#44ddff',
    '2m': '#44ddff',
    '70cm': '#44ddff',
  };
  return colors[band] ?? '#66ff99';
}
