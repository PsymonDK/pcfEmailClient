import * as React from 'react';
import { prepareBody } from '../domain/bodyPipeline';
import { BODY_SURFACE, BODY_SURFACE_FG, BODY_SURFACE_FG_MUTED, RADIUS, T } from './tokens';

/**
 * Renders one message body. The highest-risk component in the inventory, for two reasons.
 *
 * **Security.** The HTML was written by someone outside the organisation and lands in a page
 * holding the agent's authenticated Dynamics session. Measured 2026-09-11 (S12): Dataverse stores
 * it verbatim — 17 of 17 hostile probes survived a round-trip byte-identical — so sanitising is
 * entirely ours to do. Nothing reaches `dangerouslySetInnerHTML` here without passing through
 * `prepareBody` (domain/bodyPipeline.ts), whose order is fixed:
 *
 *     sanitise  →  split quoted history  →  strip injected notices  →  re-sanitise each piece
 *
 * **Containment.** Sanitising stops script. It does nothing about a 1400px-wide Outlook table, a
 * 96px heading, or a sender who sets white text — so the container resets typography, caps widths,
 * and gives wide content its own horizontal scroll. The app layout must never move because of
 * something a sender wrote.
 */

export interface BodyFrameProps {
  /** Raw `email.description`, exactly as stored. */
  rawHtml: string;
  /** Content-ID → data URL for inline images, once fetched. */
  inlineImages?: ReadonlyMap<string, string>;
  /** Collapsed by default per Gate 2; the fold state is the caller's to remember. */
  quoteExpanded: boolean;
  noticesExpanded: boolean;
  onToggleQuote: () => void;
  onToggleNotices: () => void;
}

