import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getDXSpots, getCallsignLocations, type DXSpot } from './services/backendClient';

// ── Station fallback (neutral world view — never any user QTH) ──
const DEFAULT_STATION = { lat: 20, lng: -30, callsign: '', grid: '' };  // Neutral Atlantic view - never any user QTH

interface DashboardContact {
  call: string;
  band: string;
  mode: string;
  grid: string;
  date: string;
  time: string;
  country: string;
  state: string;
  lotw_up: boolean;
  lotw_conf: boolean;
  eqsl_up: boolean;
  eqsl_conf: boolean;
  qrz_up: boolean;
  qrz_conf: boolean;
  _sort?: string;
}

// ── Solar Data ──
interface SolarData {
  sfi: number | null;
  sfi_90d: number | null;
  sn: number | null;
  a_index: number | null;
  k_index: number | null;
  r_scale: number | null;
  s_scale: number | null;
  g_scale: number | null;
}

// ── Grid to lat/lng ──
function gridToLatLng(grid: string | null): { lat: number; lng: number } | null {
  if (!grid) return null;
  const g = grid.toUpperCase().trim();
  if (g.length < 4) return null;
  const fieldLon = (g.charCodeAt(0) - 65) * 20 - 180;
  const fieldLat = (g.charCodeAt(1) - 65) * 10 - 90;
  const sqLon = parseInt(g[2]) * 2;
  const sqLat = parseInt(g[3]);
  let lon = fieldLon + sqLon + 1;
  let lat = fieldLat + sqLat + 0.5;
  if (g.length >= 6) {
    lon = fieldLon + sqLon + (g.charCodeAt(4) - 65) * (2 / 24) + (1 / 24);
    lat = fieldLat + sqLat + (g.charCodeAt(5) - 65) * (1 / 24) + (0.5 / 24);
  }
  return { lat, lng: lon };
}

// ── Band conditions ──
const BANDS = [
  { name: '160m', freq: 1.8 }, { name: '80m', freq: 3.5 }, { name: '40m', freq: 7 },
  { name: '30m', freq: 10.1 }, { name: '20m', freq: 14 }, { name: '17m', freq: 18 },
  { name: '15m', freq: 21 }, { name: '12m', freq: 24.9 }, { name: '10m', freq: 28 },
  { name: '6m', freq: 50 }, { name: '2m', freq: 144 }, { name: '70cm', freq: 440 },
];

function bandCondition(freq: number): string {
  const hour = new Date().getUTCHours();
  const isDay = hour >= 12 && hour <= 22;
  if (freq <= 2) return 'fair';
  if (freq <= 4) return isDay ? 'fair' : 'good';
  if (freq <= 8) return 'good';
  if (freq <= 11) return 'good';
  if (freq <= 15) return isDay ? 'good' : 'fair';
  if (freq <= 19) return isDay ? 'good' : 'fair';
  if (freq <= 22) return isDay ? 'good' : 'poor';
  if (freq <= 26) return isDay ? 'fair' : 'poor';
  if (freq <= 30) return isDay ? 'fair' : 'poor';
  return 'poor';
}

const condColors: Record<string, string> = {
  excellent: '#00e676', good: '#8bc34a', fair: '#ffd740', poor: '#ff9100', bad: '#ff5252',
};

