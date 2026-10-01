import type { WebApiLike } from './emailQueries';
import { normaliseWebApiError, type NormalisedError } from './errors';
import {
  bareId, emailColumnFor, isPartyEntity, LOOKUP_ENTITIES, partyNavFor, RESOLVE_ORDER,
  type PartyEntity, type ResolutionOutcome,
} from '../domain/recipients';
import type { Recipient } from '../domain/compose';
import {
  buildSearchQuery, mergeSuggestions, MIN_SEARCH_LENGTH, PER_TABLE, toSuggestions,
  type RecipientSuggestion,
} from '../domain/recipientSearch';

/**
 * Finding the record behind a recipient.
 *
 * Two routes, both producing a party the platform will deliver to:
 *
 * 1. **The agent picks one** — `Xrm.Utility.lookupObjects`, the platform's own lookup dialog.
 * 2. **An address is resolved** — a search across the party-capable tables.
 *
 * Verified live 2026-09-25: the dialog opens over the PCF inside Copilot Service Workspace,
 * searches Contacts and Users together, shows each record's email address inline, and resolves
 * with `[{ id, entityType, name }]`.
 *
 * Two behaviours of that API worth stating, because both are easy to get wrong:
 *
 * - **`id` comes back braced and upper-cased** — `{B5E30418-23F2-…}`. It must be stripped before
 *   it goes anywhere near an `@odata.bind`.
 * - **Cancelling resolves with `[]`, it does not reject.** Treating "no rejection" as "the agent
 *   picked something" would add an undefined recipient.
 */

/** What the lookup dialog hands back. */
export interface PickedRecord {
  id: string;
  entityType: string;
  name: string;
}

interface XrmUtility {
  lookupObjects(options: {
    entityTypes: string[];
    allowMultiSelect?: boolean;
    searchText?: string;
  }): Promise<PickedRecord[]>;
}

/**
 * `Xrm.Utility`, or `undefined` where it is not reachable.
 *
 * Same escape-hatch shape as `resolveXrmExecute` in `data/templates.ts`, and total for the same
 * reason: the caller hides the Add button rather than catching a ReferenceError.
 */
export function resolveXrmUtility(): XrmUtility | undefined {
  if (typeof window === 'undefined') return undefined;
  const xrm = (window as unknown as Record<string, unknown>).Xrm as
    | { Utility?: { lookupObjects?: unknown } }
    | undefined;
  const fn = xrm?.Utility?.lookupObjects;
  return typeof fn === 'function' ? (xrm?.Utility as XrmUtility) : undefined;
}

/**
 * Open the native lookup and return what the agent chose.
 *
 * Returns `[]` for a cancel, which the caller treats as "nothing to do" rather than an error.
 */
export async function openRecipientLookup(
  options: {
    /** Pre-fills the dialog's search — resolving a flagged chip searches for its address. */
    searchText?: string;
    allowMultiSelect?: boolean;
  } = {},
  utility: XrmUtility | undefined = resolveXrmUtility(),
): Promise<PickedRecord[]> {
  if (!utility) return [];
  try {
    const picked = await utility.lookupObjects({
      entityTypes: [...LOOKUP_ENTITIES],
      allowMultiSelect: options.allowMultiSelect ?? true,
      searchText: options.searchText ?? '',
    });
    return Array.isArray(picked) ? picked : [];
  } catch {
    // The dialog rejects on some dismissal paths. Nothing was chosen; that is not an error.
    return [];
  }
}

/**
 * The email address of a picked record.
 *
 * `lookupObjects` returns id, type and name — never the address — and **every table names its
 * address column differently**, which is what `emailColumnFor` is for. One read per pick.
 */
