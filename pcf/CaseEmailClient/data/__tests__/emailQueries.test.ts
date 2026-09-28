import { describe, it, expect, vi } from 'vitest';
import {
  assertGuid,
  buildAttachmentsQuery,
  buildBodyQuery,
  buildListQuery,
  buildListQueryForCases,
  buildPartiesQuery,
  fetchAncestry,
  DataverseError,
  fetchAttachments,
  fetchBody,
  fetchCaseEmails,
  fetchParties,
  groupParties,
  LIST_COLUMNS,
  toEmailRow,
  type WebApiLike,
} from '../emailQueries';

const CASE = '40a5d940-0ef6-f011-8406-000d3ab7be36';
const MSG = '5e45a3e4-c8ad-f111-aaab-0022489d55b0';

describe('buildListQuery', () => {
  it('NEVER selects description', () => {
    // The hard one. Email bodies live in blob storage; selecting them in a list query is what
    // makes a 50-message case slow, and it is the easiest regression to reintroduce by accident.
    // This test exists to fail loudly if anyone "helpfully" adds it back.
    expect(buildListQuery(CASE)).not.toContain('description');
    expect(LIST_COLUMNS as readonly string[]).not.toContain('description');
  });

  it('filters on the TYPED navigation property, not regardingobjecttypecode', () => {
    // regardingobjecttypecode is a FetchXML attribute only; filtering on it over the Web API
    // returns HTTP 400. Measured 2026-09-10, after this repo's own guidance said otherwise.
    const q = buildListQuery(CASE);
    expect(q).toContain(`regardingobjectid_incident/incidentid eq ${CASE}`);
    expect(q).not.toContain('regardingobjecttypecode');
  });

  it('selects the columns threading needs', () => {
    const q = buildListQuery(CASE);
    for (const column of [
      'activityid', 'subject', 'directioncode', 'createdon',
      'baseconversationindexhash', 'conversationindex', 'attachmentcount',
      '_correlatedactivityid_value', '_parentactivityid_value',
    ]) {
      expect(q).toContain(column);
    }
  });

  it('orders newest first', () => {
    expect(buildListQuery(CASE)).toContain('$orderby=createdon desc');
  });

  it('refuses anything that is not a GUID', () => {
    // These filters interpolate unquoted, so this is the one injection surface in the module.
    expect(() => buildListQuery("' or 1 eq 1 or '")).toThrow(/not a GUID/);
    expect(() => buildListQuery('')).toThrow(/not a GUID/);
    expect(() => buildListQuery('40a5d940')).toThrow(/not a GUID/);
  });

  it('tolerates a braced GUID, which is how form XML writes them', () => {
    expect(() => assertGuid(`{${CASE}}`, 'caseId')).not.toThrow();
  });
});

describe('the other query builders', () => {
  it('fetches the body on its own, and only the body', () => {
    expect(buildBodyQuery()).toBe('?$select=activityid,description');
  });

  it('builds a parties filter as an or-chain', () => {
    const q = buildPartiesQuery([CASE, MSG]);
    expect(q).toContain(`_activityid_value eq ${CASE} or _activityid_value eq ${MSG}`);
    expect(q).toContain('participationtypemask');
  });

  it('SELECTS the grouping key, not just filters on it', () => {
    // The bug this pins: OData will filter on a column it does not return. Without
    // `_activityid_value` in the $select, the query fetched exactly the right rows and
    // groupParties could key none of them — so every message rendered with no recipients.
    // Found in the published app on 2026-09-11, not by this suite, because the hand-written
    // fixtures below include the field while the real query did not.
    const select = buildPartiesQuery([MSG]).split('&')[0];
    expect(select).toContain('_activityid_value');
  });

  it('NEVER selects the attachment body in the metadata query', () => {
    // Selecting `body` here would download every attachment on the case to render a filename.
    const q = buildAttachmentsQuery(MSG);
    expect(q).not.toContain('body');
    expect(q).toContain('filename');
    expect(q).toContain('filesize');
    expect(q).toContain("objecttypecode eq 'email'");
  });
});

