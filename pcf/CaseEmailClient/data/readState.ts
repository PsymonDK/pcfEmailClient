import { bareId } from '../domain/guid';
import { assertGuid, fetchAllPages, type WebApiLike } from './emailQueries';
import { normaliseWebApiError, type NormalisedError } from './errors';

/**
 * Durable per-agent read state (R6), backed by the `jhrb_emailreadstate` table.
 *
 * Until now read state lived only in `setControlState`, so it survived a session switch but not a
 * browser restart — an agent who came back in the morning found every message unread again.
 *
 * **Per agent, not per org.** A column on `email` would be single-valued, so the first agent to
 * open a message would mark it read for everyone. The table is UserOwned, which means Dataverse's
 * own security trims each agent to their own rows: the isolation is a property of the platform
 * rather than something this file has to remember to filter for.
 *
 * Two shapes of the same data:
 *   - **one page per case per agent** on load, which is why the table carries a denormalised case
 *     lookup. Without it, read state for a 50-message case would be 50 queries.
 *   - **one write per message** when the dwell timer fires.
 *
 * Because the page above tells us exactly which rows already exist, a write never needs a read
 * first — which matters, since `context.webAPI` has no `execute` and therefore cannot upsert by
 * alternate key. (Over the raw Web API it can:
 * `PATCH jhrb_emailreadstates(_jhrb_emailid_value=…,_jhrb_userid_value=…)` — see CLAUDE.md.)
 */

export const READ_STATE_ENTITY = 'jhrb_emailreadstate';

const READ_STATE_COLUMNS = [
  'jhrb_emailreadstateid',
  '_jhrb_emailid_value',
  'jhrb_readon',
] as const;

/**
 * `createRecord` and `updateRecord` on top of the read surface.
 *
 * Declared separately so the reading path keeps depending on the narrow `WebApiLike` and cannot
 * accidentally acquire write access to Dataverse.
 */
export interface ReadStateApiLike extends WebApiLike {
  createRecord(
    entityLogicalName: string,
    data: Record<string, unknown>,
  ): Promise<{ id: string }>;
}

/** What the client knows about one already-read message. */
export interface ReadRecord {
  rowId: string;
  readOn?: Date;
}

/** Keyed by `activityid`. A message absent from the map has not been read by this agent. */
export type ReadStateMap = Map<string, ReadRecord>;

// ── queries ──────────────────────────────────────────────────────────────────

/**
 * Every read-state row this agent has on this case, in one request.
 *
 * Filtering on the user as well as relying on UserOwned security is belt and braces, and cheap:
 * an agent with broader-than-own read privileges (a supervisor role, say) would otherwise see
 * other people's rows and render their colleagues' read state as their own.
 */
export function buildReadStateQuery(caseId: string, userId: string): string {
  const caseGuid = bareGuid(caseId, 'caseId');
  const userGuid = bareGuid(userId, 'userId');
  return (
    `?$select=${READ_STATE_COLUMNS.join(',')}` +
    `&$filter=_jhrb_caseid_value eq ${caseGuid} and _jhrb_userid_value eq ${userGuid}`
  );
}

/**
 * The create payload.
 *
 * **The `@odata.bind` keys are PascalCase** — `jhrb_EmailId`, not `jhrb_emailid`. A lookup's
 * navigation property comes from its relationship SchemaName, and the logical name is rejected
 * with an anonymous *"Error identified in Payload"* that does not say which property it disliked.
 * Measured 2026-09-11 while creating the table; this is the single easiest thing here to get
 * wrong, so it is asserted in the tests.
 */
export function buildReadStatePayload(
  args: { emailId: string; userId: string; caseId: string; readOn?: Date },
): Record<string, unknown> {
  const emailGuid = bareGuid(args.emailId, 'emailId');
  const userGuid = bareGuid(args.userId, 'userId');
  const caseGuid = bareGuid(args.caseId, 'caseId');
  return {
    // Only for legibility in admin views — nothing reads it back.
    jhrb_name: `${emailGuid}|${userGuid}`,
    'jhrb_EmailId@odata.bind': `/emails(${emailGuid})`,
    'jhrb_UserId@odata.bind': `/systemusers(${userGuid})`,
    'jhrb_CaseId@odata.bind': `/incidents(${caseGuid})`,
    jhrb_readon: (args.readOn ?? new Date()).toISOString(),
  };
}

