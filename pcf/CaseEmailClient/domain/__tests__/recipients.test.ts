import { describe, it, expect } from 'vitest';
import {
  ambiguousAddresses,
  bareId,
  describeUnresolved,
  emailColumnFor,
  isPartyEntity,
  isResolved,
  LOOKUP_ENTITIES,
  PARTY_EMAIL_COLUMN,
  partyNavFor,
  recipientFromParty,
  replaceUnresolved,
  RESOLVE_ORDER,
  unresolvedAddresses,
  withoutDuplicates,
} from '../recipients';
import type { Recipient } from '../compose';

const resolved = (over: Partial<Recipient> = {}): Recipient => ({
  name: 'Simon Jehrbo',
  address: 'simon.jehrbo@example.com',
  partyId: 'b5e30418-23f2-f011-8406-0022489cf5dd',
  partyEntity: 'contact',
  partyNav: 'partyid_contact',
  ...over,
});

const bare = (address: string, name = 'Someone'): Recipient => ({ name, address });

describe('PARTY_EMAIL_COLUMN — every table names it differently', () => {
  it('matches what the live tables actually expose', () => {
    // All five verified queryable 2026-09-25. A single hardcoded 'emailaddress1' would silently
    // find nothing for systemuser and queue, which is the failure this map prevents.
    expect(PARTY_EMAIL_COLUMN).toEqual({
      contact: 'emailaddress1',
      account: 'emailaddress1',
      systemuser: 'internalemailaddress',
      lead: 'emailaddress1',
      queue: 'emailaddress',
    });
    expect(emailColumnFor('systemuser')).toBe('internalemailaddress');
    expect(emailColumnFor('queue')).toBe('emailaddress');
  });
});

describe('resolution and lookup tables', () => {
  it('searches contacts first — on a Case that is nearly always right', () => {
    expect(RESOLVE_ORDER[0]).toBe('contact');
  });

  it('NEVER resolves an address to a queue', () => {
    // Resolving to a queue would address our own service mailbox — the loop `resolveRecipients`
    // spends its effort excluding.
    expect(RESOLVE_ORDER).not.toContain('queue');
  });

  it('DOES offer queue in the lookup, where the agent chose it deliberately', () => {
    // Handing a thread to another team is a real thing; silently resolving to one is not.
    expect(LOOKUP_ENTITIES).toContain('queue');
  });

  it('offers LEAD in the lookup — address matching already resolved to leads', () => {
    expect(LOOKUP_ENTITIES).toContain('lead');
    // Customers first, queues last: the type-ahead lists in this order too.
    expect(LOOKUP_ENTITIES[0]).toBe('contact');
    expect(LOOKUP_ENTITIES[LOOKUP_ENTITIES.length - 1]).toBe('queue');
  });

  it('recognises only party-capable tables', () => {
    expect(isPartyEntity('contact')).toBe(true);
    expect(isPartyEntity('queue')).toBe(true);
    expect(isPartyEntity('incident')).toBe(false);
    expect(isPartyEntity('')).toBe(false);
  });
});

describe('bareId — the lookup dialog returns braced, upper-cased ids', () => {
  it('strips braces and lower-cases', () => {
    // Measured: lookupObjects resolves with "{B5E30418-23F2-F011-8406-0022489CF5DD}".
    // Passing that into an @odata.bind is the obvious thing and the wrong thing.
    expect(bareId('{B5E30418-23F2-F011-8406-0022489CF5DD}'))
      .toBe('b5e30418-23f2-f011-8406-0022489cf5dd');
  });

  it('leaves an already-bare id alone', () => {
    expect(bareId('b5e30418-23f2-f011-8406-0022489cf5dd'))
      .toBe('b5e30418-23f2-f011-8406-0022489cf5dd');
  });
});

describe('partyNavFor', () => {
  it('composes the documented names', () => {
    expect(partyNavFor('contact')).toBe('partyid_contact');
    expect(partyNavFor('systemuser')).toBe('partyid_systemuser');
  });
});