describe('groupParties', () => {
  const row = (mask: number, name: string, address: string, activity = MSG) => ({
    _activityid_value: activity,
    participationtypemask: mask,
    addressused: address,
    _partyid_value: 'p-1',
    '_partyid_value@OData.Community.Display.V1.FormattedValue': name,
  });

  it('splits by participation mask: 1 sender, 2 to, 3 cc, 4 bcc', () => {
    const grouped = groupParties([
      row(1, 'Kim Petersen', 'kp@ingenior-petersen.example.invalid'),
      row(2, 'Care', 'care@example.invalid'),
      row(3, 'Morten Bach Jensen', 'mbj@jensenvvs.example.invalid'),
      row(3, 'Anne Holm', 'bogholderi@jensenvvs.example.invalid'),
      row(4, 'Skjult', 'hidden@example.invalid'),
    ]);
    const parties = grouped.get(MSG);
    expect(parties?.sender?.name).toBe('Kim Petersen');
    expect(parties?.to.map((p) => p.name)).toEqual(['Care']);
    expect(parties?.cc.map((p) => p.name)).toEqual(['Morten Bach Jensen', 'Anne Holm']);
    expect(parties?.bcc.map((p) => p.name)).toEqual(['Skjult']);
  });

  it('keeps messages apart', () => {
    const grouped = groupParties([
      row(1, 'Kim', 'kp@x.invalid', MSG),
      row(1, 'Morten', 'mbj@y.invalid', CASE),
    ]);
    expect(grouped.size).toBe(2);
    expect(grouped.get(MSG)?.sender?.name).toBe('Kim');
    expect(grouped.get(CASE)?.sender?.name).toBe('Morten');
  });

  it('falls back to the address when there is no display name', () => {
    const grouped = groupParties([{
      _activityid_value: MSG,
      participationtypemask: 2,
      addressused: 'someone@example.invalid',
    }]);
    // A chip reading "undefined" is worse than one reading an address.
    expect(grouped.get(MSG)?.to[0].name).toBe('someone@example.invalid');
  });

  it('never invents a name', () => {
    const grouped = groupParties([{ _activityid_value: MSG, participationtypemask: 2 }]);
    expect(grouped.get(MSG)?.to[0].name).toBe('(unknown)');
  });

  it('ignores masks it does not model rather than guessing', () => {
    const grouped = groupParties([row(9, 'Organiser', 'o@example.invalid')]);
    const p = grouped.get(MSG);
    expect(p?.to).toEqual([]);
    expect(p?.cc).toEqual([]);
    expect(p?.sender).toBeUndefined();
  });

  it('skips rows with no activity id', () => {
    expect(groupParties([{ participationtypemask: 2, addressused: 'x@y.invalid' }]).size).toBe(0);
  });
});

describe('toEmailRow', () => {
  it('maps a realistic row', () => {
    const mapped = toEmailRow({
      activityid: MSG,
      subject: 'RE: Reklamation CRM:0100009',
      directioncode: true,
      statuscode: 3,
      'statuscode@OData.Community.Display.V1.FormattedValue': 'Sent',
      createdon: '2026-09-10T10:39:20Z',
      baseconversationindexhash: 100487241,
      conversationindex: '01E1ECB8719970468FB42521B09111CCB3DD4110A4DE',
      attachmentcount: 1,
      _correlatedactivityid_value: CASE,
      _parentactivityid_value: null,
    });
    expect(mapped.activityid).toBe(MSG);
    expect(mapped.directioncode).toBe(true);
    expect(mapped.statuslabel).toBe('Sent');
    expect(mapped.correlatedactivityid).toBe(CASE);
    expect(mapped.parentactivityid).toBeNull();
  });

  it('keeps null distinct from missing, because threading branches on null', () => {
    const mapped = toEmailRow({ activityid: MSG, subject: null, conversationindex: null });
    expect(mapped.subject).toBeNull();
    expect(mapped.conversationindex).toBeNull();
    expect(mapped.baseconversationindexhash).toBeNull();
    expect(mapped.directioncode).toBeNull();
  });
});

