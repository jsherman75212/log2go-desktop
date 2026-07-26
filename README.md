# Log2Go Desktop

Initial desktop framework for Jody / KE5ZQV's Log2Go NetLogger replacement.

## Purpose

This project is a sibling to the existing Log2Go mobile project and is intended to grow into the desktop client: a NetLogger Desktop-style main application with tabs/child panes for the Log2Go mobile sections.

Current bootstrap stack:

- Electron desktop shell
- Vite + React + TypeScript renderer
- Reused pure TypeScript modules from Log2Go mobile:
  - domain models
  - station profiles/contact factory/defaults
  - NetLogger XML parser and public API client
  - NetLogger state helpers
  - backend client and sync helpers

## Current first-pass functionality

The first scaffold includes:

- Active NetLogger net list using the public XML API
- Net selection
- Check-in roster loading
- AIM transcript loading
- Monitor list loading
- Roster row -> local contact draft prefill
- Local session contact logging using the existing Log2Go logging flow
- Tabs reserved for General Log, Mobile/Portable, Contest, POTA, and Settings

## Important safety/protocol note

This first desktop scaffold intentionally keeps NetLogger legacy CGI write actions conservative. Subscribe/AIM-send/unsubscribe and future logging/co-logging controls must follow the verified protocol notes and cleanup rules before live testing against NetLogger servers.

Relevant docs in the existing project:

- `/mnt/sparky/projects/log2go/docs/netlogger-api-reference.md`
- `/mnt/sparky/projects/log2go/mobile/docs/netlogger-aim-capture-analysis.md`

## Commands

From this directory:

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

`npm run dev` starts Vite and Electron together.

## Next implementation passes

1. Add durable desktop storage for contacts/settings/station profiles.
2. Port the full mobile Station Profiles editor into the Settings tab.
3. Add a true General Log pane with searchable local contact table.
4. Expand NetLogger Desktop parity: menus/toolbars, worked/needed markers, filters, roster status editing model.
5. Only after fresh capture/protocol design: add create-net/logger/co-logger functions.
