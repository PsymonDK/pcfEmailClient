import { asString } from './coerce';
import { toGuid } from '../domain/guid';
import { assertGuid, type WebApiLike } from './emailQueries';
import { normaliseWebApiError, type NormalisedError } from './errors';
import type { SenderCandidate } from '../domain/sender';

/**
 * The queue a Case sits in, and everything needed to send as it.
 *
 * Resolved from `queueitem` — the same route the queue-sender script on the standard email form
 * takes — because a Case's queue is a routing fact, not a column on the Case.
 *
 * One query does the whole job: the `$expand` pulls the queue's name, address, approval state and
 * signature id in the same round trip, so nothing downstream has to go back for them.
 */

/**
 * `incident`'s `ObjectTypeCode`. Fixed across Dataverse organisations; verified 112 here.
 *
 * **`queueitem.objecttypecode` is `Edm.Int32` over the Web API**, not a string. Measured
 * 2026-09-24: `objecttypecode eq 'incident'` fails with *"A binary operator with incompatible
 * types was detected. Found operand types 'Edm.Int32' and 'Edm.String'"* — which names neither
 * the column nor the fix. The type guard matters for the same reason it does on the email list
 * query: `_objectid_value` is a bare GUID, so without it a collision across tables is possible.
 */
export const INCIDENT_OBJECT_TYPE_CODE = 112;

const QUEUE_COLUMNS = [
  'queueid',
  'name',
  'emailaddress',
  'emailrouteraccessapproval',
  '_emailsignature_value',
  '_defaultmailbox_value',
] as const;

export function buildCaseQueueQuery(caseId: string): string {
  const bare = toGuid(caseId, 'caseId');
  return (
    '?$select=_queueid_value,statecode'
    + `&$filter=_objectid_value eq ${bare}`
    + ` and objecttypecode eq ${INCIDENT_OBJECT_TYPE_CODE}`
    /*
     * **Deliberately NOT filtered to `statecode eq 0`.**
     *
     * A `queueitem` goes Inactive when the item is *worked*, not when the Case leaves the queue.
     * Measured 2026-09-25 on CAS-01020: the Case sits in Care, its queue item is `statecode 1`,
     * and an active-only filter therefore resolved **no queue at all** — so the client fell back
     * to sending as the agent, whose mailbox cannot send, and offered a blocked Send on a Case
     * that has a perfectly good queue. That is a common state, not an edge case.
     *
     * `statecode asc` puts an Active item first when there is one, and otherwise takes the most
     * recent worked item — which still says where the Case lives.
     *
     * The queue-sender script on the standard email form filters to active only; it gets away
     * with it because its fallback names a queue explicitly. Ours resolves the *Case's* queue,
     * so it has to read this correctly rather than lean on a fallback.
     */
    + '&$orderby=statecode asc,createdon desc&$top=1'
    + `&$expand=queueid($select=${QUEUE_COLUMNS.join(',')})`
  );
}

/** A queue, in the shape the sender rule wants, plus the bits pre-flight needs. */
export interface CaseQueue {
  candidate: SenderCandidate;
  /** `emailrouteraccessapproval`. 1 is Approved; anything else fails silently on send. */
  approvalState: number;
  /** The queue's mailbox, for the outgoing-status check. */
  mailboxId?: string;
}

const str = (v: unknown): string => asString(v);

/**
 * A `queue` row as a sending identity. One mapping (R4) for both routes to a queue — the case's
 * own `queueitem` expand and the configured override — which had drifted into two copies.
 */
function toCaseQueue(q: Record<string, unknown>, fallbackId = ''): CaseQueue | undefined {
  const id = str(q.queueid) || fallbackId;
  if (!id) return undefined;
  const signatureId = str(q._emailsignature_value);
  return {
    candidate: {
      kind: 'queue',
      id,
      displayName: str(q.name) || 'Queue',
      address: str(q.emailaddress).toLowerCase(),
      signatureId: signatureId || undefined,
    },
    approvalState: typeof q.emailrouteraccessapproval === 'number'
      ? q.emailrouteraccessapproval
      : 0,
    mailboxId: str(q._defaultmailbox_value) || undefined,
  };
}

/**
 * The Case's queue, or `undefined` when it is in none.
 *
 * **Not in a queue is not an error.** Plenty of Cases are created directly and never routed; the
 * sender rule falls back to the agent for those. Returning an error here would put a banner on a
 * perfectly ordinary Case.
 */
export async function fetchCaseQueue(
  webApi: WebApiLike,
  caseId: string,
): Promise<{ queue?: CaseQueue; error?: NormalisedError }> {
  try {
    assertGuid(caseId, 'caseId');
  } catch (e) {
    return { error: { message: 'No case to resolve a queue for.', raw: e } };
  }

  try {
    const page = await webApi.retrieveMultipleRecords('queueitem', buildCaseQueueQuery(caseId), 1);
    const q = page.entities[0]?.queueid as Record<string, unknown> | undefined;
    const queue = q ? toCaseQueue(q) : undefined;
    return queue ? { queue } : {};
  } catch (rejection) {
    return { error: normaliseWebApiError(rejection) };
  }
}

/**
 * One queue by id, for the configured override case.
 *
 * Separate from `fetchCaseQueue` because it answers a different question: not "where is this
 * Case?" but "which queue did configuration name?". Rare enough that the extra round trip only
 * happens when `jhrb_overridequeue` is actually set.
 */
export async function fetchQueueById(
  webApi: WebApiLike,
  queueId: string,
): Promise<CaseQueue | undefined> {
  try {
    assertGuid(queueId, 'queueId');
    const q = await webApi.retrieveRecord(
      'queue',
      toGuid(queueId, 'queueId'),
      `?$select=${QUEUE_COLUMNS.join(',')}`,
    );
    return toCaseQueue(q, queueId);
  } catch {
    // A misconfigured override must not cost the agent their sender. Falling through to the
    // Case's own queue is the useful failure.
    return undefined;
  }
}
