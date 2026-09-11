/**
 * Stripping content the sender never wrote (R21).
 *
 * Transport and tenant policy inject material into a message body before it reaches us. All four
 * kinds below were observed together in a single real round-trip on 2026-09-10, so this is the
 * normal shape of an external message rather than a worst case. Left alone, the sender's actual
 * words are the *fourth* thing on screen — which is what the Timeline does today.
 *
 * The design decision (Gate 2, 2026-09-11) is **fold, never delete**, and the rule that governs
 * every judgement here:
 *
 *   > When detection confidence is low, SHOW the content.
 *
 * A visible banner is clutter. A hidden paragraph is a mishandled case. Those are not equally bad,
 * so the default leans the same way the failure does. Confidence tiers, from
 * docs/design/01-design-decisions.md:
 *
 *   CERTAIN  Defender banner (stable markers) · Outlook first-contact tip · classification line
 *   GUESS    signature blocks — detected, reported, but NEVER folded
 *
 * Runs AFTER sanitise.ts, which has already parsed and re-serialised the HTML, so the markup here
 * is well-formed. It runs BEFORE the quoted-history split only in the sense that both operate on
 * the new-text region; order between them does not matter because their markers do not overlap.
 */

export type NoticeKind =
  | 'defender-banner'
  | 'first-contact-tip'
  | 'classification'
  | 'signature';

export interface Notice {
  kind: NoticeKind;
  /** The HTML that was lifted out, verbatim. Nothing is destroyed — this is what the fold shows. */
  html: string;
  /**
   * Whether this may be folded away by default.
   * `false` for signatures: detection is a guess, so they are de-emphasised in the UI instead.
   */
  foldable: boolean;
}

export interface StrippedBody {
  /** The body with the foldable notices removed. */
  html: string;
  /** What was found, in document order. */
  notices: Notice[];
  /** Convenience: how many notices the UI should offer to reveal. */
  foldableCount: number;
}

/**
 * Microsoft Defender for Office 365 wraps its external-sender warning in a marked region. The
 * markers are stable and unmistakable, which is what makes this the highest-confidence rule.
 * Observed verbatim in this environment on 2026-09-10.
 */
const DEFENDER_START = 'ZjQcmQRYFpfptBannerStart';
const DEFENDER_END = 'ZjQcmQRYFpfptBannerEnd';

/**
 * Outlook's own "first contact" caution, added independently of Defender. It has no marker, so it
 * is matched on its wording — which means it is language-dependent and will miss localised
 * tenants. Deliberately accepted: a missed tip shows as clutter, which is the safe direction.
 */
const FIRST_CONTACT_PHRASES = [
  "you don't often get email from",
  'you do not often get email from',
  "don't often get email from this sender",
  'some people who received this message',
  // Danish and German tenants seen in this org family.
  'du modtager ikke ofte e-mail fra',
  'sie erhalten nicht oft e-mails von',
];

/**
 * Two guards on the first-contact rule, and they matter because the rule matches on WORDING rather
 * than a marker, which is inherently weaker than the Defender rule.
 *
 * The real tips are short and lead with the phrase: Outlook's is ~110 characters, Defender's ~90.
 * Anything appreciably longer, or with the phrase buried mid-sentence, is a person writing about
 * the warning rather than the warning itself — and that is content.
 */
const TIP_MAX_LENGTH = 250;
const TIP_MAX_OFFSET = 20;

/** Tenant-prepended classification lines, e.g. "Classification: Public". */
const CLASSIFICATION_RE =
  /^\s*(?:classification|klassifikation|klassifizierung|sensitivity|følsomhed)\s*:\s*[^<\n]{1,40}$/i;

/**
 * Signature openers. Detection only — never folded. A short sign-off and a signature block look
 * alike, and hiding the wrong one removes something the sender meant to send.
 */
const SIGNATURE_OPENERS = [
  'med venlig hilsen',
  'venlig hilsen',
  'mvh',
  'kind regards',
  'best regards',
  'kindest regards',
  'mit freundlichen grüßen',
  'met vriendelijke groet',
  'cordialement',
  'med vennlig hilsen',
  'med vänliga hälsningar',
];

