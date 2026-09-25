import { type WebApiLike } from './emailQueries';
import { normaliseWebApiError, type NormalisedError } from './errors';
import { evaluateSender, type PreflightVerdict, type SenderApproval } from '../domain/preflight';
import { describeSender, type SenderCandidate } from '../domain/sender';

/**
 * Fetching the facts R18's rule needs. The rule itself is in `domain/preflight.ts`.
 *
 * Three reads, in the order the finding says to check them: the org's approval requirements, the
 * sender's own approval state, and the mailbox's outgoing status. None of them is expensive and
 * all of them are cached for the life of the control — approval state does not change while an
 * agent is composing.
 */

/** Org-level requirements. One row, and it never changes during a session. */
export interface OrgApprovalPolicy {
  requireForQueue: boolean;
  requireForUser: boolean;
}

export async function fetchOrgApprovalPolicy(
  webApi: WebApiLike,
): Promise<{ policy: OrgApprovalPolicy; error?: NormalisedError }> {
  try {
    const page = await webApi.retrieveMultipleRecords(
      'organization',
      '?$select=requireapprovalforqueueemail,requireapprovalforuseremail',
      1,
    );
    const o = page.entities[0] ?? {};
    return {
      policy: {
        requireForQueue: o.requireapprovalforqueueemail === true,
        requireForUser: o.requireapprovalforuseremail === true,
      },
    };
  } catch (rejection) {
    // Assume approval IS required when we cannot tell. Assuming it is not would let the client
    // offer Send on a sender it has no evidence about — which is the silent-failure path.
    return {
      policy: { requireForQueue: true, requireForUser: true },
      error: normaliseWebApiError(rejection),
    };
  }
}

/** What the sender-side reads returned, before the rule is applied. */
export interface SenderFacts {
  approvalState: number;
  mailboxId?: string;
}

/**
 * A user's approval state and mailbox. (A queue's already came back on the queue expand.)
 */
export async function fetchUserFacts(
  webApi: WebApiLike,
  userId: string,
): Promise<SenderFacts> {
  try {
    const user = await webApi.retrieveRecord(
      'systemuser',
      userId.replace(/^\{|\}$/g, ''),
      '?$select=emailrouteraccessapproval,_defaultmailbox_value',
    );
    return {
      approvalState: typeof user.emailrouteraccessapproval === 'number'
        ? user.emailrouteraccessapproval
        : 0,
      mailboxId: typeof user._defaultmailbox_value === 'string'
        ? user._defaultmailbox_value
        : undefined,
    };
  } catch {
    // Unknown approval reads as "not approved", so the verdict blocks rather than waves through.
    return { approvalState: 0 };
  }
}

/**
 * A mailbox's outgoing status.
 *
 * `undefined` means we could not read it — which the rule treats as blocking, deliberately. Not
 * knowing whether mail will leave is not the same as knowing it will.
 */
export async function fetchOutgoingStatus(
  webApi: WebApiLike,
  mailboxId: string | undefined,
): Promise<number | undefined> {
  if (!mailboxId) return undefined;
  try {
    const mailbox = await webApi.retrieveRecord(
      'mailbox',
      mailboxId.replace(/^\{|\}$/g, ''),
      '?$select=outgoingemailstatus,mailboxstatus',
    );
    return typeof mailbox.outgoingemailstatus === 'number'
      ? mailbox.outgoingemailstatus
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Pre-flight one candidate sender, end to end.
 *
 * Returns a verdict for every candidate the picker offers, not just the chosen one, so a blocked
 * alternative can be shown disabled *with its reason* rather than quietly missing. An agent who
 * cannot see why an option is unavailable will ask an administrator to fix the wrong thing.
 */
export async function preflightCandidate(
  webApi: WebApiLike,
  candidate: SenderCandidate,
  policy: OrgApprovalPolicy,
  facts: SenderFacts,
): Promise<PreflightVerdict> {
  const outgoingStatus = await fetchOutgoingStatus(webApi, facts.mailboxId);
  const approval: SenderApproval = {
    address: candidate.address,
    requiresApproval: candidate.kind === 'queue' ? policy.requireForQueue : policy.requireForUser,
    approvalState: facts.approvalState,
    outgoingStatus,
  };
  return evaluateSender(approval, describeSenderShort(candidate));
}

/** "Care" reads better mid-sentence than "Care <caredemo@…>"; the address is on the From line. */
function describeSenderShort(candidate: SenderCandidate): string {
  return candidate.displayName || describeSender(candidate);
}

/**
 * The agent as a sending identity: who they are, plus the facts pre-flight needs.
 *
 * One read. The name and address are for the From line, the approval state and mailbox for the
 * verdict, and they all live on the same `systemuser` row.
 *
 * On failure the agent still exists as a candidate — with an empty address, which pre-flight
 * blocks loudly. An agent with no resolvable identity should see that stated, not find the From
 * picker mysteriously offering one option.
 */
export async function fetchAgentIdentity(
  webApi: WebApiLike,
  userId: string,
): Promise<{ candidate: SenderCandidate; facts: SenderFacts }> {
  const bare = userId.replace(/^\{|\}$/g, '');
  try {
    const user = await webApi.retrieveRecord(
      'systemuser',
      bare,
      '?$select=fullname,internalemailaddress,emailrouteraccessapproval,_defaultmailbox_value',
    );
    const s = (v: unknown): string => (typeof v === 'string' ? v : '');
    return {
      candidate: {
        kind: 'user',
        id: bare,
        displayName: s(user.fullname) || 'Me',
        address: s(user.internalemailaddress).toLowerCase(),
      },
      facts: {
        approvalState: typeof user.emailrouteraccessapproval === 'number'
          ? user.emailrouteraccessapproval
          : 0,
        mailboxId: s(user._defaultmailbox_value) || undefined,
      },
    };
  } catch {
    return {
      candidate: { kind: 'user', id: bare, displayName: 'Me', address: '' },
      facts: { approvalState: 0 },
    };
  }
}