export async function fetchPartyAddress(
  webApi: WebApiLike,
  entity: PartyEntity,
  id: string,
): Promise<string | undefined> {
  const column = emailColumnFor(entity);
  try {
    const row = await webApi.retrieveRecord(entity, bareId(id), `?$select=${column}`);
    const value = row[column];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Where a new message's default recipient comes from — see `EmailClientSetting.recipientLookup`. */
export interface RecipientSource {
  /** The table the control is hosted on. Only `incident` is a placement today. */
  entity: string;
  /** The lookup on it that names the recipient. */
  lookup: string;
}

/** The documented default when no settings row says otherwise: the Case's customer. */
export const DEFAULT_RECIPIENT_SOURCE: RecipientSource = { entity: 'incident', lookup: 'customerid' };

/**
 * The record a NEW email on this case goes to by default (2026-10-01) — the case's customer,
 * unless a settings row names another lookup.
 *
 * `undefined` whenever it cannot name a deliverable record: a lookup that is empty, points at
 * something that is not a party, points at a QUEUE (that would address our own service mailbox),
 * or a record with no address. Pre-filling is a convenience; a guess would be worse than an empty
 * To line, so nothing here falls back to an unresolved address.
 */
export async function fetchDefaultRecipient(
  webApi: WebApiLike,
  caseId: string,
  source: RecipientSource,
): Promise<Recipient | undefined> {
  // The lookup name comes from a settings row and is spliced into a query: allow a name only.
  if (source.entity !== 'incident' || !/^[a-z_][a-z0-9_]*$/i.test(source.lookup)) return undefined;
  const field = `_${source.lookup.toLowerCase()}_value`;
  try {
    const row = await webApi.retrieveRecord('incident', bareId(caseId), `?$select=${field}`);
    const id = row[field];
    // `context.webAPI` returns annotations, and the polymorphic lookup's target comes only from them.
    const entity = row[`${field}@Microsoft.Dynamics.CRM.lookuplogicalname`];
    const name = row[`${field}@OData.Community.Display.V1.FormattedValue`];
    if (typeof id !== 'string' || typeof entity !== 'string') return undefined;
    if (!isPartyEntity(entity) || entity === 'queue') return undefined;
    const address = await fetchPartyAddress(webApi, entity, id);
    if (!address) return undefined;
    return {
      name: typeof name === 'string' && name ? name : address,
      address,
      partyId: bareId(id),
      partyEntity: entity,
      partyNav: partyNavFor(entity),
    };
  } catch {
    return undefined;
  }
}

/**
 * The lookup query for one address.
 *
 * Two layers of escaping, in this order, and both are needed (M1, 2026-09-28):
 *
 * 1. **OData** — single quotes delimit the literal, so they are doubled.
 * 2. **URL** — the options string goes into the query string as-is, and the server URL-decodes it
 *    AFTER our OData escaping. Unencoded, `+` decoded to a space (so plus-addressed customers never
 *    resolved and their replies were refused), `&` and `#` cut the query off, and a `%27` in an
 *    external sender's address decoded to a quote and could rewrite the filter.
 */
export function addressFilter(entity: PartyEntity, address: string): string {
  const column = emailColumnFor(entity);
  const literal = encodeURIComponent(address.replace(/'/g, "''"));
  const name = entity === 'account' ? 'name' : 'fullname';
  return `?$select=${entity}id,${column},${name}&$filter=${column} eq '${literal}'&$top=2`;
}

/** No read privilege on a table: HTTP 403, or Dataverse's `PrivilegeDenied` (0x80040220). */
function isPrivilegeError(e: NormalisedError): boolean {
  return e.status === 403 || e.code?.toLowerCase() === '0x80040220';
}

/** One plain address. Anything else is not worth four queries, and is not a recipient. */
const ADDRESS_SHAPE = /^[^\s@,;<>"]+@[^\s@,;<>"]+$/;

/**
 * Turn a bare address back into a record.
 *
 * Searches `RESOLVE_ORDER` and stops at the first table with **exactly one** match.
 *
 * **Two matches is `ambiguous`, never a guess.** Picking the first would silently mail whichever
 * duplicate contact happened to sort first — worse than refusing and letting the agent choose.
 * `$top=2` is enough to detect that without paging the whole table.
 */
export async function resolveAddress(
  webApi: WebApiLike,
  address: string,
): Promise<ResolutionOutcome> {
  const trimmed = address.trim();
  if (!ADDRESS_SHAPE.test(trimmed)) return { kind: 'none' };

  for (const entity of RESOLVE_ORDER) {
    try {
      const page = await webApi.retrieveMultipleRecords(
        entity, addressFilter(entity, trimmed), 2,
      );
      const rows = page.entities;
      if (rows.length === 0) continue;
      if (rows.length > 1) return { kind: 'ambiguous', matches: rows.length, entity };

      const row = rows[0];
      const id = row[`${entity}id`];
      if (typeof id !== 'string') continue;
      const label = row[entity === 'account' ? 'name' : 'fullname'];
      return {
        kind: 'resolved',
        party: {
          partyId: bareId(id),
          partyEntity: entity,
          name: typeof label === 'string' && label ? label : trimmed,
          address: trimmed.toLowerCase(),
        },
      };
    } catch (rejection) {
      // A table the agent may not READ must not stop the search — they may lack read on `lead`
      // and still be perfectly able to mail a contact.
      //
      // Any OTHER failure stops it (L6). Carrying on past a contact lookup that merely timed out
      // could bind the address to an account or user with the same address instead — a real
      // record, the wrong one. Unresolved is the honest answer, and the send guard names it.
      if (isPrivilegeError(normaliseWebApiError(rejection))) continue;
      return { kind: 'none' };
    }
  }
  return { kind: 'none' };
}

/**
 * Resolve several addresses, caching within the call.
 *
 * Addresses repeat heavily across To, Cc and the quoted chain, and each miss costs up to four
 * queries.
 */
export async function resolveAddresses(
  webApi: WebApiLike,
  addresses: readonly string[],
  cache = new Map<string, ResolutionOutcome>(),
): Promise<Map<string, ResolutionOutcome>> {
  for (const address of addresses) {
    const key = address.trim().toLowerCase();
    if (!key || cache.has(key)) continue;
    cache.set(key, await resolveAddress(webApi, key));
  }
  return cache;
}

/** Narrow a picked record's `entityType`, which arrives as a plain string. */
export function pickedEntity(picked: PickedRecord): PartyEntity | undefined {
  return isPartyEntity(picked.entityType) ? picked.entityType : undefined;
}

/**
 * Fill in the record behind any recipient that arrived as a bare address.
 *
 * Inbound parties are frequently unresolved themselves — the platform stores whatever the mail
 * server reported, and an address that never matched a record when the mail arrived stays
 * unmatched on the row. Resolving at compose time means a reply binds a record even when the
 * message being answered did not.
 *
 * Recipients that already name a record are returned untouched, and anything that cannot be
 * resolved is returned as it came: unresolved is a state the UI shows and the send rule acts on,
 * not an error to throw here.
 */
export async function enrichRecipients(
  webApi: WebApiLike,
  recipients: readonly Recipient[],
  cache?: Map<string, ResolutionOutcome>,
): Promise<Recipient[]> {
  const unknown = recipients.filter((r) => !r.partyId && r.address.trim().length > 0);
  if (unknown.length === 0) return [...recipients];

  const resolved = await resolveAddresses(
    webApi, unknown.map((r) => r.address), cache,
  );

  return recipients.map((r) => {
    if (r.partyId) return r;
    const outcome = resolved.get(r.address.trim().toLowerCase());
    // Several matches stay unresolved — never a guess — but say so (L6).
    if (outcome?.kind === 'ambiguous') return { ...r, ambiguousMatches: outcome.matches };
    if (!outcome || outcome.kind !== 'resolved') return r;
    return {
      ...r,
      // Keep the name the message used; it is what the agent recognises. The record only
      // supplies the identity.
      name: r.name || outcome.party.name,
      partyId: outcome.party.partyId,
      partyEntity: outcome.party.partyEntity,
      partyNav: partyNavFor(outcome.party.partyEntity),
    };
  });
}

/**
 * Type-ahead suggestions for To/Cc: records whose name or address starts with `text`.
 *
 * One query per table, in parallel. A table the agent may not read — or one that errors — costs
 * its own suggestions and nothing else; a type-ahead that fails outright is worse than one that
 * shows the contacts it could find.
 */
export async function searchRecipients(
  webApi: WebApiLike,
  text: string,
  alreadyOnMessage: Iterable<string>,
): Promise<RecipientSuggestion[]> {
  if (text.trim().length < MIN_SEARCH_LENGTH) return [];
  const results = await Promise.all(LOOKUP_ENTITIES.map(async (entity) => {
    try {
      const page = await webApi.retrieveMultipleRecords(entity, buildSearchQuery(entity, text), PER_TABLE);
      return [entity, toSuggestions(entity, page.entities)] as const;
    } catch {
      return [entity, [] as RecipientSuggestion[]] as const;
    }
  }));
  return mergeSuggestions(new Map(results), alreadyOnMessage);
}
