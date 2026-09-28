import { PARTY_ROLE } from '../domain/draft';
import { asString } from './coerce';
import { toGuid } from '../domain/guid';
import type { EmailRow } from '../domain/threading';
import { normaliseWebApiError, type NormalisedError } from './errors';

/**
 * Every Dataverse read the reading slice needs.
 *
 * The query strings are built by pure functions so they can be asserted in tests — in particular
 * that `description` never appears in a list `$select`, which is a hard performance requirement
 * rather than an optimisation. Simulating `context.webAPI` itself would produce tests that pass
 * while the real thing fails (see the rejects-with-a-plain-object trap in errors.ts), so the
 * fetching functions are thin and verified against the live environment instead.
 */

/** The `webAPI` surface we actually use. Narrower than the platform's, and easier to stub. */
export interface WebApiLike {
  retrieveMultipleRecords(
    entityLogicalName: string,
    options?: string,
    maxPageSize?: number,
  ): Promise<{ entities: Record<string, unknown>[]; nextLink?: string }>;
  retrieveRecord(
    entityLogicalName: string,
    id: string,
    options?: string,
  ): Promise<Record<string, unknown>>;
}

// ── column sets ──────────────────────────────────────────────────────────────

/**
 * The list projection.
 *
 * **`description` is absent, and must stay absent.** Email bodies were moved out of the relational
 * store into Azure Blob storage; pulling them for a whole thread list is what makes a 50-message
 * case slow, and it is the single easiest performance regression to reintroduce by accident. The
 * body is fetched per message, on expand, by `buildBodyQuery` below.
 */
export const LIST_COLUMNS = [
  'activityid',
  'subject',
  'directioncode',
  'statecode',
  'statuscode',
  'createdon',
  'modifiedon',
  'actualend',
  'baseconversationindexhash',
  'conversationindex',
  'attachmentcount',
  'torecipients',
  '_correlatedactivityid_value',
  '_parentactivityid_value',
  '_regardingobjectid_value',
] as const;

/**
 * Recipient columns.
 *
 * **`_activityid_value` must be here.** It is the key `groupParties` buckets on, and OData will
 * happily *filter* on a column it does not *return* — so omitting it produced a query that looked
 * correct, returned the right rows, and grouped none of them. Every message rendered with no
 * recipients at all. Found in the published app on 2026-09-11.
 *
 * The unit test missed it because the hand-written fixture rows included the field: the fixture
 * was more generous than the real query. There is now a test asserting the SELECT contains it.
 */
const PARTY_COLUMNS = [
  'activitypartyid',
  '_activityid_value',
  'participationtypemask',
  'addressused',
  '_partyid_value',
] as const;

const ATTACHMENT_COLUMNS = [
  'activitymimeattachmentid',
  'attachmentid',
  'filename',
  'mimetype',
  'filesize',
  // Set only on an INLINE image the platform materialised from a `cid:` reference in the body.
  // It is what distinguishes body content from a file the agent attached — see `contentId`.
  'attachmentcontentid',
] as const;

// ── query builders (pure) ────────────────────────────────────────────────────

/**
 * Emails regarding one case.
 *
 * The filter uses the **typed navigation property**, `regardingobjectid_incident/incidentid`.
 * That both scopes the query and guarantees the regarding object is a Case, so GUIDs cannot
 * collide across tables. Do NOT reach for `regardingobjecttypecode`: it is a FetchXML attribute
 * only and filtering on it over the Web API fails with HTTP 400 (measured 2026-09-10 — earlier
 * guidance in this repo was wrong about that).
 */
export function buildListQuery(caseId: string): string {
  assertGuid(caseId, 'caseId');
  return (
    `?$select=${LIST_COLUMNS.join(',')}` +
    `&$filter=regardingobjectid_incident/incidentid eq ${caseId}` +
    `&$orderby=createdon desc`
  );
}

/**
 * The same list, across several cases at once (R8).
 *
 * One request rather than one per case: the ancestor chain is usually one deep but need not be,
 * and a request per ancestor would put the N5 budget at the mercy of how someone structured their
 * cases. `regardingCaseId` on each row says which case it came from.
 */
