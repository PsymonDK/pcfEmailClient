/**
 * Will this sender's mail actually leave? (R18)
 *
 * The highest-severity finding carried out of research, measured 2026-09-10: sending from an
 * addressed-but-**unapproved** queue returns **HTTP 200**, parks the email at `Pending Send`
 * **forever**, and records **no error anywhere** — mailbox `outgoingemailstatus` stays *Not Run*
 * and `lastsyncerror` stays null. There is no synchronous guard and no async failure signal, so a
 * client that trusts the 200 tells agents mail was sent that never left.
 *
 * The only defence is checking before offering Send. Gate 2 chose **block**, not warn-and-confirm
 * (docs/design/01-design-decisions.md §3) — which puts the whole weight of the feature on the
 * reason string. A blocked Send with a vague reason is barely better than the silent failure it
 * replaces, so every reason here names the specific thing that is wrong and who can fix it.
 *
 * Pure on purpose: `data/preflight.ts` fetches the facts, this decides. The rule is then testable
 * without a mailbox in a particular state, which is not something we can arrange on demand.
 */

/** `emailrouteraccessapproval`: 0 Empty, 1 Approved, 2 Pending Approval, 3 Rejected. */
export const APPROVAL_APPROVED = 1;

/** `mailbox.outgoingemailstatus`: 0 Not Run, 1 Success, 2 Failure. */
export const OUTGOING_SUCCESS = 1;

export interface SenderApproval {
  /** The address the mail would come from. Absent or empty is its own, loud, failure. */
  address?: string;
  /** Org `requireapprovalforqueueemail` / `requireapprovalforuseremail`, for this sender's kind. */
  requiresApproval: boolean;
  /** The sender's own `emailrouteraccessapproval`. */
  approvalState: number;
  /** The mailbox's `outgoingemailstatus`. Absent when no mailbox could be read. */
  outgoingStatus?: number;
}

export interface PreflightVerdict {
  ok: boolean;
  /** Present exactly when `ok` is false. A whole sentence, naming the fix. */
  reason?: string;
}

export function evaluateSender(
  approval: SenderApproval,
  senderLabel: string,
): PreflightVerdict {
  // The one failure the platform reports loudly: a queue with no address fails synchronously with
  // HTTP 400. Catching it here anyway costs nothing and says something useful instead of a code.
  if (!approval.address || approval.address.trim().length === 0) {
    return {
      ok: false,
      reason: `${senderLabel} has no email address, so nothing can be sent from it. `
        + 'An administrator sets this on the queue record.',
    };
  }

  if (approval.requiresApproval && approval.approvalState !== APPROVAL_APPROVED) {
    return {
      ok: false,
      reason: `${senderLabel}'s email address is not approved, so a message sent from it would `
        + 'sit at Pending Send indefinitely without ever being delivered — and without reporting '
        + 'an error. An administrator approves the address in the Power Platform admin centre.',
    };
  }

  if (approval.outgoingStatus === undefined) {
    return {
      ok: false,
      reason: `No mailbox could be read for ${senderLabel}, so there is no way to tell whether `
        + 'mail from it would be delivered.',
    };
  }

  if (approval.outgoingStatus !== OUTGOING_SUCCESS) {
    return {
      ok: false,
      reason: `${senderLabel}'s mailbox is not sending — its outgoing email has `
        + `${approval.outgoingStatus === 0 ? 'never run' : 'failed'}. `
        + 'An administrator tests and enables the mailbox before mail from it will leave.',
    };
  }

  return { ok: true };
}

/**
 * The reason to show on the Send button, or `undefined` when nothing blocks it.
 *
 * Kept separate from `evaluateSender` so the compose surface asks one question — "why can't I
 * send?" — rather than assembling the answer itself.
 */
export function sendBlockedBy(verdict: PreflightVerdict | undefined): string | undefined {
  if (!verdict) return 'Checking whether this sender can send…';
  return verdict.ok ? undefined : verdict.reason;
}
