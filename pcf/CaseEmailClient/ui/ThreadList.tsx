import * as React from 'react';
import type { Thread } from '../domain/threading';
import { normaliseSubject } from '../domain/threading';
import { listView } from '../domain/listState';
import {
  buildListRows, firstFocusable, nextFocusable, parentThreadIndex, type ListRow,
} from '../domain/listRows';
import type { MessageParties } from '../data/emailQueries';
import {
  clearClause, describeFilter, SEARCHES, type ThreadFilter,
} from '../domain/filter';
import { formatWhen, RADIUS, T } from './tokens';
import { AttachmentIcon, Avatar, Card, CardHeader, DirectionIcon, GroupHeader, IconButton, Shimmer, StatusBadge, UnreadDot } from './parts';

/**
 * The thread list. R1 (grouping), R6 (unread), and the keyboard model from
 * docs/design/03-interaction-spec.md.
 *
 * **One tab stop for the whole list, with arrow keys inside.** Tabbing through 50 rows to reach a
 * button is technically accessible and practically unusable, and it is the single most common
 * accessibility failure in a custom mail list. Focus is remembered when you leave and come back.
 */

export interface ThreadSummary {
  thread: Thread;
  /** Unread message count in this thread, for this agent. */
  unreadCount: number;
  /** Distinct participant display names, newest activity first. */
  participants: string[];
  hasAttachments: boolean;
  hasDraft: boolean;
  /** Set when the thread belongs to the parent case rather than this one (R8). */
  parentCaseNumber?: string;
  lastActivity: string;
}

export interface ThreadListProps {
  summaries: ThreadSummary[];
  selectedKey?: string;
  unreadTotal: number;
  loading: boolean;
  /**
   * The load failure, if any. **Must be passed.** Without it the list falls through to the empty
   * state and a failed load reads as "this customer has never emailed" — see domain/listState.ts.
   */
  error?: { headline: string; reassurance?: string; detail: string };
  onRetry: () => void;
  onSelect: (key: string) => void;
  onRefresh: () => void;
  /** Total count including anything the filters are hiding — see the zero-results rule. */
  totalThreadCount: number;
  filterActive: boolean;
  onClearFilters: () => void;
  parentCaseThreadCount?: number;
  /** R7. The filter is owned by the shell, because the data it filters is. */
  filter: ThreadFilter;
  onFilterChange: (next: ThreadFilter) => void;
  /** Every participant on the case, most frequent first, for the panel. */
  participantOptions: readonly string[];
  /** R8. Costs a reload, so it is a toggle rather than another filter clause. */
  includeParent: boolean;
  onIncludeParentChange: (next: boolean) => void;
  /** How many ancestor cases were found. 0 with the toggle on means this case has no parent. */
  ancestorCount: number;
  /** Issue #4 — conversations expanded IN THE LIST. Session UI state, owned by the shell. */
  expandedThreadKeys: ReadonlySet<string>;
  onToggleExpand: (threadKey: string) => void;
  /** Selecting one message of a conversation, rather than the conversation. */
  onSelectMessage: (threadKey: string, activityId: string) => void;
  /** The message currently open in the reading pane, so its row reads as selected. */
  selectedMessageId?: string;
  /** Read state, for per-message unread weight on the child rows. */
  readIds: ReadonlySet<string>;
  /** Senders for the child rows. Already loaded for the reading pane; no new query. */
  parties: Map<string, MessageParties>;
}

