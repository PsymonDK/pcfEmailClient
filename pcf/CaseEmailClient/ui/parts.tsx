import * as React from 'react';
import { avatarFill, initials, RADIUS, T } from './tokens';

/**
 * The small shared pieces, lifted from the real Case form's vocabulary so the client reads as part
 * of Dynamics rather than as an add-on. Each one maps to a row in
 * docs/design/02-component-inventory.md.
 */

/** 32px (or 24px) circular two-letter avatar — the form's `Ca` avatar. */
export const Avatar: React.FC<{ name: string; size?: 24 | 28 | 32 }> = ({ name, size = 32 }) => {
  const fill = avatarFill(name);
  return (
    <div
      aria-hidden="true"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        flex: `0 0 ${size}px`,
        borderRadius: RADIUS.pill,
        background: fill.bg,
        color: fill.fg,
        fontSize: size >= 32 ? '12px' : '10px',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {initials(name)}
    </div>
  );
};

/**
 * Unread is signalled THREE ways at once — a dot, bold weight, and an edge bar.
 *
 * Never colour alone: that fails WCGA 2.1 for anyone who cannot distinguish it, and it fails a
 * greyscale print too (N6). This component is just the dot; the weight and the bar are applied by
 * the row that owns the layout.
 */
export const UnreadDot: React.FC<{ size?: 6 | 8 }> = ({ size = 8 }) => (
  <div
    role="img"
    aria-label="Unread"
    style={{
      width: `${size}px`,
      height: `${size}px`,
      flex: `0 0 ${size}px`,
      borderRadius: RADIUS.pill,
      background: T.brandBg,
    }}
  />
);

/** The direction indicator: colour AND shape, for the same reason. */
export const DirectionIcon: React.FC<{ outgoing: boolean }> = ({ outgoing }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 20 20"
    fill="none"
    stroke={outgoing ? T.outgoing : T.incoming}
    strokeWidth="1.6"
    style={{ flex: '0 0 14px' }}
    role="img"
    aria-label={outgoing ? 'Sent' : 'Received'}
  >
    {outgoing ? <path d="M16 10H4M16 10l-4-4M16 10l-4 4" /> : <path d="M4 10h12M4 10l4-4M4 10l4 4" />}
  </svg>
);

/** The `Active` / `Received` / `Queued` badge, straight from the form's `Email from:` idiom. */
export const StatusBadge: React.FC<{ label: string; tone?: 'neutral' | 'warn' | 'ok' | 'danger' }> = ({
  label,
  tone = 'neutral',
}) => {
  const tones = {
    neutral: { bg: T.stroke3, fg: T.fg2, border: 'transparent' },
    warn: { bg: T.warnBg, fg: T.warnFg, border: T.warnStroke },
    ok: { bg: T.okBg, fg: T.okFg, border: 'transparent' },
    danger: { bg: T.dangerBg, fg: T.dangerFg, border: T.dangerStroke },
  }[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: '18px',
        padding: '0 6px',
        borderRadius: RADIUS.md,
        background: tones.bg,
        color: tones.fg,
        border: `1px solid ${tones.border}`,
        fontSize: '11px',
        flex: '0 0 auto',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
};

export const AttachmentIcon: React.FC<{ colour?: string }> = ({ colour = T.fg3 }) => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke={colour} strokeWidth="1.4" style={{ flex: '0 0 14px' }} aria-hidden="true">
    <path d="M13 7.5 8 12.5a2.1 2.1 0 0 0 3 3l5.5-5.5a4 4 0 0 0-5.7-5.7L5.2 9.8a6 6 0 0 0 8.5 8.5" />
  </svg>
);

export const Chevron: React.FC<{ direction: 'up' | 'down'; colour?: string }> = ({
  direction,
  colour = T.fg1,
}) => (
  <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke={colour} strokeWidth="1.8" style={{ flex: '0 0 12px' }} aria-hidden="true">
    <path d={direction === 'up' ? 'M5 12l5-5 5 5' : 'M5 8l5 5 5-5'} />
  </svg>
);

/**
 * The `Recent ────` group header, with its trailing rule. Lifted verbatim from the Timeline,
 * because reusing the platform's own grouping idiom is most of what makes this feel native.
 */
export const GroupHeader: React.FC<{
  label: string;
  count?: number;
  note?: string;
  tone?: 'neutral' | 'warn';
}> = ({ label, count, note, tone = 'neutral' }) => {
  const warn = tone === 'warn';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        height: '28px',
        flex: '0 0 28px',
        padding: '0 12px',
        boxSizing: 'border-box',
        background: warn ? T.bg2 : 'transparent',
      }}
    >
      {/*
        No chevron here, deliberately.

        There used to be one, and it did nothing — not a sort control, not a collapse, no click
        handler at all. It read as an affordance and had none, which is worse than plain text: the
        first person to look at this list asked what it was for. If collapsing a group is wanted
        later, make the whole header a real button; do not put back a decorative arrow.
      */}
      <span style={{ fontSize: '14px', color: warn ? T.warnFg : T.fg1, fontWeight: warn ? 600 : 400 }}>
        {label}
      </span>
      {note && <span style={{ fontSize: '12px', color: warn ? T.warnFg : T.fg3 }}>{note}</span>}
      <div style={{ flexGrow: 1, height: '1px', background: warn ? T.warnStroke : T.stroke2 }} />
      {count !== undefined && <span style={{ fontSize: '11px', color: T.fg3 }}>{count}</span>}
    </div>
  );
};

