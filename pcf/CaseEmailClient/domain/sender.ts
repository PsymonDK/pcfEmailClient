/**
 * Who an outgoing message comes from (R17/R18 groundwork).
 *
 * On a Case, the standard email form sends from the **queue the Case sits in**, not from the agent
 * — so a customer sees "Care", replies land back on the queue, and an agent leaving the company
 * does not orphan a conversation. This module holds the precedence rule that decides that, with no
 * network in it, because the rule is the part that will be argued about and therefore the part that
 * has to be testable.
 *
 * **The signature follows the sender.** There is deliberately no separate "which signature" switch:
 * one would let the From line and the sign-off disagree, which is the exact defect this module was
 * written to fix. `queue.emailsignature` is a real platform lookup, so a queue's signature is the
 * platform's own configuration and not something we store.
 *
 * Fail-safe direction: when configuration is missing, unreadable or ambiguous, resolve to **the
 * agent**. That is what the platform does with no customisation at all, so a broken settings table
 * degrades to normal behaviour rather than silently changing who mail appears to come from.
 */

export type SenderKind = 'queue' | 'user';

export interface SenderCandidate {
  kind: SenderKind;
  /** `queueid` or `systemuserid`. */
  id: string;
  /** "Care", "Simon Jehrbo" — what the From line shows. */
  displayName: string;
  /** Lowercased, because every comparison here and in `resolveRecipients` is case-insensitive. */
  address: string;
  /** `queue.emailsignature`, when there is one. Absent for a user: theirs is found by ownership. */
  signatureId?: string;
}

/** One active `jhrb_emailclientsetting` row, already flattened out of its OData shape. */
export interface SettingRow {
  /** The queue this row configures. Absent on the default row. */
  queueId?: string;
  isDefault: boolean;
  sendFromQueue: boolean;
  allowSenderOverride: boolean;
  /** Send from this queue whatever the Case's is. Normally absent. */
  overrideQueueId?: string;
  /**
   * Where a NEW message's default recipient comes from — the table this control is hosted on
   * and the lookup on it naming the recipient, e.g. `incident` / `customerid`.
   *
   * A pair rather than a bare field name so a row is self-describing, and so a future non-Case
   * placement can carry its own row instead of the control assuming it is always on a Case.
   */
  recipientEntity?: string;
  recipientLookup?: string;
}

const norm = (id: string | undefined): string | undefined =>
  id ? id.replace(/^\{|\}$/g, '').toLowerCase() : undefined;

/**
 * The row that governs this Case: queue-specific first, then the default row.
 *
 * Mirrors the precedence of the queue-sender script already running on the standard email form, so
 * an administrator who has configured one does not have to learn a second set of rules.
 *
 * A queue-specific row wins **even when it is listed after the default row**, which is the case the
 * obvious `rows.find(...)` implementation gets wrong.
 */
export function pickSetting(
  rows: readonly SettingRow[],
  queueId?: string,
): SettingRow | undefined {
  const wanted = norm(queueId);
  if (wanted) {
    const specific = rows.find((r) => norm(r.queueId) === wanted);
    if (specific) return specific;
  }
  return rows.find((r) => r.isDefault);
}

export interface ResolvedSender {
  /** Who the From line shows by default. */
  chosen: SenderCandidate;
  /**
   * Everyone the agent may pick from, `chosen` first. One entry means the UI renders static text
   * rather than a picker — there is nothing to choose.
   */
  candidates: SenderCandidate[];
}

/**
 * The sender for a new message on this Case.
 *
 * `queue` is the Case's queue (or the configured override queue), already resolved; `undefined`
 * when the Case is in no queue at all. That case falls back to the agent rather than blocking —
 * mail still goes out, and pre-flight is what tells the agent if it cannot.
 *
 * The agent is kept in `candidates` whenever overriding is allowed, so "send as me" stays one click
 * away. It is never *chosen* over an available queue: defaulting to the individual is how a
 * customer ends up replying to a person's inbox instead of the service queue.
 */
export function resolveSender(
  setting: SettingRow | undefined,
  queue: SenderCandidate | undefined,
  user: SenderCandidate,
): ResolvedSender {
  const sendFromQueue = setting?.sendFromQueue === true && queue !== undefined;
  const chosen = sendFromQueue && queue ? queue : user;

  // Overriding defaults to allowed only when a setting says so. With no configuration there is
  // nothing to override anyway — the agent is already the sender.
  const mayOverride = setting?.allowSenderOverride === true;

  const candidates: SenderCandidate[] = [chosen];
  if (mayOverride) {
    const other = chosen.kind === 'queue' ? user : queue;
    if (other && norm(other.id) !== norm(chosen.id)) candidates.push(other);
  }

  return { chosen, candidates };
}

/**
 * Is this address one of ours?
 *
 * Replaces the interim derivation that inferred "us" from the senders of outgoing mail already on
 * the Case — which was empty on a Case that had never been replied to, and wrong on one where an
 * earlier reply went out from a different queue. Every candidate counts, not just the chosen one:
 * an agent who switches the From picker must not suddenly find themselves in their own To line.
 */
export function isSelfAddress(
  address: string,
  candidates: readonly SenderCandidate[],
): boolean {
  const a = address.trim().toLowerCase();
  if (!a) return false;
  return candidates.some((c) => c.address.trim().toLowerCase() === a);
}

/** Every address that is us, for `resolveRecipients`' exclusion list. */
export function selfAddresses(candidates: readonly SenderCandidate[]): string[] {
  return candidates
    .map((c) => c.address.trim().toLowerCase())
    .filter((a) => a.length > 0);
}

/** "Care <caredemo@example.com>" — the From line, and the label in the picker. */
export function describeSender(sender: SenderCandidate): string {
  return sender.address
    ? `${sender.displayName} <${sender.address}>`
    : sender.displayName;
}
