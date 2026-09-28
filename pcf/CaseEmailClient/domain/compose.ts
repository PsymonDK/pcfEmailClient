import type { EmailRow } from './threading';
import { splitQuotedHistory } from './quoting';
import { sanitiseEmailBody } from './sanitise';
import { stripTrackingToken } from './threading';

/**
 * Composing a reply, reply-all or forward: recipients (R9) and the outgoing body (R12).
 *
 * Pure, and deliberately written **before any compose UI exists**, because R12 is the single
 * largest functional risk in the build and its rule is architectural rather than cosmetic:
 *
 *   **THE INHERITED QUOTE NEVER ENTERS THE EDITOR.**
 *
 * The editor edits only the new text. The quote is held as an opaque string, shown read-only
 * beneath the editor, and concatenated **verbatim** at send time. That collapses the editor's
 * fidelity requirement from "must round-trip arbitrary Outlook HTML" — which no editor does well —
 * to "must handle what the agent types", which they all do.
 *
 * The closed loop is the proof, and it is tested: splitting our own emitted message must return
 * the new text and the quoted block byte-for-byte unchanged.
 */

/**
 * The container we wrap an inherited chain in.
 *
 * Deliberately Dynamics' and Outlook's own id, for two reasons: real mail clients recognise it and
 * fold it, and `splitQuotedHistory` already matches it as its highest-confidence rule — so what we
 * emit is what we can re-split. Changing this without changing `REPLY_CONTAINERS` in quoting.ts
 * breaks the round trip silently.
 */
export const QUOTE_CONTAINER_ID = 'divRplyFwdMsg';

export type ComposeMode = 'reply' | 'replyAll' | 'forward';

export interface Recipient {
  name: string;
  address: string;
  /**
   * The record this recipient names, when it names one.
   *
   * Absent means **unresolved**, and Dataverse only delivers to an unresolved party when
   * `Organization.allowunresolvedpartiesonemailsend` is true — false in the demo org. So this is
   * not decoration: it is the difference between a message that is delivered and one that is
   * quietly not. See `domain/recipients.ts`.
   */
  partyId?: string;
  /** `contact` / `account` / `systemuser` / `lead` / `queue`. */
  partyEntity?: string;
  /**
   * The `@odata.bind` navigation property, as **stated by the platform** in
   * `_partyid_value@Microsoft.Dynamics.CRM.associatednavigationproperty`.
   *
   * Preferred over composing `partyid_${entity}` by hand, which is a guess that merely happens
   * to agree today.
   */
  partyNav?: string;
}

export interface ResolvedRecipients {
  to: Recipient[];
  cc: Recipient[];
}

/** What the original message's parties looked like. Mirrors `data/emailQueries`' shape. */
export interface OriginalParties {
  sender?: Recipient;
  to: Recipient[];
  cc: Recipient[];
}

const key = (r: Recipient): string => r.address.trim().toLowerCase();

/**
 * Recipients for a reply, reply-all or forward (R9).
 *
 * `ourAddresses` is every address that is *us* — the agent and the case's queue. Replying to a
 * thread and putting the service queue in To is how a support mailbox emails itself in a loop,
 * so the exclusion is not cosmetic.
 *
 * Deduplicated by address, case-insensitively, keeping the first occurrence so the name that
 * appears is the one from the most authoritative slot (sender before To before Cc).
 */