/**
 * `context.userSettings.userId` comes back wrapped in braces — `{4F2D39F5-…}`. Every filter and
 * bind here needs it bare, and an unstripped id produces a query that returns nothing rather than
 * failing, which is the kind of bug that looks like "read state does not work".
 */
function bareGuid(value: string, what: string): string {
  assertGuid(value, what);
  return bareId(value);
}

// ── fetch ────────────────────────────────────────────────────────────────────

/**
 * One page of read state for this case and agent.
 *
 * Failure is **not** propagated as an exception. Read state is an ornament on a list of email: if
 * this query fails the right outcome is a thread list where everything looks unread, not a case
 * with no mail on it. The caller gets an empty map plus the error to report quietly.
 */
export async function fetchReadState(
  webApi: WebApiLike,
  caseId: string,
  userId: string,
  pageSize = 500,
): Promise<{ read: ReadStateMap; error?: NormalisedError }> {
  const read: ReadStateMap = new Map();
  try {
    const rows = await fetchAllPages(
      webApi, READ_STATE_ENTITY, buildReadStateQuery(caseId, userId), pageSize,
    );
    for (const row of rows) {
      const emailId = asGuid(row._jhrb_emailid_value);
      const rowId = asGuid(row.jhrb_emailreadstateid);
      if (!emailId || !rowId) continue;
      read.set(emailId, { rowId, readOn: asDate(row.jhrb_readon) });
    }
    return { read };
  } catch (rejection) {
    // Never `instanceof Error`: context.webAPI rejects with a plain object.
    return { read, error: normaliseWebApiError(rejection) };
  }
}

// ── write ────────────────────────────────────────────────────────────────────

export interface MarkReadOutcome {
  ok: boolean;
  /** The row that now holds this read state, when one was created. */
  rowId?: string;
  /** True when the platform said the row already existed — a success, not a failure. */
  alreadyRead?: boolean;
  error?: NormalisedError;
}

/**
 * Records that this agent has read this message.
 *
 * Idempotent by two mechanisms, deliberately. `known` skips the request entirely for a row we
 * already loaded; and if a row is created anyway — two dwell timers firing on the same message, a
 * reload racing a write — the alternate key `jhrb_emailperagent` refuses it with **412**, which is
 * treated as success rather than surfaced. Read state has no "more read than read" state to
 * reconcile, so the second write has nothing to do.
 */
export async function markRead(
  webApi: ReadStateApiLike,
  args: { emailId: string; userId: string; caseId: string; readOn?: Date },
  known?: ReadStateMap,
): Promise<MarkReadOutcome> {
  const existing = known?.get(bareId(args.emailId));
  if (existing) return { ok: true, rowId: existing.rowId, alreadyRead: true };

  try {
    const created = await webApi.createRecord(READ_STATE_ENTITY, buildReadStatePayload(args));
    return { ok: true, rowId: asGuid(created.id) };
  } catch (rejection) {
    const error = normaliseWebApiError(rejection);
    if (isDuplicateKey(error)) return { ok: true, alreadyRead: true };
    return { ok: false, error };
  }
}

/**
 * A 412 (or the key's own message) means another write got there first.
 *
 * Matching on the message as well as the status because `context.webAPI` does not reliably surface
 * an HTTP status — it rejects with a plain object whose shape varies.
 */
function isDuplicateKey(error: NormalisedError): boolean {
  if (error.status === 412) return true;
  // The key's own wording only. A bare /duplicate/ also matched unrelated failures — a duplicate
  // detection rule, say — and reported them as success, so the row was never written (L8).
  return /already exists|entity key .* (?:requires|violated)/i.test(error.message);
}

// ── coercion ─────────────────────────────────────────────────────────────────

function asGuid(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const bare = bareId(value);
  return bare.length > 0 ? bare : undefined;
}

function asDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