describe('fetching', () => {
  const page = (entities: Record<string, unknown>[], nextLink?: string) =>
    Promise.resolve({ entities, nextLink });

  it('follows @odata.nextLink rather than truncating', async () => {
    // Showing the first 100 of 140 messages silently is a correctness bug, not a perf trade-off.
    const retrieveMultipleRecords = vi.fn()
      .mockImplementationOnce(() => page(
        [{ activityid: MSG, createdon: '2026-09-10T00:00:00Z' }],
        "/api/data/v9.2/emails?$skiptoken=abc",
      ))
      .mockImplementationOnce(() => page([{ activityid: CASE, createdon: '2026-09-09T00:00:00Z' }]));
    const api: WebApiLike = { retrieveMultipleRecords, retrieveRecord: vi.fn() };

    const rows = await fetchCaseEmails(api, CASE);
    expect(rows).toHaveLength(2);
    expect(retrieveMultipleRecords).toHaveBeenCalledTimes(2);
  });

  it('batches the parties query so a big case does not blow the URL length', async () => {
    const ids = Array.from({ length: 45 }, (_, i) =>
      `40a5d940-0ef6-f011-8406-000d3ab7be${String(i).padStart(2, '0')}`);
    const retrieveMultipleRecords = vi.fn(() => page([]));
    await fetchParties({ retrieveMultipleRecords, retrieveRecord: vi.fn() }, ids);
    expect(retrieveMultipleRecords).toHaveBeenCalledTimes(3); // 20 + 20 + 5
  });

  it('does not call the platform at all for an empty id list', async () => {
    const retrieveMultipleRecords = vi.fn();
    const parties = await fetchParties({ retrieveMultipleRecords, retrieveRecord: vi.fn() }, []);
    expect(parties.size).toBe(0);
    expect(retrieveMultipleRecords).not.toHaveBeenCalled();
  });

  it('returns an empty body rather than undefined when description is absent', async () => {
    const api: WebApiLike = {
      retrieveMultipleRecords: vi.fn(),
      retrieveRecord: vi.fn(() => Promise.resolve({ activityid: MSG })),
    };
    expect(await fetchBody(api, MSG)).toBe('');
  });

  it('maps attachment metadata, keeping attachmentid for reuse on forward', async () => {
    // The shape the server REALLY sends: a lookup arrives as `_attachmentid_value`. The fixture
    // used `attachmentid` until 2026-09-28, which is why this test passed while every forward
    // in the published app dropped its attachments.
    const api: WebApiLike = {
      retrieveMultipleRecords: vi.fn(() => page([{
        activitymimeattachmentid: 'a-1',
        _attachmentid_value: 'shared-file-1',
        filename: 'Fotodokumentation_etape3.pdf',
        mimetype: 'application/pdf',
        filesize: 2516582,
      }])),
      retrieveRecord: vi.fn(),
    };
    const [att] = await fetchAttachments(api, MSG);
    expect(att.filename).toBe('Fotodokumentation_etape3.pdf');
    expect(att.fileSize).toBe(2516582);
    // Reused rather than re-uploaded on forward: same stored file, no extra storage.
    expect(att.attachmentId).toBe('shared-file-1');
  });

  it('SELECTS the lookup form — the logical name is silently ignored by the server', () => {
    const q = buildAttachmentsQuery(MSG);
    expect(q).toContain('_attachmentid_value');
    expect(q).not.toMatch(/[,=]attachmentid[,&]/);
  });

  it('names an unnamed attachment rather than rendering nothing', async () => {
    const api: WebApiLike = {
      retrieveMultipleRecords: vi.fn(() => page([{ activitymimeattachmentid: 'a-1' }])),
      retrieveRecord: vi.fn(),
    };
    const [att] = await fetchAttachments(api, MSG);
    expect(att.filename).toBe('(unnamed)');
    expect(att.mimeType).toBe('application/octet-stream');
  });
});

describe('failures carry a usable message', () => {
  // These tests reject with PLAIN OBJECTS on purpose. That is not sloppiness — it is the measured
  // behaviour of context.webAPI (2026-09-10), and the whole reason errors.ts exists. Rejecting
  // with a real Error here would test a case the platform never produces.
  /* eslint-disable @typescript-eslint/prefer-promise-reject-errors */

  it('survives context.webAPI rejecting with a PLAIN OBJECT', async () => {
    const api: WebApiLike = {
      retrieveMultipleRecords: vi.fn(() =>
        Promise.reject({ message: 'The user is not a member of the organization.', errorCode: '0x80040217' })),
      retrieveRecord: vi.fn(),
    };

    await expect(fetchCaseEmails(api, CASE)).rejects.toBeInstanceOf(DataverseError);
    try {
      await fetchCaseEmails(api, CASE);
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as DataverseError;
      expect(err.normalised.message).toContain('not a member of the organization');
      expect(err.normalised.code).toBe('0x80040217');
    }
  });

  it('still produces something reportable when the rejection is shapeless', async () => {
    const api: WebApiLike = {
      retrieveMultipleRecords: vi.fn(() => Promise.reject({ weird: true })),
      retrieveRecord: vi.fn(),
    };
    try {
      await fetchCaseEmails(api, CASE);
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as DataverseError;
      // An ugly message beats "Unknown error": it can be pasted into a bug report.
      expect(err.normalised.message).toContain('weird');
    }
  });

  /* eslint-enable @typescript-eslint/prefer-promise-reject-errors */
});

