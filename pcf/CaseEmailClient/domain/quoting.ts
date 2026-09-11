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

const ORIGINAL_MESSAGE_MARKERS = [
  '-----original message-----',
  '-----oprindelig meddelelse-----',
  '-----ursprungliche nachricht-----',
  '-----message d\'origine-----',
  '-----mensaje original-----',
  '-----originalmeddelande-----',
  '-----alkuperäinen viesti-----',
];

/**
 * Splits a message body into new text and quoted history.
 * Pure string/DOM work - no platform dependency, so it is unit-testable.
 */
export function splitQuotedHistory(html: string | null | undefined): SplitBody {
  if (!html) return { newHtml: '', quotedHtml: '', matchedBy: 'none' };

  // Rule 1: Outlook's reply/forward container. Highest confidence.
  const rply = findByIdOrClass(html, 'divRplyFwdMsg');
  if (rply !== null) return { newHtml: html.slice(0, rply), quotedHtml: html.slice(rply), matchedBy: 'divRplyFwdMsg' };

  // Rule 2: Gmail.
  const gmail = html.search(/<div[^>]*class="[^"]*gmail_quote/i);
  if (gmail >= 0) return { newHtml: html.slice(0, gmail), quotedHtml: html.slice(gmail), matchedBy: 'gmail_quote' };

  // Rule 3: plain-text original-message delimiter (localised).
  const lower = html.toLowerCase();
  for (const marker of ORIGINAL_MESSAGE_MARKERS) {
    const at = lower.indexOf(marker);
    if (at >= 0) return { newHtml: html.slice(0, at), quotedHtml: html.slice(at), matchedBy: 'original-message' };
  }

  // Rule 4: an <hr> immediately followed by a localised From: header block.
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