/** The card container: white, hairline border, 6px radius, no elevation. */
export const Card: React.FC<{
  children: React.ReactNode;
  width?: string;
  grow?: boolean;
}> = ({ children, width, grow }) => (
  <div
    style={{
      width,
      flex: grow ? '1 1 auto' : width ? `0 0 ${width}` : undefined,
      minWidth: 0,
      background: T.bg1,
      border: `1px solid ${T.stroke2}`,
      borderRadius: RADIUS.lg,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}
  >
    {children}
  </div>
);

/** Card header: title left, icon row right. Fixed 44px — nothing above the scroll region grows. */
export const CardHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      height: '44px',
      flex: '0 0 44px',
      padding: '0 12px',
      boxSizing: 'border-box',
      minWidth: 0,
    }}
  >
    {children}
  </div>
);

/** An icon-only toolbar button. Always carries a real accessible name — never "button button". */
export const IconButton: React.FC<{
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  active?: boolean;
  /** Renders greyed and inert. Used for controls whose feature is not built yet: a button that
   * looks live and does nothing teaches agents the client is broken. */
  disabled?: boolean;
}> = ({ label, onClick, children, active, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    aria-pressed={active}
    disabled={disabled}
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '28px',
      height: '28px',
      flex: '0 0 28px',
      padding: 0,
      border: 'none',
      borderRadius: RADIUS.md,
      background: active ? T.brandBg2 : 'transparent',
      cursor: disabled ? 'default' : 'pointer',
      color: disabled ? T.fg4 : (active ? T.link : T.fg2),
      opacity: disabled ? 0.5 : 1,
    }}
  >
    {children}
  </button>
);

/** A skeleton line, used by the loading state. */
export const Shimmer: React.FC<{ width: string; height?: number }> = ({ width, height = 10 }) => (
  <div style={{ width, height: `${height}px`, background: T.stroke3, borderRadius: RADIUS.sm }} />
);

/**
 * Contains a render failure to the part that failed (L11).
 *
 * Without one, an exception anywhere — the sanitiser on a pathological body, a summary built from
 * an unexpected row — unmounted the whole control and left the agent looking at an empty tab.
 * React 16 supports this; it has to be a class.
 */
export class ErrorBoundary extends React.Component<
  { label: string; children?: React.ReactNode },
  { failed: boolean }
> {
  public state = { failed: false };

  public static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  public componentDidCatch(error: unknown): void {
    console.error(`${this.props.label} failed to render.`, error);
  }

  public render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" style={{ padding: '12px', fontSize: '13px', color: T.dangerFg }}>
        {this.props.label} could not be shown.{' '}
        <button
          type="button"
          onClick={() => this.setState({ failed: false })}
          style={{ border: 'none', background: 'transparent', padding: 0, font: 'inherit', color: T.link, cursor: 'pointer' }}
        >
          Try again
        </button>
      </div>
    );
  }
}

/**
 * A load that failed, said plainly, with a retry and the raw platform text one click away.
 * One component (R5) for the list and the reading pane, which had a copy each.
 */
export const ErrorPanel: React.FC<{
  error: { headline: string; reassurance?: string; detail: string };
  onRetry: () => void;
  /** The list and the pane sit it at slightly different insets. */
  margin: string;
}> = ({ error, onRetry, margin }) => {
  const [showDetail, setShowDetail] = React.useState(false);
  return (
    <div
      role="alert"
      style={{
        margin, padding: '10px', boxSizing: 'border-box', background: T.dangerBg,
        border: `1px solid ${T.dangerStroke}`, borderRadius: RADIUS.md,
        display: 'flex', flexDirection: 'column', gap: '6px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke={T.dangerFg} strokeWidth="1.5" style={{ flex: '0 0 15px' }} aria-hidden="true">
          <circle cx="10" cy="10" r="7.2" /><path d="M10 6.3v4.6M10 13.2v.4" />
        </svg>
        <span style={{ fontSize: '13px', fontWeight: 600, color: T.dangerFg }}>{error.headline}</span>
      </div>
      {/* The agent's first question, answered before they ask it. */}
      {error.reassurance && <span style={{ fontSize: '12px', color: T.fg2 }}>{error.reassurance}</span>}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          type="button"
          onClick={onRetry}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px', height: '26px', padding: '0 10px',
            boxSizing: 'border-box', borderRadius: RADIUS.md, background: T.bg1,
            border: `1px solid ${T.stroke1}`, font: 'inherit', fontSize: '12px', cursor: 'pointer',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke={T.fg1} strokeWidth="1.6" aria-hidden="true">
            <path d="M16 10a6 6 0 1 1-2.2-4.6" /><path d="M16.2 3.6v3h-3" />
          </svg>
          Try again
        </button>
        <button
          type="button"
          onClick={() => setShowDetail((v) => !v)}
          style={{ border: 'none', background: 'transparent', font: 'inherit', fontSize: '12px', color: T.link, cursor: 'pointer' }}
        >
          {showDetail ? 'Hide details' : 'Details'}
        </button>
      </div>
      {/* Raw platform text lives here, never in the headline. */}
      {showDetail && (
        <code style={{ fontFamily: T.mono, fontSize: '11px', color: T.fg2, wordBreak: 'break-all' }}>
          {error.detail}
        </code>
      )}
    </div>
  );
};