export const BodyFrame: React.FC<BodyFrameProps> = (props) => {
  const { rawHtml, inlineImages, quoteExpanded, noticesExpanded, onToggleQuote, onToggleNotices } = props;

  // M4 — remote pictures wait for the agent. Per message and not persisted: it is a decision
  // about this sender, this time, and the next message deserves the same default.
  const [showPictures, setShowPictures] = React.useState(false);

  // Re-running the pipeline on every render would re-parse the whole body; memoise on the input.
  const prepared = React.useMemo(
    () => prepareBody(rawHtml, { allowRemoteImages: showPictures, inlineImages }),
    [rawHtml, showPictures, inlineImages],
  );
  const foldable = prepared.notices.filter((n) => n.foldable);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>

      {prepared.blockedImages > 0 && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', maxWidth: '820px', minHeight: '28px',
            padding: '0 10px', boxSizing: 'border-box', background: T.bg3, borderRadius: RADIUS.md,
            fontSize: '12px', color: T.fg2,
          }}
        >
          <span>
            {prepared.blockedImages === 1 ? '1 picture' : `${prepared.blockedImages} pictures`} from
            the internet {prepared.blockedImages === 1 ? 'was' : 'were'} not loaded, so the sender
            cannot see when this was opened.
          </span>
          <span style={{ flexGrow: 1 }} />
          <button
            type="button"
            onClick={() => setShowPictures(true)}
            style={{
              border: 'none', background: 'transparent', padding: 0, cursor: 'pointer',
              font: 'inherit', fontSize: '12px', color: T.link,
            }}
          >
            Show pictures
          </button>
        </div>
      )}

      {/* R21 — injected notices, folded behind the platform's own View more idiom */}
      {foldable.length > 0 && (
        <div>
          <Fold
            tone="warn"
            // Says what the fold holds, not who added it: a sender can write text that looks like a
            // security banner, and this label must not vouch for it (L10).
            label={`${foldable.length} ${foldable.length === 1 ? 'notice' : 'notices'} folded — security banners and mail tips`}
            expanded={noticesExpanded}
            onToggle={onToggleNotices}
          />
          {noticesExpanded && (
            <div
              style={{
                border: `1px solid ${T.warnStroke}`,
                borderTop: 'none',
                borderRadius: `0 0 ${RADIUS.md} ${RADIUS.md}`,
                padding: '8px 10px',
                background: T.warnBg2,
              }}
            >
              {foldable.map((notice, i) => (
                <div key={`${notice.kind}-${i}`}>
                  {i > 0 && <div style={{ height: '1px', background: T.warnStroke, margin: '6px 0' }} />}
                  <Contained html={notice.html} muted />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* The sender's actual words — now the first thing read */}
      <Contained html={prepared.newHtml} />

      {/* R4 — quoted history, same idiom */}
      {prepared.quotedHtml.length > 0 && (
        <div>
          <Fold
            tone="neutral"
            label={`Trimmed content — ${prepared.quoteDepthLabel}`}
            expanded={quoteExpanded}
            onToggle={onToggleQuote}
          />
          {quoteExpanded && (
            <div
              style={{
                border: `1px solid ${T.stroke2}`,
                borderTop: 'none',
                borderRadius: `0 0 ${RADIUS.md} ${RADIUS.md}`,
                padding: '8px 10px',
              }}
            >
              {/* Rendered exactly as received. Never re-serialised — that is what makes R12
                  provable, and it is why this is the same Contained renderer with no rewriting. */}
              <Contained html={prepared.quotedHtml} muted />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** The platform's `View more ⌄` expander, which is what makes R4 and R21 feel like Dynamics. */
const Fold: React.FC<{
  label: string;
  expanded: boolean;
  tone: 'warn' | 'neutral';
  onToggle: () => void;
}> = ({ label, expanded, tone, onToggle }) => {
  const warn = tone === 'warn';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        maxWidth: '820px',
        height: '28px',
        padding: '0 10px',
        boxSizing: 'border-box',
        background: warn ? T.warnBg : T.bg3,
        border: warn ? `1px solid ${T.warnStroke}` : 'none',
        borderRadius: expanded ? `${RADIUS.md} ${RADIUS.md} 0 0` : RADIUS.md,
        color: warn ? T.warnFg : T.fg2,
        font: 'inherit',
        fontSize: '12px',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      {warn ? <WarnIcon /> : <TrimIcon />}
      <span>{label}</span>
      <span style={{ flexGrow: 1 }} />
      <span style={{ color: warn ? T.warnFg : T.fg1 }}>{expanded ? 'View less' : 'View more'}</span>
      <Chevron up={expanded} colour={warn ? T.warnFg : T.fg2} />
    </button>
  );
};

/**
 * The containment boundary. Everything a sender wrote renders inside this and nowhere else.
 *
 * `contain: content` plus the width caps are what stop a 1400px Outlook table from pushing the
 * application sideways — the failure this component exists to prevent. `overflow-x: auto` gives
 * that table its own scrollbar instead.
 */
const Contained: React.FC<{ html: string; muted?: boolean }> = ({ html, muted }) => (
  <div
    // Safe: `html` is a piece of `prepareBody`'s output, each piece sanitised as it will be
    // parsed. Nothing else may call this.
    dangerouslySetInnerHTML={{ __html: html }}
    style={{
      // Reset the sender's inherited context so their CSS starts from ours, not from Dynamics'.
      font: `400 14px/20px ${T.font}`,
      // The form's control container sets `white-space: nowrap` and it inherits this far: measured
      // 2026-09-30, every paragraph of a message ran on one line under a horizontal scrollbar.
      whiteSpace: 'normal',
      // N7 — LITERAL white and near-black, never the themed tokens.
      //
      // Mail is written for a white background: black text, white-background logos, tables with
      // light borders. In dark theme a themed surface here would make a real proportion of
      // messages unreadable, and inverting would rewrite invoices and test reports. Frozen
      // decision in docs/design/01-design-decisions.md; Outlook and Gmail both do this.
      background: BODY_SURFACE,
      color: muted ? BODY_SURFACE_FG_MUTED : BODY_SURFACE_FG,
      // Keeps the white from sitting flush against the dark card edge.
      padding: '2px 0',
      colorScheme: 'light',
      contain: 'content',
      maxWidth: '100%',
      overflowX: 'auto',
      overflowY: 'hidden',
      minWidth: 0,
      // Long unbroken URLs in signatures are a common cause of horizontal overflow.
      overflowWrap: 'anywhere',
    }}
  />
);

const Chevron: React.FC<{ up?: boolean; colour: string }> = ({ up, colour }) => (
  <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke={colour} strokeWidth="1.8" aria-hidden="true">
    <path d={up ? 'M5 12l5-5 5 5' : 'M5 8l5 5 5-5'} />
  </svg>
);

const WarnIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke={T.warnFg} strokeWidth="1.5" style={{ flex: '0 0 14px' }} aria-hidden="true">
    <path d="M10 3.5 17.5 16.5H2.5z" />
    <path d="M10 8v3.5M10 13.8v.4" />
  </svg>
);

const TrimIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke={T.fg2} strokeWidth="1.5" style={{ flex: '0 0 14px' }} aria-hidden="true">
    <path d="M4 6h12M4 10h12M4 14h7" />
  </svg>
);
