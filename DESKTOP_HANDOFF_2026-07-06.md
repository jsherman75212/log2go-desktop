# Log2Go Desktop Handoff — 2026-07-06

Project path:

```bash
cd "/mnt/sparky/projects/log2go/desktop"
```

## Created

A new sibling project to Log2Go:

```text
/mnt/sparky/projects/log2go/desktop
```

Stack:

- Electron
- Vite
- React
- TypeScript

Initial commit:

```text
e135098 feat: bootstrap Log2Go desktop framework
```

## What works now

The first framework builds and includes:

- NetLogger-style desktop main tab
- Active nets list from NetLogger public XML API
- Net selection
- Roster/check-ins load
- AIM transcript load
- Monitor list load
- Roster row -> local contact draft
- Local contact logging via reused Log2Go logging flow
- Placeholder tabs for:
  - General Log
  - Mobile/Portable
  - Contest
  - POTA
  - Settings

## Code reused from mobile

Copied pure TypeScript modules from `/mnt/sparky/projects/log2go/mobile/src`:

- `domain/*`
- `utils/*`
- selected `application/*`
- selected `services/*`
- `appVersion.ts`

Excluded from the first pass:

- React Native components
- Expo GPS implementation
- Android BackHandler/theme modules

## Verification run

From `/mnt/sparky/projects/log2go/desktop`:

```bash
npm install
npm run build
npm test
node --import tsx -e "import {fetchActiveNets, flattenActiveNets} from './src/services/netloggerClient.ts'; const r = await fetchActiveNets(); const nets = flattenActiveNets(r); console.log(JSON.stringify({responseCode:r.responseCode, serverGroups:r.servers.length, nets:nets.length, sample:nets.slice(0,3).map(n=>({server:n.serverName, net:n.netName, frequency:n.frequency, mode:n.mode, band:n.band}))}, null, 2));"
```

Results:

- `npm install`: 105 packages added, 0 vulnerabilities
- `npm run build`: passed
  - TypeScript typecheck passed
  - Vite renderer build passed
  - Electron main build passed
- `npm test`: passed, but no tests exist yet (`0` tests)
- NetLogger live API smoke test: passed
  - responseCode: `200 OK`
  - serverGroups: `5`
  - nets observed at that moment: `1`
  - sample: `3905 40m SSB Late Net`, NETLOGGER3, 7.195, SSB, 40m

## Current caution

The desktop scaffold only reads NetLogger public XML endpoints. It does not yet perform legacy CGI subscribe/AIM-send/unsubscribe or shared roster edits.

Do not add live write-capable NetLogger operations without following the cleanup/rate-limit rules in the `netlogger-legacy-integration` skill and the capture docs.

## Progress resumed 2026-07-06

Additional commits after the original handoff:

```text
d58d675 test: add desktop NetLogger glue coverage
7c107a0 feat: persist desktop logging state locally
```

What changed:

- Extracted pure desktop NetLogger UI/domain glue from `src/main.tsx` into `src/application/desktopNetloggerGlue.ts`.
- Added real Node test coverage; `npm test` now runs 7 tests instead of 0.
- Added browser `localStorage`-backed desktop persistence stores in `src/services/browserKeyValueStore.ts`.
- Wired the renderer to load saved logging state on startup and immediately autosave contact/settings/profile state after hydration.
- Corrected a stale NetLogger version comment so it matches the verified `v3.1.7W` AIM behavior.

Verification after these changes:

```text
npm test: passed, 7/7 tests
npm run build: passed
read-only NetLogger active-net smoke: 200 OK, 5 server groups, 1 active net observed at test time
```

Important caution:

- First-pass desktop persistence uses browser `localStorage`. It is durable enough for local desktop contact/session state, but it is not OS-backed secure credential storage. Do not represent backend/QRZ/LoTW/eQSL credential storage as secure until an Electron preload/IPC bridge and OS-backed storage are added.
- Electron GUI runtime still has the chrome-sandbox ownership caveat from the original handoff unless Jody fixes it with sudo or runs a controlled dev-only no-sandbox launch.

## Next best steps

1. Port the Station Profiles editor into Settings.
2. Expand General Log and Recent Contacts into true desktop tables.
3. Add an Electron preload/IPC storage bridge if secure desktop credential storage becomes necessary.
4. Design NetLogger Desktop parity features with Jody before implementing shared roster write/co-logger controls.
