import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTER, clearClause, describeFilter, filterThreads, isFilterActive,
  participantOptions, type ParticipantIndex, type ThreadFilter,
} from '../filter';
import type { EmailRow, Thread } from '../threading';

const row = (over: Partial<EmailRow> & { activityid: string }): EmailRow => ({
  subject: 'Forespørgsel på ordrestatus',
  directioncode: false,
  statuscode: 3,
  createdon: '2026-01-20T14:42:00Z',
  baseconversationindexhash: 1,
  conversationindex: null,
  attachmentcount: 0,
  ...over,
});

const thread = (key: string, subject: string, messages: EmailRow[]): Thread => ({
  key, groupedBy: 'hash', subject, messages, orderedByCreatedOnFallback: false,
});

/**
 * The participant index, built the way the shell builds it from activityparty rows.
 *
 * `searchable` is names and addresses; `people` is one display name per participant. Pass
 * `people` explicitly when a test needs them to differ.
 */
const index = (
  map: Record<string, string[]>,
  people?: Record<string, string[]>,
): ParticipantIndex => ({
  searchable: (id) => map[id],
  people: (id) => (people ?? map)[id],
});

const A1 = row({ activityid: 'a1', subject: 'Forespørgsel på ordrestatus' });
const A2 = row({
  activityid: 'a2', subject: 'RE: Forespørgsel på ordrestatus',
  directioncode: true, createdon: '2026-06-04T08:41:00Z', attachmentcount: 2,
});
const B1 = row({
  activityid: 'b1', subject: 'Reklamation: utætte samlinger',
  createdon: '2026-03-02T09:00:00Z',
});

const THREADS = [
  thread('t-a', 'Forespørgsel på ordrestatus', [A1, A2]),
  thread('t-b', 'Reklamation: utætte samlinger', [B1]),
];

const PARTIES = index({
  a1: ['Mette Nielsen', 'mette@metalservice.dk', 'Care'],
  a2: ['Care', 'care@example.invalid', 'Mette Nielsen'],
  b1: ['Søren Madsen', 'soren@nordbyg.dk', 'Care'],
});

const f = (over: Partial<ThreadFilter> = {}): ThreadFilter => ({ ...EMPTY_FILTER, ...over });

describe('isFilterActive', () => {
  it('is false for the empty filter', () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
  });

  it('ignores whitespace-only text', () => {
    // Otherwise a stray space shows the "no results, clear filters" state over a full list.
    expect(isFilterActive(f({ text: '   ' }))).toBe(false);
  });

  it('is true for each clause on its own', () => {
    expect(isFilterActive(f({ text: 'ordre' }))).toBe(true);
    expect(isFilterActive(f({ participant: 'Care' }))).toBe(true);
    expect(isFilterActive(f({ hasAttachment: true }))).toBe(true);
    expect(isFilterActive(f({ unreadOnly: true }))).toBe(true);
    expect(isFilterActive(f({ from: '2026-01-01' }))).toBe(true);
    expect(isFilterActive(f({ to: '2026-12-31' }))).toBe(true);
  });
});

