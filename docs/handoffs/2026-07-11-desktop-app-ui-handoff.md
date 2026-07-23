# Log2Go Desktop UI handoff — 2026-07-11 22:32 UTC

## Current state

Repository:

```text
/mnt/sparky/projects/log2go/desktop
branch: master
status at handoff: clean
```

Latest commits, newest first:

```text
ae80eb6 feat: add desktop roster density controls
e22a10c docs: add desktop UI handoff note
469e1eb style: make desktop roster glassy
4c7a3f2 style: add futuristic desktop background
cd8f6d5 feat: tab desktop net side panes
14575f2 feat: improve desktop roster row selection
0d664b3 style: soften desktop roster table background
fbe8901 feat: proxy NetLogger reads for desktop preview
c475c22 feat: add desktop settings and general log skeleton
61f1c4a feat: shape desktop NetLogger console
```

## Preview

Active preview process when this note was written:

```text
session_id: proc_68d3070e6565
command: npm run preview:web
cwd: /mnt/sparky/projects/log2go/desktop
URL: http://192.168.30.131:54337/
```

If the process is gone after restarting/closing terminals, restart it with:

```bash
cd '/mnt/sparky/projects/log2go/desktop'
npm run build
npm run preview:web
```

The preview uses `scripts/preview-with-proxy.mjs` so the browser renderer can read NetLogger public XML through the same-origin `/netlogger-api/...` proxy. This avoids browser CORS/fetch failures.

## What Jody approved visually

- NetLogger-style desktop console layout is the active direction.
- Futuristic black/blue gaming background from:

```text
/mnt/sparky/projects/log2go/Images/futuristic-black-blue-gaming-background/blue_esport_background_06.jpg
```

- Copied app asset:

```text
src/assets/blue-esport-background.jpg
```

- Panels are translucent dark blue/black with cyan borders so the graphic shows through.
- Roster table was changed from off-white to a transparent/glassy table.
- Jody said: "I like it! We can work with that."

## Current roster styling behavior

The roster now uses:

- transparent table background,
- dark translucent row overlays,
- subtle alternating row opacity,
- white text with a small dark text shadow,
- bright white callsigns,
- semi-opaque light header for readability,
- cyan hover highlight,
- cyan selected-row highlight,
- translucent red unavailable/checked-out rows,
- bright green worked marker.

Browser visual check after selecting the `3916 Nets` active net showed the graphic visible through the roster and the loaded 7-row roster remained readable.

## Current feature state

Implemented and verified:

1. NetLogger-style desktop skeleton.
2. Settings / Accounts skeleton with no real password fields.
3. General Log skeleton.
4. Browser preview NetLogger same-origin proxy.
5. Active nets and roster/AIM/monitors loading from NetLogger public XML.
6. Roster row click loads the contact draft.
7. AIM and Monitors are tabs in one shared panel.
8. Roster, contact draft, and AIM/Monitors panels are resizable.
9. Futuristic black/blue app background.
10. Transparent/glassy roster table.
11. Roster density controls above the table: Normal, Compact, Extra compact.

Latest verification before handoff:

```text
npm test: 14/14 passed
npm run build: passed
browser preview: http://127.0.0.1:54337/ rendered successfully
NetLogger proxy smoke: /netlogger-api/GetActiveNets.php returned live XML ResponseCode 200 OK
Live UI smoke: selected "the N0SWR net" read-only; roster loaded 8 check-ins and 10 monitors; Extra compact density toggled table class to roster-density-extra-compact
```

Recent full verification earlier in this session:

```text
npm run typecheck: passed
npm test: 13/13 passed
npm run build: passed
```

## Important constraints to preserve

- Do not implement guessed NetLogger write paths.
- Do not touch Jody's existing NetLogger identity `KE5ZQV-JODYPC`.
- NetLogger write operations must stay behind the known backend proxy path unless Jody explicitly reopens that work.
- No real online-service password fields until secure desktop credential handling exists:
  - Electron preload/IPC bridge,
  - OS-backed secret storage,
  - tests around credential handling.
- Browser/local persistence is acceptable only for non-secret early app state.

## Good next steps

Recommended next visual/UX slices:

1. Tune glassy roster readability after Jody reviews it live.
   - If too busy, add a little more row opacity.
   - If it looks good, keep it and move on.
2. Add NetLogger refresh controls:
   - Manual refresh remains.
   - Add conservative auto-refresh toggle and countdown.
   - Avoid hammering NetLogger.
3. Improve contact draft panel:
   - selected station summary,
   - clear/reset button,
   - more desktop-like field grouping,
   - clearer Log Contact action.
4. Start secure credential-storage architecture before real LoTW/QRZ/eQSL credentials.
5. Package a real Electron preview after the renderer workflow settles.

## Hermes restore command

From a shell on this machine, continue in the same area with:

```bash
cd '/mnt/sparky/projects/log2go/desktop'
hermes chat --tui --continue
```

Then ask Sparky to read this handoff note:

```text
/mnt/sparky/projects/log2go/desktop/docs/handoffs/2026-07-11-desktop-app-ui-handoff.md
```
