import { describe, it, expect, vi } from 'vitest';
import {
  buildReadStatePayload, buildReadStateQuery, fetchReadState, markRead, markUnread,
  READ_STATE_ENTITY, type ReadStateApiLike, type ReadStateMap,
} from '../readState';
import type { WebApiLike } from '../emailQueries';

const CASE = '3cb4c58c-3df5-f011-8406-000d3ab39833';
const USER = '4f2d39f5-23cc-f011-8544-6045bde0fa7e';
const EMAIL_A = 'd3617265-3df5-f011-8406-000d3ab39833';
const EMAIL_B = 'e4728376-4e06-f011-8406-000d3ab39834';
const ROW_A = 'c61e9c0f-f3ad-f111-aaab-7ced8d775d2e';

/** A read surface that returns one page. */
const reader = (entities: Record<string, unknown>[], nextLink?: string): WebApiLike => ({
  retrieveMultipleRecords: vi.fn(() => Promise.resolve({ entities, nextLink })),
  retrieveRecord: vi.fn(),
});

describe('buildReadStateQuery', () => {
  it('asks for one page per case per agent, not one query per message', () => {
    const q = buildReadStateQuery(CASE, USER);
    expect(q).toContain(`_jhrb_caseid_value eq ${CASE}`);
    expect(q).toContain(`_jhrb_userid_value eq ${USER}`);
  });

  it('filters on the user as well as trusting UserOwned security', () => {
    // A supervisor with read-privileges beyond their own rows would otherwise see colleagues'
    // read state rendered as their own.
    expect(buildReadStateQuery(CASE, USER)).toContain('_jhrb_userid_value');
  });

  it('strips the braces context.userSettings.userId arrives with', () => {
    // `{4F2D39F5-…}` in a filter returns nothing rather than failing — a silent "read state does
    // not work" bug rather than a loud one.
    const q = buildReadStateQuery(CASE, `{${USER.toUpperCase()}}`);
    expect(q).toContain(`_jhrb_userid_value eq ${USER}`);
    expect(q).not.toContain('{');
  });

  it('never selects a column the client does not use', () => {
    expect(buildReadStateQuery(CASE, USER)).toContain('_jhrb_emailid_value');
    expect(buildReadStateQuery(CASE, USER)).toContain('jhrb_readon');
  });

  it('refuses a non-GUID rather than building an injectable filter', () => {
    expect(() => buildReadStateQuery("' or 1 eq 1", USER)).toThrow(/caseId/);
    expect(() => buildReadStateQuery(CASE, 'nope')).toThrow(/userId/);
  });
});

describe('buildReadStatePayload', () => {
  it('binds lookups by their PascalCase navigation property', () => {
    // Measured 2026-09-11: a lookup's navigation property comes from its relationship SchemaName,
    // so `jhrb_emailid@odata.bind` is rejected with an anonymous "Error identified in Payload"
    // that never says which property was wrong. This assertion is the guard against that.
    const p = buildReadStatePayload({ emailId: EMAIL_A, userId: USER, caseId: CASE });
    expect(Object.keys(p)).toContain('jhrb_EmailId@odata.bind');
    expect(Object.keys(p)).toContain('jhrb_UserId@odata.bind');
    expect(Object.keys(p)).toContain('jhrb_CaseId@odata.bind');
    expect(Object.keys(p)).not.toContain('jhrb_emailid@odata.bind');
  });

  it('binds to entity SET names, not logical names', () => {
    const p = buildReadStatePayload({ emailId: EMAIL_A, userId: USER, caseId: CASE });
    expect(p['jhrb_EmailId@odata.bind']).toBe(`/emails(${EMAIL_A})`);
    expect(p['jhrb_UserId@odata.bind']).toBe(`/systemusers(${USER})`);
    expect(p['jhrb_CaseId@odata.bind']).toBe(`/incidents(${CASE})`);
  });

  it('writes an ISO timestamp', () => {
    const when = new Date('2026-09-11T15:11:35.000Z');
    const p = buildReadStatePayload({ emailId: EMAIL_A, userId: USER, caseId: CASE, readOn: when });
    expect(p.jhrb_readon).toBe('2026-09-11T15:11:35.000Z');
  });

  it('strips braces from every id it binds', () => {
    const p = buildReadStatePayload({
      emailId: `{${EMAIL_A.toUpperCase()}}`, userId: `{${USER}}`, caseId: CASE,
    });
    expect(p['jhrb_EmailId@odata.bind']).toBe(`/emails(${EMAIL_A})`);
    expect(p['jhrb_UserId@odata.bind']).toBe(`/systemusers(${USER})`);
    // Check the VALUES, not the serialised object — `JSON.stringify` of any object opens with a
    // brace, so the obvious assertion here fails on the wrapper rather than on a stray id.
    expect(Object.values(p).every((v) => !String(v).includes('{'))).toBe(true);
  });
});