/** Splits HTML into top-level-ish blocks we can consider independently, keeping offsets intact. */
interface Block {
  html: string;
  text: string;
  start: number;
  end: number;
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function topLevelBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  let depth = 0;
  // Walk element boundaries so nested content is not treated as its own block.
  const tagRe = /<(\/?)(div|p|table|blockquote)\b[^>]*?(\/?)>/gi;
  let m: RegExpExecArray | null;
  let blockStart = -1;
  while ((m = tagRe.exec(html)) !== null) {
    const closing = m[1] === '/';
    const selfClosing = m[3] === '/';
    if (selfClosing) continue;
    if (!closing) {
      if (depth === 0) blockStart = m.index;
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0 && blockStart >= 0) {
        const end = m.index + m[0].length;
        const slice = html.slice(blockStart, end);
        blocks.push({ html: slice, text: textOf(slice), start: blockStart, end });
        blockStart = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
  return blocks;
}

/**
 * Finds and removes the injected notices.
 *
 * Removal is by exact slice, so what is taken out can be shown verbatim behind the fold. Nothing
 * is rewritten.
 */
export function stripInjectedNotices(html: string | null | undefined): StrippedBody {
  if (!html) return { html: '', notices: [], foldableCount: 0 };

  const notices: Notice[] = [];
  /** Regions to cut, as [start, end) offsets into the original string. */
  const cuts: [number, number][] = [];

  // ── 1. Defender banner: CERTAIN ────────────────────────────────────────────
  // Matched on the markers, then widened to the enclosing element so the wrapper goes too.
  const startAt = html.indexOf(DEFENDER_START);
  if (startAt >= 0) {
    const endMarker = html.indexOf(DEFENDER_END, startAt);
    const end = endMarker >= 0 ? endMarker + DEFENDER_END.length : startAt + DEFENDER_START.length;
    const region = expandToEnclosingElement(html, startAt, end);
    notices.push({ kind: 'defender-banner', html: html.slice(region[0], region[1]), foldable: true });
    cuts.push(region);
  }

  const blocks = topLevelBlocks(html);

  // ── 2. First-contact tip: CERTAIN in wording, language-limited ─────────────
  for (const block of blocks) {
    if (overlapsAny(block.start, block.end, cuts)) continue;
    const lower = block.text.toLowerCase();
    if (block.text.length <= TIP_MAX_LENGTH) {
      // The phrase must also be at the START of the block. A tenant banner leads with it; a
      // customer writing ABOUT the warning ("I got a warning saying you don't often get email
      // from us, and that worries me…") mentions it mid-sentence. Requiring both a short block
      // and an early position is what separates the two — a 370-character customer paragraph was
      // being eaten with the length guard alone, which is the failure this rule must not have.
      const hit = FIRST_CONTACT_PHRASES.map((p) => lower.indexOf(p)).filter((i) => i >= 0);
      if (hit.some((i) => i <= TIP_MAX_OFFSET)) {
        notices.push({ kind: 'first-contact-tip', html: block.html, foldable: true });
        cuts.push([block.start, block.end]);
      }
    }
  }

  // ── 3. Classification line: CERTAIN ────────────────────────────────────────
  for (const block of blocks) {
    if (overlapsAny(block.start, block.end, cuts)) continue;
    if (CLASSIFICATION_RE.test(block.text)) {
      notices.push({ kind: 'classification', html: block.html, foldable: true });
      cuts.push([block.start, block.end]);
    }
  }

  // ── 4. Signature: GUESS. Reported, never folded. ───────────────────────────
  // Only the LAST matching block is considered, and only in the tail of the body — a "kind
  // regards" in the middle of a sentence is not a signature.
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (overlapsAny(block.start, block.end, cuts)) continue;
    const lower = block.text.toLowerCase();
    const opensWithSignoff = SIGNATURE_OPENERS.some((s) => lower.startsWith(s));
    const inTail = block.start > html.length * 0.5;
    if (opensWithSignoff && inTail) {
      notices.push({ kind: 'signature', html: block.html, foldable: false });
      break; // one signature per message; the first from the end wins
    }
  }

  // ── apply the cuts ─────────────────────────────────────────────────────────
  const foldable = cuts.slice().sort((a, b) => a[0] - b[0]);
  let out = '';
  let at = 0;
  for (const [from, to] of foldable) {
    if (from < at) continue; // overlapping; already covered
    out += html.slice(at, from);
    at = to;
  }
  out += html.slice(at);

  notices.sort((a, b) => html.indexOf(a.html) - html.indexOf(b.html));

  return {
    html: out,
    notices,
    foldableCount: notices.filter((n) => n.foldable).length,
  };
}

/**
 * Widens an offset range to the element that contains it, so a marker found inside a `<div>` takes
 * the whole `<div>` rather than leaving an empty shell behind.
 */
function expandToEnclosingElement(html: string, start: number, end: number): [number, number] {
  // Walk back to the nearest opening tag, forward to its matching close.
  const openAt = html.lastIndexOf('<', start);
  if (openAt < 0) return [start, end];
  const tagMatch = /^<([a-z]+)\b/i.exec(html.slice(openAt));
  if (!tagMatch) return [start, end];

  // Find the start of the element that actually encloses the marker, which may be an ancestor.
  const tag = tagMatch[1].toLowerCase();
  const elementStart = html.lastIndexOf(`<${tag}`, start);
  if (elementStart < 0) return [start, end];

  const closeTag = `</${tag}>`;
  const closeAt = html.indexOf(closeTag, Math.max(end, elementStart));
  if (closeAt < 0) return [elementStart, end];
  return [elementStart, closeAt + closeTag.length];
}

function overlapsAny(start: number, end: number, ranges: [number, number][]): boolean {
  return ranges.some(([from, to]) => start < to && end > from);
}

/** Human label for a notice, used by the fold's summary line. */
export function describeNotice(kind: NoticeKind): string {
  switch (kind) {
    case 'defender-banner':
      return 'External sender warning';
    case 'first-contact-tip':
      return 'First-contact tip';
    case 'classification':
      return 'Classification label';
    case 'signature':
      return 'Signature';
  }
}