export function buildListQueryForCases(caseIds: readonly string[]): string {
  if (caseIds.length === 0) throw new Error('buildListQueryForCases needs at least one case id');
  caseIds.forEach((id) => assertGuid(id, 'caseId'));
  const filter = caseIds
    .map((id) => `regardingobjectid_incident/incidentid eq ${id}`)
    .join(' or ');
  return (
    `?$select=${LIST_COLUMNS.join(',')}` +
    `&$filter=${filter}` +
    `&$orderby=createdon desc`
  );
}

/** One case's parent link and number, for walking the ancestry. */
export function buildCaseAncestryQuery(caseId: string): string {
  assertGuid(caseId, 'caseId');
  return `?$select=incidentid,ticketnumber,title,_parentcaseid_value`;
}

/** A case in the ancestor chain, nearest first. */
export interface AncestorCase {
  caseId: string;
  ticketNumber: string;
  title: string;
}

/**
 * Walks up `parentcaseid` from the given case.
 *
 * **Capped, and the cap is not paranoia about Dataverse.** `parentcaseid` is an ordinary lookup;
 * nothing stops a data import or a plugin from pointing two cases at each other, and an uncapped
 * walk would then hang the control on load — the most expensive possible place to discover it.
 * Also stops if a case reappears, which catches a cycle sooner than the cap does.
 */
export async function fetchAncestry(
  webApi: WebApiLike,
  caseId: string,
  maxDepth = 8,
): Promise<AncestorCase[]> {
  assertGuid(caseId, 'caseId');
  return wrap(async () => {
    const chain: AncestorCase[] = [];
    const seen = new Set<string>([caseId.toLowerCase()]);
    let current = caseId;

    for (let depth = 0; depth < maxDepth; depth += 1) {
      const row = await webApi.retrieveRecord('incident', current, buildCaseAncestryQuery(current));
      const parentId = row._parentcaseid_value ? asString(row._parentcaseid_value) : '';
      if (!parentId || seen.has(parentId.toLowerCase())) break;
      seen.add(parentId.toLowerCase());

      const parent = await webApi.retrieveRecord(
        'incident', parentId, buildCaseAncestryQuery(parentId),
      );
      chain.push({
        caseId: parentId.toLowerCase(),
        ticketNumber: asString(parent.ticketnumber, ''),
        title: asString(parent.title, ''),
      });
      current = parentId;
    }
    return chain;
  });
}

/** One message's body, fetched lazily on expand. */
export function buildBodyQuery(): string {
  return '?$select=activityid,description';
}

/**
 * Recipients for a set of messages.
 *
 * A second query rather than `$expand` on the list: an expanded collection cannot be paged
 * independently and multiplies the list payload by the party count, which fights the performance
 * requirement for exactly the deep chains this client exists to show.
 */
export function buildPartiesQuery(activityIds: readonly string[]): string {
  activityIds.forEach((id) => assertGuid(id, 'activityId'));
  const filter = activityIds.map((id) => `_activityid_value eq ${id}`).join(' or ');
  return `?$select=${PARTY_COLUMNS.join(',')}&$filter=${filter}`;
}

/**
 * Attachment metadata for one message.
 *
 * **`body` is absent deliberately** — it is the base64 file content, and pulling it to render a
 * filename and a size would download every attachment on the case. It is fetched on click.
 */
export function buildAttachmentsQuery(activityId: string): string {
  assertGuid(activityId, 'activityId');
  return (
    `?$select=${ATTACHMENT_COLUMNS.join(',')}` +
    `&$filter=_objectid_value eq ${activityId} and objecttypecode eq 'email'`
  );
}

/** One attachment's bytes, on click. */
export function buildAttachmentBodyQuery(): string {
  return '?$select=filename,mimetype,filesize,body';
}

/** GUIDs go into these filters unquoted — see `domain/guid.ts`. */
export function assertGuid(value: string, what: string): void {
  toGuid(value, what);
}

// ── party roles ──────────────────────────────────────────────────────────────

/** `participationtypemask` values. Recipients are rows, never a string — see `torecipients`. */
export { PARTY_ROLE };

export type PartyRole = keyof typeof PARTY_ROLE;

export interface Party {
  role: PartyRole | 'other';
  name: string;
  address: string;
  partyId?: string;
  /**
   * Which table `partyId` points at, and the navigation property to bind it with.
   *
   * Both arrive as annotations on the EXISTING query — no extra column, no extra request. They
   * were simply never read. Without them a reply cannot re-bind the recipient it is answering,
   * and writes an unresolved party Dataverse may refuse to deliver to.
   */
  partyEntity?: string;
  partyNav?: string;
}

