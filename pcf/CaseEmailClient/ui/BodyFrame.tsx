import * as React from 'react';
import { sanitiseEmailBody } from '../domain/sanitise';
import { splitQuotedHistory } from '../domain/quoting';
import { stripInjectedNotices, type Notice } from '../domain/noise';
import { RADIUS, T } from './tokens';

/**
 * Renders one message body. The highest-risk component in the inventory, for two reasons.
 *
 * **Security.** The HTML was written by someone outside the organisation and lands in a page
 * holding the agent's authenticated Dynamics session. Measured 2026-09-11 (S12): Dataverse stores
 * it verbatim — 17 of 17 hostile probes survived a round-trip byte-identical — so sanitising is
 * entirely ours to do. Nothing reaches `dangerouslySetInnerHTML` here without passing through
 * `sanitiseEmailBody` first, and the pipeline order is fixed:
 *
 *     sanitise  →  split quoted history  →  strip injected notices  →  render
 *
 * **Containment.** Sanitising stops script. It does nothing about a 1400px-wide Outlook table, a
 * 96px heading, or a sender who sets white text — so the container resets typography, caps widths,
 * and gives wide content its own horizontal scroll. The app layout must never move because of
 * something a sender wrote.
 */

export interface BodyFrameProps {
  /** Raw `email.description`, exactly as stored. */
  rawHtml: string;
  /** Collapsed by default per Gate 2; the fold state is the caller's to remember. */
  quoteExpanded: boolean;
  noticesExpanded: boolean;
  onToggleQuote: () => void;
  onToggleNotices: () => void;
}

interface Prepared {
  newHtml: string;
  quotedHtml: string;
  notices: Notice[];
  foldableCount: number;
  quoteDepthLabel: string;
}

function prepare(rawHtml: string): Prepared {
  // 1. Sanitise FIRST. This is the only order in which hostile markup never reaches code that
  //    indexes into the string, and it also normalises malformed sender HTML so the heuristics
  //    below see well-formed markup.
  const safe = sanitiseEmailBody(rawHtml).html;

  // 2. Split the inherited quote off. Displayed, never re-serialised.
  const split = splitQuotedHistory(safe);

  // 3. Strip what the sender did not write, from the NEW text only — a quoted chain's own
  //    banners are part of the quote and are not ours to edit.
  const cleaned = stripInjectedNotices(split.newHtml);

  return {
    newHtml: cleaned.html,
    quotedHtml: split.quotedHtml,
    notices: cleaned.notices,
    foldableCount: cleaned.foldableCount,
    quoteDepthLabel: describeQuote(split.quotedHtml),
  };
}

function describeQuote(quotedHtml: string): string {
  if (!quotedHtml) return '';
  // Count the header blocks rather than the nesting depth: "3 earlier messages" is what an agent
  // understands, and it is what the design's fold label says.
  const headers =
    (quotedHtml.match(/divRplyFwdMsg/gi) ?? []).length ||
    (quotedHtml.match(/gmail_quote/gi) ?? []).length ||
    (quotedHtml.match(/-{2,}\s*original message/gi) ?? []).length ||
    1;
  return headers === 1 ? '1 earlier message' : `${headers} earlier messages`;
}

export const BodyFrame: React.FC<BodyFrameProps> = (props) => {
  const { rawHtml, quoteExpanded, noticesExpanded, onToggleQuote, onToggleNotices } = props;

  // Re-running the pipeline on every render would re-parse the whole body; memoise on the input.
  const prepared = React.useMemo(() => prepare(rawHtml), [rawHtml]);
  const foldable = prepared.notices.filter((n) => n.foldable);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>

      {/* R21 — injected notices, folded behind the platform's own View more idiom */}
      {foldable.length > 0 && (
        <div>
          <Fold
            tone="warn"
            label={`${foldable.length} ${foldable.length === 1 ? 'notice' : 'notices'} added by your organisation`}
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
                background: '#fffbe6',
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
    // Safe: `html` has already been through sanitiseEmailBody. Nothing else may call this.
    dangerouslySetInnerHTML={{ __html: html }}
    style={{
      // Reset the sender's inherited context so their CSS starts from ours, not from Dynamics'.
      font: `400 14px/20px ${T.font}`,
      color: muted ? T.fg3 : T.fg1,
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
