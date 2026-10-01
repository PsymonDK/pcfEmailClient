import { describe, it, expect } from 'vitest';
import {
  addressFilter, DEFAULT_RECIPIENT_SOURCE, enrichRecipients, fetchDefaultRecipient, resolveAddress,
} from '../recipients';
import type { WebApiLike } from '../emailQueries';

/** What the server sees: the options string URL-decoded once, as the query string is. */
const serverSees = (options: string): string => decodeURIComponent(options);

describe('addressFilter — escaped for OData AND for the URL (M1)', () => {
  it('keeps a plus-addressed customer intact — `+` must not decode to a space', () => {
    const q = serverSees(addressFilter('contact', 'kunde+ordre@example.invalid'));
    expect(q).toContain("emailaddress1 eq 'kunde+ordre@example.invalid'");
  });

  it('cannot be cut short by & or #', () => {
    const q = serverSees(addressFilter('contact', 'a&b#c@example.invalid'));
    expect(q).toContain("eq 'a&b#c@example.invalid'&$top=2");
  });

  it('doubles a quote, and a %27 in the address stays literal rather than becoming one', () => {
    expect(serverSees(addressFilter('contact', "o'brien@example.invalid")))
      .toContain("eq 'o''brien@example.invalid'");
    // An external sender controls this string. Before the fix `%27` decoded to `'` server-side
    // and closed the literal early.
    const q = serverSees(addressFilter('contact', "x%27 or emailaddress1 ne %27@example.invalid"));
    expect(q).toContain("eq 'x%27 or emailaddress1 ne %27@example.invalid'");
  });

  it('uses each table\'s own email column', () => {
    expect(addressFilter('systemuser', 'a@b.invalid')).toContain('internalemailaddress eq');
    expect(addressFilter('account', 'a@b.invalid')).toContain('$select=accountid,emailaddress1,name');
  });
});

describe('resolveAddress — which failures may the search skip past (L6)', () => {
  const ADDRESS = 'kunde@example.invalid';
  /** Fails on `contact` with `rejection`, and finds a match on every later table. */
  const api = (rejection: unknown): WebApiLike => ({
    retrieveMultipleRecords: (entity: string) => (entity === 'contact'
      // context.webAPI rejects with plain objects, which is exactly the shape under test.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      ? Promise.reject(rejection)
      : Promise.resolve({ entities: [{ [`${entity}id`]: 'b5e30418-23f2-f011-8406-0022489cf5dd', fullname: 'Wrong', name: 'Wrong' }] })),
    retrieveRecord: () => Promise.resolve({}),
  });

  it('skips a table the agent may not read', async () => {
    const out = await resolveAddress(api({ status: 403, message: 'denied' }), ADDRESS);
    expect(out.kind).toBe('resolved');
  });

  it('STOPS on any other failure, rather than binding a later table\'s record', async () => {
    const out = await resolveAddress(api({ status: 503, message: 'busy' }), ADDRESS);
    expect(out).toEqual({ kind: 'none' });
  });
});

describe('enrichRecipients — an ambiguous match is kept unresolved but labelled (L6)', () => {
  it('marks the recipient with how many records matched, and binds none', async () => {
    const api: WebApiLike = {
      retrieveMultipleRecords: (entity: string) => Promise.resolve({
        entities: entity === 'contact'
          ? [{ contactid: 'b5e30418-23f2-f011-8406-0022489cf5dd' }, { contactid: 'c5e30418-23f2-f011-8406-0022489cf5dd' }]
          : [],
      }),
      retrieveRecord: () => Promise.resolve({}),
    };
    const [r] = await enrichRecipients(api, [{ name: 'Dup', address: 'dup@example.invalid' }]);
    expect(r.partyId).toBeUndefined();
    expect(r.ambiguousMatches).toBe(2);
  });
});

describe('resolveAddress', () => {
  it('does not query for something that is not one plain address', async () => {
    let calls = 0;
    const api: WebApiLike = {
      retrieveMultipleRecords: () => { calls += 1; return Promise.resolve({ entities: [] }); },
      retrieveRecord: () => Promise.resolve({}),
    };
    expect(await resolveAddress(api, 'two@a.invalid; three@b.invalid')).toEqual({ kind: 'none' });
    expect(await resolveAddress(api, '   ')).toEqual({ kind: 'none' });
    expect(calls).toBe(0);
  });
});

describe('fetchDefaultRecipient — who a NEW email goes to (2026-10-01)', () => {
  const CASE = '71cdb358-2abb-f111-aaad-000d3ab16615';
  const CONTACT = 'b5e30418-23f2-f011-8406-0022489cf5dd';
  /** A case whose customer lookup points at `entity`, and that record's address. */
  const api = (entity: string | undefined, address?: string, log: string[] = []): WebApiLike => ({
    retrieveMultipleRecords: () => Promise.resolve({ entities: [] }),
    retrieveRecord: (table: string, _id: string, options?: string) => {
      log.push(`${table} ${options ?? ''}`);
      if (table === 'incident') {
        return Promise.resolve(entity ? {
          _customerid_value: CONTACT,
          '_customerid_value@Microsoft.Dynamics.CRM.lookuplogicalname': entity,
          '_customerid_value@OData.Community.Display.V1.FormattedValue': 'Simon Jehrbo',
        } : {});
      }
      return Promise.resolve(address ? { emailaddress1: address, emailaddress: address } : {});
    },
  });

  it("names the case's customer as a BOUND recipient", async () => {
    expect(await fetchDefaultRecipient(api('contact', 'simon.jehrbo@example.com'), CASE, DEFAULT_RECIPIENT_SOURCE)).toEqual({
      name: 'Simon Jehrbo', address: 'simon.jehrbo@example.com', partyId: CONTACT,
      partyEntity: 'contact', partyNav: 'partyid_contact',
    });
  });

  it('prefills nothing rather than guess: no customer, no address, or a queue', async () => {
    expect(await fetchDefaultRecipient(api(undefined), CASE, DEFAULT_RECIPIENT_SOURCE)).toBeUndefined();
    expect(await fetchDefaultRecipient(api('contact', undefined), CASE, DEFAULT_RECIPIENT_SOURCE)).toBeUndefined();
    // A queue is our own service mailbox — never a default recipient.
    expect(await fetchDefaultRecipient(api('queue', 'care@example.invalid'), CASE, DEFAULT_RECIPIENT_SOURCE)).toBeUndefined();
    expect(await fetchDefaultRecipient(api('incident', 'x@example.invalid'), CASE, DEFAULT_RECIPIENT_SOURCE)).toBeUndefined();
  });

  it('reads the configured lookup, and refuses anything that is not a plain column name', async () => {
    const log: string[] = [];
    await fetchDefaultRecipient(api('contact', 'a@example.invalid', log), CASE, { entity: 'incident', lookup: 'primarycontactid' });
    expect(log[0]).toBe('incident ?$select=_primarycontactid_value');
    const none: string[] = [];
    expect(await fetchDefaultRecipient(api('contact', 'a@example.invalid', none), CASE, { entity: 'incident', lookup: 'x,description' })).toBeUndefined();
    expect(await fetchDefaultRecipient(api('contact', 'a@example.invalid', none), CASE, { entity: 'account', lookup: 'primarycontactid' })).toBeUndefined();
    expect(none).toEqual([]);
  });
});
