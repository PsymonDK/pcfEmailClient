import { buildOutgoingBody, isForwardSubject, type ComposeMode, type Recipient } from './compose';
import type { SenderCandidate } from './sender';
import { isPartyEntity, partyNavFor, type PartyEntity } from './recipients';
import { bareId, toGuid } from './guid';

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

/**
 * `participationtypemask` values: 1 Sender, 2 To, 3 Cc, 4 Bcc. The ONE table (R4) — `data/`
 * re-exports it as `PARTY_ROLE` rather than keeping a second copy that could drift.
 */
export const PARTY_ROLE = { sender: 1, to: 2, cc: 3, bcc: 4 } as const;
export const PARTY_SENDER = PARTY_ROLE.sender;
export const PARTY_TO = PARTY_ROLE.to;
export const PARTY_CC = PARTY_ROLE.cc;
export const PARTY_BCC = PARTY_ROLE.bcc;

export interface DraftArgs {
  caseId: string;
  subject: string;
  /** The full outgoing body — new text AND the inherited quote, already concatenated (R12). */
  bodyHtml: string;
  sender: SenderCandidate;
  to: readonly Recipient[];
  cc: readonly Recipient[];
  /**
   * Blind copies (issue #11). **Required**, like `inReplyToId`: a party PATCH REPLACES the whole
   * sender/To/Cc/Bcc set (measured 2026-09-29), so a save that leaves Bcc out does not keep it —
   * it deletes it. Every caller has to say what Bcc is, even when the answer is `[]`.
   */
  bcc: readonly Recipient[];
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
  /**
   * The body belongs to the compose-body FORM (S16): an update writes subject (and parties) but
   * not the description. Writing it would overwrite what the form holds — Copilot's draft, say —
   * with this client's idea of the body. Only the CREATE writes the body: the starting content.
   */
  omitBody?: boolean;
}

/** The parts of an open compose surface a save needs. */
export interface ComposeSnapshot {
  mode: ComposeMode;
  /** The message being answered. */
  activityId: string;
  subject: string;
  to: readonly Recipient[];
  cc: readonly Recipient[];
  bcc: readonly Recipient[];
  quotedBlock: string;
}

/**
 * The save payload's arguments, from what is on screen.
 *
 * Out of the component so the `inReplyToId` rule is under test: it was omitted by the shell once
 * already, with every payload test still passing, and resume silently stopped working. A forward
 * is a new message to new people, so it links to nothing and never resumes.
 */
export function draftArgsFrom(
  draft: ComposeSnapshot,
  newHtml: string,
  sender: SenderCandidate,
  caseId: string,
): DraftArgs {
  return {
    caseId,
    subject: draft.subject,
    bodyHtml: buildOutgoingBody(newHtml, draft.quotedBlock),
    sender,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    // Only a reply links to what it answers. A forward is a new message to new people, and a new
    // email answers nothing — both resume by their own row id, never by a parent.
    inReplyToId: draft.mode === 'reply' || draft.mode === 'replyAll' ? draft.activityId : undefined,
  };
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
  const id = toGuid(sender.id, 'sender id');
  const bind = sender.kind === 'queue'
    ? { 'partyid_queue@odata.bind': `/queues(${id})` }
    : { 'partyid_systemuser@odata.bind': `/systemusers(${id})` };
  return { ...bind, participationtypemask: PARTY_SENDER };
}

/**
 * One To/Cc party row.
 *
 * **Binds the record whenever one is known.** A party with only `addressused` is *unresolved*,
 * and Dataverse delivers to those only when `allowunresolvedpartiesonemailsend` is true — false
 * in the demo org, where this client nevertheless relied on it. The bare-address form is now
 * genuinely a last resort rather than the normal path it used to be.
 *
 * `partyNav` comes from the platform's own
 * `_partyid_value@Microsoft.Dynamics.CRM.associatednavigationproperty`; `partyNavFor` only
 * composes a name for records that arrive without one, such as a fresh pick from the lookup.
 *
 * `addressused` is sent **alongside** the bind, not instead of it: the message should go to the
 * address the agent saw, even where a contact has several.
 */
