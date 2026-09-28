import type { Recipient } from './compose';

/**
 * Recipients that Dataverse will actually deliver to.
 *
 * **The bug this module exists for.** Until now every To/Cc party was written as a bare
 * `addressused` with no `partyid` — what Dataverse calls an **unresolved party**. It only
 * delivers to those when `Organization.allowunresolvedpartiesonemailsend` is true, and in the
 * demo org that setting is **false**. Delivery happened anyway, so this is a portability defect
 * rather than a live outage — but the client was relying on a tolerance it is not entitled to,
 * and the sender party has always been bound properly while recipients were not.
 *
 * A recipient is therefore "resolved" when it names a real record: a contact, account,
 * systemuser, lead or queue. That record is what `partyid` points at.
 */

/** The tables `activityparty.partyid` accepts that can hold an email address. */
export type PartyEntity = 'contact' | 'account' | 'systemuser' | 'lead' | 'queue';

/**
 * Where each table keeps its email address.
 *
 * **Every one of these differs**, which is the whole reason this is a lookup table and not a
 * constant. All five verified queryable against the live environment on 2026-09-25.
 */
export const PARTY_EMAIL_COLUMN: Record<PartyEntity, string> = {
  contact: 'emailaddress1',
  account: 'emailaddress1',
  systemuser: 'internalemailaddress',
  lead: 'emailaddress1',
  queue: 'emailaddress',
};

/**
 * Which tables to search when turning a bare address back into a record, in order.
 *
 * Contact first because on a Case that is nearly always the right answer. Queue is deliberately
 * absent: resolving a recipient *to* a queue would address our own service mailbox, which
 * `resolveRecipients` spends its effort excluding.
 */
export const RESOLVE_ORDER: readonly PartyEntity[] = ['contact', 'account', 'systemuser', 'lead'];

/**
 * What the native lookup dialog offers.
 *
 * Queue IS here, unlike `RESOLVE_ORDER` — an agent deliberately picking a queue (to hand a
 * thread to another team) is a real thing, whereas silently resolving an address to one is not.
 *
 * Lead joined 2026-09-28: address matching already resolved to leads, so a lead could arrive on a
 * reply but could not be picked — the same table the standard email form offers. The order is
 * the type-ahead's too: customers first, then colleagues, then queues.
 */
export const LOOKUP_ENTITIES: readonly PartyEntity[] = [
  'contact', 'account', 'lead', 'systemuser', 'queue',
];

export function isPartyEntity(value: string): value is PartyEntity {
  return Object.prototype.hasOwnProperty.call(PARTY_EMAIL_COLUMN, value);
}

export function emailColumnFor(entity: PartyEntity): string {
  return PARTY_EMAIL_COLUMN[entity];
}

/**
 * The `@odata.bind` navigation property for a party.
 *
 * **Only a fallback.** The party query returns
 * `_partyid_value@Microsoft.Dynamics.CRM.associatednavigationproperty` — the platform stating the
 * name outright — and that should be preferred wherever it is available. Composing the name by
 * hand is a guess that happens to agree today; `partyNavFor` is for the paths that have no
 * annotation to read, such as a record just picked from the lookup dialog.
 */
export function partyNavFor(entity: PartyEntity): string {
  return `partyid_${entity}`;
}

/**
 * Strip the braces and casing the lookup dialog returns.
 *
 * Measured 2026-09-25: `Xrm.Utility.lookupObjects` resolves with
 * `id: "{B5E30418-23F2-F011-8406-0022489CF5DD}"` — braced **and** upper-cased. Passing that
 * straight into an `@odata.bind` is the obvious thing and the wrong thing.
 */
import { bareId } from './guid';

export { bareId };

/** A record the agent picked, or that an address resolved to. */
export interface ResolvedParty {
  partyId: string;
  partyEntity: PartyEntity;
  name: string;
  address: string;
}

/** What `resolveAddress` can conclude. Ambiguity is a distinct answer, never a guess. */
export type ResolutionOutcome =
  | { kind: 'resolved'; party: ResolvedParty }
  | { kind: 'none' }
  | { kind: 'ambiguous'; matches: number; entity: PartyEntity };

/** Does this recipient name a real record? */
export function isResolved(r: Recipient): boolean {
  return typeof r.partyId === 'string' && r.partyId.length > 0;
}

/**
 * Every address on the message that Dataverse would treat as unresolved.
 *
 * Deduplicated and lower-cased, so an address in both To and Cc is reported once.
 */
