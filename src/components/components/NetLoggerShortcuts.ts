import { useState, useEffect, useCallback, type RefObject } from 'react';
import type { NetLoggerCheckin } from '../../domain/netloggerTypes';

// ── Types ────────────────────────────────────────────────────────────

export type HighlighterMode = 'manual' | 'automatic';

export type ShortcutHandlers = {
  onSetStatus: (serialNo: number, status: string) => void;
  onClearStatus: (serialNo: number) => void;
  onToggleHighlighter: () => void;
  onFindCallsign: () => void;
  onQrzLookup: () => void;
  onNeededNext: () => void;
};

// ── Status mapping for F-keys ────────────────────────────────────────

const F_KEY_STATUSES: Record<string, string> = {
  F3: 'W',     // Manual Worked
  F4: 'n',     // Needed
  F5: 'c/o',   // Checked Out
  F6: 'n/h',   // Not Heard
  F7: 'u',     // Unavailable
  F8: 'n/r',   // Not Responding
  F10: 'nxt',  // Needed Next
};

// ── Keyboard Shortcuts Hook ──────────────────────────────────────────
// 
// F-keys operate on the currently selected roster row (the row the user
// last clicked). Ctrl+F opens find-callsign bar. Ctrl+Q does QRZ lookup
// on the selected callsign. F2 toggles station highlighter mode.

export function useKeyboardShortcuts(
  selectedSerialNo: number | null,
  handlers: ShortcutHandlers,
  enabled: boolean,
) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't intercept if typing in an input/textarea (except for F-keys)
    const target = e.target as HTMLElement;
    const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    // Ctrl+F — Find callsign
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      handlers.onFindCallsign();
      return;
    }

    // Ctrl+Q — QRZ lookup of selected callsign
    if ((e.ctrlKey || e.metaKey) && e.key === 'q') {
      e.preventDefault();
      handlers.onQrzLookup();
      return;
    }

    // F-keys for status setting
    if (e.key === 'F2') {
      e.preventDefault();
      handlers.onToggleHighlighter();
      return;
    }

    if (isTyping) return; // Don't process F3-F10 while typing in fields

    if (e.key === 'F9') {
      e.preventDefault();
      if (selectedSerialNo !== null) handlers.onClearStatus(selectedSerialNo);
      return;
    }

    const status = F_KEY_STATUSES[e.key];
    if (status && selectedSerialNo !== null) {
      e.preventDefault();
      handlers.onSetStatus(selectedSerialNo, status);
    }
  }, [selectedSerialNo, handlers, enabled]);

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, enabled]);
}

// ── Station Highlighter Hook ─────────────────────────────────────────

export function useStationHighlighter(
  initialMode: HighlighterMode,
  checkins: NetLoggerCheckin[],
) {
  const [highlighterMode, setHighlighterMode] = useState<'manual' | 'automatic'>(initialMode);
  const [highlightedSerial, setHighlightedSerial] = useState<number | null>(null);

  const toggleMode = useCallback(() => {
    setHighlighterMode((prev) => prev === 'manual' ? 'automatic' : 'manual');
  }, []);

  // In automatic mode, the highlight follows the selected row
  const onRowClick = useCallback((serialNo: number, mode: HighlighterMode) => {
    if (mode === 'automatic') {
      setHighlightedSerial(serialNo);
    }
  }, []);

  // In manual mode, only clicking the row header moves the highlight
  const onRowHeaderClick = useCallback((serialNo: number) => {
    setHighlightedSerial(serialNo);
  }, []);

  // Find the Needed Next station and scroll to it
  const findNeededNext = useCallback((rosterRef: RefObject<HTMLTableElement | null>) => {
    const nxtCheckin = checkins.find((c) => c.status.includes('nxt'));
    if (nxtCheckin) {
      setHighlightedSerial(nxtCheckin.serialNo);
      // Scroll to it
      if (rosterRef.current) {
        const row = rosterRef.current.querySelector(`tr[data-serial="${nxtCheckin.serialNo}"]`);
        if (row) {
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      return true;
    }
    return false;
  }, [checkins]);

  return {
    highlighterMode,
    highlightedSerial,
    toggleMode,
    onRowClick,
    onRowHeaderClick,
    findNeededNext,
    setHighlightedSerial,
  };
}

// ── Slash code parser for check-in entry ─────────────────────────────

const SLASH_CODES: Record<string, { field: string; value: string; keepInCallsign?: boolean }> = {
  '/M': { field: 'mp', value: 'M' },
  '/P': { field: 'mp', value: 'P' },
  '/C': { field: 'award', value: 'CMB' },
  '/Q': { field: 'award', value: 'QRP' },
  '/S': { field: 'award', value: 'SC' },
  '/T': { field: 'award', value: 'TRK' },
  '/Y': { field: 'award', value: 'YL' },
  '/QRP': { field: 'award', value: 'QRP', keepInCallsign: true },
};

export type ParsedSlashCode = {
  cleanCallsign: string;
  codes: { field: string; value: string }[];
};

export function parseSlashCodes(input: string): ParsedSlashCode {
  const codes: { field: string; value: string }[] = [];
  let cleanCallsign = input.trim();

  // Sort by length descending so /QRP matches before /Q
  const sortedCodes = Object.entries(SLASH_CODES).sort((a, b) => b[0].length - a[0].length);

  for (const [code, config] of sortedCodes) {
    const regex = new RegExp(escapeRegex(code) + '$', 'i');
    while (regex.test(cleanCallsign)) {
      if (!config.keepInCallsign) {
        cleanCallsign = cleanCallsign.replace(regex, '').trim();
      }
      codes.push({ field: config.field, value: config.value });
    }
  }

  return { cleanCallsign, codes };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}