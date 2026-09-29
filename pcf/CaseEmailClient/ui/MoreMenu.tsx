import * as React from 'react';
import { RADIUS, T } from './tokens';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Unavailable items stay in the menu, greyed, with the reason as their tooltip. */
  disabledReason?: string;
  /** Draw a divider above this item. */
  separated?: boolean;
}

/**
 * The reading pane's "More actions" menu (2026-09-29).
 *
 * Hand-built like the Template picker rather than Fluent's `Menu`: no component here uses Fluent,
 * and the popup is absolutely positioned inside its wrapper because CSW's form containers carry
 * transforms that break fixed positioning (see RecipientRow).
 *
 * The WAI-ARIA menu-button pattern: the button says it has a popup; opening focuses the first
 * available item; ↑/↓/Home/End move; Enter or Space activates; Escape closes and returns focus to
 * the button; Tab or a click elsewhere closes. Disabled items are skipped by the arrow keys but
 * stay visible, so the agent can see an action exists and why it is unavailable.
 */
export const MoreMenu: React.FC<{ label: string; items: readonly MenuItem[] }> = ({ label, items }) => {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = items.map((it, i) => (it.disabledReason ? -1 : i)).filter((i) => i >= 0);

  const focusItem = (i: number | undefined) => { if (i !== undefined) itemRefs.current[i]?.focus(); };
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  React.useEffect(() => {
    if (open) focusItem(enabled[0]);
    // Only on opening: re-focusing on every render would steal focus from the arrow keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const at = enabled.indexOf(itemRefs.current.findIndex((el) => el === document.activeElement));
    if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(enabled[(at + 1) % enabled.length]); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(enabled[(at - 1 + enabled.length) % enabled.length]); }
    else if (e.key === 'Home') { e.preventDefault(); focusItem(enabled[0]); }
    else if (e.key === 'End') { e.preventDefault(); focusItem(enabled[enabled.length - 1]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'Tab') close(false);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: '0 0 auto' }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); }
        }}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '28px', height: '28px', padding: 0, border: 'none', borderRadius: RADIUS.md,
          background: open ? T.brandBg2 : 'transparent', color: open ? T.link : T.fg2, cursor: 'pointer',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <circle cx="10" cy="4.5" r="1.3" /><circle cx="10" cy="10" r="1.3" /><circle cx="10" cy="15.5" r="1.3" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          style={{
            position: 'absolute', right: 0, top: '32px', zIndex: 4, minWidth: '220px',
            padding: '4px 0', boxSizing: 'border-box', background: T.bg1,
            border: `1px solid ${T.stroke1}`, borderRadius: RADIUS.md,
            display: 'flex', flexDirection: 'column',
          }}
        >
          {items.map((it, i) => (
            <React.Fragment key={it.label}>
              {it.separated && <div role="separator" style={{ height: '1px', margin: '4px 0', background: T.stroke2 }} />}
              <button
                ref={(el) => { itemRefs.current[i] = el; }}
                type="button"
                role="menuitem"
                aria-disabled={it.disabledReason ? true : undefined}
                title={it.disabledReason}
                tabIndex={-1}
                onClick={() => {
                  if (it.disabledReason) return;
                  close(true);
                  it.onSelect();
                }}
                style={{
                  height: '30px', padding: '0 12px', boxSizing: 'border-box', border: 'none',
                  background: 'transparent', textAlign: 'left', font: 'inherit', fontSize: '13px',
                  color: it.disabledReason ? T.fg4 : T.fg1,
                  cursor: it.disabledReason ? 'default' : 'pointer',
                }}
                onMouseEnter={(e) => { if (!it.disabledReason) e.currentTarget.focus(); }}
                onFocus={(e) => { e.currentTarget.style.background = T.bg3; }}
                onBlur={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {it.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};
