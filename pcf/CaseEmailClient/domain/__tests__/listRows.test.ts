import { describe, it, expect } from 'vitest';
import {
  buildListRows, firstFocusable, initialExpansion, isFocusable, nextFocusable,
  parentThreadIndex, type ListRow, type ThreadRowData,
} from '../listRows';
import type { EmailRow, Thread } from '../threading';

const msg = (id: string, incoming = true): EmailRow => ({
  activityid: id,
  subject: 'Forespørgsel på ordrestatus',
  directioncode: !incoming,
  statuscode: 3,
  createdon: '2026-01-20T14:42:00Z',
  baseconversationindexhash: 1,
  conversationindex: null,
  attachmentcount: 0,
});

const thread = (key: string, messages: EmailRow[]): Thread => ({
  key, groupedBy: 'hash', subject: 'Forespørgsel på ordrestatus', messages,
  orderedByCreatedOnFallback: false,
});

const summary = (
  key: string, messages: EmailRow[], over: Partial<ThreadRowData> = {},
): ThreadRowData => ({
  thread: thread(key, messages), unreadCount: 0, ...over,
});

const kinds = (rows: ListRow[]) => rows.map((r) => `${r.kind}:${r.id}`);

describe('buildListRows — grouping', () => {
  const unreadThread = summary('t-unread', [msg('u1'), msg('u2')], { unreadCount: 1 });
  const readThread = summary('t-read', [msg('r1'), msg('r2')]);
  const borrowed = summary('t-parent', [msg('p1')], { parentCaseNumber: 'CAS-01016' });

  it('orders unread, then Earlier, then Parent case', () => {
    const rows = buildListRows([readThread, unreadThread, borrowed], new Set(), new Set());
    expect(kinds(rows)).toEqual([
      'group:g-unread', 'thread:t-unread',
      'group:g-earlier', 'thread:t-read',
      'group:g-parent', 'thread:t-parent',
    ]);
  });

  it('omits a group header when its group is empty', () => {
    const rows = buildListRows([unreadThread], new Set(), new Set());
    // Only the Unread header — no Earlier, no Parent case.
    expect(rows.filter((r) => r.kind === 'group').map((r) => r.id)).toEqual(['g-unread']);
  });

  it('carries the parent case number onto the group header', () => {
    const rows = buildListRows([borrowed], new Set(), new Set());
    const header = rows.find((r) => r.kind === 'group');
    expect(header).toMatchObject({ note: 'CAS-01016', tone: 'warn' });
  });

  it('renders no message rows when nothing is expanded', () => {
    const rows = buildListRows([unreadThread, readThread], new Set(), new Set());
    expect(rows.some((r) => r.kind === 'message')).toBe(false);
  });
});

describe('buildListRows — expansion', () => {
  const a = summary('t-a', [msg('a1'), msg('a2'), msg('a3')], { unreadCount: 1 });
  const b = summary('t-b', [msg('b1'), msg('b2')], { unreadCount: 1 });

  it('puts a conversation’s messages immediately after it, NEWEST first', () => {
    // Matching the conversations above them, which are already most-recently-active first, and
    // every mail client's list. `thread.messages` stays chronological for the reading pane.
    const rows = buildListRows([a, b], new Set(['t-a']), new Set());
    expect(kinds(rows)).toEqual([
      'group:g-unread',
      'thread:t-a', 'message:a3', 'message:a2', 'message:a1',
      'thread:t-b',
    ]);
  });

  it('does NOT mutate the thread it was given', () => {
    // Reversing in place here would silently flip the reading pane, which stacks the same array.
    const order = a.thread.messages.map((m) => m.activityid);
    buildListRows([a], new Set(['t-a']), new Set());
    expect(a.thread.messages.map((m) => m.activityid)).toEqual(order);
  });

  it('numbers positions CHRONOLOGICALLY, not by row position', () => {
    // "Message 5 of 5" means the fifth message sent, not the fifth row down — so the newest row,
    // which is first, is the highest number.
    const rows = buildListRows([a], new Set(['t-a']), new Set());
    const messages = rows.filter((r) => r.kind === 'message');
    expect(messages.map((m) => m.kind === 'message' && `${m.id}:${m.position}/${m.of}`))
      .toEqual(['a3:3/3', 'a2:2/3', 'a1:1/3']);
  });

  it('expands several conversations independently', () => {
    const rows = buildListRows([a, b], new Set(['t-a', 't-b']), new Set());
    expect(rows.filter((r) => r.kind === 'message')).toHaveLength(5);
  });

  it('marks a single-message conversation NOT expandable, and never expands it', () => {
    // A chevron that reveals one row duplicating the header above it is noise.
    const single = summary('t-one', [msg('only')], { unreadCount: 1 });
    const rows = buildListRows([single], new Set(['t-one']), new Set());
    expect(rows.filter((r) => r.kind === 'thread')).toHaveLength(1);
    expect(rows.some((r) => r.kind === 'message')).toBe(false);
    expect(rows[1]).toMatchObject({ kind: 'thread', expandable: false, expanded: false });
  });

  it('marks unread per MESSAGE, and only incoming mail can be unread', () => {
    // The rule lives in domain/unread.ts; this is the list honouring it rather than re-deriving it.
    const mixed = summary('t-m', [msg('in1'), msg('out1', false)], { unreadCount: 1 });
    const rows = buildListRows([mixed], new Set(['t-m']), new Set());
    const messages = rows.filter((r) => r.kind === 'message');
    // Newest first, so the outgoing reply comes before the incoming original.
    expect(messages.map((m) => m.kind === 'message' && m.unread)).toEqual([false, true]);
  });

  it('respects read state on the child rows', () => {
    const rows = buildListRows([a], new Set(['t-a']), new Set(['a1']));
    const messages = rows.filter((r) => r.kind === 'message');
    // a3, a2, a1 — a1 is read, and it is now last.
    expect(messages.map((m) => m.kind === 'message' && m.unread)).toEqual([true, true, false]);
  });

  it('carries the parent case number down to child rows, so a borrowed message keeps its tint', () => {
    const borrowed = summary('t-p', [msg('p1'), msg('p2')], { parentCaseNumber: 'CAS-01016' });
    const rows = buildListRows([borrowed], new Set(['t-p']), new Set());
    const child = rows.find((r) => r.kind === 'message');
    expect(child).toMatchObject({ parentCaseNumber: 'CAS-01016' });
  });

  it('ignores an expansion key for a conversation that is no longer there', () => {
    // Restored state outlives a reload; a filtered-out or deleted thread must not throw.
    expect(() => buildListRows([a], new Set(['t-gone']), new Set())).not.toThrow();
    expect(buildListRows([a], new Set(['t-gone']), new Set()).filter((r) => r.kind === 'message'))
      .toHaveLength(0);
  });
});

