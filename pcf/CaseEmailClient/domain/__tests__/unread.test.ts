import { describe, it, expect } from 'vitest';
import {
  collapsedOlderCount, isIncoming, isUnread, messageToOpen, worthPersisting,
} from '../unread';

/** Shaped like the real thing: `directioncode` false = incoming, true = outgoing. */
const msg = (id: string, incoming: boolean) => ({ activityid: id, directioncode: !incoming });

const IN_OLD = msg('a', true);
const OUT_1 = msg('b', false);
const OUT_2 = msg('c', false);
const IN_NEW = msg('d', true);
const OUT_3 = msg('e', false);

describe('isIncoming', () => {
  it('reads directioncode false as incoming and true as outgoing', () => {
    expect(isIncoming({ directioncode: false })).toBe(true);
    expect(isIncoming({ directioncode: true })).toBe(false);
  });

  it('does not treat a missing directioncode as incoming', () => {
    // `!m.directioncode` would say "incoming" for a malformed row, which would then show an unread
    // dot on mail nobody received. Explicit `=== false` instead.
    expect(isIncoming({ directioncode: undefined as unknown as boolean })).toBe(false);
  });
});

describe('isUnread', () => {
  it('is true only for incoming mail this agent has not read', () => {
    expect(isUnread(IN_OLD, new Set())).toBe(true);
    expect(isUnread(IN_OLD, new Set(['a']))).toBe(false);
  });

  it('is NEVER true for our own sent mail, read or not', () => {
    // The bug this module exists for: the list badge applied this rule and the reading pane did
    // not, so the pane treated four outgoing replies as waiting to be read.
    expect(isUnread(OUT_1, new Set())).toBe(false);
    expect(isUnread(OUT_1, new Set(['b']))).toBe(false);
  });
});

describe('messageToOpen', () => {
  const thread = [IN_OLD, OUT_1, OUT_2, IN_NEW, OUT_3]; // oldest first, as buildThreads returns

  it('opens the NEWEST unread incoming message, not the newest message', () => {
    expect(messageToOpen(thread, new Set())?.activityid).toBe('d');
  });

  it('skips outgoing mail when looking for something unread', () => {
    // Measured in the published app 2026-09-22: without this, each reload opened the next
    // outgoing message and marked it read, one per visit.
    expect(messageToOpen(thread, new Set(['d']))?.activityid).toBe('a');
  });

  it('falls back to the newest message when nothing is unread', () => {
    expect(messageToOpen(thread, new Set(['a', 'd']))?.activityid).toBe('e');
  });

  it('opens the newest message in an all-outgoing thread', () => {
    expect(messageToOpen([OUT_1, OUT_2, OUT_3], new Set())?.activityid).toBe('e');
  });

  it('returns undefined for an empty thread rather than throwing', () => {
    expect(messageToOpen([], new Set())).toBeUndefined();
  });

  it('prefers the newest unread when several are unread', () => {
    expect(messageToOpen([IN_OLD, IN_NEW], new Set())?.activityid).toBe('d');
  });
});

describe('worthPersisting', () => {
  it('stores incoming read state and skips outgoing', () => {
    // A row for an outgoing message can never change what anyone sees — it is one wasted row per
    // message per agent, on a table that grows with every reply.
    expect(worthPersisting({ directioncode: false })).toBe(true);
    expect(worthPersisting({ directioncode: true })).toBe(false);
  });
});

describe('collapsedOlderCount', () => {
  it('folds all but the last three when the open message is recent', () => {
    expect(collapsedOlderCount(6, 5)).toBe(3);
  });

  it('never folds past the message being opened', () => {
    // The bug: a thread whose only unread message was the OLDEST opened with nothing expanded,
    // because the target sat inside the folded group.
    expect(collapsedOlderCount(5, 0)).toBe(0);
    expect(collapsedOlderCount(6, 1)).toBe(1);
  });

  it('folds nothing in a short thread', () => {
    expect(collapsedOlderCount(3, 2)).toBe(0);
    expect(collapsedOlderCount(1, 0)).toBe(0);
  });

  it('never returns a negative count', () => {
    expect(collapsedOlderCount(2, 1)).toBe(0);
    expect(collapsedOlderCount(0, -1)).toBe(0);
  });
});
