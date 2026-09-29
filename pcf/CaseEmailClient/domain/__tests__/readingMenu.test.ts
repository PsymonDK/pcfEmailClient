import { describe, it, expect } from 'vitest';
import { readingMenuTargets } from '../readingMenu';

const IN_1 = { activityid: 'in-1', directioncode: false };
const OUT_1 = { activityid: 'out-1', directioncode: true };
const IN_2 = { activityid: 'in-2', directioncode: false };
const OUT_2 = { activityid: 'out-2', directioncode: true };
const thread = [IN_1, OUT_1, IN_2, OUT_2]; // chronological, as thread.messages is

const state = (unread: string[] = [], expanded: string[] = [], collapsedOlder = 0) => ({
  isUnread: (id: string) => unread.includes(id),
  isExpanded: (id: string) => expanded.includes(id),
  collapsedOlder,
});

describe('readingMenuTargets — Open in email form', () => {
  it('opens the selected message, else the newest', () => {
    expect(readingMenuTargets(thread, 'in-1', state()).openId).toBe('in-1');
    expect(readingMenuTargets(thread, undefined, state()).openId).toBe('out-2');
    // A selection from another thread is not this thread's selection.
    expect(readingMenuTargets(thread, 'elsewhere', state()).openId).toBe('out-2');
  });

  it('has nothing to open in an empty thread', () => {
    expect(readingMenuTargets([], undefined, state()).openId).toBeUndefined();
  });
});

describe('readingMenuTargets — Mark as unread', () => {
  it('marks the selected RECEIVED message', () => {
    expect(readingMenuTargets(thread, 'in-1', state()).unread).toEqual({ id: 'in-1' });
  });

  it('with nothing selected, marks the newest received message — not the newest message', () => {
    expect(readingMenuTargets(thread, undefined, state()).unread).toEqual({ id: 'in-2' });
  });

  it('refuses a selected SENT message rather than quietly marking a different one', () => {
    expect(readingMenuTargets(thread, 'out-1', state()).unread).toEqual({
      reason: 'Only received mail can be marked unread.',
    });
  });

  it('says so when the target is already unread, or there is no received mail', () => {
    expect(readingMenuTargets(thread, 'in-2', state(['in-2'])).unread).toEqual({ reason: 'Already unread.' });
    expect(readingMenuTargets([OUT_1, OUT_2], undefined, state()).unread).toEqual({
      reason: 'This conversation has no received mail to mark unread.',
    });
  });
});

describe('readingMenuTargets — Expand all / Collapse all', () => {
  it('offers each only when it would change something', () => {
    const all = thread.map((m) => m.activityid);
    expect(readingMenuTargets(thread, undefined, state([], all))).toMatchObject({ canExpandAll: false, canCollapseAll: true });
    expect(readingMenuTargets(thread, undefined, state([], []))).toMatchObject({ canExpandAll: true, canCollapseAll: false });
  });

  it('counts messages folded into "N earlier messages" as collapsed', () => {
    const all = thread.map((m) => m.activityid);
    expect(readingMenuTargets(thread, undefined, state([], all, 2)).canExpandAll).toBe(true);
  });
});
