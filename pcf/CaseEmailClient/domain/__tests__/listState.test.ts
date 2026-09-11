import { describe, it, expect } from 'vitest';
import { listView, type ListStateInput } from '../listState';

const input = (over: Partial<ListStateInput> = {}): ListStateInput => ({
  loading: false,
  error: undefined,
  visibleCount: 0,
  totalCount: 0,
  filterActive: false,
  ...over,
});

describe('listView — the bug this exists to prevent', () => {
  it('shows the ERROR, never the empty state, when the load failed', () => {
    // The shipped bug: listError was passed only to the reading pane, so a failed load left the
    // thread list with zero rows and nothing loading, and it rendered "No email on this case yet".
    // A failure presented as a customer who had never written in.
    expect(listView(input({ error: new Error('boom') }))).toBe('error');
    expect(listView(input({ error: { message: 'privilege check failed' } }))).toBe('error');
    expect(listView(input({ error: 'string failures count too' }))).toBe('error');
  });

  it('keeps showing the error while a retry is in flight', () => {
    // Swapping the message for a skeleton on every retry is how a failure becomes invisible:
    // the agent clicks Try again, sees shimmer, sees nothing, and concludes the case is empty.
    expect(listView(input({ error: new Error('boom'), loading: true }))).toBe('error');
  });

  it('shows the error even when rows from a previous load are still in hand', () => {
    expect(listView(input({ error: new Error('boom'), visibleCount: 3, totalCount: 3 }))).toBe('error');
  });
});

describe('listView — the two empties are different states', () => {
  it('says "empty" only when there is genuinely no mail and no filter', () => {
    expect(listView(input())).toBe('empty');
  });

  it('says "empty-filtered" when mail exists but the filters hide it', () => {
    expect(listView(input({ totalCount: 3, filterActive: true }))).toBe('empty-filtered');
  });

  it('does NOT claim "filtered" when a filter is on but the case really has no mail', () => {
    // Otherwise the UI offers "clear your filters to see 0 threads", which is nonsense.
    expect(listView(input({ totalCount: 0, filterActive: true }))).toBe('empty');
  });
});

describe('listView — the ordinary states', () => {
  it('loads before it decides anything', () => {
    expect(listView(input({ loading: true }))).toBe('loading');
    expect(listView(input({ loading: true, totalCount: 5 }))).toBe('loading');
  });

  it('renders rows when there are any', () => {
    expect(listView(input({ visibleCount: 3, totalCount: 3 }))).toBe('rows');
    expect(listView(input({ visibleCount: 1, totalCount: 9, filterActive: true }))).toBe('rows');
  });

  it('prefers rows over loading once something is in hand', () => {
    // A background refresh must not blank the list the agent is reading.
    expect(listView(input({ visibleCount: 3, totalCount: 3, loading: false }))).toBe('rows');
  });
});

describe('listView — precedence, stated once', () => {
  it('is error > loading > rows > filtered-empty > empty', () => {
    const all = { error: new Error('x'), loading: true, visibleCount: 5, totalCount: 9, filterActive: true };
    expect(listView(all)).toBe('error');
    expect(listView({ ...all, error: undefined })).toBe('loading');
    expect(listView({ ...all, error: undefined, loading: false })).toBe('rows');
    expect(listView({ ...all, error: undefined, loading: false, visibleCount: 0 })).toBe('empty-filtered');
    expect(listView({ ...all, error: undefined, loading: false, visibleCount: 0, filterActive: false })).toBe('empty');
  });
});
