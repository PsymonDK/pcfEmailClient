/**
 * Sending, and telling the truth about it (R17).
 *
 * **`SendEmail` returning HTTP 200 does not mean the mail was sent.** It means the platform
 * accepted the request. The email then moves to `Pending Send` and is picked up asynchronously —
 * or, when the sender is not approved, sits there **forever with no error recorded anywhere**
 * (measured 2026-09-10). A client that reports success on the 200 tells agents their mail is on
 * its way when it may never leave. That is the single highest-severity risk carried out of
 * research, and this module exists to make it impossible to get wrong by accident.
 *
 * So the send ladder is reported as it actually is: accepted → pending → sending → sent, with
 * **pending shown as visibly not-done**, never collapsed into "Sent".
 *
 * Status codes read from the live metadata on 2026-09-25, not from memory:
 *
 * | Code | Label | `statecode` |
 * |---|---|---|
 * | 1 | Draft | 0 Open |
 * | 2 | Completed | 1 |
 * | 3 | **Sent** | 1 |
 * | 4 | Received | 1 |
 * | 5 | Canceled | 2 |
 * | 6 | **Pending Send** | 1 |
 * | 7 | **Sending** | 1 |
 * | 8 | **Failed** | **0 Open** |
 */

import { describeUnresolved } from './recipients';
import type { PendingAttachment } from './attachments';

export const EMAIL_STATUS = {
  draft: 1,
  completed: 2,
  sent: 3,
  received: 4,
  canceled: 5,
  pendingSend: 6,
  sending: 7,
  failed: 8,
} as const;

export type SendPhase = 'idle' | 'saving' | 'issuing' | 'pending' | 'sent' | 'failed' | 'unknown';

/**
 * Has the platform finished with this message, one way or the other?
 *
 * `Failed` counts as settled even though its `statecode` is **0 (Open)** — the same state a
 * draft has. Treating "open" as "still in progress" would make a failed send poll forever.
 */
export function isSettled(statusCode: number | undefined): boolean {
  return statusCode === EMAIL_STATUS.sent
    || statusCode === EMAIL_STATUS.completed
    || statusCode === EMAIL_STATUS.failed
    || statusCode === EMAIL_STATUS.canceled;
}

/** Still moving through the send pipeline. */
export function isInFlight(statusCode: number | null | undefined): boolean {
  return statusCode === EMAIL_STATUS.pendingSend || statusCode === EMAIL_STATUS.sending;
}

export function phaseFor(statusCode: number | undefined): SendPhase {
  switch (statusCode) {
    case EMAIL_STATUS.sent:
    case EMAIL_STATUS.completed:
      return 'sent';
    case EMAIL_STATUS.failed:
    case EMAIL_STATUS.canceled:
      return 'failed';
    case EMAIL_STATUS.pendingSend:
    case EMAIL_STATUS.sending:
      return 'pending';
    default:
      return 'unknown';
  }
}

/**
 * How long to keep asking, in milliseconds between polls.
 *
 * Backs off rather than hammering: a server-side-synced mailbox usually settles in a few
 * seconds, and there is nothing to gain from polling a message that is going to sit for hours.
 * Totals about 30 seconds, after which the honest answer is "still pending", not "sent".
 */
export const POLL_DELAYS = [1000, 2000, 3000, 5000, 8000, 11000] as const;

export interface SendReport {
  phase: SendPhase;
  /** What the agent reads. Never "Sent" unless the platform actually said so. */
  headline: string;
  /** The second line, when there is something useful to add. */
  detail?: string;
  /** True only for a confirmed delivery hand-off. Drives the "done" styling, nothing else. */
  confirmed: boolean;
}

/**
 * Turn a final observed status into something an agent can act on.
 *
 * The `pending` case is the one that matters. It is **not** an error — the mail may well go out
 * a minute later — but it is also **not** success, and the wording must not let an agent walk
 * away believing the customer has been answered.
 */
export function reportFor(statusCode: number | undefined, pollsExhausted: boolean): SendReport {
  switch (phaseFor(statusCode)) {
    case 'sent':
      return { phase: 'sent', headline: 'Sent', confirmed: true };

    case 'failed':
      return {
        phase: 'failed',
        headline: statusCode === EMAIL_STATUS.canceled ? 'Send was cancelled' : 'Send failed',
        detail: 'The message is still on the case and can be edited and sent again.',
        confirmed: false,
      };

    case 'pending':
      return {
        phase: 'pending',
        headline: pollsExhausted ? 'Still sending' : 'Sending',
        detail: pollsExhausted
          // Deliberately not reassuring. An unapproved sender parks here permanently and the
          // platform records nothing, so "it will arrive shortly" would be a guess presented
          // as a fact.
          ? 'The platform has accepted the message but has not delivered it yet. It is not lost '
            + '— check the case in a few minutes. If it stays here, the sending mailbox needs an '
            + 'administrator.'
          : undefined,
        confirmed: false,
      };

    default:
      return {
        phase: 'unknown',
        headline: 'Sent, but the status could not be confirmed',
        detail: 'The message left this screen. Check the case to confirm it went out.',
        confirmed: false,
      };
  }
}

