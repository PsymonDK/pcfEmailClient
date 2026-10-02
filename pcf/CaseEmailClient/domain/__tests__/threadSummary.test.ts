import { describe, it, expect } from 'vitest';
import { toSummary } from '../threadSummary';
import { buildParticipantIndex } from '../filter';
import { ourAddresses, type SenderCandidate } from '../sender';
import type { EmailRow, Thread } from '../threading';

const row = (id: string, over: Partial<EmailRow> = {}): EmailRow => ({
  activityid: id, subject: 'S', directioncode: false, statuscode: 4, createdon: `2026-09-0${id.length}T10:00:00Z`,
  baseconversationindexhash: 1, conversationindex: null, ...over,
});
const thread = (messages: EmailRow[]): Thread => ({
  key: 't', groupedBy: 'hash', subject: 'S', messages, orderedByCreatedOnFallback: true,
});

describe('toSummary (R2)', () => {
  const names: Record<string, string> = { a: 'Kunde', b: 'Care', c: 'Kunde' };
  const senderNameOf = (id: string) => names[id];

  it('counts only INCOMING unread messages', () => {
    const t = thread([row('a'), row('b', { directioncode: true }), row('c')]);
    expect(toSummary(t, senderNameOf, new Set(['a'])).unreadCount).toBe(1);
  });

  it('lists distinct participants, newest first', () => {
    const t = thread([row('a'), row('b', { directioncode: true }), row('c')]);
    expect(toSummary(t, senderNameOf, new Set()).participants).toEqual(['Kunde', 'Care']);
  });

  it('marks a thread borrowed when ANY message hangs off an ancestor case (R8)', () => {
    const t = thread([row('a', { regardingCaseId: 'this' }), row('c', { regardingCaseId: 'parent' })]);
    expect(toSummary(t, senderNameOf, new Set(), new Map([['parent', 'CAS-1']])).parentCaseNumber)
      .toBe('CAS-1');
    expect(toSummary(t, senderNameOf, new Set(), new Map()).parentCaseNumber).toBeUndefined();
  });

  it('knows a draft by its status code', () => {
    expect(toSummary(thread([row('a', { statuscode: 1 })]), senderNameOf, new Set()).hasDraft).toBe(true);
    expect(toSummary(thread([row('a')]), senderNameOf, new Set()).hasDraft).toBe(false);
  });

  it('knows a thread with a message on its way out, or failed — for the conversation row (R17)', () => {
    const of = (statuscode: number) => toSummary(thread([row('a'), row('b', { directioncode: true, statuscode })]), senderNameOf, new Set());
    expect(of(6)).toMatchObject({ sending: true, failed: false }); // Pending Send
    expect(of(7)).toMatchObject({ sending: true, failed: false }); // Sending
    expect(of(8)).toMatchObject({ sending: false, failed: true }); // Failed
    expect(of(3)).toMatchObject({ sending: false, failed: false }); // Sent
  });
});

describe('ourAddresses — the UNION that keeps the queue out of To (R2)', () => {
  const CARE: SenderCandidate = { kind: 'queue', id: 'q', displayName: 'Care', address: 'Care@Example.invalid' };
  const rows = [row('a'), row('b', { directioncode: true })];
  const senders: Record<string, string> = { a: 'kunde@example.invalid', b: 'old-queue@example.invalid' };

  it('includes the resolved senders AND every address this case has sent from', () => {
    const ours = ourAddresses([CARE], rows, (id) => senders[id]);
    expect(ours).toEqual(new Set(['care@example.invalid', 'old-queue@example.invalid']));
  });

  it('still knows the case\'s own sender when no queue resolved — the CAS-01020 case', () => {
    expect(ourAddresses([], rows, (id) => senders[id]).has('old-queue@example.invalid')).toBe(true);
  });

  it('never counts an incoming sender as us', () => {
    expect(ourAddresses([CARE], rows, (id) => senders[id]).has('kunde@example.invalid')).toBe(false);
  });
});

describe('buildParticipantIndex (R2)', () => {
  const parties = new Map([['m1', {
    sender: { name: 'Mette', address: 'mette@example.invalid' },
    to: [{ name: '', address: 'care@example.invalid' }],
    cc: [], bcc: [],
  }]]);

  it('makes names AND addresses searchable', () => {
    expect(buildParticipantIndex(parties).searchable('m1'))
      .toEqual(['Mette', 'mette@example.invalid', 'care@example.invalid']);
  });

  it('lists each person once — by name, or by address when there is no name', () => {
    expect(buildParticipantIndex(parties).people('m1')).toEqual(['Mette', 'care@example.invalid']);
  });
});