export function resolveRecipients(
  mode: ComposeMode,
  original: OriginalParties,
  ourAddresses: Iterable<string>,
): ResolvedRecipients {
  // Forward addresses nobody: the agent chooses, and silently carrying the original recipients
  // into a forward is how mail reaches people it was never meant to.
  if (mode === 'forward') return { to: [], cc: [] };

  const ours = new Set([...ourAddresses].map((a) => a.trim().toLowerCase()).filter(Boolean));
  const seen = new Set<string>();

  const take = (candidates: readonly Recipient[]): Recipient[] => {
    const out: Recipient[] = [];
    for (const r of candidates) {
      const k = key(r);
      if (!k || ours.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
    return out;
  };

  // The sender goes in To first, so it claims the address before any Cc copy of the same person.
  const to = take([
    ...(original.sender ? [original.sender] : []),
    ...(mode === 'replyAll' ? original.to : []),
  ]);
  const cc = mode === 'replyAll' ? take(original.cc) : [];

  return { to, cc };
}

/** The attribution header a reply or forward puts above the quoted message. */
export interface QuoteHeader {
  from: string;
  sent: string;
  to: string;
  cc?: string;
  subject: string;
}

/**
 * The quoted block: an attribution header plus the original message's body, **sanitised once**.
 *
 * `originalBodyHtml` is the raw `description` exactly as Dataverse returns it — written by
 * someone outside the organisation, and S12 measured that the platform sanitises nothing. It is
 * sanitised HERE, once, and never transformed again: from this point the block is the opaque,
 * verbatim string R12 depends on, so the round trip is still byte-exact.
 *
 * **Why here and not at the call site.** Until 2026-09-28 this comment said "not sanitised
 * again" — but the body had never been sanitised the first time. The reading pane sanitises
 * inside `BodyFrame` and nothing else did, so Reply → expand quote rendered the sender's HTML into
 * the host document with the agent's session behind it, and the same HTML went out in the reply
 * under the queue's identity. Doing it inside the builder means no caller can forget.
 */
export function buildQuotedBlock(header: QuoteHeader, originalBodyHtml: string): string {
  const rows = [
    ['From', header.from],
    ['Sent', header.sent],
    ['To', header.to],
    ...(header.cc ? [['Cc', header.cc]] : []),
    ['Subject', header.subject],
  ];
  const headerHtml = rows
    .map(([label, value]) => `<div><b>${label}:</b> ${escapeHtml(value)}</div>`)
    .join('');

  return (
    `<div id="${QUOTE_CONTAINER_ID}">`
    + '<hr style="display:inline-block;width:98%" tabindex="-1">'
    + `<div style="font-size:11pt">${headerHtml}</div>`
    // Remote images kept: this is the customer's own message going back to them.
    + sanitiseEmailBody(originalBodyHtml, { allowRemoteImages: true, isolateIds: false }).html
    + '</div>'
  );
}

/**
 * The body we actually send: the agent's new text, then the quoted block, concatenated.
 *
 * No wrapper is added around `quotedBlock` — it already carries its own container, which is what
 * makes the round trip exact. Wrapping it again would mean the string that comes back out of
 * `splitQuotedHistory` is not the string that went in.
 */
export function buildOutgoingBody(newHtml: string, quotedBlock?: string): string {
  const safeNew = stripQuoteMarkers(newHtml);
  return quotedBlock ? safeNew + quotedBlock : safeNew;
}

/**
 * Removes our own quote-container marker from text the agent typed or pasted.
 *
 * `splitQuotedHistory` cuts at the **first** occurrence of the marker. If an agent pastes content
 * that happens to carry `divRplyFwdMsg` — pasting a previous reply into a new one does exactly
 * that — the split would cut inside the new text and silently move half of what they wrote into
 * the fold. Renaming the id in pasted content keeps the marker unique to the block we appended,
 * and leaves the pasted content otherwise untouched.
 *
 * **The replacement must not CONTAIN the marker.** `divRplyFwdMsg-quoted` was the obvious first
 * attempt and it does not work: the splitter matches on substring, so the renamed id still
 * matched, still came first, and still cut in the wrong place. The test caught it.
 */
const PASTED_QUOTE_CLASS = 'cecPastedQuote';

export function stripQuoteMarkers(html: string): string {
  return html.replace(
    new RegExp(`(id|class)\\s*=\\s*(["'])([^"']*\\b)${QUOTE_CONTAINER_ID}\\b`, 'gi'),
    `$1=$2$3${PASTED_QUOTE_CLASS}`,
  );
}

/**
 * The closed loop, as a function so it can be asserted in tests AND used as a guard.
 *
 * Returns true when splitting the assembled body gives back exactly what went into it. A false
 * here means the outgoing message would not survive being read back by our own reader — which is
 * the failure R12 exists to prevent.
 */
export function roundTrips(newHtml: string, quotedBlock: string): boolean {
  const assembled = buildOutgoingBody(newHtml, quotedBlock);
  const split = splitQuotedHistory(assembled);
  return split.newHtml === stripQuoteMarkers(newHtml) && split.quotedHtml === quotedBlock;
}

/** The attribution header for a message being replied to or forwarded. */
export function headerFor(
  message: Pick<EmailRow, 'subject' | 'createdon'>,
  parties: OriginalParties,
  formatWhen: (iso: string) => string,
): QuoteHeader {
  const list = (rs: readonly Recipient[]) =>
    rs.map((r) => (r.name ? `${r.name} <${r.address}>` : r.address)).join('; ');
  return {
    from: parties.sender ? list([parties.sender]) : '',
    sent: formatWhen(message.createdon),
    to: list(parties.to),
    cc: parties.cc.length > 0 ? list(parties.cc) : undefined,
    subject: message.subject ?? '',
  };
}

/**
 * The reply or forward subject.
 *
 * **The old tracking token is stripped.** The platform appends a fresh one on send, so carrying
 * the inherited one forward yields `… CRM:0100012 CRM:0100019` — seen in the published app on
 * 2026-09-23 before this was added. Threading does not depend on the token in the subject;
 * `conversationindex` and the hash carry it, and the platform rewrites both on send.
 */
export function composeSubject(mode: ComposeMode, originalSubject: string | null): string {
  const base = stripTrackingToken((originalSubject ?? '').trim());
  const prefix = mode === 'forward' ? 'FW: ' : 'RE: ';
  // Do not stack prefixes: "RE: RE: RE:" is how a thread's subject becomes unreadable. Matches the
  // same prefixes `normaliseSubject` strips, so the two stay consistent.
  if (/^\s*(re|fw|fwd|sv|vs|aw|antw|rif|ang|vb|vl)\s*(\[\d+\])?\s*:/i.test(base)) return base;
  return prefix + base;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
