import { sanitiseEmailBody } from './sanitise';
import { splitQuotedHistory } from './quoting';
import { stripInjectedNotices, type Notice } from './noise';

/**
 * One message body, from the raw stored HTML to the pieces the reading pane renders.
 *
 *     sanitise  →  split quoted history  →  strip injected notices  →  RE-SANITISE each piece
 *
 * Sanitising first is the only order in which hostile markup never reaches code that indexes
 * into the string. The last step exists because the middle two cut that string with regexes and
 * `indexOf`, and a cut can land INSIDE an attribute value: `<p title="--- Original Message ---
 * <img src=x onerror=…>">` is kept whole by the sanitiser, then split at the marker, leaving a
 * fragment that re-parses into a live `img[onerror]` (M5, 2026-09-28 — reproduced in jsdom).
 * Current Chromium happens to escape `<` inside attribute values when it serialises, which is
 * the only reason it did not fire there; safety must not rest on a browser serialisation detail.
 * Re-sanitising a fragment is cheap, and it makes every string that reaches the DOM one the
 * sanitiser has seen in the form it will be parsed.
 *
 * Out of `BodyFrame` so the pipeline can be tested as a unit — which is how the gap was found.
 */

export interface PreparedBody {
  newHtml: string;
  quotedHtml: string;
  notices: Notice[];
  foldableCount: number;
  quoteDepthLabel: string;
  /** Remote images held back. Non-zero is what offers the agent "show pictures". */
  blockedImages: number;
}

export function prepareBody(
  rawHtml: string,
  options: { allowRemoteImages?: boolean } = {},
): PreparedBody {
  const first = sanitiseEmailBody(rawHtml, options);

  // Displayed, never re-serialised into anything that is sent.
  const split = splitQuotedHistory(first.html);

  // Strip what the sender did not write, from the NEW text only — a quoted chain's own banners
  // are part of the quote and are not ours to edit.
  const cleaned = stripInjectedNotices(split.newHtml);

  const again = (html: string): string => sanitiseEmailBody(html, options).html;
  return {
    newHtml: again(cleaned.html),
    quotedHtml: again(split.quotedHtml),
    notices: cleaned.notices.map((n) => ({ ...n, html: again(n.html) })),
    foldableCount: cleaned.foldableCount,
    quoteDepthLabel: describeQuote(split.quotedHtml),
    blockedImages: first.blockedImages,
  };
}

export function describeQuote(quotedHtml: string): string {
  if (!quotedHtml) return '';
  // Count the header blocks rather than the nesting depth: "3 earlier messages" is what an agent
  // understands, and it is what the design's fold label says.
  const headers =
    (quotedHtml.match(/divRplyFwdMsg/gi) ?? []).length ||
    (quotedHtml.match(/gmail_quote/gi) ?? []).length ||
    (quotedHtml.match(/-{2,}\s*original message/gi) ?? []).length ||
    1;
  return headers === 1 ? '1 earlier message' : `${headers} earlier messages`;
}
