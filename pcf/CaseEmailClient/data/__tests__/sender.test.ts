import { describe, it, expect, vi } from 'vitest';
import {
  buildCaseQueueQuery, fetchCaseQueue, INCIDENT_OBJECT_TYPE_CODE,
} from '../caseQueue';
import { buildSettingsQuery, fetchSettings, toSettingRow } from '../settings';
import { buildDraftLookupQuery } from '../draft';
import type { WebApiLike } from '../emailQueries';

const CASE_ID = 'af855822-81ab-f111-aaab-0022489d55b0';
const CARE_ID = '23b1c48e-1ff2-f011-8406-7ced8d2e4880';

const stub = (
  handler: (entity: string, options?: string) => { entities: Record<string, unknown>[] },
): WebApiLike => ({
  retrieveMultipleRecords: vi.fn((e: string, o?: string) => Promise.resolve(handler(e, o))),
  retrieveRecord: () => Promise.resolve({}),
});

describe('buildCaseQueueQuery', () => {
  const q = buildCaseQueueQuery(CASE_ID);

  it('filters objecttypecode as a NUMBER, not a string', () => {
    // Measured 2026-09-24: `objecttypecode eq 'incident'` fails with "A binary operator with
    // incompatible types was detected. Found operand types 'Edm.Int32' and 'Edm.String'" — a
    // message that names neither the column nor the fix.
    expect(q).toContain(`objecttypecode eq ${INCIDENT_OBJECT_TYPE_CODE}`);
    expect(q).not.toContain("objecttypecode eq 'incident'");
    expect(INCIDENT_OBJECT_TYPE_CODE).toBe(112);
  });

  it('type-guards as well as scoping, so a GUID cannot collide across tables', () => {
    expect(q).toContain('_objectid_value eq');
    expect(q).toContain('objecttypecode eq');
  });

  it('does NOT filter to active queue items', () => {
    // Measured 2026-09-25 on CAS-01020: the Case is in Care, its queueitem is statecode 1
    // (the item was WORKED, not removed), and an active-only filter resolved no queue at all —
    // so the client fell back to the agent, whose mailbox cannot send. Common, not an edge.
    expect(q).not.toContain('statecode eq 0');
  });

  it('prefers an ACTIVE item, then the most recent', () => {
    // statecode asc puts Active (0) before Inactive (1); createdon desc breaks the tie.
    expect(q).toContain('$orderby=statecode asc,createdon desc');
    expect(q).toContain('$top=1');
  });

  it('expands everything the sender and pre-flight need, in ONE round trip', () => {
    for (const column of [
      'name', 'emailaddress', 'emailrouteraccessapproval',
      '_emailsignature_value', '_defaultmailbox_value',
    ]) {
      expect(q).toContain(column);
    }
  });

  it('lower-cases and de-braces the case id', () => {
    expect(buildCaseQueueQuery(`{${CASE_ID.toUpperCase()}}`)).toContain(CASE_ID);
  });
});

describe('fetchCaseQueue', () => {
  const queueRow = {
    queueid: CARE_ID,
    name: 'Care',
    emailaddress: 'care@example.invalid',
    emailrouteraccessapproval: 1,
    _emailsignature_value: 'ca237ab1-16f6-f011-8406-000d3ab39833',
    _defaultmailbox_value: '0836e394-1ff2-f011-8406-7ced8d2e4880',
  };

  it('maps the real Care queue into a sender candidate', async () => {
    const out = await fetchCaseQueue(stub(() => ({ entities: [{ queueid: queueRow }] })), CASE_ID);
    expect(out.queue?.candidate).toEqual({
      kind: 'queue',
      id: CARE_ID,
      displayName: 'Care',
      // Lower-cased, because every comparison downstream is case-insensitive and one
      // upper-case letter here would put the queue in its own To line.
      address: 'care@example.invalid',
      signatureId: 'ca237ab1-16f6-f011-8406-000d3ab39833',
    });
    expect(out.queue?.approvalState).toBe(1);
    expect(out.error).toBeUndefined();
  });

  it('treats "in no queue" as ordinary, NOT as an error', async () => {
    // Plenty of cases are created directly and never routed. An error here would put a banner
    // on a perfectly normal case.
    const out = await fetchCaseQueue(stub(() => ({ entities: [] })), CASE_ID);
    expect(out.queue).toBeUndefined();
    expect(out.error).toBeUndefined();
  });

  it('copes with a queue that has no signature or no address', async () => {
    const bare = { queueid: CARE_ID, name: 'Care' };
    const out = await fetchCaseQueue(stub(() => ({ entities: [{ queueid: bare }] })), CASE_ID);
    expect(out.queue?.candidate.signatureId).toBeUndefined();
    expect(out.queue?.candidate.address).toBe('');
    // Unknown approval reads as 0, which pre-flight blocks rather than waving through.
    expect(out.queue?.approvalState).toBe(0);
  });

  it('reports a bad case id without calling the platform', async () => {
    let called = false;
    const api: WebApiLike = {
      retrieveMultipleRecords: () => { called = true; return Promise.resolve({ entities: [] }); },
      retrieveRecord: () => Promise.resolve({}),
    };
    const out = await fetchCaseQueue(api, 'not-a-guid');
    expect(out.error).toBeDefined();
    expect(called).toBe(false);
  });

  it('normalises a rejection rather than throwing at the caller', async () => {
    const api: WebApiLike = {
      // `context.webAPI` rejects with a PLAIN OBJECT, not an Error — see data/errors.ts.
      /* eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors */
      retrieveMultipleRecords: vi.fn(() => Promise.reject({ message: 'boom' })),
      retrieveRecord: () => Promise.resolve({}),
    };
    const out = await fetchCaseQueue(api, CASE_ID);
    expect(out.error?.message).toBe('boom');
  });
});

