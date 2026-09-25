import type { Recipient } from './compose';
import type { SenderCandidate } from './sender';

/**
 * The shape of a draft email row (R16).
 *
 * Pure: this builds the payload, `data/draft.ts` posts it. The payload is where the Dataverse
 * email model's sharp edges live, so it is worth having somewhere they can be asserted without a
 * round trip.
 *
 * Four rules, each one a documented trap rather than a preference:
 *
 * 1. **A draft is `statecode` 0 (Open) + `statuscode` 1 (Draft).** `Email.StatusCode` cannot be
 *    null — omitting it does not mean "default", it fails.
 * 2. **Recipients are `activityparty` ROWS, not strings.** `participationtypemask` 1 Sender,
 *    2 To, 3 Cc, 4 Bcc.
 * 3. **Never write `email.torecipients`.** It is a read-only display convenience
 *    (`IsValidForForm: False`) that looks exactly like the field you want.
 * 4. **Never write `email.templateid`** — documented "for internal use only".
 */

/** `statecode`: 0 Open. A draft is an open activity, not a completed one. */
export const DRAFT_STATECODE = 0;
/** `statuscode`: 1 Draft. Cannot be null. */
export const DRAFT_STATUSCODE = 1;

/** `participationtypemask` values. Same table as `data/emailQueries.ts`' `PARTY_ROLE`. */
export const PARTY_SENDER = 1;
export const PARTY_TO = 2;
export const PARTY_CC = 3;

export interface DraftArgs {
  caseId: string;
  subject: string;
  /** The full outgoing body — new text AND the inherited quote, already concatenated (R12). */
  bodyHtml: string;
  sender: SenderCandidate;
  to: readonly Recipient[];
  cc: readonly Recipient[];
  /**
   * The message being replied to.
   *
   * Set on CREATE only — `parentactivityid` is `IsValidForCreate: true` but
   * `IsValidForUpdate: false` (measured 2026-09-25), so it is a one-time link, which is all we
   * **Required, not optional, on purpose.** As an optional field it was silently never passed:
   * the payload builder supported it, every unit test asserted it, and the shell simply omitted
   * it — so drafts saved with a null parent and resume could never find them. Only the published
   * app showed it. Making the key mandatory forces each caller to decide, even if the answer is
   * `undefined` (a forward has nothing to link to).
   *
   * Without it there is no way to find an agent's existing draft when they reopen Reply on
   * the same message, and every reopen would create ANOTHER draft row on the Case.
   */
  inReplyToId: string | undefined;
}

/**
 * One `activityparty` row.
 *
 * A party is identified **either** by a lookup to a real record (`partyid_<entity>@odata.bind`)
 * **or**, when no record matches, by a bare `addressused` string. Recipients on a Case are
 * frequently the second kind — a customer who was mailed but never created as a Contact — so the
 * bare-address form is the normal path here, not a fallback.
 */
export function senderParty(sender: SenderCandidate): Record<string, unknown> {
  const id = sender.id.replace(/^\{|\}$/g, '');
  const bind = sender.kind === 'queue'
    ? { 'partyid_queue@odata.bind': `/queues(${id})` }
    : { 'partyid_systemuser@odata.bind': `/systemusers(${id})` };
  return { ...bind, participationtypemask: PARTY_SENDER };
}

export function recipientParty(r: Recipient, mask: number): Record<string, unknown> {
  return { addressused: r.address, participationtypemask: mask };
}

/**
 * Every party row for a draft, sender first.
 *
 * Recipients with no address are dropped: an `activityparty` with neither a lookup nor an
 * `addressused` is a row that means nothing, and Dataverse will accept it silently.
 */
export function buildPartyRows(args: DraftArgs): Record<string, unknown>[] {
  const usable = (r: Recipient) => r.address.trim().length > 0;
  return [
    senderParty(args.sender),
    ...args.to.filter(usable).map((r) => recipientParty(r, PARTY_TO)),
    ...args.cc.filter(usable).map((r) => recipientParty(r, PARTY_CC)),
  ];
}

/**
 * The create payload for a new draft.
 *
 * `regardingobjectid_incident@odata.bind` uses the **typed** navigation property, the same
 * discipline the list query uses: it guarantees the regarding object is a Case rather than
 * whatever else shares that GUID.
 */
export function buildDraftPayload(args: DraftArgs): Record<string, unknown> {
  return {
    subject: args.subject,
    description: args.bodyHtml,
    statecode: DRAFT_STATECODE,
    statuscode: DRAFT_STATUSCODE,
    // 1 = Outgoing. Without it the draft reads as incoming mail, and `domain/unread.ts` would
    // then treat the agent's own unsent draft as something waiting to be read.
    directioncode: true,
    'regardingobjectid_incident@odata.bind': `/incidents(${args.caseId.replace(/^\{|\}$/g, '')})`,
    email_activity_parties: buildPartyRows(args),
    // The navigation property is the lowercase `parentactivityid`, read off
    // `ReferencingEntityNavigationPropertyName` rather than guessed from the SchemaName
    // (`ParentActivityId`) — guessing from SchemaName is what fails, per CLAUDE.md.
    ...(args.inReplyToId
      ? {
        'parentactivityid@odata.bind':
            `/emails(${args.inReplyToId.replace(/^\{|\}$/g, '')})`,
      }
      : {}),
  };
}

/**
 * The update payload for an existing draft.
 *
 * **Parties are deliberately absent.** Setting `email_activity_parties` on a PATCH replaces the
 * whole collection, which is what you want semantically — but it is a separate, heavier request
 * than a body/subject save, and autosave fires far more often for typing than for recipient
 * changes. `buildPartyRows` is exported so the caller can send them only when they changed.
 */
export function buildDraftUpdate(
  args: Pick<DraftArgs, 'subject' | 'bodyHtml'>,
): Record<string, unknown> {
  return {
    subject: args.subject,
    description: args.bodyHtml,
  };
}

/**
 * Is there anything here worth persisting?
 *
 * An empty reply opened and abandoned should not leave a draft row on the Case — the agent would
 * come back to a list cluttered with blank drafts they never wrote. A signature alone does not
 * count as content: it is there before the agent types a character.
 */
export function worthSaving(bodyHtml: string, signatureHtml: string): boolean {
  const strip = (html: string) => html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const body = strip(bodyHtml);
  if (body.length === 0) return false;

  const signature = strip(signatureHtml);
  if (signature.length === 0) return true;

  // The signature is inside the body at this point, so compare what is left once it is removed.
  return body.replace(signature, '').trim().length > 0;
}

/** "Saved 14:32" — the autosave indicator's text (R16). */
export function describeSaved(at: Date | undefined, now: Date = new Date()): string {
  if (!at) return 'Not saved yet';
  const seconds = Math.floor((now.getTime() - at.getTime()) / 1000);
  if (seconds < 10) return 'Saved just now';
  if (seconds < 60) return `Saved ${seconds}s ago`;
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return `Saved ${hh}:${mm}`;
}
