import { bareId } from '../domain/guid';
import { assertGuid } from './emailQueries';
import { normaliseWebApiError, type NormalisedError } from './errors';
import { type ReadStateApiLike } from './readState';
import {
  buildDraftPayload, buildDraftUpdate, buildPartyRows, type DraftArgs,
} from '../domain/draft';

/**
 * Persisting an in-progress reply to Dataverse (R16).
 *
 * **Why durable storage and not just `setControlState`.** `setControlState` is measured to survive
 * a CSW two-session teardown on both placements, so it is not a workaround — but it does not
 * survive a page reload, a crash, or a browser being closed. The difference this file makes is
 * between losing a draft and losing a draft *silently*.
 *
 * Every shape below was measured against the live environment on 2026-09-25, not inferred:
 *
 * - `email_activity_parties` on **create** accepts a queue sender by
 *   `partyid_queue@odata.bind` and recipients as bare `addressused` strings with no `partyid`.
 *   The bare form is the normal case on a Case — customers are frequently not Contacts.
 * - The platform **fills `addressused` on the queue sender itself** from the queue's address, and
 *   **derives `torecipients`** from the To parties. Confirms `torecipients` is read-only output;
 *   writing it is the trap it looks like the solution to.
 * - `email_activity_parties` on **PATCH replaces** the To/Cc/sender set and leaves the platform's
 *   own owner (mask 9) and regarding (mask 8) rows alone. So recipient edits are one request, not
 *   a delete-then-recreate dance.
 */

