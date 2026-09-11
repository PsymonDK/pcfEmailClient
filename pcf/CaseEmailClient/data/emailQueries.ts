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

/**
 * GUIDs go into these filters unquoted, so they are the one place a caller could inject OData.
 * Validating rather than escaping, because a non-GUID here is always a bug rather than input.
 */
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertGuid(value: string, what: string): void {
  const bare = value.replace(/^\{|\}$/g, '');
  if (!GUID_RE.test(bare)) throw new Error(`${what} is not a GUID: ${JSON.stringify(value)}`);
}

// ── party roles ──────────────────────────────────────────────────────────────

/** `participationtypemask` values. Recipients are rows, never a string — see `torecipients`. */
export const PARTY_ROLE = {
  sender: 1,
  to: 2,
  cc: 3,
  bcc: 4,
} as const;

export type PartyRole = keyof typeof PARTY_ROLE;

export interface Party {
  role: PartyRole | 'other';
  name: string;
  address: string;
  partyId?: string;
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

/**
 * Dataverse rows arrive as `Record<string, unknown>`, and `String(unknown)` happily produces
 * "[object Object]" for anything that is not a primitive. This keeps that out of the UI.
 */
function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

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

/** All emails on a case, paged. */
export async function fetchCaseEmails(
  webApi: WebApiLike,
  caseId: string,
  pageSize = 100,
): Promise<EmailRow[]> {
  return wrap(async () => {
    const rows: Record<string, unknown>[] = [];
    let options: string | undefined = buildListQuery(caseId);

    // Follow @odata.nextLink rather than truncating. A case-scoped view will rarely need it, but
    // silently showing the first 100 of 140 messages is a correctness bug, not a performance one.
    while (options) {
      const page = await webApi.retrieveMultipleRecords('email', options, pageSize);
      rows.push(...page.entities);
      options = page.nextLink ? page.nextLink.slice(page.nextLink.indexOf('?')) : undefined;
    }

    return rows.map(toEmailRow);
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
    }));
  });
}
