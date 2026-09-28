import { emailColumnFor, LOOKUP_ENTITIES, type PartyEntity } from './recipients';
import { bareId } from './guid';

/**
 * Type-ahead in To/Cc: find records by name or address as the agent types, the way the standard
 * email form's recipient field does.
 *
 * Record-first, like the platform: a suggestion is always a real record with an address, so what
 * the agent picks is bound (`partyid_<entity>@odata.bind`) and deliverable. The same tables the
 * lookup dialog offers — including queues, because picking one deliberately is different from
 * matching one by accident (CLAUDE.md).
 */

export interface RecipientSuggestion {
  partyId: string;
  partyEntity: PartyEntity;
  name: string;
  address: string;
}

/** Below this, a search is noise: one letter matches half the directory. */
export const MIN_SEARCH_LENGTH = 2;
/** Per table, and in total. A type-ahead that scrolls has stopped being a type-ahead. */
export const PER_TABLE = 4;
export const MAX_SUGGESTIONS = 8;

const NAME_COLUMN: Record<PartyEntity, string> = {
  contact: 'fullname',
  account: 'name',
  systemuser: 'fullname',
  lead: 'fullname',
  queue: 'name',
};

/**
 * The query for one table: name OR address starts with the text, the address is present, and the
 * record is usable. Escaped for OData (quotes doubled) AND for the URL — the same two layers as
 * the address filter (M1), for the same reasons.
 */
export function buildSearchQuery(entity: PartyEntity, text: string): string {
  const email = emailColumnFor(entity);
  const name = NAME_COLUMN[entity];
  const literal = encodeURIComponent(text.trim().replace(/'/g, "''"));
  const active = entity === 'systemuser' ? ' and isdisabled eq false' : ' and statecode eq 0';
  return `?$select=${entity}id,${name},${email}`
    + `&$filter=(startswith(${name},'${literal}') or startswith(${email},'${literal}'))`
    + ` and ${email} ne null${active}`
    + `&$orderby=${name}&$top=${PER_TABLE}`;
}

/** One table's rows as suggestions; rows without an id or an address are dropped. */
export function toSuggestions(entity: PartyEntity, rows: readonly Record<string, unknown>[]): RecipientSuggestion[] {
  const out: RecipientSuggestion[] = [];
  for (const row of rows) {
    const id = row[`${entity}id`];
    const address = row[emailColumnFor(entity)];
    const name = row[NAME_COLUMN[entity]];
    if (typeof id !== 'string' || typeof address !== 'string' || !address.trim()) continue;
    out.push({
      partyId: bareId(id),
      partyEntity: entity,
      name: typeof name === 'string' && name.trim() ? name.trim() : address.trim(),
      address: address.trim().toLowerCase(),
    });
  }
  return out;
}

/**
 * All tables' suggestions in one list: the lookup's table order (people before queues), without
 * repeats or anyone already on the message, capped.
 */
export function mergeSuggestions(
  byTable: ReadonlyMap<PartyEntity, readonly RecipientSuggestion[]>,
  alreadyOnMessage: Iterable<string>,
): RecipientSuggestion[] {
  const taken = new Set([...alreadyOnMessage].map((a) => a.trim().toLowerCase()));
  const seen = new Set<string>();
  const out: RecipientSuggestion[] = [];
  for (const entity of LOOKUP_ENTITIES) {
    for (const s of byTable.get(entity) ?? []) {
      const key = `${s.partyEntity}:${s.partyId}`;
      if (seen.has(key) || taken.has(s.address)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= MAX_SUGGESTIONS) return out;
    }
  }
  return out;
}

/** "contact" → "Contact", for the small label beside a suggestion. */
export function entityLabel(entity: PartyEntity): string {
  return { contact: 'Contact', account: 'Account', systemuser: 'User', lead: 'Lead', queue: 'Queue' }[entity];
}