describe('filterThreads', () => {
  const run = (filter: Partial<ThreadFilter>, read = new Set<string>()) =>
    filterThreads(THREADS, PARTIES, read, f(filter)).map((t) => t.key);

  it('returns every thread when nothing is filtered', () => {
    expect(run({})).toEqual(['t-a', 't-b']);
  });

  it('matches on subject', () => {
    expect(run({ text: 'reklamation' })).toEqual(['t-b']);
  });

  it('matches on a participant name and on an address', () => {
    expect(run({ text: 'søren' })).toEqual(['t-b']);
    expect(run({ text: 'metalservice.dk' })).toEqual(['t-a']);
  });

  it('is case-insensitive', () => {
    expect(run({ text: 'REKLAMATION' })).toEqual(['t-b']);
  });

  it('requires ALL terms, not any', () => {
    // Typing two words and getting results that match either is what people read as broken search.
    expect(run({ text: 'reklamation samlinger' })).toEqual(['t-b']);
    expect(run({ text: 'reklamation ordrestatus' })).toEqual([]);
  });

  it('keeps a thread whole when only one message matches', () => {
    // A thread matches if ANY message does, and then the conversation stays intact — hiding the
    // reply that quotes the match would make the result misleading rather than focused.
    const out = filterThreads(THREADS, PARTIES, new Set(), f({ hasAttachment: true }));
    expect(out.map((t) => t.key)).toEqual(['t-a']);
    expect(out[0].messages).toHaveLength(2);
  });

  it('filters by has-attachment', () => {
    expect(run({ hasAttachment: true })).toEqual(['t-a']);
  });

  it('treats a null attachmentcount as no attachment', () => {
    const t = [thread('t-n', 'x', [row({ activityid: 'n1', attachmentcount: null })])];
    expect(filterThreads(t, index({}), new Set(), f({ hasAttachment: true }))).toEqual([]);
  });

  it('filters by unread, and only incoming mail can be unread', () => {
    // a2 is outgoing with an attachment; unreadOnly must not match it even though it is unread
    // in the naive sense. That rule lives in domain/unread.ts.
    expect(run({ unreadOnly: true })).toEqual(['t-a', 't-b']);
    expect(run({ unreadOnly: true }, new Set(['a1']))).toEqual(['t-b']);
    expect(run({ unreadOnly: true, hasAttachment: true })).toEqual([]);
  });

  it('filters by an inclusive date range', () => {
    expect(run({ from: '2026-03-01', to: '2026-03-31' })).toEqual(['t-b']);
    // Inclusive on both ends — B1 is exactly 2026-03-02.
    expect(run({ from: '2026-03-02', to: '2026-03-02' })).toEqual(['t-b']);
  });

  it('accepts an open-ended bound', () => {
    expect(run({ from: '2026-06-01' })).toEqual(['t-a']);
    expect(run({ to: '2026-02-01' })).toEqual(['t-a']);
  });

  it('combines clauses with AND', () => {
    expect(run({ text: 'ordrestatus', hasAttachment: true })).toEqual(['t-a']);
    expect(run({ text: 'reklamation', hasAttachment: true })).toEqual([]);
  });

  it('matches a participant exactly, so "Care" does not match "Care Demo"', () => {
    const t = [thread('t-c', 'x', [row({ activityid: 'c1' })])];
    const p = index({ c1: ['Care Demo'] });
    expect(filterThreads(t, p, new Set(), f({ participant: 'Care' }))).toEqual([]);
    expect(filterThreads(t, p, new Set(), f({ participant: 'Care Demo' })).length).toBe(1);
  });

  it('matches the THREAD subject when the message subject is null', () => {
    const t = [thread('t-d', 'Reklamation: utætte samlinger', [row({ activityid: 'd1', subject: null })])];
    expect(filterThreads(t, index({}), new Set(), f({ text: 'reklamation' })).length).toBe(1);
  });

  it('does not match across the subject/participant boundary', () => {
    // Fields are joined with a separator that cannot appear in the data, so a term cannot span
    // the end of the subject and the start of a name.
    const t = [thread('t-e', 'Ordre', [row({ activityid: 'e1', subject: 'Ordre' })])];
    expect(filterThreads(t, index({ e1: ['Nielsen'] }), new Set(), f({ text: 'ordrenielsen' }))).toEqual([]);
  });

  it('survives a malformed createdon rather than throwing', () => {
    const t = [thread('t-f', 'x', [row({ activityid: 'f1', createdon: 'not a date' })])];
    expect(filterThreads(t, index({}), new Set(), f({ from: '2026-01-01' }))).toEqual([]);
    // With no date clause it is still listed — a bad timestamp must not hide mail.
    expect(filterThreads(t, index({}), new Set(), f({ text: 'x' })).length).toBe(1);
  });

  it('returns nothing rather than everything when nothing matches', () => {
    expect(run({ text: 'zzzz' })).toEqual([]);
  });
});

