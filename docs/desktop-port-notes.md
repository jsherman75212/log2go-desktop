# Desktop Port Notes

Created as sibling project: `/mnt/sparky/projects/log2go/desktop`.

Source inspected/read-only:

- Mobile app: `/mnt/sparky/projects/log2go/mobile`
- Backend: `/mnt/sparky/projects/log2go/server`
- NetLogger docs: `/mnt/sparky/projects/log2go/docs/netlogger-api-reference.md`
- Legacy AIM capture notes: `/mnt/sparky/projects/log2go/mobile/docs/netlogger-aim-capture-analysis.md`

Existing mobile/backend repos had uncommitted work at bootstrap time, so this desktop port did not modify them.

## Architecture choice

Electron + Vite + React + TypeScript was chosen for the first desktop framework because the mobile project already has reusable TypeScript domain and NetLogger code. The UI is rewritten for desktop HTML/CSS instead of trying to run React Native components directly.

## Reused modules

Copied from mobile:

- `src/domain/*`
- `src/utils/*`
- selected `src/application/*`
- selected `src/services/*`
- `src/appVersion.ts`

Excluded for first pass:

- React Native component code
- Expo GPS implementation
- React Native theme/BackHandler modules

## Current behavior limits

The desktop scaffold uses public NetLogger XML API reads. It does not yet perform legacy CGI subscribe/AIM-send/unsubscribe. That write path must follow the `netlogger-legacy-integration` rules:

- cleanup before code/live testing
- no rapid-fire calls; respect 20s minimum interval
- subscribe/unsubscribe identity uses monitor format with `v3.1.7W`
- AIM send identity uses bare client callsign with no version suffix
- verify publication by transcript, not `*success*` alone

## Intended UI shape

Main NetLogger Desktop tab:

- active net browser
- roster grid
- contact draft/log pane
- AIM pane
- monitor pane

Other tabs/child panes:

- General Log
- Mobile/Portable
- Contest
- POTA
- Settings