describe('isResolved / unresolvedAddresses', () => {
  it('a bare address is not resolved', () => {
    expect(isResolved(bare('x@y.com'))).toBe(false);
    expect(isResolved(resolved())).toBe(true);
  });

  it('collects unresolved addresses across To and Cc, deduplicated', () => {
    const out = unresolvedAddresses(
      [resolved(), bare('kunde@example.com')],
      [bare('KUNDE@example.com'), bare('chef@example.com')],
      [],
    );
    expect(out).toEqual(['kunde@example.com', 'chef@example.com']);
  });

  it('is empty when everything names a record', () => {
    expect(unresolvedAddresses([resolved()], [], [])).toEqual([]);
  });

  it('ignores recipients with no address at all', () => {
    expect(unresolvedAddresses([bare('   ')], [], [])).toEqual([]);
  });

  it('counts an unresolved BCC address too — a blind copy must name a record (issue #11)', () => {
    expect(unresolvedAddresses([resolved()], [], [bare('hemmelig@example.com')])).toEqual(['hemmelig@example.com']);
    expect(ambiguousAddresses([], [], [{ ...bare('to@example.com'), ambiguousMatches: 2 }])).toEqual(['to@example.com']);
  });
});

describe('describeUnresolved', () => {
  it('NAMES the offending addresses', () => {
    // "Some recipients could not be resolved" leaves the agent hunting. The entire value of
    // blocking is saying which address to fix.
    const msg = describeUnresolved(['kunde@example.com']);
    expect(msg).toContain('kunde@example.com');
    expect(msg).toContain('lookup');
  });

  it('reads correctly for one and for several', () => {
    expect(describeUnresolved(['a@b.com'])).toContain('is not a known record');
    expect(describeUnresolved(['a@b.com', 'c@d.com'])).toContain('are not known records');
  });

  it('says nothing when there is nothing wrong', () => {
    expect(describeUnresolved([])).toBe('');
  });
});

describe('recipientFromParty', () => {
  const pick = { id: '{B5E30418-23F2-F011-8406-0022489CF5DD}', entityType: 'contact', name: 'Simon Jehrbo' };

  it('turns a pick into a bound recipient', () => {
    const out = recipientFromParty(pick, 'Simon.Jehrbo@example.com');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.recipient).toEqual({
      name: 'Simon Jehrbo',
      address: 'simon.jehrbo@example.com',
      partyId: 'b5e30418-23f2-f011-8406-0022489cf5dd',
      partyEntity: 'contact',
      partyNav: 'partyid_contact',
    });
  });

  it('REFUSES a record with no email address', () => {
    // Otherwise the chip looks like a recipient, saves like a recipient, and delivers to nobody
    // — the same quiet failure as the unresolved party itself.
    for (const address of [undefined, '', '   ']) {
      const out = recipientFromParty(pick, address);
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.reason).toContain('no email address');
    }
  });

  it('refuses a table that cannot be a party', () => {
    const out = recipientFromParty({ ...pick, entityType: 'incident' }, 'a@b.com');
    expect(out.ok).toBe(false);
  });
});

describe('withoutDuplicates', () => {
  it('drops a pick already on the message, case-insensitively', () => {
    const out = withoutDuplicates([resolved({ address: 'SIMON.JEHRBO@example.com' })], [resolved()]);
    expect(out).toEqual([]);
  });

  it('drops duplicates within one batch', () => {
    const out = withoutDuplicates([bare('a@b.com'), bare('A@B.com')], []);
    expect(out).toHaveLength(1);
  });

  it('keeps genuinely new recipients', () => {
    expect(withoutDuplicates([bare('new@example.com')], [resolved()])).toHaveLength(1);
  });
});

describe('replaceUnresolved — resolving a flagged chip in place', () => {
  const flagged: Recipient = { name: '', address: 'kunde@example.invalid' };
  const other: Recipient = { name: 'A', address: 'a@example.invalid', partyId: 'p-a', partyEntity: 'contact' };
  const picked: Recipient = { name: 'Kunde', address: 'kunde@example.invalid', partyId: 'p-k', partyEntity: 'contact' };

  it('puts the record where the flagged chip was', () => {
    expect(replaceUnresolved([other, flagged], [], 'KUNDE@example.invalid', picked)).toEqual([other, picked]);
  });

  it('takes the RECORD’s address, which may differ from what was typed', () => {
    const elsewhere = { ...picked, address: 'kunde@firma.example.invalid' };
    expect(replaceUnresolved([flagged], [], flagged.address, elsewhere)).toEqual([elsewhere]);
  });

  it('drops the flagged chip if that record is already on the message', () => {
    const inCc: Recipient = { ...picked };
    expect(replaceUnresolved([other, flagged], [inCc], flagged.address, picked)).toEqual([other]);
  });

  it('never touches a resolved recipient with the same address', () => {
    const resolved = { ...picked };
    expect(replaceUnresolved([resolved], [], resolved.address, other)).toEqual([resolved]);
  });
});