/**
 * Would sending now leave an attachment behind, or send one the agent cannot see finished?
 *
 * `afterSave` is the difference between the two checkpoints. Before the save, a forwarded file
 * that has not become a row yet is expected — the save is what creates it. After the save it is
 * not: a carried-over file still without a row means the customer would get the forward without
 * the attachment the tray showed. That race was real until 2026-09-28 (H4): the reuse ran in an
 * effect that `issueSend` could beat, and counted as `done` before its row existed.
 *
 * A `failed` item blocks too. It is either a file that never uploaded (the agent believes it is
 * attached) or a remove that did not delete (the agent believes it is gone) — both are the tray
 * disagreeing with what would be sent.
 */
export function attachmentBlocker(
  items: readonly PendingAttachment[],
  afterSave: boolean,
): string | undefined {
  if (items.some((a) => a.status === 'uploading' || a.status === 'pending')) {
    return 'Wait for the attachments to finish uploading.';
  }
  if (items.some((a) => a.status === 'failed')) {
    return 'An attachment has a problem. Remove it, or add it again, before sending.';
  }
  if (afterSave && items.some((a) => a.reusedAttachmentId && !a.attachmentId)) {
    return 'A forwarded attachment could not be carried over yet. Try sending again.';
  }
  return undefined;
}

/**
 * Is this draft in a state where sending is even meaningful? Checked BEFORE the save.
 *
 * Guards the obvious own-goals: sending with nobody in To, with files still uploading, or to an
 * address the org will not deliver to. Whether the platform already took the message is a
 * question about the saved row, so it is `blockingReasonAfterSave`'s job, not this one's.
 */
export function blockingReasonBeforeSend(args: {
  recipientCount: number;
  /** The tray as it stands. Required: a boolean the caller computes is how guards go inert. */
  attachments: readonly PendingAttachment[];
  /**
   * Addresses that match no record, and whether the org tolerates them.
   *
   * **Both are required, not optional.** This guard has already gone inert twice — once for
   * `inReplyToId`, once for `statusCode` — each time because `domain/` held the rule and the
   * caller silently omitted the input, with every test still passing. A required key forces
   * each call site to decide, which is the only thing that has actually prevented a recurrence.
   */
  unresolvedAddresses: readonly string[];
  /** Those of `unresolvedAddresses` that matched several records. Required, for the same reason. */
  ambiguousAddresses: readonly string[];
  allowUnresolved: boolean;
}): string | undefined {
  if (args.recipientCount === 0) return 'Add at least one recipient first.';
  const attachments = attachmentBlocker(args.attachments, false);
  if (attachments) return attachments;
  // Checked last: it is the most specific complaint, and the least useful to show while
  // something more basic is also wrong.
  if (!args.allowUnresolved && args.unresolvedAddresses.length > 0) {
    return describeUnresolved(args.unresolvedAddresses, args.ambiguousAddresses);
  }
  return undefined;
}

/**
 * Checked AFTER the save, against the row that is about to be sent.
 *
 * **The double-send guard fails CLOSED.** `statusCode` is `undefined` when the row could not be
 * read, and until 2026-09-28 (M3) that passed as "not sent yet" — so the one moment the guard
 * could not see was the moment it let the send through. Only Draft (1) and Failed (8) are
 * sendable: a failed send is still an open row, and `reportFor` tells the agent it "can be edited
 * and sent again", which was untrue while this refused it (L1).
 */
export function blockingReasonAfterSave(args: {
  statusCode: number | undefined;
  attachments: readonly PendingAttachment[];
}): string | undefined {
  if (args.statusCode === undefined) {
    return 'Could not confirm this message has not already been sent, so it was not sent. '
      + 'Try again in a moment.';
  }
  if (args.statusCode !== EMAIL_STATUS.draft && args.statusCode !== EMAIL_STATUS.failed) {
    return 'This message has already been sent.';
  }
  return attachmentBlocker(args.attachments, true);
}
