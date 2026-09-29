/**
 * Turning an `emailsignature` row into HTML (R15).
 *
 * **`emailsignature.body` is not HTML.** It is an XSLT stylesheet, and the HTML lives in CDATA
 * sections interleaved with `xsl:value-of` substitutions. The real signature in this environment
 * looks like:
 *
 * ```
 * <![CDATA[ <div>…Venlig hilsen…<span> ]]>
 * <xsl:choose><xsl:when test="systemuser/firstname">
 *   <xsl:value-of select="systemuser/firstname"/>
 * </xsl:when><xsl:otherwise></xsl:otherwise></xsl:choose>
 * <![CDATA[ </span></p><p>Customer Care</p><p>Kvadrat</p></div> ]]>
 * ```
 *
 * So taking **the first** CDATA section — the obvious implementation — yields a truncated
 * signature ending in an unclosed `<span>`, with the agent's name, "Customer Care" and "Kvadrat"
 * all missing. Measured on the real row, 2026-09-23.
 *
 * The substitutions are why the format exists at all: the signature is personalised per sender.
 * We resolve the ones we can and drop the rest, which matches the stylesheet's own
 * `<xsl:otherwise></xsl:otherwise>` — its instruction for "no value" is an empty string.
 */

/** Values available to substitute, keyed by the stylesheet's `select` path. */
export type SignatureValues = Record<string, string | undefined>;

const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
const VALUE_OF = /<xsl:value-of\s+select="([^"]+)"\s*\/>/gi;

/**
 * Extracts the signature HTML, resolving what it can.
 *
 * Returns `''` for anything unusable rather than throwing — a signature that cannot be parsed
 * should cost the agent a signature, never the ability to reply.
 */
export function extractSignatureHtml(body: string | null | undefined, values: SignatureValues = {}): string {
  if (!body) return '';

  // Not every signature is XSLT-wrapped: one saved as plain HTML has no CDATA at all, and should
  // pass through rather than come back empty.
  if (!body.includes('<![CDATA[')) {
    return body.includes('<xsl:') ? '' : body.trim();
  }

  // Walk the stylesheet in order, keeping CDATA content and resolving the substitutions BETWEEN
  // sections. Concatenating the CDATA alone would lose the personalised values; taking only the
  // first loses most of the signature.
  let out = '';
  let cursor = 0;
  CDATA.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CDATA.exec(body)) !== null) {
    out += resolveSubstitutions(body.slice(cursor, match.index), values);
    out += match[1];
    cursor = match.index + match[0].length;
  }
  out += resolveSubstitutions(body.slice(cursor), values);
  return out.trim();
}

/**
 * Resolves `xsl:value-of` in a stretch of stylesheet, discarding the rest of the XSLT.
 *
 * Everything that is not a resolved value is dropped: `xsl:choose`, `xsl:when`, closing tags and
 * the stylesheet wrapper would otherwise land in the agent's editor as literal markup.
 */
function resolveSubstitutions(xslt: string, values: SignatureValues): string {
  if (!xslt.includes('<xsl:')) return '';
  let out = '';
  VALUE_OF.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VALUE_OF.exec(xslt)) !== null) {
    // A VALUE, spliced into HTML — so it is escaped. A user's own name or title containing `<`
    // was inserted as markup until 2026-09-28 (L5).
    out += escapeHtml(values[m[1]] ?? '');
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The editable body a reply starts with: two blank lines, then the signature.
 *
 * The blank lines matter — an agent whose cursor lands *inside* their own signature has to
 * navigate out of it before typing, every single time.
 */
export function initialBodyWithSignature(signatureHtml: string): string {
  if (!signatureHtml) return '';
  return `<p></p><p></p>${signatureHtml}`;
}
