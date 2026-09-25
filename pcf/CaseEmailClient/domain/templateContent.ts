/**
 * What comes back from `InstantiateTemplate`, made safe to insert (R14).
 *
 * Measured against the real action on 2026-09-23. It returns
 * `{ value: [ { subject, description } ] }`, and `description` is a **complete HTML document** —
 * `<html><head><meta …></head><body>…</body></html>` — not a fragment. Inserting that into the
 * editor whole would nest a document inside a document; the sanitiser drops `html`/`head`/`body`
 * anyway, so the body content is what we want and taking it deliberately is clearer than relying
 * on that side effect.
 *
 * Tokens ARE resolved server-side: the probe came back with "Dear Metalservice Fyn ApS" and the
 * real case number substituted. But resolution can fail silently, and the design is explicit that
 * an unfillable token must be **visible to the agent rather than posted to a customer** as
 * `{!Case:Title;}` — so anything left unresolved is detected and reported, not quietly inserted.
 */

/** A Dynamics template token that survived instantiation, e.g. `{!Case:Title;}`. */
const UNRESOLVED_TOKEN = /\{!\s*[^}]*?\s*\}/g;

export interface PreparedTemplate {
  /** Body content, ready to insert. Still must be sanitised before it reaches the DOM. */
  html: string;
  subject: string;
  /** Tokens the platform could not fill. Shown to the agent; never silently sent. */
  unresolved: string[];
}

export function prepareTemplate(
  subject: string | null | undefined,
  description: string | null | undefined,
): PreparedTemplate {
  const html = extractBody(description ?? '');
  return {
    html,
    subject: (subject ?? '').trim(),
    unresolved: findUnresolvedTokens(`${subject ?? ''} ${html}`),
  };
}

/**
 * The contents of `<body>`, or the input unchanged when there is no document wrapper.
 *
 * Deliberately a string operation rather than `DOMParser`: parsing and re-serialising would
 * normalise the markup, and normalising template HTML is how carefully-built layouts quietly
 * change shape. The same reasoning as R12's quote handling.
 */
export function extractBody(html: string): string {
  const open = /<body[^>]*>/i.exec(html);
  if (!open) {
    // No <body>. Strip a bare <html>/<head> wrapper if one is there, otherwise pass it through.
    return html.replace(/<\/?(?:html|head|meta|title)[^>]*>/gi, '').trim();
  }
  const start = open.index + open[0].length;
  const closeAt = html.toLowerCase().lastIndexOf('</body>');
  return (closeAt > start ? html.slice(start, closeAt) : html.slice(start)).trim();
}

/** Distinct tokens the platform left behind, in the order they appear. */
export function findUnresolvedTokens(text: string): string[] {
  const seen = new Set<string>();
  UNRESOLVED_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = UNRESOLVED_TOKEN.exec(text)) !== null) seen.add(m[0]);
  return [...seen];
}