export function unresolvedAddresses(
  to: readonly Recipient[],
  cc: readonly Recipient[],
): string[] {
  const seen = new Set<string>();
  for (const r of [...to, ...cc]) {
    if (isResolved(r)) continue;
    const a = r.address.trim().toLowerCase();
    if (a) seen.add(a);
  }
  return [...seen];
}

/**
 * The sentence shown when a send is refused for unresolved recipients.
 *
 * **Names them.** "Some recipients could not be resolved" leaves the agent hunting; the whole
 * value of blocking is telling them precisely which address to fix.
 */
export function describeUnresolved(
  addresses: readonly string[],
  /**
   * Those of `addresses` that matched several records. They get their own sentence: "not a known
   * record" was untrue for them, and sent the agent looking for a record that exists twice (L6).
   */
  ambiguous: readonly string[] = [],
): string {
  if (addresses.length === 0) return '';
  const several = new Set(ambiguous.map((a) => a.toLowerCase()));
  const unknown = addresses.filter((a) => !several.has(a.toLowerCase()));
  const matchedMany = addresses.filter((a) => several.has(a.toLowerCase()));
  const parts: string[] = [];
  if (unknown.length > 0) {
    const verb = unknown.length === 1 ? 'is not a known record' : 'are not known records';
    parts.push(`${unknown.join(', ')} ${verb}.`);
  }
  if (matchedMany.length > 0) {
    const verb = matchedMany.length === 1 ? 'matches' : 'each match';
    parts.push(`${matchedMany.join(', ')} ${verb} more than one record, so it is not clear who is meant.`);
  }
  return `${parts.join(' ')} This organisation only delivers to recipients that match a `
    + 'contact, account, user or queue — use the lookup to pick one.';
}

/** The unresolved addresses that matched SEVERAL records rather than none (L6). */
export function ambiguousAddresses(
  to: readonly Recipient[],
  cc: readonly Recipient[],
): string[] {
  const seen = new Set<string>();
  for (const r of [...to, ...cc]) {
    if (isResolved(r) || !r.ambiguousMatches) continue;
    const a = r.address.trim().toLowerCase();
    if (a) seen.add(a);
  }
  return [...seen];
}

/**
 * Turn a picked record into a recipient, or explain why it cannot be one.
 *
 * A record with no email address is refused **at the moment of picking**. Adding it silently
 * would produce a chip that looks like a recipient, saves like a recipient, and delivers to
 * nobody — which is the same class of quiet failure as the unresolved party itself.
 */
export function recipientFromParty(
  party: { id: string; entityType: string; name: string },
  address: string | undefined,
): { ok: true; recipient: Recipient } | { ok: false; reason: string } {
  if (!isPartyEntity(party.entityType)) {
    return { ok: false, reason: `${party.name} cannot receive email.` };
  }
  const trimmed = (address ?? '').trim();
  if (!trimmed) {
    return {
      ok: false,
      reason: `${party.name} has no email address, so it cannot be a recipient.`,
    };
  }
  return {
    ok: true,
    recipient: {
      name: party.name,
      address: trimmed.toLowerCase(),
      partyId: bareId(party.id),
      partyEntity: party.entityType,
      partyNav: partyNavFor(party.entityType),
    },
  };
}

/** Drop any pick whose address duplicates one already on the message. */
export function withoutDuplicates(
  incoming: readonly Recipient[],
  existing: readonly Recipient[],
): Recipient[] {
  const seen = new Set(existing.map((r) => r.address.trim().toLowerCase()));
  const out: Recipient[] = [];
  for (const r of incoming) {
    const a = r.address.trim().toLowerCase();
    if (!a || seen.has(a)) continue;
    seen.add(a);
    out.push(r);
  }
  return out;
}

/**
 * Replace a flagged (unresolved) recipient with the record the agent picked for it, in place —
 * the chip keeps its position in the row. If that record is already on the message, the flagged
 * chip simply goes: the same person twice is never what was meant.
 */
export function replaceUnresolved(
  list: readonly Recipient[],
  others: readonly Recipient[],
  address: string,
  replacement: Recipient,
): Recipient[] {
  const at = list.findIndex((r) => !isResolved(r) && r.address.trim().toLowerCase() === address.trim().toLowerCase());
  if (at < 0) return [...list];
  const key = replacement.address.trim().toLowerCase();
  const taken = [...others, ...list.filter((_, i) => i !== at)]
    .some((r) => r.address.trim().toLowerCase() === key);
  return taken ? list.filter((_, i) => i !== at) : list.map((r, i) => (i === at ? replacement : r));
}
