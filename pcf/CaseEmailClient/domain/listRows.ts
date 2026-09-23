import type { EmailRow, Thread } from './threading';
import { isUnread } from './unread';

/**
 * The thread list as a flat sequence of rows — Outlook-style expandable conversations (issue #4).
 *
 * **Why flat.** The list now renders three kinds of row (group headers, conversations, and the
 * messages of an expanded conversation) and the keyboard has to walk them as one sequence, because
 * the whole list is a single tab stop with arrow keys inside. Rendering a tree and navigating it
 * separately means two descriptions of the same order that drift apart — and the order was already
 * triplicated across three `.map()` calls before this existed. One list, built once, read by both.
 *
 * Group headers are rows so that rendering stays a single pass, but they are **not focusable** —
 * `nextFocusable` steps over them. Arrowing onto a header that cannot be actioned is the small
 * wrongness that makes a custom list feel unfinished.
 */

/** The shape a caller needs to render one conversation row. Mirrors `ui/ThreadList`'s summary. */
export interface ThreadRowData {
  thread: Thread;
  unreadCount: number;
  parentCaseNumber?: string;
}

export type ListRow<S extends ThreadRowData = ThreadRowData> =
  | {
    kind: 'group';
    /** Stable key for React and for tests; never focused. */
    id: string;
    label: string;
    count?: number;
    note?: string;
    tone?: 'warn';
  }
  | {
    kind: 'thread';
    id: string;
    summary: S;
    expanded: boolean;
    /** False for a single-message conversation: there is nothing to expand into. */
    expandable: boolean;
  }
  | {
    kind: 'message';
    id: string;
    threadKey: string;
    message: EmailRow;
    /** 1-based position in the conversation, for the row's accessible name. */
    position: number;
    of: number;
    unread: boolean;
    /** Carried down from the conversation so a borrowed message keeps its tint (R8). */
    parentCaseNumber?: string;
  };

/**
 * Groups conversations the way the design orders them, and expands the ones asked for.
 *
 * Ordering is unchanged from before: unread first, then earlier, then anything borrowed from an
 * ancestor case. A conversation's messages follow it immediately, oldest first — the same order the
 * reading pane stacks them in, because two different orders for the same conversation is the kind
 * of inconsistency nobody reports and everybody distrusts.
 */
export function buildListRows<S extends ThreadRowData>(
  summaries: readonly S[],
  expandedThreadKeys: ReadonlySet<string>,
  readIds: ReadonlySet<string>,
): ListRow<S>[] {
  const unread = summaries.filter((s) => s.unreadCount > 0 && !s.parentCaseNumber);
  const earlier = summaries.filter((s) => s.unreadCount === 0 && !s.parentCaseNumber);
  const borrowed = summaries.filter((s) => !!s.parentCaseNumber);

  const rows: ListRow<S>[] = [];

  const emit = (summary: S) => {
    const key = summary.thread.key;
    const messages = summary.thread.messages;
    // A one-message conversation has nothing to expand into, and offering a chevron that reveals
    // a single row duplicating the header above it is noise.
    const expandable = messages.length > 1;
    const expanded = expandable && expandedThreadKeys.has(key);
    rows.push({ kind: 'thread', id: key, summary, expanded, expandable });
    if (!expanded) return;
    // NEWEST FIRST, matching the conversations above them and every mail client's list.
    //
    // `thread.messages` is chronological — that is the order the reading pane stacks them in and
    // the order `conversationindex` defines — so the list reverses a copy rather than re-sorting,
    // and `position` stays chronological: "Message 5 of 5" means the fifth message sent, not the
    // fifth row down. Reversing in place here would silently flip the reading pane too.
    const children: ListRow<S>[] = messages.map((message, i) => ({
      kind: 'message' as const,
      id: message.activityid,
      threadKey: key,
      message,
      position: i + 1,
      of: messages.length,
      unread: isUnread(message, readIds),
      parentCaseNumber: summary.parentCaseNumber,
    }));
    children.reverse();
    rows.push(...children);
  };

  if (unread.length > 0) {
    rows.push({ kind: 'group', id: 'g-unread', label: 'Unread', count: unread.length });
    for (const s of unread) emit(s);
  }
  if (earlier.length > 0) {
    rows.push({ kind: 'group', id: 'g-earlier', label: 'Earlier', count: earlier.length });
    for (const s of earlier) emit(s);
  }
  if (borrowed.length > 0) {
    rows.push({
      kind: 'group', id: 'g-parent', label: 'Parent case',
      note: borrowed[0].parentCaseNumber, tone: 'warn',
    });
    for (const s of borrowed) emit(s);
  }
  return rows;
}

/** Whether the keyboard can land on this row. */
export function isFocusable(row: ListRow): boolean {
  return row.kind !== 'group';
}

/**
 * The next row the keyboard should focus, stepping over group headers.
 *
 * Returns the current index when there is nothing further in that direction, so holding an arrow
 * key parks at the end rather than wrapping — wrapping in a mail list means Down at the bottom
 * silently jumps to the top and you lose your place.
 */
export function nextFocusable(
  rows: readonly ListRow[],
  from: number,
  direction: 1 | -1,
): number {
  for (let i = from + direction; i >= 0 && i < rows.length; i += direction) {
    if (isFocusable(rows[i])) return i;
  }
  return from;
}

/** The first focusable row, for the initial focus position. */
export function firstFocusable(rows: readonly ListRow[]): number {
  const i = rows.findIndex(isFocusable);
  return i === -1 ? 0 : i;
}

/**
 * The index of the conversation a row belongs to — where `Left` goes from a message row.
 *
 * Collapsing a conversation from one of its children has to move focus somewhere, and the only
 * non-surprising answer is the header that just swallowed it.
 */
export function parentThreadIndex(rows: readonly ListRow[], from: number): number {
  for (let i = Math.min(from, rows.length - 1); i >= 0; i -= 1) {
    if (rows[i].kind === 'thread') return i;
  }
  return from;
}

/**
 * Which conversations to expand, and which message to land on, for a freshly loaded case.
 *
 * Outlook collapses everything by default, and mostly that is right — but landing an agent on a
 * list where nothing is open and nothing is selected wastes the one thing the client knows: which
 * message is actually waiting for them. So exactly one conversation opens, the one holding that
 * message.
 */
export function initialExpansion<S extends ThreadRowData>(
  summaries: readonly S[],
  targetMessageId: string | undefined,
): Set<string> {
  if (!targetMessageId) return new Set();
  const owner = summaries.find(
    (s) => s.thread.messages.some((m) => m.activityid === targetMessageId),
  );
  // Still nothing to expand for a single-message conversation.
  if (!owner || owner.thread.messages.length < 2) return new Set();
  return new Set([owner.thread.key]);
}