export interface MessageParties {
  sender?: Party;
  to: Party[];
  cc: Party[];
  bcc: Party[];
}

const roleOf = (mask: unknown): PartyRole | 'other' => {
  switch (mask) {
    case PARTY_ROLE.sender: return 'sender';
    case PARTY_ROLE.to: return 'to';
    case PARTY_ROLE.cc: return 'cc';
    case PARTY_ROLE.bcc: return 'bcc';
    default: return 'other';
  }
};

/** Groups raw `activityparty` rows by role, per message. Pure, so it is unit-tested. */
export function groupParties(
  rows: readonly Record<string, unknown>[],
): Map<string, MessageParties> {
  const byActivity = new Map<string, MessageParties>();

  for (const row of rows) {
    const activityId = asString(row._activityid_value, '');
    if (!activityId) continue;

    let bucket = byActivity.get(activityId);
    if (!bucket) {
      bucket = { to: [], cc: [], bcc: [] };
      byActivity.set(activityId, bucket);
    }

    const party: Party = {
      role: roleOf(row.participationtypemask),
      // The formatted-value annotation carries the display name; fall back to the address, because
      // a chip reading "undefined" is worse than one reading an email address.
      name:
        asString(
          row['_partyid_value@OData.Community.Display.V1.FormattedValue'] ??
          row.addressused ??
          '',
        ) || '(unknown)',
      address: asString(row.addressused, ''),
      partyId: row._partyid_value ? asString(row._partyid_value) : undefined,
      // The platform states the table and the bind property outright; prefer them over deriving
      // either. Both are absent on an unresolved party — exactly the signal we want.
      partyEntity: row['_partyid_value@Microsoft.Dynamics.CRM.lookuplogicalname']
        ? asString(row['_partyid_value@Microsoft.Dynamics.CRM.lookuplogicalname'])
        : undefined,
      partyNav: row['_partyid_value@Microsoft.Dynamics.CRM.associatednavigationproperty']
        ? asString(row['_partyid_value@Microsoft.Dynamics.CRM.associatednavigationproperty'])
        : undefined,
    };

    switch (party.role) {
      case 'sender': bucket.sender = party; break;
      case 'to': bucket.to.push(party); break;
      case 'cc': bucket.cc.push(party); break;
      case 'bcc': bucket.bcc.push(party); break;
      default: break; // masks we do not model are ignored rather than guessed at
    }
  }

  return byActivity;
}

// ── row mapping ──────────────────────────────────────────────────────────────


/** Maps a raw Dataverse row onto the shape the threading module expects. */
export function toEmailRow(raw: Record<string, unknown>): EmailRow {
  return {
    activityid: asString(raw.activityid, ''),
    subject: raw.subject === null || raw.subject === undefined ? null : asString(raw.subject),
    directioncode: typeof raw.directioncode === 'boolean' ? raw.directioncode : null,
    statuscode: typeof raw.statuscode === 'number' ? raw.statuscode : null,
    statuslabel: raw['statuscode@OData.Community.Display.V1.FormattedValue']
      ? asString(raw['statuscode@OData.Community.Display.V1.FormattedValue'])
      : undefined,
    createdon: asString(raw.createdon, ''),
    baseconversationindexhash:
      typeof raw.baseconversationindexhash === 'number' ? raw.baseconversationindexhash : null,
    conversationindex:
      raw.conversationindex === null || raw.conversationindex === undefined
        ? null
        : asString(raw.conversationindex),
    correlatedactivityid: raw._correlatedactivityid_value
      ? asString(raw._correlatedactivityid_value)
      : null,
    parentactivityid: raw._parentactivityid_value ? asString(raw._parentactivityid_value) : null,
    attachmentcount: typeof raw.attachmentcount === 'number' ? raw.attachmentcount : null,
    // Which case this message hangs off. Needed by R8: once parent-case mail is mixed into the
    // list, a thread has to know which case it came from in order to be marked as borrowed.
    regardingCaseId: raw._regardingobjectid_value
      ? asString(raw._regardingobjectid_value).toLowerCase()
      : null,
  };
}

// ── fetching ─────────────────────────────────────────────────────────────────

