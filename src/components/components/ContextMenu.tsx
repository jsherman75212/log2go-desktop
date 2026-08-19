import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';

// ── Types ───────────────────────────────────────────────────────────

export type MenuItem =
  | { type: 'item'; label: string; onClick: () => void; danger?: boolean; checked?: boolean; disabled?: boolean }
  | { type: 'separator' }
  | { type: 'submenu'; label: string; children: MenuItem[]; disabled?: boolean };

export type MenuPosition = { x: number; y: number };

// ── Context Menu Component ──────────────────────────────────────────

type ContextMenuProps = {
  items: MenuItem[];
  position: MenuPosition;
  onClose: () => void;
};

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState(position);
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);
  const [submenuPos, setSubmenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Adjust position to keep menu within viewport
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      let x = position.x;
      let y = position.y;
      if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 4;
      if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 4;
      if (x < 0) x = 4;
      if (y < 0) y = 4;
      setAdjustedPos({ x, y });
    }
  }, [position]);

  // Click-outside and escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmenuHover = useCallback((index: number, el: HTMLElement | null) => {
    if (!el) { setOpenSubmenu(null); return; }
    const rect = el.getBoundingClientRect();
    setSubmenuPos({ x: rect.right - 2, y: rect.top });
    setOpenSubmenu(index);
  }, []);

  return (
    <div
      className="context-menu-backdrop"
      onClick={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }}
    >
      <div
        ref={menuRef}
        className="context-menu"
        style={{ left: adjustedPos.x, top: adjustedPos.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((item, i) => {
          if (item.type === 'separator') {
            return <div key={i} className="context-menu-separator" />;
          }
          if (item.type === 'submenu') {
            return (
              <div
                key={i}
                className="context-menu-item context-menu-submenu-trigger"
                onMouseEnter={(e) => { if (!item.disabled) handleSubmenuHover(i, e.currentTarget); }}
                onMouseLeave={() => { if (openSubmenu === i) setOpenSubmenu(null); }}
                ref={item.disabled ? undefined : undefined}
              >
                <span className="context-menu-label">{item.label}</span>
                <span className="context-menu-arrow">▶</span>
                {openSubmenu === i && !item.disabled && (
                  <div className="context-menu context-submenu" style={{ left: submenuPos.x, top: submenuPos.y }}>
                    {item.children.map((child, j) => {
                      if (child.type === 'separator') {
                        return <div key={j} className="context-menu-separator" />;
                      }
                      if (child.type === 'submenu') {
                        // Nested submenus not supported (NetLogger doesn't use them)
                        return null;
                      }
                      return (
                        <button
                          key={j}
                          className={`context-menu-item ${child.danger ? 'context-menu-item-danger' : ''}`}
                          disabled={child.disabled}
                          onClick={() => { child.onClick(); onClose(); }}
                        >
                          {child.checked && <span className="context-menu-check">✓</span>}
                          <span className="context-menu-label">{child.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }
          return (
            <button
              key={i}
              className={`context-menu-item ${item.danger ? 'context-menu-item-danger' : ''}`}
              disabled={item.disabled}
              onClick={() => { item.onClick(); onClose(); }}
            >
              {item.checked && <span className="context-menu-check">✓</span>}
              <span className="context-menu-label">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Hook for building roster context menu items ──────────────────────

export type RosterMenuContext = {
  callsign: string;
  serialNo: number;
  currentStatus: string;
  isNcs: boolean;
  isLogger: boolean;
  netType: 'log2go' | 'netlogger';
  onSetStatus: (callsign: string, serialNo: number, status: string) => void;
  onClearStatus: (callsign: string, serialNo: number) => void;
  onSetMobilePortable: (callsign: string, serialNo: number, mp: string) => void;
  onClearRow: (callsign: string, serialNo: number) => void;
  onDeleteRow: (callsign: string, serialNo: number) => void;
  onInsertRow: (callsign: string, serialNo: number) => void;
  onQrzLookup: (callsign: string) => void;
  onAddToRoster: (callsign: string) => void;
  onRemoveFromRoster: (callsign: string, serialNo: number) => void;
  onPromote: (callsign: string, role: string) => void;
};

// ── Status helpers ──────────────────────────────────────────────────

const AVAILABILITY_STATUSES: { code: string; label: string; fKey: string }[] = [
  { code: 'c/o', label: 'Checked Out (c/o)', fKey: 'F5' },
  { code: 'n/r', label: 'Not Responding (n/r)', fKey: 'F8' },
  { code: 'u', label: 'Unavailable (u)', fKey: 'F7' },
];

const LOCAL_STATUSES: { code: string; label: string; fKey: string }[] = [
  { code: 'n/h', label: 'Not Heard (n/h)', fKey: 'F6' },
  { code: 'W', label: 'Manual Worked (W)', fKey: 'F3' },
  { code: 'n', label: 'Needed (n)', fKey: 'F4' },
  { code: 'nxt', label: 'Needed Next (nxt)', fKey: 'F10' },
];

const NET_OFFICIAL_STATUSES: { code: string; label: string }[] = [
  { code: 'nc', label: 'Net Control (nc)' },
  { code: 'log', label: 'Logger (log)' },
  { code: 'rel', label: 'Relay (rel)' },
  { code: 'vip', label: 'VIP (vip)' },
];

const CLUB_AWARDS: { code: string; label: string }[] = [
  { code: 'QRP', label: 'QRP' },
  { code: 'TRK', label: 'Trucker (TRK)' },
  { code: 'MIL', label: 'Military (MIL)' },
  { code: 'MIL:A', label: 'Army (MIL:A)' },
  { code: 'MIL:N', label: 'Navy (MIL:N)' },
  { code: 'MIL:M', label: 'Marines (MIL:M)' },
  { code: 'MIL:AF', label: 'Air Force (MIL:AF)' },
  { code: 'MIL:CG', label: 'Coast Guard (MIL:CG)' },
  { code: 'CMB', label: 'Combo (CMB)' },
  { code: 'YL', label: 'YL' },
  { code: 'CLG', label: 'Clergy (CLG)' },
  { code: 'SC', label: 'State Capitol (SC)' },
  { code: 'FR', label: 'First Responder (FR)' },
  { code: 'FR:DIS', label: 'Dispatcher (FR:DIS)' },
  { code: 'FR:EP', label: 'EMT/Paramedic (FR:EP)' },
  { code: 'FR:FF', label: 'Firefighter (FR:FF)' },
  { code: 'FR:POL', label: 'Police (FR:POL)' },
  { code: 'SHIP', label: 'Museum Ship (SHIP)' },
];

export function buildRosterMenu(ctx: RosterMenuContext): MenuItem[] {
  const items: MenuItem[] = [];
  const canManage = (ctx.isNcs || ctx.isLogger) && ctx.netType === 'log2go';

  // Availability Status submenu
  items.push({
    type: 'submenu',
    label: 'Availability Status',
    disabled: !canManage,
    children: AVAILABILITY_STATUSES.map((s) => ({
      type: 'item' as const,
      label: `${s.label}${ctx.currentStatus.includes(s.code) ? '  ✓' : ''}`,
      onClick: () => ctx.onSetStatus(ctx.callsign, ctx.serialNo, s.code),
      disabled: !canManage,
    })),
  });

  // Local Status submenu (visible to all, local-only)
  items.push({
    type: 'submenu',
    label: 'Local Status',
    children: LOCAL_STATUSES.map((s) => ({
      type: 'item' as const,
      label: `${s.label}${ctx.currentStatus.includes(s.code) ? '  ✓' : ''}`,
      onClick: () => ctx.onSetStatus(ctx.callsign, ctx.serialNo, s.code),
    })),
  });

  // Clear all status
  items.push({
    type: 'item',
    label: 'Clear All Status (F9)',
    onClick: () => ctx.onClearStatus(ctx.callsign, ctx.serialNo),
  });

  // Separator
  items.push({ type: 'separator' });

  // Net Official Status submenu (NCS/Logger only)
  items.push({
    type: 'submenu',
    label: 'Net Official Status',
    disabled: !canManage,
    children: NET_OFFICIAL_STATUSES.map((s) => ({
      type: 'item' as const,
      label: `${s.label}${ctx.currentStatus.includes(s.code) ? '  ✓' : ''}`,
      onClick: () => ctx.onSetStatus(ctx.callsign, ctx.serialNo, s.code),
      disabled: !canManage,
    })),
  });

  // Club Award Status submenu (NCS/Logger only)
  items.push({
    type: 'submenu',
    label: 'Club Award Status',
    disabled: !canManage,
    children: CLUB_AWARDS.map((a) => ({
      type: 'item' as const,
      label: `${a.label}${ctx.currentStatus.includes(a.code) ? '  ✓' : ''}`,
      onClick: () => ctx.onSetStatus(ctx.callsign, ctx.serialNo, a.code),
      disabled: !canManage,
    })),
  });

  // Mobile/Portable submenu
  items.push({
    type: 'submenu',
    label: 'Mobile/Portable',
    disabled: !canManage,
    children: [
      { type: 'item' as const, label: 'Mobile (M)', onClick: () => ctx.onSetMobilePortable(ctx.callsign, ctx.serialNo, 'M') },
      { type: 'item' as const, label: 'Portable (P)', onClick: () => ctx.onSetMobilePortable(ctx.callsign, ctx.serialNo, 'P') },
      { type: 'item' as const, label: 'Clear M/P', onClick: () => ctx.onSetMobilePortable(ctx.callsign, ctx.serialNo, '') },
    ],
  });

  // Separator
  items.push({ type: 'separator' });

  // Check-in modification actions (Logger only, Log2Go nets)
  if (canManage) {
    items.push({ type: 'item', label: 'Clear Row', onClick: () => ctx.onClearRow(ctx.callsign, ctx.serialNo) });
    items.push({ type: 'item', label: 'Delete Row', danger: true, onClick: () => ctx.onDeleteRow(ctx.callsign, ctx.serialNo) });
    items.push({ type: 'item', label: 'Insert Row Above', onClick: () => ctx.onInsertRow(ctx.callsign, ctx.serialNo) });
    items.push({ type: 'separator' });
  }

  // QRZ Lookup
  items.push({
    type: 'item',
    label: `QRZ Lookup: ${ctx.callsign}`,
    onClick: () => ctx.onQrzLookup(ctx.callsign),
  });

  // Add/Remove from roster (context menu may be on monitors too)
  if (ctx.isLogger && ctx.netType === 'log2go') {
    items.push({
      type: 'item',
      label: `Add ${ctx.callsign} to roster`,
      onClick: () => ctx.onAddToRoster(ctx.callsign),
    });
  }
  if (canManage && ctx.serialNo !== undefined) {
    items.push({
      type: 'item',
      label: `Remove ${ctx.callsign} from roster`,
      danger: true,
      onClick: () => ctx.onRemoveFromRoster(ctx.callsign, ctx.serialNo),
    });
  }

  // Separator before promote/demote
  if (ctx.isNcs && ctx.netType === 'log2go') {
    items.push({ type: 'separator' });
    items.push({ type: 'item', label: `Promote ${ctx.callsign} to NCS`, onClick: () => ctx.onPromote(ctx.callsign, 'NCS') });
    items.push({ type: 'item', label: `Promote ${ctx.callsign} to Co-NCS`, onClick: () => ctx.onPromote(ctx.callsign, 'CO_NCS') });
    items.push({ type: 'item', label: `Promote ${ctx.callsign} to Logger`, onClick: () => ctx.onPromote(ctx.callsign, 'LOGGER') });
    items.push({ type: 'item', label: `Promote ${ctx.callsign} to Relay`, onClick: () => ctx.onPromote(ctx.callsign, 'RELAY') });
    items.push({ type: 'item', label: `Demote ${ctx.callsign} to Monitor`, onClick: () => ctx.onPromote(ctx.callsign, 'MONITOR') });
  }

  return items;
}

// ── Monitor/AIM context menu builder ────────────────────────────────

export type MonitorMenuContext = {
  callsign: string;
  isNcs: boolean;
  isLogger: boolean;
  netType: 'log2go' | 'netlogger';
  isIgnored: boolean;
  onPromote: (callsign: string, role: string) => void;
  onToggleIgnore: (callsign: string) => void;
  onGroupIgnore: (callsign: string) => void;
};

export function buildMonitorMenu(ctx: MonitorMenuContext): MenuItem[] {
  const items: MenuItem[] = [];

  if (ctx.isNcs && ctx.netType === 'log2go') {
    items.push({ type: 'item', label: `Promote ${ctx.callsign} to NCS`, onClick: () => ctx.onPromote(ctx.callsign, 'NCS') });
    items.push({ type: 'item', label: `Promote ${ctx.callsign} to Co-NCS`, onClick: () => ctx.onPromote(ctx.callsign, 'CO_NCS') });
    items.push({ type: 'item', label: `Promote ${ctx.callsign} to Logger`, onClick: () => ctx.onPromote(ctx.callsign, 'LOGGER') });
    items.push({ type: 'item', label: `Promote ${ctx.callsign} to Relay`, onClick: () => ctx.onPromote(ctx.callsign, 'RELAY') });
    items.push({ type: 'item', label: `Demote ${ctx.callsign} to Monitor`, onClick: () => ctx.onPromote(ctx.callsign, 'MONITOR') });
    items.push({ type: 'separator' });
  }

  // AIM Ignore
  items.push({
    type: 'item',
    label: ctx.isIgnored ? `Unignore ${ctx.callsign} (AIM)` : `Ignore ${ctx.callsign} (AIM)`,
    onClick: () => ctx.onToggleIgnore(ctx.callsign),
  });

  // Group Ignore (NCS/Logger only)
  if ((ctx.isNcs || ctx.isLogger) && ctx.netType === 'log2go') {
    items.push({
      type: 'item',
      label: `Group Ignore ${ctx.callsign} (All)`,
      danger: true,
      onClick: () => ctx.onGroupIgnore(ctx.callsign),
    });
  }

  return items;
}