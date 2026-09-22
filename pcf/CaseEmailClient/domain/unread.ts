import type { EmailRow } from './threading';

/**
 * What "unread" means — in one place, because it was in four and they disagreed.
 *
 * R6's acceptance sentence is *"an unopened **incoming** email is visually distinct"*. An agent's
 * own sent mail is never unread: they wrote it. The thread-list badge and the thread summary both
 * applied that rule; the per-message state and the "open the newest unread message" selection did
 * not. Measured in the published app on 2026-09-22: every reload auto-expanded the next *outgoing*
 * message and wrote a read-state row for it, so the list said "1 unread" while the pane behaved as
 * though four messages were waiting to be read.
 *
 * `directioncode` is `false` for incoming and `true` for outgoing — the comparison is explicit
 * rather than `!m.directioncode` so an `undefined` on a malformed row does not read as incoming.
 */
export function isIncoming(message: Pick<EmailRow, 'directioncode'>): boolean {
  return message.directioncode === false;
}

/** True when this message should show as unread to this agent. */
export function isUnread(
  message: Pick<EmailRow, 'activityid' | 'directioncode'>,
  readIds: ReadonlySet<string>,
): boolean {
  return isIncoming(message) && !readIds.has(message.activityid);
}

/**
 * The message a thread should open on: the newest unread incoming one, or the newest message when
 * there is nothing unread.
 *
 * Takes messages **oldest-first**, which is how `buildThreads` returns them.
 */
export function messageToOpen<T extends Pick<EmailRow, 'activityid' | 'directioncode'>>(
  messages: readonly T[],
  readIds: ReadonlySet<string>,
): T | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (isUnread(m, readIds)) return m;
  }
  return messages[messages.length - 1];
}

/**
 * How many of the oldest messages to fold into the "N earlier messages" row.
 *
 * A thread shows its last three messages and collapses the rest — but the message we chose to
 * open can be older than that, and then the collapse hides it. Measured in the published app on
 * 2026-09-22: a thread whose only unread message was the oldest opened with **nothing expanded**,
 * because the target sat inside the folded group. Never fold past the message being opened.
 */
export function collapsedOlderCount(
  messageCount: number,
  openIndex: number,
  visible = 3,
): number {
  return Math.max(0, Math.min(messageCount - visible, openIndex));
}

/**
 * Whether this message's read state is worth storing.
 *
 * Only incoming mail can be unread, so a row for an outgoing message is a row that can never
 * change what anyone sees — just noise in the table, one per message per agent.
 */
export function worthPersisting(message: Pick<EmailRow, 'directioncode'>): boolean {
  return isIncoming(message);
}