describe('describeFilter', () => {
  it('produces one chip per active clause', () => {
    const chips = describeFilter(f({ text: 'ordre', hasAttachment: true, unreadOnly: true }));
    expect(chips.map((c) => c.key)).toEqual(['text', 'hasAttachment', 'unreadOnly']);
  });

  it('collapses a date range into one chip', () => {
    expect(describeFilter(f({ from: '2026-01-01', to: '2026-06-30' })))
      .toEqual([{ key: 'dates', label: '2026-01-01 to 2026-06-30' }]);
  });

  it('labels an open-ended bound in the direction it applies', () => {
    expect(describeFilter(f({ from: '2026-01-01' }))[0].label).toBe('From 2026-01-01');
    expect(describeFilter(f({ to: '2026-06-30' }))[0].label).toBe('Until 2026-06-30');
  });

  it('is empty for the empty filter', () => {
    expect(describeFilter(EMPTY_FILTER)).toEqual([]);
  });

  it('shows the search term quoted, trimmed', () => {
    expect(describeFilter(f({ text: '  ordre  ' }))[0].label).toBe('"ordre"');
  });
});

describe('clearClause', () => {
  it('removes exactly the clause named and leaves the rest', () => {
    const full = f({ text: 'a', participant: 'Care', hasAttachment: true, unreadOnly: true, from: '2026-01-01', to: '2026-02-01' });
    expect(clearClause(full, 'text').text).toBe('');
    expect(clearClause(full, 'text').participant).toBe('Care');
    expect(clearClause(full, 'participant').participant).toBeUndefined();
    expect(clearClause(full, 'hasAttachment').hasAttachment).toBe(false);
    expect(clearClause(full, 'unreadOnly').unreadOnly).toBe(false);
  });

  it('clears BOTH date bounds together, because one chip represents them', () => {
    const dated = f({ from: '2026-01-01', to: '2026-02-01' });
    expect(clearClause(dated, 'dates').from).toBeUndefined();
    expect(clearClause(dated, 'dates').to).toBeUndefined();
  });

  it('does not mutate the filter it was given', () => {
    const before = f({ text: 'ordre' });
    clearClause(before, 'text');
    expect(before.text).toBe('ordre');
  });

  it('clearing every clause leaves an inactive filter', () => {
    let current = f({ text: 'a', participant: 'Care', hasAttachment: true, unreadOnly: true, from: '2026-01-01' });
    for (const chip of describeFilter(current)) current = clearClause(current, chip.key);
    expect(isFilterActive(current)).toBe(false);
  });
});

describe('participantOptions', () => {
  it('lists each participant once, most frequent first', () => {
    // Care is on all three messages, Mette on two. The customer and the handling agent should
    // reach the top of the panel rather than whoever sorts alphabetically.
    expect(participantOptions(THREADS, PARTIES).slice(0, 2)).toEqual(['Care', 'Mette Nielsen']);
  });

  it('lists PEOPLE, not every searchable string', () => {
    // Seen in the published app 2026-09-22: built from the searchable list, the dropdown offered
    // "Care" and "caredemo@…onmicrosoft.com" as two separate choices for one person.
    const t = [thread('t', 'x', [row({ activityid: '1' })])];
    const p = index(
      { 1: ['Care', 'care@example.invalid'] },  // searchable
      { 1: ['Care'] },                                             // people
    );
    expect(participantOptions(t, p)).toEqual(['Care']);
    // …but free text still finds the address.
    expect(filterThreads(t, p, new Set(), f({ text: 'onmicrosoft' })).length).toBe(1);
  });

  it('breaks ties alphabetically so the order is stable', () => {
    const t = [thread('t', 'x', [row({ activityid: '1' })])];
    expect(participantOptions(t, index({ 1: ['Zoe', 'Anna'] }))).toEqual(['Anna', 'Zoe']);
  });

  it('skips blank names', () => {
    const t = [thread('t', 'x', [row({ activityid: '1' })])];
    expect(participantOptions(t, index({ 1: ['', '  ', 'Anna'] }))).toEqual(['Anna']);
  });

  it('is empty when nothing is loaded', () => {
    expect(participantOptions([], index({}))).toEqual([]);
  });
});