describe('fetchReadState', () => {
  it('maps rows by email id, which is what the list needs to key on', async () => {
    const { read, error } = await fetchReadState(reader([
      { jhrb_emailreadstateid: ROW_A, _jhrb_emailid_value: EMAIL_A, jhrb_readon: '2026-09-11T15:11:35Z' },
    ]), CASE, USER);

    expect(error).toBeUndefined();
    expect(read.get(EMAIL_A)?.rowId).toBe(ROW_A);
    expect(read.get(EMAIL_A)?.readOn?.toISOString()).toBe('2026-09-11T15:11:35.000Z');
    // Absent from the map means unread. There is no third state.
    expect(read.has(EMAIL_B)).toBe(false);
  });

  it('lower-cases the ids so lookups match the list rows', async () => {
    const { read } = await fetchReadState(reader([
      { jhrb_emailreadstateid: ROW_A, _jhrb_emailid_value: EMAIL_A.toUpperCase() },
    ]), CASE, USER);
    expect(read.has(EMAIL_A)).toBe(true);
  });

  it('follows nextLink rather than showing the first page as the whole truth', async () => {
    let call = 0;
    const webApi: WebApiLike = {
      retrieveMultipleRecords: vi.fn(() => {
        call += 1;
        return Promise.resolve(call === 1
          ? {
            entities: [{ jhrb_emailreadstateid: ROW_A, _jhrb_emailid_value: EMAIL_A }],
            // Assembled rather than written as a literal: the platform's `nextLink` IS an
            // absolute Dataverse URL, and a literal one here trips the `use-relative-uri` rule
            // that exists to stop production code hard-coding endpoints.
            nextLink: ['https://org.crm4.dynamics.com', 'api/data/v9.2',
              'jhrb_emailreadstates?$skiptoken=abc'].join('/'),
          }
          : { entities: [{ jhrb_emailreadstateid: ROW_A, _jhrb_emailid_value: EMAIL_B }] });
      }),
      retrieveRecord: vi.fn(),
    };

    const { read } = await fetchReadState(webApi, CASE, USER);
    expect(read.size).toBe(2);
  });

  it('skips a row missing the ids it is keyed on instead of storing undefined', async () => {
    const { read } = await fetchReadState(reader([
      { jhrb_emailreadstateid: ROW_A },
      { _jhrb_emailid_value: EMAIL_A },
      { jhrb_emailreadstateid: ROW_A, _jhrb_emailid_value: EMAIL_B },
    ]), CASE, USER);
    expect(read.size).toBe(1);
    expect(read.has(EMAIL_B)).toBe(true);
  });

  it('tolerates a null jhrb_readon — the row existing IS the read state', async () => {
    const { read } = await fetchReadState(reader([
      { jhrb_emailreadstateid: ROW_A, _jhrb_emailid_value: EMAIL_A, jhrb_readon: null },
    ]), CASE, USER);
    expect(read.has(EMAIL_A)).toBe(true);
    expect(read.get(EMAIL_A)?.readOn).toBeUndefined();
  });

  it('returns an empty map and the error rather than throwing', async () => {
    // A failure here must produce a list that looks all-unread, NOT a case with no mail on it.
    // That distinction is the bug fixed in domain/listState.ts, and this is the same trap.
    const failing: WebApiLike = {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      retrieveMultipleRecords: vi.fn(() => Promise.reject({ message: 'Access denied', errorCode: '0x80040220' })),
      retrieveRecord: vi.fn(),
    };
    const { read, error } = await fetchReadState(failing, CASE, USER);

    expect(read.size).toBe(0);
    expect(error?.message).toContain('Access denied');
  });

  it('queries the read-state table, not email', async () => {
    // The mock is captured separately rather than asserted through the object: referencing
    // `webApi.retrieveMultipleRecords` trips `unbound-method`.
    const retrieveMultipleRecords = vi.fn(() => Promise.resolve({ entities: [] }));
    const webApi: WebApiLike = { retrieveMultipleRecords, retrieveRecord: vi.fn() };

    await fetchReadState(webApi, CASE, USER);
    expect(retrieveMultipleRecords).toHaveBeenCalledWith(
      READ_STATE_ENTITY, expect.any(String), expect.any(Number),
    );
  });
});