export interface Attachment {
  id: string;
  /** The shared file id. On FORWARD this is reused rather than re-uploaded — same stored file. */
  attachmentId?: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  /**
   * The Content-ID, when this row is an INLINE image rather than a file the agent attached.
   *
   * Measured 2026-09-25: saving a draft whose body quotes a message containing
   * `<img src="cid:…">` makes the platform create an `activitymimeattachment` for it, **reusing
   * the original's blob**. That is desirable — without it the quoted image arrives broken — but
   * such a row is body content, not an attachment. It must not appear in the attachment tray,
   * and removing it would break the quote. It still weighs on the wire, so it must be counted
   * toward the message size.
   */
  contentId?: string;
}

export class DataverseError extends Error {
  public readonly normalised: NormalisedError;
  constructor(normalised: NormalisedError) {
    super(normalised.message);
    this.name = 'DataverseError';
    this.normalised = normalised;
  }
}

const wrap = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (rejection) {
    // Never `instanceof Error` here: context.webAPI rejects with a plain object.
    throw new DataverseError(normaliseWebApiError(rejection));
  }
};

/**
 * Every row a query matches, following `@odata.nextLink` rather than truncating.
 *
 * A case-scoped view will rarely need a second page, but silently showing the first 100 of 140
 * messages is a correctness bug, not a performance one. One copy (R4): the read-state page had
 * its own.
 */
export async function fetchAllPages(
  webApi: WebApiLike,
  entity: string,
  firstOptions: string,
  pageSize: number,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let options: string | undefined = firstOptions;
  while (options) {
    const page = await webApi.retrieveMultipleRecords(entity, options, pageSize);
    rows.push(...page.entities);
    options = page.nextLink ? page.nextLink.slice(page.nextLink.indexOf('?')) : undefined;
  }
  return rows;
}

/** All emails on a case, paged. Pass several ids to include ancestor cases (R8). */
export async function fetchCaseEmails(
  webApi: WebApiLike,
  caseId: string | readonly string[],
  pageSize = 100,
): Promise<EmailRow[]> {
  return wrap(async () => {
    const options = typeof caseId === 'string'
      ? buildListQuery(caseId)
      : buildListQueryForCases(caseId);
    return (await fetchAllPages(webApi, 'email', options, pageSize)).map(toEmailRow);
  });
}

/** One message's body. Call on expand, never in the list. */
export async function fetchBody(webApi: WebApiLike, activityId: string): Promise<string> {
  assertGuid(activityId, 'activityId');
  return wrap(async () => {
    const row = await webApi.retrieveRecord('email', activityId, buildBodyQuery());
    return typeof row.description === 'string' ? row.description : '';
  });
}

/** Recipients for a batch of messages. */
export async function fetchParties(
  webApi: WebApiLike,
  activityIds: readonly string[],
): Promise<Map<string, MessageParties>> {
  if (activityIds.length === 0) return new Map();
  return wrap(async () => {
    // OData `or` chains get unwieldy; batch so a 50-message case stays within a sane URL length.
    const batches: string[][] = [];
    for (let i = 0; i < activityIds.length; i += 20) {
      batches.push(activityIds.slice(i, i + 20));
    }
    const all: Record<string, unknown>[] = [];
    for (const batch of batches) {
      const page = await webApi.retrieveMultipleRecords('activityparty', buildPartiesQuery(batch));
      all.push(...page.entities);
    }
    return groupParties(all);
  });
}

/** Attachment metadata for one message. Never the bytes. */
export async function fetchAttachments(
  webApi: WebApiLike,
  activityId: string,
): Promise<Attachment[]> {
  return wrap(async () => {
    const page = await webApi.retrieveMultipleRecords(
      'activitymimeattachment',
      buildAttachmentsQuery(activityId),
    );
    return page.entities.map((row) => ({
      id: asString(row.activitymimeattachmentid, ''),
      attachmentId: row.attachmentid ? asString(row.attachmentid) : undefined,
      filename: asString(row.filename, '(unnamed)'),
      mimeType: asString(row.mimetype, 'application/octet-stream'),
      fileSize: typeof row.filesize === 'number' ? row.filesize : 0,
      contentId: row.attachmentcontentid ? asString(row.attachmentcontentid) : undefined,
    }));
  });
}