export const ThreadList: React.FC<ThreadListProps> = (props) => {
  const {
    summaries, selectedKey, unreadTotal, loading, error, onRetry, onSelect, onRefresh,
    totalThreadCount, filterActive, onClearFilters, parentCaseThreadCount,
    filter, onFilterChange, participantOptions, includeParent, onIncludeParentChange,
    ancestorCount, expandedThreadKeys, onToggleExpand, onSelectMessage, selectedMessageId, readIds,
    parties,
  } = props;

  const [panelOpen, setPanelOpen] = React.useState(false);
  const chips = describeFilter(filter);

  const listRef = React.useRef<HTMLDivElement>(null);
  // Remembered across focus loss, per the interaction spec.
  const [focusIndex, setFocusIndex] = React.useState(0);

  // One decision, taken in a tested pure function, instead of a scatter of `!loading &&` guards
  // that made a failed load indistinguishable from an empty case.
  const view = listView({
    loading,
    error,
    visibleCount: summaries.length,
    totalCount: totalThreadCount,
    filterActive,
  });

  // One flat list, built once (issue #4). Rendering and keyboard navigation read the same
  // sequence — the order used to be spelled out three times and would have been six with children.
  const rows = React.useMemo(
    () => buildListRows(summaries, expandedThreadKeys, readIds),
    [summaries, expandedThreadKeys, readIds],
  );

  const moveFocus = (next: number) => {
    setFocusIndex(next);
    // Keep the focused row in view without stealing the page's scroll.
    //
    // Addressed by ROW ID, not by position. Indexing `querySelectorAll` by the row index looked
    // right and was wrong: group headers are rows in the sequence but carry no `data-list-row`,
    // so every index past the first header pointed at the wrong element and scrolled somewhere
    // arbitrary. Ids cannot drift out of step with the array the way two parallel orders can.
    const target = rows[next];
    if (!target) return;
    listRef.current
      ?.querySelector(`[data-row-id="${CSS.escape(`${target.kind}:${target.id}`)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (rows.length === 0) return;
    const row = rows[focusIndex];

    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        moveFocus(nextFocusable(rows, focusIndex, e.key === 'ArrowDown' ? 1 : -1));
        return;
      }
      case 'ArrowRight': {
        // Into the conversation. On a message row there is nowhere further right to go, so it is
        // left for the reading pane's own handling rather than swallowed here.
        if (row?.kind === 'thread' && row.expandable && !row.expanded) {
          e.preventDefault();
          onToggleExpand(row.id);
        }
        return;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        if (row?.kind === 'thread' && row.expanded) {
          onToggleExpand(row.id);
        } else if (row?.kind === 'message') {
          // Collapsing from a child has to move focus somewhere; the only non-surprising answer
          // is the header that just swallowed it.
          const owner = parentThreadIndex(rows, focusIndex);
          moveFocus(owner);
          const ownerRow = rows[owner];
          if (ownerRow?.kind === 'thread' && ownerRow.expanded) onToggleExpand(ownerRow.id);
        }
        return;
      }
      case ' ': {
        // Space toggles a conversation, per the issue. On a message row it selects, because a
        // message has nothing to expand in this pane.
        e.preventDefault();
        if (row?.kind === 'thread' && row.expandable) onToggleExpand(row.id);
        else if (row?.kind === 'message') onSelectMessage(row.threadKey, row.id);
        return;
      }
      case 'Enter': {
        e.preventDefault();
        if (row?.kind === 'thread') onSelect(row.id);
        else if (row?.kind === 'message') onSelectMessage(row.threadKey, row.id);
        return;
      }
      default:
    }
  };

  return (
    <Card width="424px">
      <CardHeader>
        <span style={{ fontSize: '16px', fontWeight: 600, color: T.fg1 }}>Email</span>
        {unreadTotal > 0 && (
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', height: '20px', padding: '0 8px',
              borderRadius: RADIUS.pill, background: T.brandBg2, color: T.link,
              fontSize: '11px', fontWeight: 600,
            }}
          >
            {unreadTotal} unread
          </span>
        )}
        <span style={{ flexGrow: 1 }} />
        {/* Compose is Phase 2. A button that renders and does nothing teaches agents the client is
            broken, so it says so rather than sitting there inert. */}
        <IconButton label="New email — not built yet" disabled>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M10 4.5v11M4.5 10h11" /></svg>
        </IconButton>
        <IconButton
          label={filterActive ? 'Filter (active)' : 'Filter'}
          active={filterActive || panelOpen}
          onClick={() => setPanelOpen((o) => !o)}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3.5 5h13M6 10h8M8.5 15h3" /></svg>
        </IconButton>
        <IconButton label="Refresh" onClick={onRefresh}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M16 10a6 6 0 1 1-2.2-4.6" /><path d="M16.2 3.6v3h-3" /></svg>
        </IconButton>
      </CardHeader>

      {/* Fixed-height search. Nothing above the scroll region may grow — a toolbar that wraps to a
          second line silently eats the reading area. The chip row below is the one exception, and
          it is capped at one line that scrolls rather than wrapping. */}
      <div style={{ padding: '0 12px 8px 12px', boxSizing: 'border-box', flex: '0 0 auto' }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', height: '32px',
            padding: '0 10px', boxSizing: 'border-box', background: T.bg3, borderRadius: RADIUS.md,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={T.fg3} strokeWidth="1.4" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" /><path d="M12.8 12.8 17 17" />
          </svg>
          <input
            // `type="text"`, NOT `type="search"`. Chrome renders its own clear button inside a
            // search input, so the field showed TWO ✕ side by side (seen in the published app,
            // 2026-09-22). Ours is kept because the native one is unstyleable and absent in
            // Firefox, so relying on it would give different agents different controls.
            type="text"
            value={filter.text}
            onChange={(e) => onFilterChange({ ...filter, text: e.target.value })}
            placeholder={`Search ${SEARCHES}`}
            aria-label={`Search email on this case. Searches ${SEARCHES}, not message text.`}
            aria-describedby="cec-search-scope"
            style={{
              flexGrow: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
              font: 'inherit', fontSize: '14px', color: T.fg1,
            }}
          />
          {filter.text.length > 0 && (
            <button
              type="button"
              onClick={() => onFilterChange({ ...filter, text: '' })}
              aria-label="Clear search"
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer', color: T.fg3,
                font: 'inherit', fontSize: '13px', padding: '0 2px', flex: '0 0 auto',
              }}
            >
              ✕
            </button>
          )}
        </div>
        {/*
          R7's honesty note, and it is not decoration.

          This searches only what the list query loaded. Message BODIES are not searched and
          cannot be: they are deliberately absent from the list query (blob storage, N5), and the
          platform does not support filtering on `description` at all — that is Dataverse search, a
          different and slower path. Without saying so, an agent who searches a phrase they
          remember from a message and gets nothing concludes the mail is not on the case.
        */}
        <span
          id="cec-search-scope"
          style={{ display: 'block', marginTop: '4px', fontSize: '11px', color: T.fg4 }}
        >
          Searches {SEARCHES} — not message text
        </span>
      </div>

      {panelOpen && (
        <FilterPanel
          filter={filter}
          participantOptions={participantOptions}
          onChange={onFilterChange}
          onClose={() => setPanelOpen(false)}
          onClearAll={onClearFilters}
          includeParent={includeParent}
          onIncludeParentChange={onIncludeParentChange}
          ancestorCount={ancestorCount}
        />
      )}

      {/* One line, scrolls rather than wraps: the height above the scroll region must be
          predictable however many clauses are active. */}
      {chips.length > 0 && (
        <div
          style={{
            display: 'flex', gap: '6px', alignItems: 'center', flex: '0 0 auto',
            height: '32px', padding: '0 12px 6px 12px', boxSizing: 'border-box',
            overflowX: 'auto', overflowY: 'hidden',
          }}
        >
          {chips.map((chip) => (
            <FilterChip
              key={chip.key}
              label={chip.label}
              onRemove={() => onFilterChange(clearClause(filter, chip.key))}
            />
          ))}
        </div>
      )}

      {/* ── the one scroll region ── */}
      <div
        ref={listRef}
        // ONE tab stop; arrows move inside. See the interaction spec.
        tabIndex={0}
        role="listbox"
        aria-label="Email threads"
        onKeyDown={onKeyDown}
        style={{ flexGrow: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0, outlineOffset: '-2px' }}
      >
        {view === 'loading' && <ListSkeleton />}

        {/* Error BEFORE any empty state, and it stays up while a retry is in flight. */}
        {view === 'error' && error && <ListError error={error} onRetry={onRetry} />}

        {view === 'empty' && <EmptyNoMail />}

        {view === 'empty-filtered' && (
          <EmptyFiltered total={totalThreadCount} onClearFilters={onClearFilters} />
        )}

        {view === 'rows' && rows.map((row, i) => {
          if (row.kind === 'group') {
            return (
              <GroupHeader
                key={row.id}
                label={row.label}
                count={row.count}
                note={row.note}
                tone={row.tone}
              />
            );
          }
          if (row.kind === 'thread') {
            return (
              <ThreadRow
                key={row.id}
                summary={row.summary}
                // A conversation reads as selected only while no single message of it is open;
                // otherwise both the header and a child would claim selection.
                selected={row.id === selectedKey && !selectedMessageId}
                focused={focusIndex === i}
                expandable={row.expandable}
                expanded={row.expanded}
                onToggleExpand={() => { setFocusIndex(i); onToggleExpand(row.id); }}
                onSelect={() => { setFocusIndex(i); onSelect(row.id); }}
              />
            );
          }
          return (
            <MessageRow
              key={`${row.threadKey}:${row.id}`}
              row={row}
              parties={parties}
              selected={row.id === selectedMessageId}
              focused={focusIndex === i}
              onSelect={() => { setFocusIndex(i); onSelectMessage(row.threadKey, row.id); }}
            />
          );
        })}
      </div>

      {/* Fixed footer, the platform's View-more idiom */}
      {parentCaseThreadCount !== undefined && parentCaseThreadCount > 0 && (
        <div
          style={{
            display: 'flex', alignItems: 'center', height: '36px', flex: '0 0 36px',
            padding: '0 12px', boxSizing: 'border-box', borderTop: `1px solid ${T.stroke3}`,
          }}
        >
          <span style={{ fontSize: '14px', color: T.fg1 }}>
            View parent case ({parentCaseThreadCount} {parentCaseThreadCount === 1 ? 'thread' : 'threads'})
          </span>
          <span style={{ flexGrow: 1 }} />
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke={T.fg2} strokeWidth="1.6" aria-hidden="true"><path d="M5 8l5 5 5-5" /></svg>
        </div>
      )}
    </Card>
  );
};

const ThreadRow: React.FC<{
  summary: ThreadSummary;
  selected: boolean;
  focused: boolean;
  expandable: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
}> = ({ summary, selected, focused, expandable, expanded, onToggleExpand, onSelect }) => {
  const unread = summary.unreadCount > 0;
  const fromParent = !!summary.parentCaseNumber;
  const subject = normaliseSubjectForDisplay(summary.thread.subject);
  const lead = summary.participants[0] ?? '(unknown)';

  // Three unread signals at once: edge bar, dot, weight. Never colour alone (N6).
  const edge = unread ? T.brandBg : fromParent ? T.parentEdge : 'transparent';

  return (
    <div
      data-list-row=""
      data-thread-row=""
      data-row-id={`thread:${summary.thread.key}`}
      role="option"
      aria-selected={selected}
      aria-expanded={expandable ? expanded : undefined}
      aria-label={
        `${unread ? 'Unread. ' : ''}${subject}. ` +
        `${summary.thread.messages.length} messages${unread ? `, ${summary.unreadCount} unread` : ''}. ` +
        `Latest from ${lead}, ${formatWhen(summary.lastActivity)}.` +
        `${summary.hasAttachments ? ' Has attachments.' : ''}` +
        `${fromParent ? ` From parent case ${summary.parentCaseNumber}.` : ''}` +
        `${expandable ? (expanded ? ' Expanded.' : ' Collapsed.') : ''}`
      }
      // Clicking the ROW toggles expansion, Outlook-style (issue #4). Selecting the conversation
      // without expanding is still available on Enter, and on a single-message conversation the
      // click selects because there is nothing to expand.
      onClick={expandable ? onToggleExpand : onSelect}
      style={{
        display: 'flex',
        gap: '10px',
        padding: '8px 12px',
        paddingLeft: '9px',
        boxSizing: 'border-box',
        borderLeft: `3px solid ${edge}`,
        background: selected ? T.brandBg2 : fromParent ? T.warnBg2 : 'transparent',
        borderTop: `1px solid ${T.stroke3}`,
        cursor: 'pointer',
        outline: focused ? `2px solid ${T.focus}` : 'none',
        outlineOffset: '-2px',
      }}
    >
      {/* The twisty. 14px of gutter is reserved even when there is nothing to expand, so the
          avatars of expandable and single-message conversations still line up. */}
      <span
        style={{
          flex: '0 0 14px', display: 'flex', alignItems: 'flex-start', paddingTop: '10px',
          color: T.fg2,
        }}
        aria-hidden="true"
      >
        {expandable && (
          <svg
            width="12" height="12" viewBox="0 0 20 20" fill="none"
            stroke="currentColor" strokeWidth="2"
            style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}
          >
            <path d="M7 4l6 6-6 6" />
          </svg>
        )}
      </span>
      <Avatar name={lead} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', flexGrow: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '12px', color: unread ? T.fg1 : T.fg3, fontWeight: unread ? 600 : 400 }}>
            Last activity {formatWhen(summary.lastActivity)}
          </span>
          <span style={{ flexGrow: 1 }} />
          {unread && <UnreadDot />}
        </div>

        <span
          style={{
            fontSize: '14px',
            fontWeight: unread ? 700 : 400,
            color: T.fg1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {subject}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          <span style={{ fontSize: '14px', color: T.fg2, flex: '0 0 auto' }}>
            {summary.thread.messages.length} {summary.thread.messages.length === 1 ? 'message' : 'messages'}
          </span>
          {summary.hasDraft && <StatusBadge label="Draft" tone="warn" />}
          {fromParent && <StatusBadge label={summary.parentCaseNumber ?? ''} tone="warn" />}
          {/* The separator is conditional. Rendering it unconditionally left a dangling "·" with
              nothing after it whenever participants could not be resolved — which is how the
              missing `_activityid_value` in the parties SELECT first showed itself. */}
          {summary.participants.length > 0 && (
            <>
              <span style={{ fontSize: '14px', color: T.fg3, flex: '0 0 auto' }}>·</span>
              <span
                style={{
                  fontSize: '14px', color: T.fg2, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {summary.participants.join(', ')}
              </span>
            </>
          )}
          {summary.hasAttachments && <AttachmentIcon />}
        </div>
      </div>
    </div>
  );
};

/**
 * Three skeleton rows, always — in the shape of real rows so nothing jumps when data lands.
 * Guessing the count and being wrong is worse than a fixed placeholder.
 */
const ListSkeleton: React.FC = () => (
  <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '14px' }} aria-busy="true" aria-label="Loading email">
    {[0, 1, 2].map((i) => (
      <div key={i} style={{ display: 'flex', gap: '10px' }}>
        <div style={{ width: '32px', height: '32px', flex: '0 0 32px', borderRadius: RADIUS.pill, background: T.stroke3 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', flexGrow: 1 }}>
          <Shimmer width="45%" height={9} />
          <Shimmer width="85%" height={11} />
          <Shimmer width="60%" height={9} />
        </div>
      </div>
    ))}
  </div>
);

/**
 * The load-failure state. Takes precedence over every empty state, because the two are not
 * interchangeable: one means "nothing to deal with", the other means "we do not know".
 */
const ListError: React.FC<{
  error: { headline: string; reassurance?: string; detail: string };
  onRetry: () => void;
}> = ({ error, onRetry }) => {
  const [showDetail, setShowDetail] = React.useState(false);
  return (
    <div
      role="alert"
      style={{
        margin: '12px', padding: '10px', boxSizing: 'border-box', background: T.dangerBg,
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
      {showDetail && (
        <code style={{ fontFamily: T.mono, fontSize: '11px', color: T.fg2, wordBreak: 'break-all' }}>
          {error.detail}
        </code>
      )}
    </div>
  );
};

/**
 * Genuinely no mail. The ONLY state allowed to say "yet" — that word is what separates "nothing
 * here" from "something is wrong", and it must never appear over a failure.
 */
const EmptyNoMail: React.FC = () => (
  <div
    style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '8px', padding: '32px 24px', boxSizing: 'border-box', textAlign: 'center',
    }}
  >
    <svg width="38" height="38" viewBox="0 0 20 20" fill="none" stroke={T.stroke1} strokeWidth="1.1" aria-hidden="true">
      <path d="M2.5 5.5h15v9h-15z" /><path d="m2.5 6 7.5 5 7.5-5" />
    </svg>
    <span style={{ fontSize: '14px', fontWeight: 600, color: T.fg1 }}>No email on this case yet</span>
    <span style={{ fontSize: '12px', color: T.fg3 }}>
      When the customer writes in, or you send the first message, it appears here.
    </span>
  </div>
);

/**
 * Mail exists, the filters hide it. **States the real total**, because "no results" and "this
 * customer has never emailed" are indistinguishable unless the count is spelled out.
 */
/**
 * One message of an expanded conversation (issue #4).
 *
 * Deliberately shorter and quieter than a conversation row: 30px against ~60px, no avatar, no
 * subject. The subject is on the header directly above it and repeating it down a conversation is
 * how a list stops being skimmable — the useful difference between these rows is *who* and *when*.
 */
const MessageRow: React.FC<{
  row: Extract<ListRow<ThreadSummary>, { kind: 'message' }>;
  parties: Map<string, MessageParties>;
  selected: boolean;
  focused: boolean;
  onSelect: () => void;
}> = ({ row, parties, selected, focused, onSelect }) => {
  const { message, unread, position, of } = row;
  const sender = parties.get(message.activityid)?.sender?.name
    ?? (message.directioncode === true ? 'Us' : '(unknown)');
  const outgoing = message.directioncode === true;
  const fromParent = !!row.parentCaseNumber;

  return (
    <div
      data-list-row=""
      data-message-row=""
      data-row-id={`message:${row.id}`}
      role="option"
      aria-selected={selected}
      aria-label={
        `${unread ? 'Unread. ' : ''}Message ${position} of ${of}. ` +
        `${outgoing ? 'Sent to' : 'From'} ${sender}, ${formatWhen(message.createdon)}.` +
        `${(message.attachmentcount ?? 0) > 0 ? ' Has attachments.' : ''}`
      }
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        height: '30px',
        // Indented to the conversation's avatar, so the hierarchy is legible without a guide line.
        padding: '0 12px 0 47px',
        boxSizing: 'border-box',
        // The same hairline the reading pane puts between messages, so a conversation reads the
        // same way in both panes. Without it the child rows ran together into a block.
        borderTop: `1px solid ${T.stroke3}`,
        // Unread keeps its edge bar here too — colour is never the only signal (N6).
        borderLeft: `3px solid ${unread ? T.brandBg : fromParent ? T.parentEdge : 'transparent'}`,
        background: selected ? T.brandBg2 : fromParent ? T.warnBg2 : 'transparent',
        cursor: 'pointer',
        outline: focused ? `2px solid ${T.focus}` : 'none',
        outlineOffset: '-2px',
      }}
    >
      <DirectionIcon outgoing={outgoing} />
      <span
        style={{
          fontSize: '13px',
          fontWeight: unread ? 700 : 400,
          color: T.fg1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {sender}
      </span>
      {message.statuscode === 1 && <StatusBadge label="Draft" tone="warn" />}
      <span style={{ flexGrow: 1 }} />
      {(message.attachmentcount ?? 0) > 0 && <AttachmentIcon />}
      <span style={{ fontSize: '12px', color: T.fg3, flex: '0 0 auto' }}>
        {formatWhen(message.createdon)}
      </span>
      {unread && <UnreadDot />}
    </div>
  );
};

/**
 * One active filter clause, removable.
 *
 * Custom because Fluent 9.46.2 has no filter chip: `Badge` is not interactive and `Button` is the
 * wrong shape. Recorded as 🟡 in the component inventory for exactly this reason.
 */
const FilterChip: React.FC<{ label: string; onRemove: () => void }> = ({ label, onRemove }) => (
  <span
    style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px', flex: '0 0 auto',
      height: '24px', padding: '0 4px 0 8px', boxSizing: 'border-box',
      background: T.brandBg2, border: `1px solid ${T.brandStroke2}`, borderRadius: RADIUS.pill,
      fontSize: '12px', color: T.fg1, maxWidth: '180px',
    }}
  >
    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {label}
    </span>
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove filter ${label}`}
      style={{
        border: 'none', background: 'transparent', cursor: 'pointer', color: T.fg3,
        font: 'inherit', fontSize: '12px', lineHeight: 1, padding: '2px 3px', flex: '0 0 auto',
      }}
    >
      ✕
    </button>
  </span>
);

/**
 * The filter panel (R7).
 *
 * Inline rather than a floating popover: inside a 471px-tall host a popover either clips or covers
 * the list it is filtering. It takes its space from the scroll region while open, which is the one
 * place the height budget says may give — "first to collapse under pressure".
 */
const FilterPanel: React.FC<{
  filter: ThreadFilter;
  participantOptions: readonly string[];
  onChange: (next: ThreadFilter) => void;
  onClose: () => void;
  onClearAll: () => void;
  includeParent: boolean;
  onIncludeParentChange: (next: boolean) => void;
  ancestorCount: number;
}> = ({
  filter, participantOptions, onChange, onClose, onClearAll,
  includeParent, onIncludeParentChange, ancestorCount,
}) => {
  const label = { fontSize: '12px', color: T.fg2, fontWeight: 600 } as const;
  const field = {
    height: '28px', padding: '0 8px', boxSizing: 'border-box', width: '100%',
    border: `1px solid ${T.stroke1}`, borderRadius: RADIUS.md, background: T.bg1,
    font: 'inherit', fontSize: '13px', color: T.fg1,
  } as const;

  return (
    <div
      role="group"
      aria-label="Filter email"
      style={{
        flex: '0 0 auto', margin: '0 12px 8px 12px', padding: '10px',
        boxSizing: 'border-box', background: T.bg2,
        border: `1px solid ${T.stroke2}`, borderRadius: RADIUS.md,
        display: 'flex', flexDirection: 'column', gap: '8px',
      }}
    >
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: T.fg1 }}>
        <input
          type="checkbox"
          checked={filter.hasAttachment}
          onChange={(e) => onChange({ ...filter, hasAttachment: e.target.checked })}
        />
        Has attachment
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: T.fg1 }}>
        <input
          type="checkbox"
          checked={filter.unreadOnly}
          onChange={(e) => onChange({ ...filter, unreadOnly: e.target.checked })}
        />
        Unread only
      </label>

      {/* R8. Separated by a rule because it is not a filter: the others narrow what is already
          loaded, this one goes and fetches more. */}
      <div style={{ borderTop: `1px solid ${T.stroke2}`, paddingTop: '8px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: T.fg1 }}>
          <input
            type="checkbox"
            checked={includeParent}
            onChange={(e) => onIncludeParentChange(e.target.checked)}
          />
          Include parent case
        </label>
        {/* On, and nothing found: say so. Otherwise ticking a box and seeing no change reads as a
            broken toggle rather than as a case with no parent. */}
        {includeParent && ancestorCount === 0 && (
          <span style={{ display: 'block', marginTop: '4px', fontSize: '11px', color: T.fg4 }}>
            This case has no parent case.
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={label}>Participant</span>
        <select
          value={filter.participant ?? ''}
          onChange={(e) => onChange({ ...filter, participant: e.target.value || undefined })}
          aria-label="Filter by participant"
          style={field}
        >
          <option value="">Anyone</option>
          {participantOptions.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flexGrow: 1 }}>
          <span style={label}>From</span>
          <input
            type="date"
            value={filter.from ?? ''}
            onChange={(e) => onChange({ ...filter, from: e.target.value || undefined })}
            aria-label="Filter from date"
            style={field}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flexGrow: 1 }}>
          <span style={label}>To</span>
          <input
            type="date"
            value={filter.to ?? ''}
            onChange={(e) => onChange({ ...filter, to: e.target.value || undefined })}
            aria-label="Filter to date"
            style={field}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '2px' }}>
        <button
          type="button"
          onClick={onClearAll}
          style={{
            border: 'none', background: 'transparent', color: T.link, cursor: 'pointer',
            font: 'inherit', fontSize: '13px', padding: '4px 6px',
          }}
        >
          Clear all
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{
            border: `1px solid ${T.stroke1}`, background: T.bg1, color: T.fg1, cursor: 'pointer',
            font: 'inherit', fontSize: '13px', padding: '4px 12px', borderRadius: RADIUS.md,
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
};