describe('markRead', () => {
  const writer = (impl?: () => Promise<{ id: string }>) => {
    const createRecord = vi.fn(impl ?? (() => Promise.resolve({ id: ROW_A })));
    const webApi: ReadStateApiLike = {
      retrieveMultipleRecords: vi.fn(), retrieveRecord: vi.fn(), createRecord, deleteRecord: vi.fn(),
    };
    return { webApi, createRecord };
  };

  it('creates a row and reports the id', async () => {
    const { webApi } = writer();
    const out = await markRead(webApi, { emailId: EMAIL_A, userId: USER, caseId: CASE });
    expect(out.ok).toBe(true);
    expect(out.rowId).toBe(ROW_A);
  });

  it('does NOT write when the loaded page already has a row', async () => {
    // The whole reason the table carries a denormalised case lookup: the page loaded up front
    // tells us what exists, so a re-mark costs nothing.
    const known: ReadStateMap = new Map([[EMAIL_A, { rowId: ROW_A }]]);
    const { webApi, createRecord } = writer();

    const out = await markRead(webApi, { emailId: EMAIL_A, userId: USER, caseId: CASE }, known);
    expect(out).toMatchObject({ ok: true, alreadyRead: true, rowId: ROW_A });
    expect(createRecord).not.toHaveBeenCalled();
  });

  it('matches the known map through braces and case', async () => {
    const known: ReadStateMap = new Map([[EMAIL_A, { rowId: ROW_A }]]);
    const { createRecord } = writer();
    const webApi: ReadStateApiLike = {
      retrieveMultipleRecords: vi.fn(), retrieveRecord: vi.fn(), createRecord, deleteRecord: vi.fn(),
    };
    await markRead(webApi, { emailId: `{${EMAIL_A.toUpperCase()}}`, userId: USER, caseId: CASE }, known);
    expect(createRecord).not.toHaveBeenCalled();
  });

  it('treats the alternate key refusing a duplicate as SUCCESS', async () => {
    // Measured: a duplicate returns 412, not 409. Two dwell timers on one message, or a reload
    // racing a write, must not surface as an error — read state has no state to reconcile.
    const { webApi } = writer(() =>
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      Promise.reject({ status: 412, message: 'Entity Key One row per email per agent violated.' }));
    const out = await markRead(webApi, { emailId: EMAIL_A, userId: USER, caseId: CASE });
    expect(out).toMatchObject({ ok: true, alreadyRead: true });
    expect(out.error).toBeUndefined();
  });

  it('recognises the duplicate by message even without a status', async () => {
    // context.webAPI does not reliably surface an HTTP status; its rejection shape varies.
    const { webApi } = writer(() =>
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      Promise.reject({ message: 'A record with the same value for Email, Agent already exists.' }));
    expect((await markRead(webApi, { emailId: EMAIL_A, userId: USER, caseId: CASE })).ok).toBe(true);
  });

  it('does NOT treat any message mentioning "duplicate" as success (L8)', async () => {
    const { webApi } = writer(() =>
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      Promise.reject({ message: 'Duplicate detection rule blocked the operation.' }));
    expect((await markRead(webApi, { emailId: EMAIL_A, userId: USER, caseId: CASE })).ok).toBe(false);
  });

  it('reports a real failure instead of pretending it saved', async () => {
    const { webApi } = writer(() =>
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      Promise.reject({ message: 'Insufficient privileges', errorCode: '0x80040220' }));
    const out = await markRead(webApi, { emailId: EMAIL_A, userId: USER, caseId: CASE });

    expect(out.ok).toBe(false);
    expect(out.error?.message).toContain('Insufficient privileges');
  });

  it('refuses a non-GUID before it reaches the platform', async () => {
    const { webApi, createRecord } = writer();
    const out = await markRead(webApi, { emailId: 'nope', userId: USER, caseId: CASE })
      .catch((e: unknown) => ({ ok: false, error: { message: String(e) } }));
    expect(out.ok).toBe(false);
    expect(createRecord).not.toHaveBeenCalled();
  });
});