describe('buildListQueryForCases — R8', () => {
  const A = '40a5d940-0ef6-f011-8406-000d3ab7be36';
  const B = '290bf70d-ebf5-f011-8406-7c1e521fcfa3';

  it('ORs the typed navigation property across cases', () => {
    const q = buildListQueryForCases([A, B]);
    expect(q).toContain(`regardingobjectid_incident/incidentid eq ${A}`);
    expect(q).toContain(`regardingobjectid_incident/incidentid eq ${B}`);
    expect(q).toContain(' or ');
  });

  it('still never selects the body', () => {
    // The same hard rule as the single-case query: bodies live in blob storage (N5).
    expect(buildListQueryForCases([A, B])).not.toContain('description');
  });

  it('selects the regarding case, so a thread can be marked as borrowed', () => {
    expect(buildListQueryForCases([A])).toContain('_regardingobjectid_value');
  });

  it('refuses a non-GUID and an empty list rather than building a bad filter', () => {
    expect(() => buildListQueryForCases([A, 'nope'])).toThrow(/caseId/);
    expect(() => buildListQueryForCases([])).toThrow(/at least one/);
  });
});

describe('fetchAncestry — R8', () => {
  const CHILD = '40a5d940-0ef6-f011-8406-000d3ab7be36';
  const PARENT = '290bf70d-ebf5-f011-8406-7c1e521fcfa3';
  const GRAND = '11c0c49d-f8f5-f011-8406-000d3ab39833';

  /** A fake `incident` store keyed by id. */
  const cases = (map: Record<string, { parent?: string; ticket: string }>) => {
    const retrieveRecord = vi.fn((_entity: string, id: string) => {
      const found = map[id.toLowerCase()];
      if (!found) return Promise.reject(new Error(`no case ${id}`));
      return Promise.resolve({
        incidentid: id,
        ticketnumber: found.ticket,
        title: `Case ${found.ticket}`,
        _parentcaseid_value: found.parent ?? null,
      } as Record<string, unknown>);
    });
    return { webApi: { retrieveMultipleRecords: vi.fn(), retrieveRecord }, retrieveRecord };
  };

  it('returns an empty chain when the case has no parent', async () => {
    const { webApi } = cases({ [CHILD]: { ticket: 'CAS-01021' } });
    expect(await fetchAncestry(webApi, CHILD)).toEqual([]);
  });

  it('walks up one level', async () => {
    const { webApi } = cases({
      [CHILD]: { ticket: 'CAS-01021', parent: PARENT },
      [PARENT]: { ticket: 'CAS-01016' },
    });
    const chain = await fetchAncestry(webApi, CHILD);
    expect(chain).toEqual([{ caseId: PARENT, ticketNumber: 'CAS-01016', title: 'Case CAS-01016' }]);
  });

  it('walks the whole chain, nearest first', async () => {
    const { webApi } = cases({
      [CHILD]: { ticket: 'C', parent: PARENT },
      [PARENT]: { ticket: 'P', parent: GRAND },
      [GRAND]: { ticket: 'G' },
    });
    expect((await fetchAncestry(webApi, CHILD)).map((a) => a.ticketNumber)).toEqual(['P', 'G']);
  });

  it('STOPS on a cycle instead of hanging the control', async () => {
    // `parentcaseid` is an ordinary lookup; nothing stops an import or a plugin pointing two
    // cases at each other. An uncapped walk would spin on load — the most expensive place to
    // find out.
    const { webApi } = cases({
      [CHILD]: { ticket: 'C', parent: PARENT },
      [PARENT]: { ticket: 'P', parent: CHILD },
    });
    const chain = await fetchAncestry(webApi, CHILD);
    expect(chain.map((a) => a.ticketNumber)).toEqual(['P']);
  });

  it('honours the depth cap on a long chain', async () => {
    // A chain longer than the cap is truncated rather than followed forever.
    const ids = [CHILD, PARENT, GRAND];
    const { webApi } = cases({
      [CHILD]: { ticket: 'C', parent: PARENT },
      [PARENT]: { ticket: 'P', parent: GRAND },
      [GRAND]: { ticket: 'G' },
    });
    expect(await fetchAncestry(webApi, ids[0], 1)).toHaveLength(1);
  });

  it('refuses a non-GUID before calling the platform', async () => {
    const { webApi, retrieveRecord } = cases({});
    await expect(fetchAncestry(webApi, 'nope')).rejects.toThrow(/caseId/);
    expect(retrieveRecord).not.toHaveBeenCalled();
  });
});
