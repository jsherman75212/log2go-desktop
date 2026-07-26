# Log2Go Desktop NetLogger-style Port Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task when expanding beyond the first checked-in desktop slice.

**Goal:** Port Log2Go into a desktop client that feels familiar to NetLogger desktop users while preserving Log2Go's backend-centered account/QSO architecture.

**Architecture:** Keep the Electron renderer as the desktop shell, with pure TypeScript application/domain helpers under `src/application` and `src/domain`. NetLogger public XML reads remain read-only in the renderer for roster/AIM/monitor visibility; legacy CGI write-capable join/AIM/send/unsubscribe must stay behind the existing backend proxy architecture unless explicitly reopened and re-tested. Desktop local persistence can use browser `localStorage` for early non-secret state, but credentials must not be described as secure until an Electron preload/IPC bridge with OS-backed secret storage is added.

**Tech Stack:** Electron, Vite, React, TypeScript, Node test runner, shared Log2Go TypeScript domain/services.

---

## Current verified baseline

Repository: `/mnt/sparky/projects/log2go/desktop`

Verified before this plan:

- `git status --short --branch` returned a clean `## master` branch.
- `npm test` passed 7/7 tests.
- `npm run build` passed TypeScript, Vite renderer build, and Electron TypeScript build.

Implemented in this first desktop slice:

- Added tested roster worked-state helpers: `normalizeRosterCallsign`, `isCheckinWorked`, and `workedFlag`.
- Expanded the NetLogger roster UI with W marker, county, remarks, QSL, member ID, DXCC, and a selected-net summary strip.
- Renamed the header to `Log2Go Desktop` and kept the UI explicitly NetLogger-style without claiming unsupported write-path or credential-security behavior.
- Re-verified with `npm test` passing 8/8 tests and `npm run build` passing.

## Desktop product direction

The desktop app should resemble the NetLogger desktop workflow without becoming a clone of old internals:

1. Data-dense operating screen first.
2. Active nets list on the left.
3. Main check-in roster in the center.
4. Local QSO/logging controls and AIM/monitors on the right.
5. Bottom status bar with plain, actionable messages.
6. Tabs or panes for General Log, Mobile/Portable, Contest, POTA, Accounts/Settings.
7. Local contacts visibly mark roster rows already logged during the current desktop session.
8. Backend/account sync remains Log2Go-owned and service-state-aware.

## Safety and operating constraints

- Do not hammer NetLogger volunteer servers. Manual refresh is fine; future auto-poll must use conservative intervals.
- Do not implement NetLogger write paths by guessing endpoints.
- Do not use Jody's `KE5ZQV-JODYPC` NetLogger identity in desktop testing.
- Do not claim desktop credential storage is secure while it is localStorage-backed.
- Frequency/license validation gates QSO logging, not passive roster viewing.

---

## Task 1: Add tested desktop roster display helpers

**Objective:** Add pure helper functions that let the roster mark already-logged stations and display NetLogger-like compact status markers.

**Files:**
- Modify: `src/application/desktopNetloggerGlue.ts`
- Test: `src/application/desktopNetloggerGlue.test.ts`

**Steps:**
1. Add a helper that normalizes callsigns for roster comparison.
2. Add `isCheckinWorked(checkin, contacts, selectedNet)`.
3. Add `workedFlag(checkin, contacts, selectedNet)` returning `W` or blank.
4. Test same-net matching and different-net non-matching.
5. Run `npm test`.

## Task 2: Make the NetLogger tab look more like a desktop operating console

**Objective:** Improve the first desktop screen so it is recognizably NetLogger-like: title bar, active-net summary, roster columns, local worked marker, AIM/monitors, and contact draft panel.

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

**Steps:**
1. Rename header title from framework language to `Log2Go Desktop`.
2. Add a selected-net summary strip above the roster.
3. Expand roster columns to include worked marker, county, remarks, QSL, member ID, and DXCC.
4. Use the helper from Task 1 to mark already logged check-ins.
5. Keep status colors for NCS/logger/relay/VIP/unavailable.
6. Run `npm test` and `npm run build`.

## Task 3: Add a desktop Accounts/Settings skeleton without credential claims

**Objective:** Replace placeholder Settings copy with a practical desktop settings shell that makes the security boundary explicit.

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

**Steps:**
1. Add sections for Station Profiles, Backend Account, Online Services, and Desktop Storage.
2. Display current station profile summary from `loggingState.stationProfile` or active profile helper if present.
3. Show warning: early desktop persistence is local-only and not OS-backed secure storage yet.
4. Do not add password fields until the Electron secure-store bridge exists.
5. Run `npm test` and `npm run build`.

## Task 4: Add NetLogger read-only auto-refresh controls

**Objective:** Add an operator-controlled poll cadence that respects NetLogger server load.

**Files:**
- Modify: `src/main.tsx`
- Test: `src/application/desktopNetloggerGlue.test.ts` if any pure scheduling helpers are extracted.

**Steps:**
1. Add a manual/auto toggle for selected-net refresh only.
2. Default auto refresh OFF.
3. If enabled, poll selected net every 20 seconds minimum.
4. Stop polling when no selected net or tab changes away from NetLogger.
5. Show next refresh countdown in the UI.
6. Run `npm test` and `npm run build`.

## Task 5: Add General Log desktop pane

**Objective:** Port the core manual QSO entry into a desktop form/table layout.

**Files:**
- Create or modify: `src/components/GeneralLogPanel.tsx` if component extraction is chosen.
- Modify: `src/main.tsx`
- Test pure mapping helpers under `src/application/`.

**Steps:**
1. Extract the local contact draft form into a reusable component or helper.
2. Add a General Log tab with manual callsign/frequency/mode/RST/grid/county fields.
3. Reuse `logContact()` for persistence and numbering.
4. Show recent contacts table below the form.
5. Run `npm test` and `npm run build`.

## Task 6: Add secure desktop credential architecture before real passwords

**Objective:** Prepare credential handling correctly before exposing LoTW/QRZ/eQSL password forms.

**Files:**
- Create: Electron preload/IPC bridge files as needed.
- Add dependency only after choosing an OS-backed secret storage library.
- Test: Node tests for fallback/error behavior.

**Steps:**
1. Choose and verify an OS-backed secret storage approach for Linux/Windows/macOS.
2. Add IPC methods for get/set/delete secret.
3. Keep renderer unable to directly read secret storage implementation details.
4. Migrate existing localStorage secret-store placeholder only after confirmation.
5. Run `npm test` and `npm run build`.

---

## Verification checklist for each desktop slice

- `git status --short --branch` reviewed before edits.
- `npm test` passes.
- `npm run build` passes.
- Any NetLogger live test is read-only public XML only unless explicitly approved.
- UI strings do not claim unsupported security or upload behavior.
- Changes are documented in this plan or a dated resume note.