describe('buildSettingsQuery', () => {
  it('reads only active rows', () => {
    expect(buildSettingsQuery()).toContain('statecode eq 0');
  });

  it('selects both queue lookups and all three flags', () => {
    const q = buildSettingsQuery();
    for (const column of [
      'jhrb_isdefault', 'jhrb_sendfromqueue', 'jhrb_allowsenderoverride',
      '_jhrb_queue_value', '_jhrb_overridequeue_value',
    ]) {
      expect(q).toContain(column);
    }
  });

  it('does NOT filter to the default row', () => {
    // Precedence lives in `domain/sender.ts#pickSetting`, tested there. Splitting it between a
    // $filter and a function is how the two come to disagree.
    expect(buildSettingsQuery()).not.toContain('jhrb_isdefault eq true');
  });
});

describe('fetchSettings', () => {
  it('flattens the OData shape', async () => {
    const api = stub(() => ({
      entities: [{
        jhrb_isdefault: true,
        jhrb_sendfromqueue: true,
        jhrb_allowsenderoverride: true,
        _jhrb_queue_value: null,
      }],
    }));
    const out = await fetchSettings(api);
    expect(out.rows).toEqual([{
      queueId: undefined,
      isDefault: true,
      sendFromQueue: true,
      allowSenderOverride: true,
      overrideQueueId: undefined,
    }]);
  });

  it('returns NO ROWS on failure, which resolves to sending as the agent', async () => {
    // The fail-safe direction. Defaulting to the queue when configuration cannot be read would
    // change who mail appears to come from on the strength of a failed request.
    const api: WebApiLike = {
      /* eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors */
      retrieveMultipleRecords: vi.fn(() => Promise.reject({ message: 'no privilege' })),
      retrieveRecord: () => Promise.resolve({}),
    };
    const out = await fetchSettings(api);
    expect(out.rows).toEqual([]);
    // Returned, not swallowed: the caller logs it, because zero rows is otherwise
    // indistinguishable from a table the agent simply cannot read.
    expect(out.error?.message).toBe('no privilege');
  });
});

describe('toSettingRow', () => {
  it('treats a missing flag as false, not as true', () => {
    expect(toSettingRow({})).toEqual({
      queueId: undefined,
      isDefault: false,
      sendFromQueue: false,
      allowSenderOverride: false,
      overrideQueueId: undefined,
    });
  });

  it('does not accept a truthy non-boolean as true', () => {
    // OData booleans arrive as booleans; anything else here means the column changed shape,
    // and guessing would silently turn queue sending on.
    expect(toSettingRow({ jhrb_sendfromqueue: 'true' }).sendFromQueue).toBe(false);
    expect(toSettingRow({ jhrb_sendfromqueue: 1 }).sendFromQueue).toBe(false);
  });
});

describe('buildDraftLookupQuery — finding an agent’s existing draft', () => {
  const q = buildDraftLookupQuery(CASE_ID, 'de1b0e6c-b6b8-f111-aaaf-000d3ab163fb');

  it('finds only OPEN DRAFTS, never sent mail', () => {
    // statecode 0 + statuscode 1 is the draft definition. Without both, reopening Reply could
    // adopt an already-sent message and overwrite it.
    expect(q).toContain('statecode eq 0');
    expect(q).toContain('statuscode eq 1');
  });

  it('scopes by case through the typed navigation property AND by parent message', () => {
    expect(q).toContain('regardingobjectid_incident/incidentid eq');
    expect(q).toContain('_parentactivityid_value eq');
  });

  it('DOES select description, deliberately', () => {
    // The never-fetch-the-body rule is about LIST queries, where it costs a blob read per row.
    // This fetches at most one, and the body is the point: it is the agent's unsent reply.
    expect(q).toContain('description');
    expect(q).toContain('$top=1');
  });
});

describe('settings — the recipient source pair', () => {
  it('reads both halves', () => {
    expect(toSettingRow({
      jhrb_recipiententity: 'incident', jhrb_recipientlookup: 'customerid',
    })).toMatchObject({ recipientEntity: 'incident', recipientLookup: 'customerid' });
  });

  it('treats blank as unset, so a half-configured row does not look configured', () => {
    expect(toSettingRow({ jhrb_recipiententity: '   ', jhrb_recipientlookup: '' }))
      .toMatchObject({ recipientEntity: undefined, recipientLookup: undefined });
  });

  it('is selected by the query', () => {
    expect(buildSettingsQuery()).toContain('jhrb_recipiententity');
    expect(buildSettingsQuery()).toContain('jhrb_recipientlookup');
  });
});
