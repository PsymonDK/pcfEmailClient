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
export function isInFlight(statusCode: number | undefined): boolean {
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
 * Is this draft in a state where sending is even meaningful?
 *
 * Guards the obvious own-goals: sending with nobody in To, and sending a message the platform
 * has already taken (which would either error or double-send).
 */
export function blockingReasonBeforeSend(args: {
  recipientCount: number;
  statusCode?: number;
  uploadsInFlight: boolean;
}): string | undefined {
  if (args.recipientCount === 0) return 'Add at least one recipient first.';
  if (args.uploadsInFlight) return 'Wait for the attachments to finish uploading.';
  if (args.statusCode !== undefined && args.statusCode !== EMAIL_STATUS.draft) {
    return 'This message has already been sent.';
  }
  return undefined;
}