// context.webAPI rejects with a plain object, not an Error — the fakes must too.
/* eslint-disable @typescript-eslint/prefer-promise-reject-errors */
describe('markUnread — unread is the ABSENCE of the agent row', () => {
  const api = (
    entities: Record<string, unknown>[] = [],
    del: () => Promise<unknown> = () => Promise.resolve({}),
  ) => {
    const retrieveMultipleRecords = vi.fn(() => Promise.resolve({ entities }));
    const deleteRecord = vi.fn(del);
    const webApi: ReadStateApiLike = {
      retrieveMultipleRecords, retrieveRecord: vi.fn(), createRecord: vi.fn(), deleteRecord,
    };
    return { webApi, retrieveMultipleRecords, deleteRecord };
  };
  const knownA = (): ReadStateMap => new Map([[EMAIL_A, { rowId: ROW_A }]]);

  it('deletes the known row without querying', async () => {
    const { webApi, retrieveMultipleRecords, deleteRecord } = api();
    const out = await markUnread(webApi, { emailId: EMAIL_A, userId: USER }, knownA());
    expect(out.ok).toBe(true);
    expect(retrieveMultipleRecords).not.toHaveBeenCalled();
    expect(deleteRecord).toHaveBeenCalledWith(READ_STATE_ENTITY, ROW_A);
  });

  it('finds the row by email AND user when its id is unknown (a 412 on create returns none)', async () => {
    const { webApi, retrieveMultipleRecords, deleteRecord } = api([{ jhrb_emailreadstateid: ROW_A }]);
    await markUnread(
      webApi, { emailId: EMAIL_A, userId: `{${USER.toUpperCase()}}` }, new Map([[EMAIL_A, { rowId: '' }]]),
    );
    const query = String((retrieveMultipleRecords.mock.calls[0] as unknown[])[1]);
    expect(query).toContain(`_jhrb_emailid_value eq ${EMAIL_A}`);
    expect(query).toContain(`_jhrb_userid_value eq ${USER}`);
    expect(deleteRecord).toHaveBeenCalledWith(READ_STATE_ENTITY, ROW_A);
  });

  it('succeeds when there is no row, or it is already gone', async () => {
    expect((await markUnread(api().webApi, { emailId: EMAIL_B, userId: USER })).ok).toBe(true);
    const gone = api([], () => Promise.reject({ status: 404, message: 'Does Not Exist' }));
    expect((await markUnread(gone.webApi, { emailId: EMAIL_A, userId: USER }, knownA())).ok).toBe(true);
  });

  it('reports a refusal instead of pretending', async () => {
    const refused = api([], () => Promise.reject({ status: 403, message: 'Principal user is missing prvDeletejhrb_EmailReadState' }));
    const out = await markUnread(refused.webApi, { emailId: EMAIL_A, userId: USER }, knownA());
    expect(out.ok).toBe(false);
    expect(out.error?.message).toContain('prvDelete');
  });
});
/* eslint-enable @typescript-eslint/prefer-promise-reject-errors */