// ── Dashboard Component ──
export function DashboardTab({ accessToken, backendBaseUrl, accountProfile, stationGrid }: {
  accessToken?: string;
  backendBaseUrl?: string;
  accountProfile?: { id: number; callsign: string; email: string; username: string };
  stationGrid?: string;
}) {
  const STATION = (() => {
    const grid = stationGrid || DEFAULT_STATION.grid;
    const pos = gridToLatLng(grid);
    return {
      lat: pos?.lat ?? DEFAULT_STATION.lat,
      lng: pos?.lng ?? DEFAULT_STATION.lng,
      callsign: accountProfile?.callsign || DEFAULT_STATION.callsign,
      grid,
    };
  })();
  const hasUserGrid = !!(stationGrid && stationGrid.trim().length >= 4);

  const SOLAR_WAVELENGTHS: { id: string; name: string; desc: string }[] = [
    { id: '0193', name: 'AIA 193Å', desc: 'Corona' },
    { id: '0304', name: 'AIA 304Å', desc: 'Chromosphere' },
    { id: '0171', name: 'AIA 171Å', desc: 'Quiet Corona' },
    { id: '0094', name: 'AIA 94Å', desc: 'Flaring' },
    { id: 'HMIIC', name: 'HMI Int', desc: 'Visible' },
  ];
  const [solarWl, setSolarWl] = useState<string>('0193');
  const [solarCycle, setSolarCycle] = useState(false);
  const [solarRefreshKey, setSolarRefreshKey] = useState(Date.now());
  const solarImageUrl = solarWl ? '/solar-image/' + solarWl + '?t=' + solarRefreshKey : '';
  const [solar, setSolar] = useState<SolarData>({
    sfi: null, sfi_90d: null, sn: null, a_index: null, k_index: null,
    r_scale: null, s_scale: null, g_scale: null,
  });
  const [contacts, setContacts] = useState<DashboardContact[]>([]);
  const [totalContacts, setTotalContacts] = useState<number>(0);
  const [contactLimit, setContactLimit] = useState<number>(40);
  const [dxSpots, setDxSpots] = useState<DXSpot[]>([]);
  const [dxSpotLocations, setDxSpotLocations] = useState<Record<string, { lat: number; lng: number; grid: string; country: string }>>({});
  const [dxSpotsHeight, setDxSpotsHeight] = useState<number>(240);
  const dxPanelRef = useRef<HTMLDivElement>(null);
  const displayedContacts = contactLimit === 0 ? contacts : contacts.slice(0, contactLimit);
  const [utcTime, setUtcTime] = useState('--:--:--');
  const [utcDate, setUtcDate] = useState('----');
  const [localTime, setLocalTime] = useState('--:--:--');
  const [localDate, setLocalDate] = useState('----');
  const globeRef = useRef<HTMLDivElement>(null);
  const globeObjRef = useRef<any>(null);

  // ── Clock ──
  useEffect(() => {
    function tick() {
      const now = new Date();
      setUtcTime(now.toISOString().slice(11, 19));
      setUtcDate(now.toISOString().slice(0, 10));
      setLocalTime(now.toLocaleTimeString('en-US', { hour12: false }));
      setLocalDate(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Solar image refresh key (cache busting) ──
  useEffect(() => {
    const id = setInterval(() => setSolarRefreshKey(Date.now()), 300000);
    return () => clearInterval(id);
  }, []);

  // ── Solar image wavelength cycling ──
  useEffect(() => {
    if (!solarCycle) return;
    const id = setInterval(() => {
      setSolarWl(prev => {
        const idx = SOLAR_WAVELENGTHS.findIndex(w => w.id === prev);
        return SOLAR_WAVELENGTHS[(idx + 1) % SOLAR_WAVELENGTHS.length].id;
      });
    }, 5000);
    return () => clearInterval(id);
  }, [solarCycle]);

  // ── Solar data ──
  useEffect(() => {
    async function fetchSolar() {
      try {
        const r = await fetch('/solar-api/json');
        const data = await r.json();
        setSolar({
          sfi: data.sfi ?? null, sfi_90d: data.sfi_90d ?? data.sfi_90day ?? null, sn: data.sn ?? data.ssn ?? null,
          a_index: data.a_index ?? data.A_Index ?? null, k_index: data.k_index ?? data.K_Index ?? null,
          r_scale: data.r_scale ?? null, s_scale: data.s_scale ?? null, g_scale: data.g_scale ?? null,
        });
      } catch { /* ignore */ }
    }
    fetchSolar();
    const id = setInterval(fetchSolar, 300000);
    return () => clearInterval(id);
  }, []);

  // ── Contacts ──
  useEffect(() => {
    async function fetchContacts() {
      try {
        const baseUrl = (backendBaseUrl || 'https://api.log2goapp.net').replace(/\/$/, '');
        const r = await fetch(baseUrl + '/api/v1/contacts?limit=500', {
          headers: accessToken ? { 'Authorization': 'Bearer ' + accessToken } : {},
        });
        if (!r.ok) return;
        const data = await r.json();
        // Support both new {contacts, total} shape and legacy array shape
        const rawContacts = Array.isArray(data) ? data : (data.contacts ?? []);
        const total = data.total ?? rawContacts.length;
        setTotalContacts(total);
        // Sort by qso_date + time_on descending (newest first)
        const mapped = rawContacts.map((c: any) => ({
          call: c.call ?? c.call_sign ?? c.callsign ?? '??',
          band: c.band ?? '??',
          mode: c.mode ?? '??',
          grid: c.gridsquare ?? c.grid ?? '',
          date: c.qso_date ?? (c.timestamp ? c.timestamp.slice(0, 10) : ''),
          time: c.time_on ?? (c.timestamp ? c.timestamp.slice(11, 16) : ''),
          country: c.country ?? '',
          state: c.state ?? '',
          lotw_up: c.lotw_uploaded ?? c.lotw_up ?? false,
          lotw_conf: c.lotw_confirmed ?? c.lotw_conf ?? false,
          eqsl_up: c.eqsl_uploaded ?? false,
          eqsl_conf: c.eqsl_confirmed ?? false,
          qrz_up: c.qrz_uploaded ?? false,
          qrz_conf: c.qrz_confirmed ?? false,
          _sort: (c.qso_date ?? '') + (c.time_on ?? ''),
        }));
        mapped.sort((a: any, b: any) => (b._sort as string).localeCompare(a._sort as string));
        setContacts(mapped);

        // Always fetch live DX spots for the dashboard
        try {
          const spots = await getDXSpots(baseUrl, accessToken!, 30);
          setDxSpots(spots);
          // Look up DX spot callsign locations via QRZ
          if (spots.length > 0) {
            const callsigns = [...new Set(spots.flatMap((s: DXSpot) => [s.dx_call.toUpperCase(), s.spotter.toUpperCase()]))];
            try {
              const locs = await getCallsignLocations(baseUrl, accessToken!, callsigns);
              setDxSpotLocations(locs);
            } catch { /* ignore QRZ lookup failures */ }
          }
        } catch { setDxSpots([]); }
      } catch { /* ignore */ }
    }
    if (!accessToken) return;
    fetchContacts();
  }, [accessToken, backendBaseUrl]);

  // ── DX Spots 5-min refresh ──
  useEffect(() => {
    if (!accessToken || !backendBaseUrl) return;
    const id = setInterval(async () => {
      try {
        const spots = await getDXSpots(backendBaseUrl!, accessToken, 30);
        setDxSpots(spots);
      } catch { /* ignore */ }
    }, 300000);
    return () => clearInterval(id);
  }, [accessToken, backendBaseUrl]);

  // ── Band → color mapping (OpenHamClock style) ──
  const BAND_COLORS: Record<string, string> = {
    '160m': '#ff6666', '80m': '#ffcc66', '40m': '#ffcc66',
    '30m': '#66ffcc', '20m': '#66ff99', '17m': '#66ffcc',
    '15m': '#66ccff', '12m': '#9966ff', '10m': '#ff66ff',
    '6m': '#44ddff', '2m': '#44ddff', '70cm': '#44ddff',
  };
  function bandColor(band: string): string {
    return BAND_COLORS[band] ?? '#66ff99';
  }

  // ── Globe ──
  useEffect(() => {
    if (!globeRef.current) return;
    const container = globeRef.current;
    let globe: any = null;

    function initGlobe() {
      if (!container || container.clientWidth === 0) return;
      // @ts-ignore — globe.gl loaded from CDN script
      const G = window.Globe;
      if (!G) { setTimeout(initGlobe, 300); return; }

      const contactPts: any[] = [];
      const arcs: any[] = [];
      const htmlEls: any[] = [];
      const rings: any[] = [];
      const uniqueGrids = new Set<string>();
      const uniqueCountries = new Set<string>();

      // Station ring (pulsing ring at home QTH)
      if (STATION.grid) { rings.push({ lat: STATION.lat, lng: STATION.lng, color: '#00b4ff', maxRadius: 3, propagationSpeed: 1, repeatPeriod: 2000 }); }

      displayedContacts.forEach(c => {
        const pos = gridToLatLng(c.grid);
        if (!pos) return;
        const anyUploaded = c.lotw_up || c.eqsl_up || c.qrz_up;
        const anyConfirmed = c.lotw_conf || c.eqsl_conf || c.qrz_conf;
        const color = bandColor(c.band);
        const arcColor = anyConfirmed ? '#00e676' : anyUploaded ? '#ff9100' : '#ff5252';
        contactPts.push({ lat: pos.lat, lng: pos.lng, label: `${c.call} · ${c.band} ${c.mode} · ${c.grid}`, color: arcColor, size: 0.3 });
        arcs.push({ startLat: STATION.lat, startLng: STATION.lng, endLat: pos.lat, endLng: pos.lng, color: arcColor, dash: false });
        // Callsign tag on the globe (OpenHamClock style)
        htmlEls.push({ lat: pos.lat, lng: pos.lng, alt: 0.008, tag: c.call, bgColor: color, type: 'contact' });
        if (c.grid) uniqueGrids.add(c.grid.slice(0, 4));
        if (c.country) uniqueCountries.add(c.country);
      });

      // Add DX spot points, arcs, and tags
      dxSpots.forEach((spot: DXSpot) => {
        const dxLoc = dxSpotLocations[spot.dx_call.toUpperCase()];
        const spotterLoc = dxSpotLocations[spot.spotter.toUpperCase()];
        const spotColor = bandColor(spot.band);
        if (dxLoc) {
          contactPts.push({ lat: dxLoc.lat, lng: dxLoc.lng, label: `${spot.dx_call} · ${spot.band} ${spot.mode} · DX`, color: '#00e5ff', size: 0.4 });
          // DX callsign tag
          htmlEls.push({ lat: dxLoc.lat, lng: dxLoc.lng, alt: 0.008, tag: spot.dx_call, bgColor: spotColor, type: 'dx' });
          // DX pin label
          htmlEls.push({ lat: dxLoc.lat, lng: dxLoc.lng, alt: 0.018, tag: 'DX', bgColor: '#4488ff', type: 'pin' });
        }
        if (spotterLoc) {
          contactPts.push({ lat: spotterLoc.lat, lng: spotterLoc.lng, label: `${spot.spotter} · Spotter`, color: '#ffab40', size: 0.25 });
          // Spotter (DE) tag
          htmlEls.push({ lat: spotterLoc.lat, lng: spotterLoc.lng, alt: 0.018, tag: 'DE', bgColor: '#ffb432', type: 'pin' });
        }
        // Draw arc from spotter to DX (or from home if no spotter location)
        if (dxLoc) {
          const startLat = spotterLoc ? spotterLoc.lat : STATION.lat;
          const startLng = spotterLoc ? spotterLoc.lng : STATION.lng;
          arcs.push({ startLat, startLng, endLat: dxLoc.lat, endLng: dxLoc.lng, color: '#00e5ff', dash: true });
        }
      });

      const stationLabel = STATION.grid ? `${STATION.callsign} · ${STATION.grid} · Home` : (STATION.callsign ? `${STATION.callsign} · Set grid in Settings` : 'Set your grid in Settings');
      const stationPts = [{ lat: STATION.lat, lng: STATION.lng, label: stationLabel, color: '#00b4ff', size: 0.6 }];

      globe = G()
        .globeImageUrl('/dashboard/img/globe/globe_level0_8192x4096.jpg')
        .bumpImageUrl('/dashboard/img/earth-topology.png')
        .showAtmosphere(true)
        .atmosphereColor('#00b4ff')
        .atmosphereAltitude(0.15)
        .pointsData([...stationPts, ...contactPts])
        .pointAltitude(0)
        .pointColor('color')
        .pointLabel('label')
        .pointRadius(0.1)
        .arcsData(arcs)
        .arcColor('color')
        .arcStroke(0.075)
        .arcAltitude(0.12)
        .arcCurveResolution(64)
        .pointsMerge(false)
        // ── OpenHamClock-style colored tags on the globe ──
        .htmlElementsData(htmlEls)
        .htmlLat('lat')
        .htmlLng('lng')
        .htmlAltitude('alt')
        .htmlElement((d: any) => {
          const el = document.createElement('span');
          el.textContent = d.tag;
          if (d.type === 'pin') {
            // DE/DX circle pins like OpenHamClock
            el.style.cssText = `background:${d.bgColor};color:${d.bgColor === '#4488ff' ? '#fff' : '#000'};font-size:11px;font-weight:700;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;pointer-events:auto;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.5);border:2px solid rgba(255,255,255,0.3);line-height:1;`;
          } else {
            // Callsign tag — small colored badge by band
            el.style.cssText = `background:${d.bgColor};color:#000;font-size:10px;font-weight:600;border-radius:3px;padding:1px 4px;pointer-events:auto;cursor:pointer;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.4);`;
          }
          return el;
        })
        .htmlElementVisibilityModifier((el: HTMLElement, isVisible: boolean) => {
          el.style.opacity = isVisible ? '1' : '0';
          el.style.transition = 'opacity 250ms';
        })
        // ── Pulsing ring at home QTH ──
        .ringsData(rings)
        .ringLat('lat')
        .ringLng('lng')
        .ringColor('color')
        .ringMaxRadius('maxRadius')
        .ringPropagationSpeed('propagationSpeed')
        .ringRepeatPeriod('repeatPeriod')
        (container);

      function resizeGlobe() {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w > 0 && h > 0) {
          globe.width([w]);
          globe.height([h]);
        }
      }
      resizeGlobe();
      window.addEventListener('resize', resizeGlobe);
      const initialAlt = hasUserGrid ? 3.5 : 4;
      globe.pointOfView({ lat: STATION.lat, lng: STATION.lng, altitude: initialAlt }, 0);
      globeObjRef.current = globe;
    }

    // Load globe.gl script if not already loaded
    if (!(window as any).Globe) {
      const script = document.createElement('script');
      script.src = '/dashboard/js/globe.gl.min.js';
      script.onload = () => initGlobe();
      document.head.appendChild(script);
    } else {
      initGlobe();
    }

    return () => {
      if (globeObjRef.current) {
        // Cleanup globe
        try { globeObjRef.current._destructor?.(); } catch {}
        globeObjRef.current = null;
      }
    };
  }, [contacts, contactLimit, dxSpots, dxSpotLocations, STATION.lat, STATION.lng, STATION.callsign, STATION.grid]);

  // ── Globe view switching ──
  const [globeView, setGlobeView] = useState<'day' | 'night'>('day');
  useEffect(() => {
    const g = globeObjRef.current;
    if (!g) return;
    if (globeView === 'day') {
      g.globeImageUrl('/dashboard/img/globe/globe_level0_8192x4096.jpg');
      g.bumpImageUrl('/dashboard/img/earth-topology.png');
      g.showAtmosphere(true);
    } else {
      g.globeImageUrl('/dashboard/img/globe/globe_level1_16384x8192.jpg');
      g.bumpImageUrl(null);
      g.showAtmosphere(true);
    }
  }, [globeView]);

  const uniqueGrids = new Set(displayedContacts.map(c => c.grid?.slice(0, 4)).filter(Boolean));
  const uniqueCountries = new Set(displayedContacts.map(c => c.country).filter(Boolean));

  return (
    <div className="dashboard-layout">
      {/* Left sidebar */}
      <div className="dashboard-sidebar">
        <div className="dashboard-panel">
          <div className="dashboard-panel-title">📍 Station</div>
          <div className="dashboard-callsign">{STATION.callsign || 'Log2Go'}</div>
          <div className="dashboard-grid">{STATION.grid || 'Set grid in Settings'}</div>
          <div className="dashboard-coords">{STATION.grid ? `${STATION.lat.toFixed(4)}° N, ${Math.abs(STATION.lng).toFixed(4)}° ${STATION.lng < 0 ? 'W' : 'E'}` : 'Configure your station'}</div>
        </div>

        <div className="dashboard-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', marginBottom: 2 }}>
            <span style={{ fontSize: 10, color: '#5a7a96' }}>☀ SOLAR</span>
            <select
              value={solarWl}
              onChange={e => { setSolarWl(e.target.value); setSolarCycle(false); }}
              style={{
                background: '#0d1b2a',
                color: '#b0c4d8',
                border: '1px solid #1b3a5c',
                borderRadius: 3,
                padding: '1px 4px',
                fontSize: 10,
                cursor: 'pointer',
                flex: 1,
                minWidth: 0,
              }}
            >
              {SOLAR_WAVELENGTHS.map(w => (
                <option key={w.id} value={w.id}>{w.desc}</option>
              ))}
            </select>
            <button
              onClick={() => setSolarCycle(!solarCycle)}
              title={solarCycle ? 'Stop cycling' : 'Auto-cycle wavelengths'}
              style={{
                background: solarCycle ? '#00b4ff' : '#0d1b2a',
                color: solarCycle ? '#0a0e17' : '#5a7a96',
                border: '1px solid #1b3a5c',
                borderRadius: 3,
                padding: '1px 6px',
                fontSize: 10,
                cursor: 'pointer',
                fontWeight: 700,
                lineHeight: '14px',
              }}
            >▶</button>
          </div>
          <div style={{ flex: '1 1 0%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 0, overflow: 'hidden', width: '100%' }}>
            <img
              src={solarImageUrl}
              alt="SDO Solar Image"
              onError={(e: React.SyntheticEvent<HTMLImageElement>) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              style={{ maxHeight: '100%', maxWidth: '100%', width: 'auto', height: 'auto', objectFit: 'contain', borderRadius: '50%', border: '2px solid #1e3048', background: '#0a0e17' }}
            />
          </div>
          <div style={{ fontSize: 10, color: '#5a7a96', marginTop: 2, flexShrink: 0 }}>SDO/AIA · Live from NASA</div>
        </div>

        <div className="dashboard-panel">
          <div className="dashboard-panel-title">☀️ Solar Conditions</div>
          <div className="solar-table">
            <div className="solar-row"><span className="solar-label">SFI</span><span className="solar-value">{solar.sfi ?? '--'}</span></div>
            <div className="solar-row"><span className="solar-label">SN</span><span className="solar-value">{solar.sn ?? '--'}</span></div>
            <div className="solar-row"><span className="solar-label">A-Index</span><span className="solar-value">{solar.a_index ?? '--'}</span></div>
            <div className="solar-row"><span className="solar-label">K-Index</span><span className="solar-value">{solar.k_index ?? '--'}</span></div>
            <div className="solar-row"><span className="solar-label">R</span><span className="solar-value" style={{ color: solar.r_scale != null ? { 0: '#00e676', 1: '#ff9800', 2: '#f44336', 3: '#e040fb', 4: '#ff1744', 5: '#d50000' }[solar.r_scale] ?? '#00b4ff' : undefined }}>R{solar.r_scale ?? '--'}</span></div>
            <div className="solar-row"><span className="solar-label">S</span><span className="solar-value" style={{ color: solar.s_scale != null ? { 0: '#00e676', 1: '#ff9800', 2: '#f44336', 3: '#e040fb', 4: '#ff1744', 5: '#d50000' }[solar.s_scale] ?? '#00b4ff' : undefined }}>S{solar.s_scale ?? '--'}</span></div>
            <div className="solar-row"><span className="solar-label">G</span><span className="solar-value" style={{ color: solar.g_scale != null ? { 0: '#00e676', 1: '#ff9800', 2: '#f44336', 3: '#e040fb', 4: '#ff1744', 5: '#d50000' }[solar.g_scale] ?? '#00b4ff' : undefined }}>G{solar.g_scale ?? '--'}</span></div>
          </div>
          <div className="solar-footer">Source: SWPC NOAA · 5 min refresh</div>
        </div>

        <div className="dashboard-panel">
          <div className="dashboard-panel-title">📡 Band Conditions</div>
          <div className="band-grid">
            {BANDS.map(b => {
              const cond = bandCondition(b.freq);
              return (
                <div className="band-cell" key={b.name}>
                  <div className="band-name">{b.name}</div>
                  <div className="band-cond" style={{ color: condColors[cond] ?? '#ffd740' }}>{cond}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="dashboard-panel">
          <div className="dashboard-panel-title">📊 QSO Stats</div>
          <div style={{ fontSize: 12, color: '#8fa8c4' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div><span style={{ color: '#00b4ff' }}>{totalContacts}</span> Total</div>
              <div><span style={{ color: '#00b4ff' }}>{new Set(contacts.map(c => c.country).filter(Boolean)).size}</span> Countries</div>
              <div><span style={{ color: '#00b4ff' }}>{new Set(contacts.map(c => c.band)).size}</span> Bands</div>
              <div><span style={{ color: '#00b4ff' }}>{new Set(contacts.map(c => c.mode)).size}</span> Modes</div>
              <div><span style={{ color: '#00e676' }}>{contacts.filter(c => c.lotw_conf).length}</span> LoTW ✓</div>
              <div><span style={{ color: '#00e676' }}>{contacts.filter(c => c.eqsl_conf).length}</span> eQSL ✓</div>
              <div><span style={{ color: '#00e676' }}>{contacts.filter(c => c.qrz_conf).length}</span> QRZ ✓</div>
              <div><span style={{ color: '#00b4ff' }}>{new Set(contacts.map(c => c.grid).filter(Boolean).map(g => g.slice(0, 4))).size}</span> Grids</div>
              <div><span style={{ color: '#f5a623' }}>{contacts.filter(c => c.lotw_up && !c.lotw_conf).length}</span> LoTW ↑</div>
              <div><span style={{ color: '#f5a623' }}>{contacts.filter(c => c.eqsl_up && !c.eqsl_conf).length}</span> eQSL ↑</div>
              <div><span style={{ color: '#f5a623' }}>{contacts.filter(c => c.qrz_up && !c.qrz_conf).length}</span> QRZ ↑</div>
              <div><span style={{ color: '#ff5252' }}>{contacts.filter(c => !c.lotw_up && !c.eqsl_up && !c.qrz_up).length}</span> Not sent</div>
            </div>
          </div>
        </div>
      </div>

      {/* Globe center column */}
      <div className="globe-area">
        <div id="globeViz" ref={globeRef} style={{ width: '100%', height: '100%', position: 'relative' }} />
        <div className="globe-controls">
          <div className={`globe-btn${globeView === 'day' ? ' active' : ''}`} onClick={() => setGlobeView('day')}>🗺️ Map</div>
          <div className={`globe-btn${globeView === 'night' ? ' active' : ''}`} onClick={() => setGlobeView('night')}>🔍 Detail</div>
          <div className="globe-btn" onClick={() => globeObjRef.current?.pointOfView?.({ lat: STATION.lat, lng: STATION.lng, altitude: hasUserGrid ? 3.5 : 4 }, 1000)}>🏠 Home</div>
        </div>
        <div className="globe-stats">
          <b>{displayedContacts.length}</b> QSOs mapped · <b>{uniqueGrids.size}</b> grids · <b>{uniqueCountries.size}</b> country
        </div>
      </div>

      {/* Right panel — DX Spots + Recent Contacts with draggable divider */}
      <div className="contacts-panel" style={{ position: 'relative' }}>
        {/* ── DX Spots Subpanel (always visible) ── */}
        <div ref={dxPanelRef} className="dashboard-panel" style={{ paddingBottom: 0, height: dxSpotsHeight, minHeight: 80, flexShrink: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="dashboard-panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>📡 DX Spots</span>
            {dxSpots.length > 0 && (
              <span style={{ fontSize: 10, color: '#00e676', fontWeight: 500 }}>
                <span style={{ color: '#00e676' }}>●</span> Live · {dxSpots.length}
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: '#5a7a96', marginBottom: 4 }}>Reverse Beacon Network · 5 min refresh</div>
          {dxSpots.length > 0 ? (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table className="roster-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1b3a5c', background: '#000000' }}>
                    <th style={{ textAlign: 'left', padding: '2px 4px', color: '#8fa8c4' }}>Call</th>
                    <th style={{ textAlign: 'left', padding: '2px 4px', color: '#8fa8c4' }}>Freq</th>
                    <th style={{ textAlign: 'left', padding: '2px 4px', color: '#8fa8c4' }}>Band</th>
                    <th style={{ textAlign: 'left', padding: '2px 4px', color: '#8fa8c4' }}>Mode</th>
                    <th style={{ textAlign: 'left', padding: '2px 4px', color: '#8fa8c4' }}>SNR</th>
                    <th style={{ textAlign: 'left', padding: '2px 4px', color: '#8fa8c4' }}>Spotter</th>
                    <th style={{ textAlign: 'left', padding: '2px 4px', color: '#8fa8c4' }}>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {dxSpots.slice(0, 20).map((spot, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #1b3a5c', background: i % 2 === 0 ? '#0a1628' : '#0d1f35', cursor: 'pointer' }} onClick={() => {
                      const loc = dxSpotLocations[spot.dx_call.toUpperCase()];
                      if (loc && globeObjRef.current) {
                        globeObjRef.current.pointOfView({ lat: loc.lat, lng: loc.lng, altitude: 1.5 }, 1200);
                      }
                    }}>
                      <td style={{ padding: '2px 4px', color: '#00e676', fontWeight: 600 }}>{spot.dx_call}</td>
                      <td style={{ padding: '2px 4px', color: '#e0e0e0' }}>{spot.freq.toFixed(3)}</td>
                      <td style={{ padding: '2px 4px', color: '#00b4ff' }}>{spot.band}</td>
                      <td style={{ padding: '2px 4px', color: '#e0e0e0' }}>{spot.mode}</td>
                      <td style={{ padding: '2px 4px', color: '#8fa8c4' }}>{spot.snr} dB</td>
                      <td style={{ padding: '2px 4px', color: '#8fa8c4' }}>{spot.spotter}</td>
                      <td style={{ padding: '2px 4px', color: '#8fa8c4' }}>{spot.time}Z</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '12px', color: '#5a7a96', fontSize: 11 }}>
              Waiting for spots…
            </div>
          )}
        </div>

        {/* ── Draggable Divider ── */}
        <div
          style={{
            height: 6,
            background: '#1b3a5c',
            cursor: 'row-resize',
            flexShrink: 0,
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            const startY = e.clientY;
            const startHeight = dxPanelRef.current ? dxPanelRef.current.getBoundingClientRect().height : dxSpotsHeight;
            const parentEl = dxPanelRef.current?.parentElement;
            const parentHeight = parentEl ? parentEl.getBoundingClientRect().height : 800;
            const onMove = (ev: MouseEvent) => {
              const delta = ev.clientY - startY;
              const newH = Math.max(80, Math.min(parentHeight - 80, startHeight + delta));
              setDxSpotsHeight(newH);
            };
            const onUp = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          }}
        >
          <div style={{ width: 32, height: 3, borderRadius: 2, background: '#3a5a7c' }} />
        </div>

        {/* ── Recent Contacts Subpanel ── */}
        <div className="dashboard-panel" style={{ paddingBottom: 8, flexShrink: 0 }}>
          <div className="dashboard-panel-title" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span>📻 Recent Contacts</span>
            {displayedContacts.length > 0 && (
              <select
                value={contactLimit}
                onChange={e => setContactLimit(Number(e.target.value))}
                style={{
                  background: '#0d1b2a',
                  color: '#8fa8c4',
                  border: '1px solid #1b3a5c',
                  borderRadius: 4,
                  padding: '2px 6px',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                <option value={0}>All</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
                <option value={40}>40</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            )}
          </div>
        </div>
        <div className="contacts-list" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {displayedContacts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#8fa8c4', fontSize: 13 }}>
              No contacts yet
            </div>
          ) : (
            displayedContacts.map(c => {
              let statusBadge = <span className="contact-lotw none">—</span>;
              const anyConf = c.lotw_conf || c.eqsl_conf || c.qrz_conf;
              const anyUp = c.lotw_up || c.eqsl_up || c.qrz_up;
              if (anyConf) statusBadge = <span className="contact-lotw confirmed">✓ CONF</span>;
              else if (anyUp) statusBadge = <span className="contact-lotw uploaded">↑ UP</span>;
              return (
                <div className="contact-row" key={`${c.call}-${c.date}-${c.time}`} onClick={() => {
                  const pos = gridToLatLng(c.grid);
                  if (pos && globeObjRef.current) {
                    globeObjRef.current.pointOfView({ lat: pos.lat, lng: pos.lng, altitude: 1.5 }, 1200);
                  }
                }}>
                  <div className="contact-row-top">
                    <span className="contact-callsign">{c.call}</span>
                    <span className="contact-band-mode">{c.band} {c.mode}</span>
                  </div>
                  <div className="contact-row-bottom">
                    <span className="contact-details">{c.grid} {c.state}</span>
                    <span className="contact-time">{c.date} {c.time} {statusBadge}</span>
                  </div>
                </div>
              );
            })
          )}
          {totalContacts > contacts.length && (
            <div style={{ textAlign: 'center', padding: '8px', color: '#8fa8c4', fontSize: 11 }}>
              Showing {contacts.length} of {totalContacts} contacts
            </div>
          )}
        </div>
      </div>
    </div>
  );
}