describe('keyboard navigation', () => {
  const a = summary('t-a', [msg('a1'), msg('a2')], { unreadCount: 1 });
  const b = summary('t-b', [msg('b1'), msg('b2')]);
  const rows = buildListRows([a, b], new Set(['t-a']), new Set());
  // group:g-unread, thread:t-a, message:a2, message:a1, group:g-earlier, thread:t-b
  //      0            1           2           3             4              5

  it('steps into expanded children', () => {
    expect(nextFocusable(rows, 0, 1)).toBe(1);
    expect(nextFocusable(rows, 1, 1)).toBe(2);
  });

  it('STEPS OVER group headers in both directions', () => {
    // Arrowing onto a header that cannot be actioned is the small wrongness that makes a custom
    // list feel unfinished.
    expect(rows[4].kind).toBe('group');
    expect(nextFocusable(rows, 3, 1)).toBe(5);
    expect(nextFocusable(rows, 5, -1)).toBe(3);
  });

  it('parks at the ends rather than wrapping', () => {
    // Down at the bottom jumping to the top loses your place without saying so.
    expect(nextFocusable(rows, 5, 1)).toBe(5);
    // Index 1 is the first focusable row; Up from there stays put rather than landing on the header.
    expect(nextFocusable(rows, 1, -1)).toBe(1);
  });

  it('finds the first focusable row even when a group header leads', () => {
    const onlyBorrowed = buildListRows(
      [summary('t-p', [msg('p1')], { parentCaseNumber: 'C' })], new Set(), new Set(),
    );
    expect(onlyBorrowed[0].kind).toBe('group');
    expect(firstFocusable(onlyBorrowed)).toBe(1);
  });

  it('returns 0 for an empty list rather than -1', () => {
    expect(firstFocusable([])).toBe(0);
  });

  it('walks back to the owning conversation from a child row', () => {
    // Where Left goes: collapsing from a child must move focus to the header that swallowed it.
    expect(parentThreadIndex(rows, 3)).toBe(1);
    expect(parentThreadIndex(rows, 2)).toBe(1);
  });

  it('is a no-op on a conversation row', () => {
    expect(parentThreadIndex(rows, 5)).toBe(5);
  });

  it('isFocusable excludes only group headers', () => {
    expect(rows.filter(isFocusable).map((r) => r.kind)).toEqual(['thread', 'message', 'message', 'thread']);
  });
});

describe('initialExpansion', () => {
  const a = summary('t-a', [msg('a1'), msg('a2')]);
  const single = summary('t-one', [msg('only')]);

  it('opens exactly the conversation holding the message worth landing on', () => {
    expect([...initialExpansion([a, single], 'a2')]).toEqual(['t-a']);
  });

  it('opens nothing when there is no target', () => {
    expect(initialExpansion([a], undefined).size).toBe(0);
  });

  it('opens nothing for a single-message conversation', () => {
    expect(initialExpansion([single], 'only').size).toBe(0);
  });

  it('opens nothing when the target is not in any loaded conversation', () => {
    expect(initialExpansion([a], 'nope').size).toBe(0);
  });

  it('opens ONE conversation, not all of them', () => {
    // Outlook collapses everything by default; we make exactly one exception, for the message the
    // agent is actually being sent to.
    expect(initialExpansion([a, summary('t-b', [msg('b1'), msg('b2')])], 'a1').size).toBe(1);
  });
});
