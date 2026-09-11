import * as React from 'react';
import type { Thread } from '../domain/threading';
import { normaliseSubject } from '../domain/threading';
import { formatWhen, RADIUS, T } from './tokens';
import { AttachmentIcon, Avatar, Card, CardHeader, GroupHeader, IconButton, Shimmer, StatusBadge, UnreadDot } from './parts';

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
  onSelect: (key: string) => void;
  onRefresh: () => void;
  /** Total count including anything the filters are hiding — see the zero-results rule. */
  totalThreadCount: number;
  filterActive: boolean;
  onClearFilters: () => void;
  parentCaseThreadCount?: number;
}

export const ThreadList: React.FC<ThreadListProps> = (props) => {
  const {
    summaries, selectedKey, unreadTotal, loading, onSelect, onRefresh,
    totalThreadCount, filterActive, onClearFilters, parentCaseThreadCount,
  } = props;

  const listRef = React.useRef<HTMLDivElement>(null);
  // Remembered across focus loss, per the interaction spec.
  const [focusIndex, setFocusIndex] = React.useState(0);

  const unread = summaries.filter((s) => s.unreadCount > 0 && !s.parentCaseNumber);
  const read = summaries.filter((s) => s.unreadCount === 0 && !s.parentCaseNumber);
  const parent = summaries.filter((s) => !!s.parentCaseNumber);
  const ordered = [...unread, ...read, ...parent];

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (ordered.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown'
        ? Math.min(ordered.length - 1, focusIndex + 1)
        : Math.max(0, focusIndex - 1);
      setFocusIndex(next);
      // Keep the focused row in view without stealing the page's scroll.
      listRef.current?.querySelectorAll('[data-thread-row]')[next]
        ?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(ordered[focusIndex].thread.key);
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
        <IconButton label="New email">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M10 4.5v11M4.5 10h11" /></svg>
        </IconButton>
        <IconButton label="Filter" active={filterActive}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3.5 5h13M6 10h8M8.5 15h3" /></svg>
        </IconButton>
        <IconButton label="Refresh" onClick={onRefresh}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M16 10a6 6 0 1 1-2.2-4.6" /><path d="M16.2 3.6v3h-3" /></svg>
        </IconButton>
      </CardHeader>

      {/* Fixed-height search. Nothing above the scroll region may grow. */}
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
          <span style={{ fontSize: '14px', color: T.fg4 }}>Search email on this case</span>
        </div>
      </div>

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
        {loading && <ListSkeleton />}

        {!loading && ordered.length === 0 && (
          <EmptyList filterActive={filterActive} total={totalThreadCount} onClearFilters={onClearFilters} />
        )}

        {!loading && unread.length > 0 && <GroupHeader label="Unread" count={unread.length} />}
        {!loading && unread.map((s) => (
          <ThreadRow
            key={s.thread.key}
            summary={s}
            selected={s.thread.key === selectedKey}
            focused={ordered[focusIndex]?.thread.key === s.thread.key}
            onSelect={() => { setFocusIndex(ordered.indexOf(s)); onSelect(s.thread.key); }}
          />
        ))}

        {!loading && read.length > 0 && <GroupHeader label="Earlier" count={read.length} />}
        {!loading && read.map((s) => (
          <ThreadRow
            key={s.thread.key}
            summary={s}
            selected={s.thread.key === selectedKey}
            focused={ordered[focusIndex]?.thread.key === s.thread.key}
            onSelect={() => { setFocusIndex(ordered.indexOf(s)); onSelect(s.thread.key); }}
          />
        ))}

        {!loading && parent.length > 0 && (
          <GroupHeader label="Parent case" note={parent[0].parentCaseNumber} tone="warn" />
        )}
        {!loading && parent.map((s) => (
          <ThreadRow
            key={s.thread.key}
            summary={s}
            selected={s.thread.key === selectedKey}
            focused={ordered[focusIndex]?.thread.key === s.thread.key}
            onSelect={() => { setFocusIndex(ordered.indexOf(s)); onSelect(s.thread.key); }}
          />
        ))}
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
  onSelect: () => void;
}> = ({ summary, selected, focused, onSelect }) => {
  const unread = summary.unreadCount > 0;
  const fromParent = !!summary.parentCaseNumber;
  const subject = normaliseSubjectForDisplay(summary.thread.subject);
  const lead = summary.participants[0] ?? '(unknown)';

  // Three unread signals at once: edge bar, dot, weight. Never colour alone (N6).
  const edge = unread ? T.brandBg : fromParent ? '#f2c811' : 'transparent';

  return (
    <div
      data-thread-row=""
      role="option"
      aria-selected={selected}
      aria-label={
        `${unread ? 'Unread. ' : ''}${subject}. ` +
        `${summary.thread.messages.length} messages${unread ? `, ${summary.unreadCount} unread` : ''}. ` +
        `Latest from ${lead}, ${formatWhen(summary.lastActivity)}.` +
        `${summary.hasAttachments ? ' Has attachments.' : ''}` +
        `${fromParent ? ` From parent case ${summary.parentCaseNumber}.` : ''}`
      }
      onClick={onSelect}
      style={{
        display: 'flex',
        gap: '10px',
        padding: '8px 12px',
        paddingLeft: '9px',
        boxSizing: 'border-box',
        borderLeft: `3px solid ${edge}`,
        background: selected ? T.brandBg2 : fromParent ? '#fffbe6' : 'transparent',
        borderTop: `1px solid ${T.stroke3}`,
        cursor: 'pointer',
        outline: focused ? `2px solid ${T.focus}` : 'none',
        outlineOffset: '-2px',
      }}
    >
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
 * The empty state, which is two different states wearing the same clothes.
 *
 * Saying WHICH matters: "no results" and "this customer has never emailed" look identical unless
 * the count is stated, and the wrong reading changes how an agent handles the case.
 */
const EmptyList: React.FC<{ filterActive: boolean; total: number; onClearFilters: () => void }> = ({
  filterActive, total, onClearFilters,
}) => (
  <div
    style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '8px', padding: '32px 24px', boxSizing: 'border-box', textAlign: 'center',
    }}
  >
    <svg width="38" height="38" viewBox="0 0 20 20" fill="none" stroke="#c8c6c4" strokeWidth="1.1" aria-hidden="true">
      {filterActive
        ? <><circle cx="8.5" cy="8.5" r="5.5" /><path d="M12.8 12.8 17 17" /></>
        : <><path d="M2.5 5.5h15v9h-15z" /><path d="m2.5 6 7.5 5 7.5-5" /></>}
    </svg>

    {filterActive ? (
      <>
        <span style={{ fontSize: '14px', fontWeight: 600, color: T.fg1 }}>No email matches these filters</span>
        <span style={{ fontSize: '12px', color: T.fg3 }}>
          This case has <strong>{total} {total === 1 ? 'thread' : 'threads'}</strong>. They are hidden
          by the filters, not missing.
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
      </>
    ) : (
      <>
        {/* "yet" is doing real work: it separates "nothing here" from "something is wrong". */}
        <span style={{ fontSize: '14px', fontWeight: 600, color: T.fg1 }}>No email on this case yet</span>
        <span style={{ fontSize: '12px', color: T.fg3 }}>
          When the customer writes in, or you send the first message, it appears here.
        </span>
      </>
    )}
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
