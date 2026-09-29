import type { EmailRow } from './threading';
import { isIncoming } from './unread';

/**
 * What the reading pane's "More actions" menu acts on (2026-09-29).
 *
 * The menu sits on the THREAD header, but two of its actions are about ONE message. Both follow
 * the shared selection (CLAUDE.md: selection is one fact) — the selected message if it is in
 * this thread, and a stated fallback when nothing is selected — so the agent never has to guess
 * which message a click will touch.
 */
export interface ReadingMenuTargets {
  /** "Open in email form": the selected message, else the newest. */
  openId?: string;
  /** "Mark as unread": the message it would mark, or why the item is unavailable. */
  unread: { id: string } | { reason: string };
  canExpandAll: boolean;
  canCollapseAll: boolean;
}

export function readingMenuTargets(
  messages: readonly Pick<EmailRow, 'activityid' | 'directioncode'>[],
  selectedId: string | undefined,
  state: {
    isUnread: (activityId: string) => boolean;
    isExpanded: (activityId: string) => boolean;
    /** Messages folded into the "N earlier messages" row count as collapsed. */
    collapsedOlder: number;
  },
): ReadingMenuTargets {
  const selected = messages.find((m) => m.activityid === selectedId);
  const newest = messages[messages.length - 1];

  return {
    openId: (selected ?? newest)?.activityid,
    unread: unreadTarget(messages, selected, state.isUnread),
    canExpandAll: state.collapsedOlder > 0 || messages.some((m) => !state.isExpanded(m.activityid)),
    canCollapseAll: messages.some((m) => state.isExpanded(m.activityid)),
  };
}

/**
 * Only RECEIVED mail can be unread (`domain/unread.ts`). With a sent message selected the item
 * says so rather than quietly marking some other message: falling back to the newest received
 * one would change a message the agent was not looking at. With nothing selected, the newest
 * received message is the obvious one.
 */
function unreadTarget(
  messages: readonly Pick<EmailRow, 'activityid' | 'directioncode'>[],
  selected: Pick<EmailRow, 'activityid' | 'directioncode'> | undefined,
  isUnread: (activityId: string) => boolean,
): { id: string } | { reason: string } {
  if (selected && !isIncoming(selected)) {
    return { reason: 'Only received mail can be marked unread.' };
  }
  const target = selected ?? [...messages].reverse().find(isIncoming);
  if (!target) return { reason: 'This conversation has no received mail to mark unread.' };
  if (isUnread(target.activityid)) return { reason: 'Already unread.' };
  return { id: target.activityid };
}
