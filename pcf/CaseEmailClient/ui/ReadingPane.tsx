import { cidReferences, normaliseCid } from '../domain/inlineImages';
import { isInFlight } from '../domain/send';
import * as React from 'react';
import type { EmailRow, Thread } from '../domain/threading';
import type { Attachment, MessageParties } from '../data/emailQueries';
import type { ComposeMode } from '../domain/compose';
import { BodyFrame } from './BodyFrame';
import { formatSize, formatWhen, RADIUS, T } from './tokens';
import {
  AttachmentIcon, Avatar, Card, CardHeader, Chevron, DirectionIcon, ErrorPanel, IconButton, Shimmer,
  StatusBadge, UnreadDot,
} from './parts';

/**
 * The reading pane: a thread header plus the message stack. R2, R3, R4, R5, R6, R21.
 *
 * Like the thread list, the stack is **one tab stop** with arrow keys inside, and `Space` expands
 * or collapses the focused message.
 */

export interface MessageState {
  /** Body HTML once fetched. `undefined` while it has never been requested. */
  body?: string;
  loadingBody: boolean;
  bodyError?: string;
  attachments?: Attachment[];
  /** The attachment list would not load. The body still shows — one failure, not two (L11). */
  attachmentsError?: boolean;
  /** Content-ID → data URL for the body's inline images, filled in after the body shows. */
  inlineImages?: ReadonlyMap<string, string>;
  expanded: boolean;
  quoteExpanded: boolean;
  noticesExpanded: boolean;
  unread: boolean;
}

export interface ReadingPaneProps {
  thread?: Thread;
  parties: Map<string, MessageParties>;
  states: Map<string, MessageState>;
  /** How many of the oldest messages are collapsed into the "N earlier messages" row. */
  collapsedOlderCount: number;
  onExpandOlder: () => void;
  onToggleMessage: (activityId: string) => void;
  onToggleQuote: (activityId: string) => void;
  /** Issue #4 — the message the list asked us to show. Scrolled to, not exclusively rendered. */
  focusMessageId?: string;
  onToggleNotices: (activityId: string) => void;
  onDownloadAttachment: (attachment: Attachment) => void;
  /** Fetch a body again after it failed to load. */
  onRetryBody: (activityId: string) => void;
  /** Fires when a message has been expanded and visible long enough to count as read (R6). */
  onDwellRead: (activityId: string) => void;
  /** R9 entry points. The pane knows which message; the shell knows how to compose against it. */
  onCompose: (mode: ComposeMode, activityId: string) => void;
  loading: boolean;
  error?: { headline: string; reassurance?: string; detail: string };
  onRetry: () => void;
}

/** Mark-read dwell, per Gate 2: expanded AND on screen, continuously. */
const DWELL_MS = 1500;

