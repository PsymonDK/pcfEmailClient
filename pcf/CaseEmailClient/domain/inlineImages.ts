/**
 * Inline images: `<img src="cid:…">` in a body, and the attachment rows that hold their bytes.
 *
 * Dataverse extracts every inline image — a signature logo, a pasted screenshot — into an
 * `activitymimeattachment` whose `attachmentcontentid` is the Content-ID the body refers to. A
 * browser cannot fetch `cid:`, so until 2026-09-28 every such image rendered broken: the sanitiser
 * kept the reference ("it still has to be resolved to its stored attachment afterwards") and
 * nothing ever did. Found in the published app on CAS-01130-T1M1W1, where a company logo showed as
 * broken and — correctly — no "Show pictures" offer appeared, because nothing was remote.
 *
 * Resolution runs AFTER sanitising, and only ever writes a raster `data:` URL built here from an
 * allow-listed MIME type and base64 — the same shape the sanitiser itself permits.
 */

/** Content-IDs arrive as `abc@x`, `<abc@x>`, or percent-encoded in the `src`. One spelling. */
export function normaliseCid(raw: string): string {
  let s = raw.trim();
  try { s = decodeURIComponent(s); } catch { /* keep as-is */ }
  return s.replace(/^<|>$/g, '').trim().toLowerCase();
}

const CID_SRC = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])cid:([^"']+)\2/gi;

/** Every Content-ID the body's images refer to, normalised. */
export function cidReferences(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(CID_SRC)) out.add(normaliseCid(m[3]));
  return out;
}

const RASTER = /^image\/(?:png|jpe?g|gif|webp|bmp)$/i;
const BASE64 = /^[A-Za-z0-9+/=\s]*$/;

/**
 * A displayable `data:` URL for an attachment's bytes, or `undefined` if it is not a raster
 * image. SVG is excluded deliberately: it can carry script (the sanitiser refuses it too).
 */
export function toImageDataUrl(mimeType: string, base64: string): string | undefined {
  const mime = mimeType.trim().toLowerCase();
  if (!RASTER.test(mime) || !base64 || !BASE64.test(base64)) return undefined;
  return `data:${mime};base64,${base64.replace(/\s+/g, '')}`;
}

/** Replace each resolvable `cid:` source with its image; leave the rest untouched. */
export function resolveCidImages(html: string, images: ReadonlyMap<string, string>): string {
  if (images.size === 0) return html;
  return html.replace(CID_SRC, (whole, prefix: string, quote: string, cid: string) => {
    const url = images.get(normaliseCid(cid));
    return url ? `${prefix}${quote}${url}${quote}` : whole;
  });
}
