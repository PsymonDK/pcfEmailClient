// Quoted-history splitting (R4 / R12). There is no column, marker or API for this -
// Dataverse stores one HTML blob - so this is a heuristic. See
// docs/research/04-data-model.md#r4r12--quoted-history
//
// Deliberately localisation-aware: the seed data uses Danish Fra:/Sendt:/Til:/Emne:
// header blocks precisely to stop this being tuned to English only.

export interface SplitBody {
  /** The new text of this message. */
  newHtml: string;
  /** The inherited quoted chain, verbatim. Never re-serialised. */
  quotedHtml: string;
  /** Which rule matched, so the spike can report heuristic coverage. */
  matchedBy: 'divRplyFwdMsg' | 'gmail_quote' | 'blockquote' | 'original-message' | 'header-block' | 'none';
}

// Localised "From:" header-block openers seen in Outlook forward/reply blocks.
const FROM_LABELS = [
  'from', 'fra', 'von', 'de', 'da', 'van', 'od', 'ab',
  'lähettäjä', 'från', 'avsender', 'nadawca', 'origem', 'mittente',
];

/**
 * The reply/forward container ids and classes, in confidence order.
 *
 * **`replyfwdmessage` is Dynamics' OWN marker**, and it was missing until real mail was read in the
 * published app on 2026-09-11. That was the worst possible gap: this client's most common input is
 * mail that Dynamics itself sent, so the one marker we lacked was the one we would meet most.
 * Outlook uses `divRplyFwdMsg`; Dynamics uses `replyfwdmessage`, lower-case and differently named.
 */
const REPLY_CONTAINERS = ['divRplyFwdMsg', 'replyfwdmessage'];

/**
 * The plain-text delimiter, as a pattern rather than a list of literals.
 *
 * Real mail measured 2026-09-11 uses `------------------- Original Message -------------------` —
 * nineteen dashes, spaces around the words, title case. The previous literal list required exactly
 * five dashes and no spaces, so it matched none of it. Dash count and spacing are cosmetic and
 * vary by client, so they must not be part of the match.
 */
const ORIGINAL_MESSAGE_RE = new RegExp(
  '-{3,}\\s*(?:' + [
    'original message',
    'oprindelig meddelelse',
    'ursprungliche nachricht',
    "message d'origine",
    'mensaje original',
    'originalmeddelande',
    'alkuperäinen viesti',
    'oorspronkelijk bericht',
  ].join('|') + ')\\s*-{3,}',
  'i',
);

/**
 * Splits a message body into new text and quoted history.
 * Pure string/DOM work - no platform dependency, so it is unit-testable.
 */
export function splitQuotedHistory(html: string | null | undefined): SplitBody {
  if (!html) return { newHtml: '', quotedHtml: '', matchedBy: 'none' };

  // Rule 1: a reply/forward CONTAINER — Outlook's or Dynamics' own. Highest confidence, because
  // cutting at the container start puts the whole quoted block inside the fold, delimiter and all.
  for (const token of REPLY_CONTAINERS) {
    const at = findByIdOrClass(html, token);
    if (at !== null) {
      return { newHtml: html.slice(0, at), quotedHtml: html.slice(at), matchedBy: 'divRplyFwdMsg' };
    }
  }

  // Rule 2: Gmail.
  const gmail = html.search(/<div[^>]*class="[^"]*gmail_quote/i);
  if (gmail >= 0) return { newHtml: html.slice(0, gmail), quotedHtml: html.slice(gmail), matchedBy: 'gmail_quote' };

  // Rule 3: the plain-text delimiter, if no container wrapped it.
  const delimiter = ORIGINAL_MESSAGE_RE.exec(html);
  if (delimiter) {
    return {
      newHtml: html.slice(0, delimiter.index),
      quotedHtml: html.slice(delimiter.index),
      matchedBy: 'original-message',
    };
  }

  // Rule 4: a localised From: header block, optionally preceded by an <hr>.
  //
  // This MUST stay below rule 3. Measured 2026-09-11: in real Dynamics mail the bolded `From:`
  // sits ~60 bytes AFTER the delimiter, so matching it first cut the quote in the wrong place and
  // left the "--- Original Message ---" line stranded in the new text, visible above the fold.
  const headerBlock = findHeaderBlock(html);
  if (headerBlock >= 0) {
    return { newHtml: html.slice(0, headerBlock), quotedHtml: html.slice(headerBlock), matchedBy: 'header-block' };
  }

  // Rule 5: first top-level blockquote. Lowest confidence - many senders use
  // blockquote for emphasis, so this is last.
  const bq = html.search(/<blockquote/i);
  if (bq >= 0) return { newHtml: html.slice(0, bq), quotedHtml: html.slice(bq), matchedBy: 'blockquote' };

  return { newHtml: html, quotedHtml: '', matchedBy: 'none' };
}

function findByIdOrClass(html: string, token: string): number | null {
  const re = new RegExp(`<div[^>]*(?:id|class)="[^"]*${token}`, 'i');
  const m = re.exec(html);
  return m ? m.index : null;
}

function findHeaderBlock(html: string): number {
  const labels = FROM_LABELS.map(escapeRe).join('|');
  // <b>Fra:</b> ... within a short window after an <hr>, or standalone bolded label.
  const re = new RegExp(`(<hr[^>]*>\\s*)?<(?:b|strong)>\\s*(?:${labels})\\s*:\\s*</(?:b|strong)>`, 'i');
  const m = re.exec(html);
  if (!m) return -1;
  // Prefer to cut at the <hr> when one precedes the label.
  return m.index;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Counts nesting depth of quoted history, for reporting. */
export function quoteDepth(html: string | null | undefined): number {
  if (!html) return 0;
  const rply = (html.match(/<div[^>]*(?:id|class)="[^"]*divRplyFwdMsg/gi) ?? []).length;
  const gmail = (html.match(/<div[^>]*class="[^"]*gmail_quote/gi) ?? []).length;
  const bq = (html.match(/<blockquote/gi) ?? []).length;
  return Math.max(rply, gmail, bq);
}
