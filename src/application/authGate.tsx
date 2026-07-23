import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  getRegistrationStatus,
  login as apiLogin,
  startRegistration,
  getAccountProfile,
  type RegistrationStartResponse,
  type AccountProfile,
} from '../services/backendClient';

// ── Types ────────────────────────────────────────────────────────────

export type AuthGateView =
  | 'checking'          // still contacting the server
  | 'login'             // username + password + "Login/Register" button
  | 'register'          // registration form (callsign + email) — shown after failed login
  | 'pending'           // registration started, waiting for email verification
  | 'logged-in';        // successfully authenticated

export type AuthGateProps = {
  baseUrl: string;
  onLoginSuccess: (token: string, profile: AccountProfile, keepLoggedIn: boolean) => void;
  onSkipLogin?: () => void;
  existingToken?: string;
  deviceType: string;
  visible: boolean;
  /**
   * When true (desktop/mobile), login is persistent by default — the
   * "Keep me logged in" checkbox is shown (checked by default) and a
   * stored token is reused on the next visit.
   * When false (web), login is per-session only — no checkbox, no
   * token reuse, user logs in every visit.
   */
  persistentLogin?: boolean;
};

// ── Device ID management ─────────────────────────────────────────────

const DEVICE_ID_KEY = 'log2go.deviceId.web.v1';
const KEEP_LOGGED_IN_KEY = 'log2go.keepLoggedIn';

