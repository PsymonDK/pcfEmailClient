import { describe, it, expect } from 'vitest';
import {
  buildSearchQuery, entityLabel, MAX_SUGGESTIONS, mergeSuggestions, toSuggestions,
  type RecipientSuggestion,
} from '../recipientSearch';
import type { PartyEntity } from '../recipients';

const serverSees = (q: string) => decodeURIComponent(q);

describe('buildSearchQuery — verified live against the demo org 2026-09-28', () => {
  it('matches name OR address, requires an address, and only active records', () => {
    const q = serverSees(buildSearchQuery('contact', 'sim'));
    expect(q).toContain("(startswith(fullname,'sim') or startswith(emailaddress1,'sim'))");
    expect(q).toContain('emailaddress1 ne null');
    expect(q).toContain('statecode eq 0');
  });

  it('uses each table\'s own name and email columns, and isdisabled for users', () => {
    expect(buildSearchQuery('account', 'x')).toContain('$select=accountid,name,emailaddress1');
    const user = buildSearchQuery('systemuser', 'x');
    expect(user).toContain('internalemailaddress');
    expect(user).toContain('isdisabled eq false');
    expect(buildSearchQuery('queue', 'x')).toContain('$select=queueid,name,emailaddress');
  });

  it('escapes a quote for OData and the whole literal for the URL', () => {
    const q = buildSearchQuery('contact', "o'br+ien&");
    expect(serverSees(q)).toContain("startswith(fullname,'o''br+ien&')");
    expect(q).not.toContain("o''br+ien&"); // raw & and + would break the query string
  });
});

describe('toSuggestions / mergeSuggestions', () => {
  const s = (entity: PartyEntity, id: string, address: string): RecipientSuggestion =>
    ({ partyEntity: entity, partyId: id, name: id, address });

  it('keeps only rows with an id and an address, normalised', () => {
    const out = toSuggestions('contact', [
      { contactid: '{B5E30418-23F2-F011-8406-0022489CF5DD}', fullname: 'Simon Jehrbo', emailaddress1: 'Simon.Jehrbo@Example.com ' },
      { contactid: 'c-2', fullname: 'No address' },
    ]);
    expect(out).toEqual([{
      partyId: 'b5e30418-23f2-f011-8406-0022489cf5dd', partyEntity: 'contact',
      name: 'Simon Jehrbo', address: 'simon.jehrbo@example.com',
    }]);
  });

  it('orders people before queues, drops anyone already on the message, and caps', () => {
    const byTable = new Map<PartyEntity, RecipientSuggestion[]>([
      ['queue', [s('queue', 'q1', 'care@x.invalid')]],
      ['contact', [s('contact', 'c1', 'a@x.invalid'), s('contact', 'c2', 'taken@x.invalid')]],
    ]);
    const out = mergeSuggestions(byTable, ['TAKEN@x.invalid']);
    expect(out.map((x) => x.partyId)).toEqual(['c1', 'q1']);

    const many = new Map<PartyEntity, RecipientSuggestion[]>([
      ['contact', Array.from({ length: 20 }, (_, i) => s('contact', `c${i}`, `c${i}@x.invalid`))],
    ]);
    expect(mergeSuggestions(many, [])).toHaveLength(MAX_SUGGESTIONS);
  });

  it('labels each table the way an agent reads it', () => {
    expect(entityLabel('systemuser')).toBe('User');
  });
});