export const ReadingPane: React.FC<ReadingPaneProps> = (props) => {
  const {
    thread, parties, states, collapsedOlderCount, onExpandOlder, onToggleMessage,
    onToggleQuote, onToggleNotices, onDownloadAttachment, onDwellRead, loading, error, onRetry,
    onRetryBody,
    focusMessageId, onCompose,
  } = props;

  const stackRef = React.useRef<HTMLDivElement>(null);
  // Focus is a message ID, not a position (M14). An index survived a thread change pointing past
  // the end of the new thread, and Space then threw on `visible[focusIndex]`.
  const [focusedId, setFocusedId] = React.useState<string>();

  const messages = thread?.messages ?? [];
  const visible = messages.slice(collapsedOlderCount);
  const focusIndex = Math.max(0, visible.findIndex((m) => m.activityid === focusedId));

  /** Addressed by id, never by index into `querySelectorAll` — see CLAUDE.md. */
  const scrollToMessage = (activityId: string) => {
    stackRef.current
      ?.querySelector(`[data-message-id="${CSS.escape(activityId)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };

  /**
   * Issue #4, option (b): the pane keeps the whole conversation and scrolls to the chosen message.
   *
   * The alternative — a strictly single-message pane — would have moved the R6 dwell trigger, and
   * that is the requirement most recently and expensively made to work. This way the list owns the
   * thread structure and the pane owns which message you are looking at, without either of them
   * re-implementing the other.
   *
   * Keyed on the id, not on `states`, so expanding an *additional* message by hand does not yank
   * the scroll back to the selected one.
   */
  React.useEffect(() => {
    if (!focusMessageId) return;
    if (!visible.some((m) => m.activityid === focusMessageId)) return;
    scrollToMessage(focusMessageId);
    setFocusedId(focusMessageId);
    // Keyed on the id, deliberately not on `visible` (a new array every render) — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMessageId, thread?.key, collapsedOlderCount]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (visible.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = visible[e.key === 'ArrowDown'
        ? Math.min(visible.length - 1, focusIndex + 1)
        : Math.max(0, focusIndex - 1)];
      if (!next) return;
      setFocusedId(next.activityid);
      scrollToMessage(next.activityid);
    } else if (e.key === ' ') {
      e.preventDefault();
      const target = visible[focusIndex];
      if (target) onToggleMessage(target.activityid);
    }
  };

  if (!thread && !loading && !error) {
    return (
      <Card grow>
        <div
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            flexGrow: 1, gap: '8px', color: T.fg3, fontSize: '14px',
          }}
        >
          <svg width="38" height="38" viewBox="0 0 20 20" fill="none" stroke={T.stroke1} strokeWidth="1.1" aria-hidden="true">
            <path d="M2.5 5.5h15v9h-15z" /><path d="m2.5 6 7.5 5 7.5-5" />
          </svg>
          <span>Select a thread to read it</span>
        </div>
      </Card>
    );
  }

  return (
    <Card grow>
      <CardHeader>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span
            style={{
              fontSize: '16px', fontWeight: 600, color: T.fg1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {thread?.subject ?? ''}
          </span>
          {thread && (
            <span style={{ fontSize: '12px', color: T.fg3 }}>
              {thread.messages.length} {thread.messages.length === 1 ? 'message' : 'messages'}
              {thread.orderedByCreatedOnFallback && ' · ordered by date'}
              {thread.groupedBy !== 'hash' && ` · grouped by ${thread.groupedBy}`}
            </span>
          )}
        </div>
        <span style={{ flexGrow: 1 }} />
        <IconButton label="More actions">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <circle cx="10" cy="4.5" r="1.3" /><circle cx="10" cy="10" r="1.3" /><circle cx="10" cy="15.5" r="1.3" />
          </svg>
        </IconButton>
      </CardHeader>

      <div
        ref={stackRef}
        tabIndex={0}
        role="list"
        aria-label="Messages in this thread"
        onKeyDown={onKeyDown}
        style={{
          flexGrow: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0,
          borderTop: `1px solid ${T.stroke3}`, outlineOffset: '-2px',
        }}
      >
        {error && <ErrorPanel error={error} onRetry={onRetry} margin="12px 14px" />}

        {loading && !error && <MessageSkeleton />}

        {!loading && !error && collapsedOlderCount > 0 && (
          <button
            type="button"
            onClick={onExpandOlder}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px', width: '100%', height: '30px',
              padding: '0 14px', boxSizing: 'border-box', background: 'transparent', border: 'none',
              borderBottom: `1px solid ${T.stroke3}`, font: 'inherit', fontSize: '14px',
              color: T.fg1, cursor: 'pointer', textAlign: 'left',
            }}
          >
            <Chevron direction="down" />
            <span>
              {collapsedOlderCount} earlier {collapsedOlderCount === 1 ? 'message' : 'messages'}
            </span>
            <div style={{ flexGrow: 1, height: '1px', background: T.stroke2 }} />
          </button>
        )}

        {!loading && !error && visible.map((message, i) => (
          <MessageView
            key={message.activityid}
            message={message}
            parties={parties.get(message.activityid)}
            state={states.get(message.activityid)}
            focused={i === focusIndex}
            selected={message.activityid === focusMessageId}
            onToggle={() => { setFocusedId(message.activityid); onToggleMessage(message.activityid); }}
            onToggleQuote={() => onToggleQuote(message.activityid)}
            onToggleNotices={() => onToggleNotices(message.activityid)}
            onDownloadAttachment={onDownloadAttachment}
            onRetryBody={() => onRetryBody(message.activityid)}
            onDwellRead={() => onDwellRead(message.activityid)}
            onReply={() => onCompose('reply', message.activityid)}
            onReplyAll={() => onCompose('replyAll', message.activityid)}
            onForward={() => onCompose('forward', message.activityid)}
          />
        ))}
      </div>
    </Card>
  );
};

const MessageView: React.FC<{
  message: EmailRow;
  parties?: MessageParties;
  state?: MessageState;
  focused: boolean;
  /** The message the list and the pane agree is being read. */
  selected: boolean;
  onToggle: () => void;
  onToggleQuote: () => void;
  onToggleNotices: () => void;
  onDownloadAttachment: (a: Attachment) => void;
  onRetryBody: () => void;
  onDwellRead: () => void;
  /** R9 entry points, per message — the pane knows which one is being answered. */
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
}> = (props) => {
  const {
    message, parties, state, focused, selected, onToggle, onToggleQuote, onToggleNotices,
    onReply, onReplyAll, onForward,
    onDownloadAttachment, onDwellRead, onRetryBody,
  } = props;

  const expanded = state?.expanded ?? false;
  const unread = state?.unread ?? false;
  const outgoing = message.directioncode === true;
  // Not 'Care': that is one queue in one environment (L13). Same fallback as the thread list.
  const senderName = parties?.sender?.name ?? (outgoing ? 'Us' : '(unknown sender)');
  const rowRef = React.useRef<HTMLDivElement>(null);
  /**
   * The latest callback, read when the timer fires. As an effect dependency it was a new function
   * on every parent render, so each render tore down the observer and restarted the 1.5s clock —
   * and a parent that re-renders steadily (a `setControlState` round trip does) meant nothing
   * was ever marked read (M13).
   */
  const dwellRef = React.useRef(onDwellRead);
  dwellRef.current = onDwellRead;

  /**
   * R6 — mark read ON DWELL. Both conditions must hold continuously for ~1.5s: the message is
   * expanded, AND it is on screen. Skimming past a collapsed row does not count, and neither does
   * expanding then immediately collapsing.
   *
   * Why dwell rather than on-expand: agents open a thread and skim. Mark-on-expand marks messages
   * read that were never read, and the cost of that is a message the agent believes they have
   * dealt with.
   */
  React.useEffect(() => {
    if (!expanded || !unread) return;
    const el = rowRef.current;
    if (!el) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => { if (timer) { clearTimeout(timer); timer = undefined; } };
    const fire = () => dwellRef.current();

    // IntersectionObserver is the on-screen half. Without it, a message expanded far below the
    // fold would be marked read while never having been visible.
    if (typeof IntersectionObserver === 'undefined') {
      timer = setTimeout(fire, DWELL_MS);
      return clear;
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          clear();
          timer = setTimeout(fire, DWELL_MS);
        } else {
          clear(); // left the viewport before the dwell completed: not read
        }
      }
    }, { threshold: 0.25 });

    observer.observe(el);
    return () => { clear(); observer.disconnect(); };
  }, [expanded, unread]);

  const statusLabel = message.statuslabel ?? (outgoing ? 'Sent' : 'Received');
  // From the status CODE, not a substring of its label: the label is localised (L13).
  const statusTone = isInFlight(message.statuscode) ? 'warn' : 'neutral';

  return (
    <div
      ref={rowRef}
      data-message=""
      data-message-id={message.activityid}
      role="listitem"
      style={{
        display: 'flex',
        gap: '10px',
        padding: expanded ? '6px 14px 10px 11px' : '6px 14px 6px 11px',
        boxSizing: 'border-box',
        borderTop: `1px solid ${T.stroke3}`,
        borderLeft: `3px solid ${unread ? T.brandBg : 'transparent'}`,
        // The same selected tint the list row uses, so both panes agree at a glance about which
        // message is open.
        background: selected ? T.brandBg2 : 'transparent',
        outline: focused ? `2px solid ${T.focus}` : 'none',
        outlineOffset: '-2px',
        minWidth: 0,
      }}
    >
      <Avatar name={senderName} size={expanded ? 32 : 24} />

      <div
        style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexGrow: 1, minWidth: 0 }}
      >
        {/*
          The whole header strip selects the message, not just the "Email from: X" link.
          A 14px link inside a 60px row is a target you have to aim at, and every mail client
          makes the row itself clickable.

          `onMouseDown` rather than `onClick` so that selecting text in a collapsed header does
          not also toggle it, and the guard skips clicks that landed on a real control — the
          Reply/Forward buttons and the sender link live in here and must keep their own meaning.
        */}
        <div
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('button, a')) return;
            onToggle();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, cursor: 'pointer' }}
        >
        {/* metadata line, the form's "Modified on:" idiom */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span style={{ fontSize: '12px', color: unread ? T.fg1 : T.fg3, fontWeight: unread ? 600 : 400 }}>
            {outgoing ? 'Sent on' : 'Received on'}: {formatWhen(message.createdon)}
          </span>
          {unread && <UnreadDot size={8} />}
          <span style={{ flexGrow: 1 }} />
          {expanded && (
            <>
              <IconButton label="Reply" onClick={onReply}>
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 5 3 10l5 5" /><path d="M3 10h7a6 6 0 0 1 6 6" /></svg>
              </IconButton>
              <IconButton label="Reply all" onClick={onReplyAll}>
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M7 4 2 9l5 5" /><path d="M11 4 6 9l5 5" /><path d="M6 9h6a6 6 0 0 1 6 6" /></svg>
              </IconButton>
              <IconButton label="Forward" onClick={onForward}>
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M12 5l5 5-5 5" /><path d="M17 10h-7a6 6 0 0 0-6 6" /></svg>
              </IconButton>
            </>
          )}
        </div>

        {/* The platform's own "Email from: X" + badge idiom, which also carries the send status */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, padding: 0,
            border: 'none', background: 'transparent', font: 'inherit', cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <DirectionIcon outgoing={outgoing} />
          <span style={{ fontSize: '14px', color: T.fg1, flex: '0 0 auto' }}>Email from:</span>
          <span
            style={{
              fontSize: '14px', color: T.link, textDecoration: 'underline',
              fontWeight: unread ? 700 : 400, flex: '0 0 auto',
            }}
          >
            {senderName}
          </span>
          <StatusBadge label={statusLabel} tone={statusTone} />
          {parties && (
            <span
              style={{
                fontSize: '12px', color: T.fg3, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
              }}
            >
              {recipientSummary(parties)}
            </span>
          )}
          {!expanded && (message.attachmentcount ?? 0) > 0 && <AttachmentIcon />}
        </button>
        </div>

        {/* collapsed: a snippet is deliberately NOT shown — we have not fetched the body, and
            fetching it for every row is exactly the blob-storage performance trap. */}

        {expanded && (
          <div style={{ marginTop: '4px', minWidth: 0 }}>
            {state?.loadingBody && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '820px' }} aria-busy="true">
                <Shimmer width="90%" />
                <Shimmer width="75%" />
                <Shimmer width="40%" />
              </div>
            )}

            {state?.bodyError && (
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px',
                  boxSizing: 'border-box', background: T.dangerBg, borderRadius: RADIUS.md,
                  maxWidth: '820px',
                }}
              >
                {/* Scoped to THIS message: one body that will not load must never blank the thread. */}
                <span style={{ fontSize: '12px', color: T.dangerFg }}>Message text couldn&apos;t be loaded.</span>
                <button
                  type="button"
                  // Retries the fetch. It called `onToggle` until 2026-09-28, which COLLAPSED the
                  // message instead (L11).
                  onClick={onRetryBody}
                  style={{ border: 'none', background: 'transparent', font: 'inherit', fontSize: '12px', color: T.link, fontWeight: 600, cursor: 'pointer' }}
                >
                  Retry
                </button>
              </div>
            )}

            {state?.body !== undefined && !state.loadingBody && !state.bodyError && (
              <BodyFrame
                rawHtml={state.body}
                inlineImages={state.inlineImages}
                quoteExpanded={state.quoteExpanded}
                noticesExpanded={state.noticesExpanded}
                onToggleQuote={onToggleQuote}
                onToggleNotices={onToggleNotices}
              />
            )}

            {state?.attachmentsError && (
              <span style={{ fontSize: '12px', color: T.dangerFg }}>
                The attachments on this message couldn&apos;t be listed.
              </span>
            )}
            {(() => {
              // Inline images the body shows are part of the message, not files: Outlook does not
              // list them either. One the body does NOT reference stays listed, so nothing that
              // will reach the customer is ever hidden.
              const shown = cidReferences(state?.body ?? '');
              const files = (state?.attachments ?? []).filter(
                (a) => !(a.contentId && shown.has(normaliseCid(a.contentId))),
              );
              return files.length > 0
                ? <AttachmentList attachments={files} onDownload={onDownloadAttachment} />
                : null;
            })()}
          </div>
        )}
      </div>
    </div>
  );
};

/** R5 — per-message attachments with filename, type and size. */
const AttachmentList: React.FC<{
  attachments: Attachment[];
  onDownload: (a: Attachment) => void;
}> = ({ attachments, onDownload }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
    {attachments.map((a) => (
      <button
        key={a.id}
        type="button"
        onClick={() => onDownload(a)}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px', height: '26px', padding: '0 8px',
          boxSizing: 'border-box', borderRadius: RADIUS.md, background: T.bg3, border: 'none',
          font: 'inherit', cursor: 'pointer',
        }}
      >
        <FileIcon mimeType={a.mimeType} />
        <span style={{ fontSize: '13px', color: T.link }}>{a.filename}</span>
        {a.fileSize > 0 && <span style={{ fontSize: '12px', color: T.fg4 }}>{formatSize(a.fileSize)}</span>}
      </button>
    ))}
  </div>
);

const FileIcon: React.FC<{ mimeType: string }> = ({ mimeType }) => {
  const colour = mimeType.includes('pdf')
    ? T.dangerFg
    : mimeType.includes('sheet') || mimeType.includes('excel')
      ? T.okFg
      : mimeType.startsWith('image/')
        ? T.link
        : T.fg3;
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={colour} strokeWidth="1.3" style={{ flex: '0 0 16px' }} aria-hidden="true">
      <path d="M5 2.5h6l4 4v11H5z" /><path d="M11 2.5v4h4" />
    </svg>
  );
};


const MessageSkeleton: React.FC = () => (
  <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '16px' }} aria-busy="true">
    {[0, 1].map((i) => (
      <div key={i} style={{ display: 'flex', gap: '10px' }}>
        <div style={{ width: '32px', height: '32px', flex: '0 0 32px', borderRadius: RADIUS.pill, background: T.stroke3 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexGrow: 1 }}>
          <Shimmer width="30%" height={9} />
          <Shimmer width="55%" height={11} />
          <Shimmer width="92%" height={10} />
          <Shimmer width="80%" height={10} />
        </div>
      </div>
    ))}
  </div>
);

/** `To: … · Cc: …`, with overflow collapsed rather than wrapped. */
function recipientSummary(parties: MessageParties): string {
  const show = (list: { name: string }[], max = 2): string => {
    if (list.length === 0) return '';
    const names = list.slice(0, max).map((p) => p.name);
    const extra = list.length - names.length;
    return names.join(', ') + (extra > 0 ? ` +${extra}` : '');
  };
  const to = show(parties.to);
  const cc = show(parties.cc);
  return [to && `To: ${to}`, cc && `Cc: ${cc}`].filter(Boolean).join(' · ');
}