function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const newId = `log2go-web-${crypto.randomUUID()}`;
    localStorage.setItem(DEVICE_ID_KEY, newId);
    return newId;
  } catch {
    return `log2go-web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function loadKeepLoggedInPref(): boolean {
  try {
    return localStorage.getItem(KEEP_LOGGED_IN_KEY) !== 'false';
  } catch {
    return true;
  }
}

function saveKeepLoggedInPref(value: boolean): void {
  try {
    localStorage.setItem(KEEP_LOGGED_IN_KEY, String(value));
  } catch { /* ignore */ }
}

// ── Component ────────────────────────────────────────────────────────

export function AuthGate({
  baseUrl,
  onLoginSuccess,
  onSkipLogin,
  existingToken,
  deviceType,
  visible,
  persistentLogin = false,
}: AuthGateProps) {
  const [view, setView] = useState<AuthGateView>('checking');
  const [deviceId, setDeviceId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Login form state
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [keepLoggedIn, setKeepLoggedIn] = useState(loadKeepLoggedInPref());

  // Registration form state (shown after a failed login attempt)
  const [regCallsign, setRegCallsign] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [registrationResult, setRegistrationResult] = useState<RegistrationStartResponse>();

  // Pending state — polling
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // When true, the user manually went back to login from pending/register.
  // Suppresses the auto-check that would force them back to 'pending'.
  // Starts true so the initial page load doesn't auto-trap the user in
  // 'pending' — only explicit user actions (register, recheck) should
  // transition to pending, not the auto-check on mount.
  const suppressAutoPendingRef = useRef(true);

  // ── Try to log in, fall back to registration if credentials unknown ─
  const attemptLogin = useCallback(async (username: string, password: string): Promise<boolean> => {
    try {
      const tokenResponse = await apiLogin(baseUrl, username, password, undefined);
      if (tokenResponse.access_token) {
        const profile = await getAccountProfile(baseUrl, tokenResponse.access_token);
        const shouldKeep = persistentLogin && keepLoggedIn;
        saveKeepLoggedInPref(shouldKeep);
        setView('logged-in');
        onLoginSuccess(tokenResponse.access_token, profile, shouldKeep);
        return true;
      }
    } catch {
      // Login failed — credentials might be unknown
    }
    return false;
  }, [baseUrl, keepLoggedIn, onLoginSuccess, persistentLogin]);

  // ── Handle "Login/Register" button click ──────────────────────────
  const handleLoginOrRegister = useCallback(async () => {
    const username = loginUsername.trim();
    if (!username || !loginPassword) {
      setError('Enter your username/callsign and password to log in or register.');
      return;
    }
    setBusy(true);
    setError('');

    const success = await attemptLogin(username, loginPassword);
    if (success) {
      setBusy(false);
      return;
    }

    // Login failed — switch to registration view, pre-fill callsign
    // from whatever the user typed as their username.
    setRegCallsign(username.toUpperCase());
    setRegEmail('');
    setView('register');
    setBusy(false);
  }, [attemptLogin, loginUsername, loginPassword]);

  // ── Handle registration submit ───────────────────────────────────
  const handleRegister = useCallback(async () => {
    const callsign = regCallsign.trim().toUpperCase();
    const email = regEmail.trim().toLowerCase();
    if (!callsign || !email) {
      setError('Callsign and email are required.');
      return;
    }
    if (!email.includes('@') || email.startsWith('@') || email.endsWith('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await startRegistration(baseUrl, {
        callsign,
        email,
        deviceId,
        deviceName: `${callsign}'s ${deviceType}`,
        deviceType,
      });
      setRegistrationResult(result);
      if (result.device_id && result.device_id !== deviceId) {
        setDeviceId(result.device_id);
        try { localStorage.setItem(DEVICE_ID_KEY, result.device_id); } catch { /* ignore */ }
      }
      setView('pending');
    } catch (err) {
      setError(`Registration failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [baseUrl, deviceId, deviceType, regCallsign, regEmail]);

  // ── Poll for registration completion when in "pending" state ─────
  useEffect(() => {
    if (view !== 'pending' || !deviceId) return;

    const poll = async () => {
      try {
        const result = await getRegistrationStatus(baseUrl, deviceId);
        if (result.status === 'active') {
          if (result.username) setLoginUsername(result.username);
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
          setLoginPassword('');
          setView('login');
        }
      } catch {
        // Ignore poll errors — will retry
      }
    };

    pollTimerRef.current = setInterval(poll, 10_000);
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [view, deviceId, baseUrl]);

  // ── Manual re-check (for pending state) ─────────────────────────
  const handleRecheck = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const result = await getRegistrationStatus(baseUrl, deviceId);
      if (result.status === 'active') {
        if (result.username) setLoginUsername(result.username);
        setLoginPassword('');
        setView('login');
      } else {
        setError('Registration is still pending. Check your email for the verification link.');
      }
    } catch (err) {
      setError(`Could not check status: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [baseUrl, deviceId]);

  // ── Go back to login from registration ──────────────────────────
  const handleBackToLogin = useCallback(() => {
    suppressAutoPendingRef.current = true;
    setView('login');
    setError('');
  }, []);

  // ── Clear device ID and start over ──────────────────────────────
  const handleStartOver = useCallback(() => {
    suppressAutoPendingRef.current = true;
    const newId = `log2go-web-${crypto.randomUUID()}`;
    try { localStorage.setItem(DEVICE_ID_KEY, newId); } catch { /* ignore */ }
    setDeviceId(newId);
    setRegistrationResult(undefined);
    setRegCallsign('');
    setRegEmail('');
    setLoginUsername('');
    setLoginPassword('');
    setError('');
    setView('login');
  }, []);

  // ── Initialize on mount ──────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;

    // Only desktop/mobile (persistentLogin=true) may reuse a stored token.
    // Web always requires a fresh login each visit.
    const canReuseToken = persistentLogin && loadKeepLoggedInPref();

    if (canReuseToken && existingToken) {
      setView('checking');
      getAccountProfile(baseUrl, existingToken)
        .then((profile) => {
          setView('logged-in');
          onLoginSuccess(existingToken, profile, true);
        })
        .catch(() => {
          const did = getOrCreateDeviceId();
          setDeviceId(did);
          setView('login');
        });
    } else {
      const did = getOrCreateDeviceId();
      setDeviceId(did);
      setView('login');
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Check registration status for pending device ─────────────────
  useEffect(() => {
    if (view !== 'login' || !deviceId) return;
    if (suppressAutoPendingRef.current) return; // user manually went back to login
    let cancelled = false;
    getRegistrationStatus(baseUrl, deviceId)
      .then((result) => {
        if (cancelled) return;
        if (result.status === 'pending') {
          if (result.callsign) setRegCallsign(result.callsign);
          if (result.email) setRegEmail(result.email);
          setView('pending');
        } else if (result.status === 'active' && result.username) {
          setLoginUsername(result.username);
        }
      })
      .catch(() => { /* ignore */ });

    return () => { cancelled = true; };
  }, [view, deviceId, baseUrl]);

  if (!visible) return null;

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="auth-gate-overlay" role="dialog" aria-modal="true" aria-label="Log2Go account authentication">
      <div className="auth-gate-modal">
        {view === 'checking' && (
          <div className="auth-gate-section">
            <h2>Log2Go</h2>
            <p className="auth-gate-muted">Connecting…</p>
            <div className="auth-gate-spinner" />
          </div>
        )}

        {view === 'login' && (
          <div className="auth-gate-section">
            <h2>Log2Go</h2>
            <p className="auth-gate-muted">
              Enter your username/callsign and password. If you don't have an account yet, we'll set one up.
            </p>
            {error && <div className="auth-gate-error">{error}</div>}
            <div className="auth-gate-form">
              <label>
                Username / Callsign
                <input
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  placeholder="Your callsign"
                  autoComplete="username"
                  disabled={busy}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void handleLoginOrRegister(); }}
                />
              </label>
              <label>
                Password
                <input
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  type="password"
                  autoComplete="current-password"
                  disabled={busy}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void handleLoginOrRegister(); }}
                />
              </label>
            </div>
            {persistentLogin && (
              <label className="auth-gate-checkbox">
                <input
                  type="checkbox"
                  checked={keepLoggedIn}
                  onChange={(e) => setKeepLoggedIn(e.target.checked)}
                  disabled={busy}
                />
                Keep me logged in
              </label>
            )}
            <button
              className="auth-gate-primary-btn"
              onClick={() => void handleLoginOrRegister()}
              disabled={busy || !loginUsername.trim() || !loginPassword}
            >
              {busy ? 'Checking…' : 'Login / Register'}
            </button>
            {onSkipLogin && (
              <button
                className="auth-gate-skip-btn"
                onClick={onSkipLogin}
                disabled={busy}
                type="button"
              >
                Continue as SWL (no login)
              </button>
            )}
          </div>
        )}

        {view === 'register' && (
          <div className="auth-gate-section">
            <h2>New Account</h2>
            <p className="auth-gate-muted">
              No account found for <strong>{loginUsername.trim()}</strong>. Enter your callsign and email
              to create a Log2Go account. We'll send a verification link to your email.
            </p>
            {error && <div className="auth-gate-error">{error}</div>}
            <div className="auth-gate-form">
              <label>
                Callsign
                <input
                  value={regCallsign}
                  onChange={(e) => setRegCallsign(e.target.value.toUpperCase())}
                  placeholder="Your callsign"
                  autoComplete="username"
                  disabled={busy}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void handleRegister(); }}
                />
              </label>
              <label>
                Email
                <input
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  type="email"
                  disabled={busy}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void handleRegister(); }}
                />
              </label>
            </div>
            <button
              className="auth-gate-primary-btn"
              onClick={() => void handleRegister()}
              disabled={busy || !regCallsign.trim() || !regEmail.trim()}
            >
              {busy ? 'Sending…' : 'Send Verification Email'}
            </button>
            <button
              className="auth-gate-text-btn"
              onClick={handleBackToLogin}
              disabled={busy}
              type="button"
            >
              ← Back to login
            </button>
          </div>
        )}

        {view === 'pending' && (
          <div className="auth-gate-section">
            <h2>Check Your Email</h2>
            <p>
              We sent a verification link to <strong>{registrationResult?.email || regEmail}</strong> for{' '}
              <strong>{registrationResult?.callsign || regCallsign}</strong>.
            </p>
            <p className="auth-gate-muted">
              Click the link in your email to set your username and password. Once you've completed that step,
              click the button below to continue.
            </p>
            {registrationResult?.email_status === 'smtp_not_configured' && (
              <div className="auth-gate-info">
                <p>
                  <strong>Development mode:</strong> Email is not configured on this server yet.
                  Use this link to verify:
                </p>
                <a href={registrationResult.verify_url} target="_blank" rel="noopener noreferrer" className="auth-gate-link">
                  Open verification link →
                </a>
              </div>
            )}
            {error && <div className="auth-gate-error">{error}</div>}
            <div className="auth-gate-actions">
              <button
                className="auth-gate-primary-btn"
                onClick={() => void handleRecheck()}
                disabled={busy}
              >
                {busy ? 'Checking…' : "I've Verified — Continue"}
              </button>
              <button
                className="auth-gate-text-btn"
                onClick={handleBackToLogin}
                disabled={busy}
                type="button"
              >
                ← Back to login
              </button>
              <button
                className="auth-gate-text-btn"
                onClick={handleStartOver}
                disabled={busy}
                type="button"
              >
                Start over with a new device ID
              </button>
            </div>
          </div>
        )}

        {view === 'logged-in' && (
          <div className="auth-gate-section">
            <h2>✓ Logged In</h2>
            <p>You're authenticated. Loading Log2Go…</p>
          </div>
        )}
      </div>
    </div>
  );
}