const EmptyFiltered: React.FC<{ total: number; onClearFilters: () => void }> = ({
  total, onClearFilters,
}) => (
  <div
    style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '8px', padding: '32px 24px', boxSizing: 'border-box', textAlign: 'center',
    }}
  >
    <svg width="38" height="38" viewBox="0 0 20 20" fill="none" stroke={T.stroke1} strokeWidth="1.1" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.5" /><path d="M12.8 12.8 17 17" />
    </svg>
    <span style={{ fontSize: '14px', fontWeight: 600, color: T.fg1 }}>No email matches these filters</span>
    <span style={{ fontSize: '12px', color: T.fg3 }}>
      This case has <strong>{total} {total === 1 ? 'thread' : 'threads'}</strong>. They are hidden by
      the filters, not missing.
    </span>
    <button
      type="button"
      onClick={onClearFilters}
      style={{
        marginTop: '4px', height: '30px', padding: '0 14px', border: `1px solid ${T.stroke1}`,
        borderRadius: RADIUS.md, background: T.bg1, font: 'inherit', fontSize: '14px',
        color: T.fg1, cursor: 'pointer',
      }}
    >
      Clear all filters
    </button>
  </div>
);

/** Strips the reply prefixes and tracking tokens for display, keeping the original casing. */
function normaliseSubjectForDisplay(subject: string): string {
  const normalised = normaliseSubject(subject);
  if (normalised === '(no subject)') return '(no subject)';
  // normaliseSubject lower-cases for comparison; find the same span in the original so the
  // agent sees the sender's own capitalisation.
  const at = subject.toLowerCase().indexOf(normalised.slice(0, 24));
  return at >= 0 ? subject.slice(at).replace(/\s*\b[A-Za-z]{2,8}:\d{4,12}\b\s*/g, ' ').trim() : subject;
}
