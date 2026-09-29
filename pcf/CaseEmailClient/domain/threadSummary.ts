import type { Thread } from './threading';
import { isUnread } from './unread';
import { EMAIL_STATUS } from './send';

/**
 * One conversation as the thread list shows it.
 *
 * Built here rather than in the shell so the rules in it are under test (R2, 2026-09-28): the R8
 * "borrowed from the parent case" marking, the unread count's direction rule, and what counts as
 * a draft all lived in `EmailClientRoot.tsx`, which no test imports.
 */
export interface ThreadSummary {
  thread: Thread;
  /** Unread message count in this thread, for this agent. */
  unreadCount: number;
  /** Distinct participant display names, newest activity first. */
  participants: string[];
  hasAttachments: boolean;
  hasDraft: boolean;
  /** Set when the thread belongs to the parent case rather than this one (R8). */
  parentCaseNumber?: string;
  lastActivity: string;
}

export function toSummary(
  thread: Thread,
  /** The sender's display name for one message, if it has one. */
  senderNameOf: (activityId: string) => string | undefined,
  readIds: ReadonlySet<string>,
  /** Ticket numbers of ancestor cases, keyed by case id — R8. */
  ancestorNumbers?: ReadonlyMap<string, string>,
): ThreadSummary {
  const names = new Set<string>();
  for (const m of [...thread.messages].reverse()) {
    const name = senderNameOf(m.activityid);
    if (name) names.add(name);
  }
  const last = thread.messages[thread.messages.length - 1];
  return {
    thread,
    // R8. A thread is "borrowed" when ANY of its messages hangs off an ancestor case — a chain
    // can legitimately span both once someone re-parents an email, and in that case the borrowed
    // marking is the safer of the two readings: it says "some of this is not from here".
    parentCaseNumber: ancestorNumbers && ancestorNumbers.size > 0
      ? thread.messages
        .map((m) => (m.regardingCaseId ? ancestorNumbers.get(m.regardingCaseId) : undefined))
        .find((n) => n !== undefined)
      : undefined,
    // Only INBOUND messages can be unread: we do not mark our own sent mail unread.
    unreadCount: thread.messages.filter((m) => isUnread(m, readIds)).length,
    participants: [...names].slice(0, 3),
    hasAttachments: thread.messages.some((m) => (m.attachmentcount ?? 0) > 0),
    hasDraft: thread.messages.some((m) => m.statuscode === EMAIL_STATUS.draft),
    lastActivity: last?.createdon ?? '',
  };
}