export function recipientParty(r: Recipient, mask: number): Record<string, unknown> {
  const base = { addressused: r.address, participationtypemask: mask };
  if (!r.partyId || !r.partyEntity || !isPartyEntity(r.partyEntity)) return base;

  // The platform-stated navigation property is preferred (CLAUDE.md), but it becomes a property
  // NAME in the payload, so it must at least have the shape of a party lookup's navigation
  // property. Anything else falls back to the composed one rather than reaching the request.
  const nav = r.partyNav && /^partyid_[a-z0-9_]+$/.test(r.partyNav)
    ? r.partyNav
    : partyNavFor(r.partyEntity);
  return {
    ...base,
    [`${nav}@odata.bind`]: `/${PARTY_SET[r.partyEntity]}(${toGuid(r.partyId, 'partyId')})`,
  };
}

/** The OData entity set for each party table — the plural in the `@odata.bind` path. */
const PARTY_SET: Record<PartyEntity, string> = {
  contact: 'contacts',
  account: 'accounts',
  systemuser: 'systemusers',
  lead: 'leads',
  queue: 'queues',
};

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
    // Written on EVERY party save, not only when Bcc was edited: the PATCH replaces the whole set,
    // and leaving Bcc out is what deleted it from resumed drafts (issue #11, measured 2026-09-29).
    ...args.bcc.filter(usable).map((r) => recipientParty(r, PARTY_BCC)),
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
    'regardingobjectid_incident@odata.bind': `/incidents(${toGuid(args.caseId, 'caseId')})`,
    email_activity_parties: buildPartyRows(args),
    // The navigation property is the lowercase `parentactivityid`, read off
    // `ReferencingEntityNavigationPropertyName` rather than guessed from the SchemaName
    // (`ParentActivityId`) — guessing from SchemaName is what fails, per CLAUDE.md.
    ...(args.inReplyToId
      ? {
        'parentactivityid@odata.bind':
            `/emails(${toGuid(args.inReplyToId, 'inReplyToId')})`,
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
  args: Pick<DraftArgs, 'subject' | 'bodyHtml' | 'omitBody'>,
): Record<string, unknown> {
  return args.omitBody
    ? { subject: args.subject }
    : { subject: args.subject, description: args.bodyHtml };
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

/**
 * What the reading pane may offer on a message that is still a DRAFT (N7).
 *
 * Reply, Reply all and Forward were offered on every expanded message, drafts included — so an
 * agent could "forward" their own unsent reply, and it was labelled "Sent on" besides. A draft is
 * not something to answer; it is something to finish. Continuing it reopens compose on the SAME
 * row against the message it answers, so nothing is duplicated.
 *
 * - `resume` — the agent's own draft: answering a message on this case, or, with no parent at
 *   all, a NEW email (`answeringId` empty). A new email has no quote to sit under, so it needs none;
 *   a draft the standard email form left behind resumes the same way, and any quote it carries is
 *   split off and kept verbatim, exactly as on a reply.
 * - `otherAgent` — somebody else's. Their unsent work is theirs to finish.
 * - `cannotResume` — it answers a message that is not on this case, it is a forward with nothing
 *   to forward, or there is no user id to prove ownership.
 */
export type DraftContinuation =
  | { kind: 'resume'; mode: ComposeMode; answeringId: string }
  | { kind: 'otherAgent' }
  | { kind: 'cannotResume' };

/** `undefined` when the message is not a draft — the pane then offers its normal actions. */
export function draftContinuation(
  message: {
    statuscode: number | null;
    subject: string | null;
    parentactivityid?: string | null;
    ownerid?: string | null;
  },
  idsOnCase: ReadonlySet<string>,
  userId: string | undefined,
): DraftContinuation | undefined {
  if (message.statuscode !== DRAFT_STATUSCODE) return undefined;
  if (message.ownerid && userId && bareId(message.ownerid) !== bareId(userId)) {
    return { kind: 'otherAgent' };
  }
  if (!userId || !message.ownerid) return { kind: 'cannotResume' };
  const answering = message.parentactivityid ? bareId(message.parentactivityid) : undefined;
  if (!answering) {
    // No parent: a new email — unless its subject says forward, which has lost what it forwarded.
    return isForwardSubject(message.subject)
      ? { kind: 'cannotResume' }
      : { kind: 'resume', mode: 'new', answeringId: '' };
  }
  if (!idsOnCase.has(answering)) return { kind: 'cannotResume' };
  // Only the kind matters on resume: the recipients shown are the ones stored on the row, and
  // reply and reply-all differ only in how recipients are derived.
  return {
    kind: 'resume',
    mode: isForwardSubject(message.subject) ? 'forward' : 'reply',
    answeringId: answering,
  };
}