/** `context.webAPI`, narrowed to the writes a draft needs. */
export interface DraftApiLike extends ReadStateApiLike {
  updateRecord(
    entityLogicalName: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<{ id: string }>;
  deleteRecord(entityLogicalName: string, id: string): Promise<{ id: string }>;
}

export interface SaveOutcome {
  ok: boolean;
  /** The draft's `activityid`, whether it was just created or already existed. */
  emailId?: string;
  savedAt?: Date;
  error?: NormalisedError;
}

/** Strip braces for a URL. Callers validate with `assertGuid` first. */
const bare = bareId;

/**
 * Create the draft row.
 *
 * Returns the new `activityid`, which the caller must hold on to — every later save is an update
 * against it, and losing it means the next autosave creates a *second* draft. That is the failure
 * mode to watch for here: not data loss, but duplicate drafts multiplying on a Case.
 */
export async function createDraft(
  webApi: DraftApiLike,
  args: DraftArgs,
): Promise<SaveOutcome> {
  try {
    assertGuid(args.caseId, 'caseId');
  } catch (e) {
    return { ok: false, error: { message: 'No case to save a draft against.', raw: e } };
  }

  try {
    const created = await webApi.createRecord('email', buildDraftPayload(args));
    return { ok: true, emailId: bare(created.id), savedAt: new Date() };
  } catch (rejection) {
    return { ok: false, error: normaliseWebApiError(rejection) };
  }
}

/**
 * Update an existing draft.
 *
 * `includeParties` sends the recipient set too, which replaces it wholesale. It is off by default
 * because autosave fires for typing far more often than for recipient changes, and there is no
 * reason to rewrite three `activityparty` rows every time someone types a sentence.
 */
export async function updateDraft(
  webApi: DraftApiLike,
  emailId: string,
  args: DraftArgs,
  includeParties = false,
): Promise<SaveOutcome> {
  try {
    assertGuid(emailId, 'emailId');
  } catch (e) {
    return { ok: false, error: { message: 'That draft cannot be addressed.', raw: e } };
  }

  try {
    const payload = includeParties
      ? { ...buildDraftUpdate(args), email_activity_parties: buildPartyRows(args) }
      : buildDraftUpdate(args);
    await webApi.updateRecord('email', bare(emailId), payload);
    return { ok: true, emailId: bare(emailId), savedAt: new Date() };
  } catch (rejection) {
    return { ok: false, emailId: bare(emailId), error: normaliseWebApiError(rejection) };
  }
}

/** Create or update, whichever this draft needs. One entry point so callers cannot pick wrong. */
export async function saveDraft(
  webApi: DraftApiLike,
  emailId: string | undefined,
  args: DraftArgs,
  includeParties = false,
): Promise<SaveOutcome> {
  return emailId
    ? updateDraft(webApi, emailId, args, includeParties)
    : createDraft(webApi, args);
}

/** A draft already on the Case, found again when the agent reopens Reply on the same message. */
export interface ExistingDraft {
  emailId: string;
  subject: string;
  /** The full stored body — new text AND quote. Split it with `splitQuotedHistory`. */
  bodyHtml: string;
}

export function buildDraftLookupQuery(caseId: string, inReplyToId: string, ownerId: string): string {
  const c = bare(caseId).toLowerCase();
  const p = bare(inReplyToId).toLowerCase();
  const o = bare(ownerId).toLowerCase();
  return (
    // `description` IS selected here, deliberately breaking the never-fetch-the-body rule —
    // that rule is about LIST queries, where it costs a blob read per row. This fetches at most
    // one row, and the body is the entire point: it is the agent's unsent reply.
    '?$select=activityid,subject,description'
    + `&$filter=regardingobjectid_incident/incidentid eq ${c}`
    + ` and _parentactivityid_value eq ${p}`
    // The AGENT's draft, not anybody's. Without this (M2), a second agent opening Reply on the
    // same message silently resumed — and could send — a colleague's unsent draft.
    + ` and _ownerid_value eq ${o}`
    + ' and statecode eq 0 and statuscode eq 1'
    + '&$orderby=modifiedon desc&$top=1'
  );
}

/**
 * The agent's existing draft for this message, if they already started one.
 *
 * Without this, closing compose and reopening Reply creates a **second** draft row, then a third
 * — the Case fills with duplicates of one unsent reply. That is worse than the problem drafts
 * solve, so the lookup is not optional polish.
 *
 * Returns `undefined` on any failure: composing fresh is a fine outcome, and a lookup error must
 * never stop an agent replying.
 */
export async function findExistingDraft(
  webApi: DraftApiLike,
  caseId: string,
  inReplyToId: string,
  /** The agent. No agent, no resume: composing fresh beats adopting a draft of unknown owner. */
  ownerId: string | undefined,
): Promise<ExistingDraft | undefined> {
  if (!ownerId) return undefined;
  try {
    assertGuid(caseId, 'caseId');
    assertGuid(inReplyToId, 'inReplyToId');
    assertGuid(ownerId, 'ownerId');
    const page = await webApi.retrieveMultipleRecords(
      'email', buildDraftLookupQuery(caseId, inReplyToId, ownerId), 1,
    );
    const row = page.entities[0];
    if (!row || typeof row.activityid !== 'string') return undefined;
    return {
      emailId: row.activityid,
      subject: typeof row.subject === 'string' ? row.subject : '',
      bodyHtml: typeof row.description === 'string' ? row.description : '',
    };
  } catch {
    return undefined;
  }
}

/**
 * One draft by id — reopening the compose that was open when the control was torn down (M11).
 *
 * The id came back through `setControlState`, so it is re-checked here rather than trusted: it
 * must still be an open DRAFT (it may have been sent from elsewhere since) and it must be the
 * agent's own, the same ownership rule `findExistingDraft` applies.
 */
export async function fetchDraftById(
  webApi: DraftApiLike,
  emailId: string,
  ownerId: string | undefined,
): Promise<ExistingDraft | undefined> {
  if (!ownerId) return undefined;
  try {
    assertGuid(emailId, 'emailId');
    assertGuid(ownerId, 'ownerId');
    const row = await webApi.retrieveRecord(
      'email', bare(emailId), '?$select=activityid,subject,description,statecode,statuscode,_ownerid_value',
    );
    const owner = typeof row._ownerid_value === 'string' ? row._ownerid_value.toLowerCase() : '';
    if (row.statecode !== 0 || row.statuscode !== 1) return undefined;
    if (owner !== bare(ownerId).toLowerCase()) return undefined;
    return {
      emailId: bare(emailId),
      subject: typeof row.subject === 'string' ? row.subject : '',
      bodyHtml: typeof row.description === 'string' ? row.description : '',
    };
  } catch {
    return undefined;
  }
}

/**
 * Discard a draft the agent abandoned.
 *
 * Only ever called for a row this client created in this sitting, and only when the agent closes
 * compose having written nothing worth keeping — never on a draft they deliberately saved. An
 * abandoned blank draft left behind clutters the Case list with mail nobody wrote.
 */
export async function discardDraft(
  webApi: DraftApiLike,
  emailId: string,
): Promise<{ ok: boolean; error?: NormalisedError }> {
  try {
    assertGuid(emailId, 'emailId');
    await webApi.deleteRecord('email', bare(emailId));
    return { ok: true };
  } catch (rejection) {
    // A draft that will not delete is untidy, not harmful. Never surface this to the agent.
    return { ok: false, error: normaliseWebApiError(rejection) };
  }
}
