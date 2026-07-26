import { useState, useEffect, useCallback } from 'react';

// ── Preferences Type ─────────────────────────────────────────────────

export type Log2GoPreferences = {
  // IM
  announceMonitors: boolean;
  clearImsAtNetStart: boolean;
  // Contacts
  deleteConfirmThreshold: number;
  recomputeWorkedFlag: boolean;
  callsignOnlyForOperator: boolean;
  // Worked Station Flag criteria
  workedFlagMatchNet: boolean;
  workedFlagMatchBand: boolean;
  workedFlagMatchMode: boolean;
  workedFlagMatchClub: boolean;
  workedFlagMatchState: boolean;
  workedFlagMatchMP: boolean;
  // Appearance
  profileChangeIndicator: boolean;
  defaultRosterDensity: 'normal' | 'compact' | 'extra-compact';
  // Are You Sure
  confirmCloseNet: boolean;
  // Startup
  manualHighlighterStartup: boolean;
};

const STORAGE_KEY = 'log2go.preferences';

export const DEFAULT_PREFERENCES: Log2GoPreferences = {
  announceMonitors: true,
  clearImsAtNetStart: true,
  deleteConfirmThreshold: 0,
  recomputeWorkedFlag: true,
  callsignOnlyForOperator: false,
  workedFlagMatchNet: false,
  workedFlagMatchBand: false,
  workedFlagMatchMode: false,
  workedFlagMatchClub: false,
  workedFlagMatchState: false,
  workedFlagMatchMP: false,
  profileChangeIndicator: false,
  defaultRosterDensity: 'normal',
  confirmCloseNet: true,
  manualHighlighterStartup: false,
};

// ── Storage ──────────────────────────────────────────────────────────

export function loadPreferences(): Log2GoPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(prefs: Log2GoPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch { /* non-fatal */ }
}

// ── Preferences Hook ─────────────────────────────────────────────────

export function usePreferences() {
  const [prefs, setPrefs] = useState<Log2GoPreferences>(() => loadPreferences());

  const update = useCallback(<K extends keyof Log2GoPreferences>(key: K, value: Log2GoPreferences[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      savePreferences(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setPrefs(DEFAULT_PREFERENCES);
    savePreferences(DEFAULT_PREFERENCES);
  }, []);

  return { prefs, update, reset };
}

// ── Preferences Modal Component ─────────────────────────────────────

type PreferencesModalProps = {
  prefs: Log2GoPreferences;
  onUpdate: <K extends keyof Log2GoPreferences>(key: K, value: Log2GoPreferences[K]) => void;
  onClose: () => void;
  onReset: () => void;
};

export function PreferencesModal({ prefs, onUpdate, onClose, onReset }: PreferencesModalProps) {
  return (
    <div className="prefs-modal-backdrop" onClick={onClose}>
      <div className="prefs-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Preferences</h2>

        <div className="prefs-modal-section">
          <h3>IM (AIM Chat)</h3>
          <label className="prefs-row">
            <input type="checkbox" checked={prefs.announceMonitors} onChange={(e) => onUpdate('announceMonitors', e.target.checked)} />
            Announce when monitors start/stop
          </label>
          <label className="prefs-row">
            <input type="checkbox" checked={prefs.clearImsAtNetStart} onChange={(e) => onUpdate('clearImsAtNetStart', e.target.checked)} />
            Clear AIM messages when joining a new net
          </label>
        </div>

        <div className="prefs-modal-section">
          <h3>Contacts</h3>
          <label className="prefs-row">
            Delete confirmation threshold:
            <input type="number" min={0} value={prefs.deleteConfirmThreshold} onChange={(e) => onUpdate('deleteConfirmThreshold', parseInt(e.target.value) || 0)} />
            <span className="auth-gate-muted">(0 = always confirm)</span>
          </label>
          <label className="prefs-row">
            <input type="checkbox" checked={prefs.recomputeWorkedFlag} onChange={(e) => onUpdate('recomputeWorkedFlag', e.target.checked)} />
            Recompute Worked Station Flag when criteria change
          </label>
          <label className="prefs-row">
            <input type="checkbox" checked={prefs.callsignOnlyForOperator} onChange={(e) => onUpdate('callsignOnlyForOperator', e.target.checked)} />
            Use callsign only for Operator field
          </label>
        </div>

        <div className="prefs-modal-section">
          <h3>Worked Station Flag Criteria</h3>
          <p className="auth-gate-muted" style={{ fontSize: 12, marginBottom: 6 }}>Call Sign is always matched. Check additional criteria to narrow matches:</p>
          <label className="prefs-row">
            <input type="checkbox" checked={prefs.workedFlagMatchNet} onChange={(e) => onUpdate('workedFlagMatchNet', e.target.checked)} />
            Match Net name
          </label>
          <label className="prefs-row">
            <input type="checkbox" checked={prefs.workedFlagMatchBand} onChange={(e) => onUpdate('workedFlagMatchBand', e.target.checked)} />
            Match Band
          </label>
          <label className="prefs-row">
            <input type="checkbox" checked={prefs.workedFlagMatchMode} onChange={(e) => onUpdate('workedFlagMatchMode', e.target.checked)} />
            Match Mode
          </label>
          <label className="prefs-row">
            <input type="checkbox" checked={prefs.workedFlagMatchClub} onChange={(e) => onUpdate('workedFlagMatchClub', e.target.checked)} />
            Match Club
          </label>
          <label className="prefs-row">
            <input type="checkbox" checked={prefs.workedFlagMatchState} onChange={(e) => onUpdate('workedFlagMatchState', e.target.checked)} />
            Match State
          </label>
          <label className="prefs-row">
            <input type="checkbox" checked={prefs.workedFlagMatchMP} onChange={(e) => onUpdate('workedFlagMatchMP', e.target.checked)} />
            Match M/P Status
          </label>
        </div>

        <div className="prefs-modal-section">
          <h3>Appearance</h3>
          <label className="prefs-row">
            Default roster density:
            <select value={prefs.defaultRosterDensity} onChange={(e) => onUpdate('defaultRosterDensity', e.target.value as 'normal' | 'compact' | 'extra-compact')}>
              <option value="normal">Normal</option>
              <option value="compact">Compact</option>
              <option value="extra-compact">Extra compact</option>
            </select>
          </label>
          <label className="prefs-row">
            <input type="checkbox" checked={prefs.profileChangeIndicator} onChange={(e) => onUpdate('profileChangeIndicator', e.target.checked)} />
            Enable Profile Change Indicator (row numbers turn red)
          </label>
        </div>

        <div className="prefs-modal-section">
          <h3>Confirmations</h3>
          <label className="prefs-row">
            <input type="checkbox" checked={prefs.confirmCloseNet} onChange={(e) => onUpdate('confirmCloseNet', e.target.checked)} />
            Confirm before closing a net
          </label>
        </div>

        <div className="prefs-modal-section">
          <h3>Startup</h3>
          <label className="prefs-row">
            <input type="checkbox" checked={prefs.manualHighlighterStartup} onChange={(e) => onUpdate('manualHighlighterStartup', e.target.checked)} />
            Start with Manual Station Highlighter (vs Automatic)
          </label>
        </div>

        <div className="prefs-actions">
          <button className="small-button" onClick={onReset}>Reset to Defaults</button>
          <button className="small-button" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}