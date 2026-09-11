import DOMPurify from 'dompurify';

/**
 * Sanitising an email body before it reaches the DOM.
 *
 * This is not a hardening measure to be deferred. Message bodies are written by people outside the
 * organisation and land in a page holding the agent's own authenticated Dynamics session, so
 * rendering one unsanitised is stored cross-site-scripting with the agent's permissions behind it.
 *
 * **Measured, 2026-09-11 (S12): Dataverse sanitises nothing.** 1442 bytes of hostile HTML written
 * to `email.description` came back byte-identical, with all 17 probe blocks intact — script, event
 * handlers, a credential-harvesting form, `javascript:` hrefs, iframes, a data: SVG carrying
 * script. The platform presumably sanitises inside its own controls at render time; we render the
 * body ourselves, so this is ours to do.
 *
 * Pipeline order is fixed: **sanitise → split quoted history → strip injected notices → render.**
 * Sanitising first is the only order in which hostile markup never reaches code that indexes into
 * the string, and DOMPurify's parse-and-reserialise normalises malformed sender HTML so the
 * downstream heuristics see well-formed markup.
 */

/**
 * Tags kept. Conservative, but everything here is load-bearing for real mail:
 * `table` and friends because half of B2B email is a table; `font`/`center` because Outlook still
 * emits them; `blockquote` because the quote heuristic needs it to survive.
 */
const ALLOWED_TAGS = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'center', 'code', 'col', 'colgroup', 'dd',
  'del', 'div', 'dl', 'dt', 'em', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img',
  'ins', 'li', 'ol', 'p', 'pre', 's', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody',
  'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'wbr',
];

/**
 * Attributes kept.
 *
 * **`id` and `class` are not optional.** The quoted-history split matches on
 * `div#divRplyFwdMsg` and `.gmail_quote`, and the injected-notice strip matches on the Defender
 * `ZjQcmQRYFpfptBanner…` markers. DOMPurify's defaults would drop both attributes, which disables
 * R4, R12 and R21 at once — silently, and in a way that looks like the heuristics are broken
 * rather than the sanitiser. This is the single most likely "why does nothing work" bug here.
 */
const ALLOWED_ATTR = [
  'align', 'alt', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'class', 'color', 'colspan',
  'dir', 'face', 'height', 'href', 'id', 'lang', 'name', 'rowspan', 'size', 'span', 'src',
  'start', 'style', 'title', 'type', 'valign', 'width',
];

/**
 * Tags removed outright, content and all.
 *
 * **`style` is in this list because of measured data, not theory.** 8 of 12 real received bodies
 * carry a `<style>` tag holding *unscoped* rules — `p.MsoNormal { margin: 0 }`,
 * `.EmailQuote { border-left: #800000 2px solid }`, `@font-face` declarations. A sender's
 * stylesheet has no scope, so left in place it restyles the Dynamics chrome around us.
 *
 * `head`, `meta`, `base` and `title` go the same way: real bodies are whole HTML documents, and
 * injecting a document into a div would otherwise hoist its head content into the host page.
 */
const FORBID_TAGS = [
  'base', 'button', 'embed', 'form', 'head', 'html', 'iframe', 'input', 'link', 'math', 'meta',
  'noscript', 'object', 'option', 'script', 'select', 'style', 'svg', 'template', 'textarea',
  'title', 'video', 'audio', 'source', 'track',
];

const FORBID_ATTR = ['srcdoc', 'formaction', 'action', 'ping', 'http-equiv'];

/**
 * URL schemes allowed anywhere in the body.
 *
 * `cid:` is permitted so the `<img>` survives sanitising — a browser cannot fetch it, so it still
 * has to be resolved to its stored attachment afterwards.
 */
const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|tel:|cid:|data:image\/)/i;

/**
 * The attributes that are NOT URLs, declared so DOMPurify stops URL-checking them.
 *
 * This is not a nicety. A custom `ALLOWED_URI_REGEXP` is tested against **every** attribute value
 * that DOMPurify does not already know to be URL-free — so `border="1"`, `colspan="2"` and
 * `align="right"` all failed the pattern and were silently dropped, quietly destroying every table
 * we are meant to render faithfully (R3). Caught by test on 2026-09-11, after the attribute was
 * already in ALLOWED_ATTR and therefore looked safe.
 *
 * Derived from ALLOWED_ATTR rather than hand-listed, so adding an attribute above cannot
 * reintroduce the bug. Only `href` and `src` are left to the URL check, which is what we want.
 */
const NON_URI_ATTR = ALLOWED_ATTR.filter((attr) => attr !== 'href' && attr !== 'src');

/**
 * Raster images only, and this is enforced in the hook rather than by the regexp above.
 *
 * Deliberately excludes `data:image/svg+xml`, because an SVG can carry script, and
 * `data:text/html`, because that is a page.
 */
const SAFE_DATA_URI = /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/=]*$/i;

/**
 * Whitespace and C0/C1 control characters, used to defeat filter-evasion padding.
 *
 * Matching control characters IS the point here: browsers ignore them inside a URL, so a filter
 * that does not strip them first can simply be walked past.
 */
// eslint-disable-next-line no-control-regex
const BLANKS = /[\u0000-\u0020\u007F-\u009F]/g;

/**
 * CSS properties kept in a `style` attribute. Senders colour and align things deliberately and it
 * carries meaning, so the attribute stays — but positioning is dropped, because
 * `position: fixed` in a message body can cover the application around it.
 */
const ALLOWED_CSS_PROPS = new Set([
  'background', 'background-color', 'border', 'border-bottom', 'border-collapse', 'border-color',
  'border-left', 'border-radius', 'border-right', 'border-spacing', 'border-style', 'border-top',
  'border-width', 'color', 'direction', 'display', 'font', 'font-family', 'font-size',
  'font-style', 'font-variant', 'font-weight', 'height', 'letter-spacing', 'line-height',
  'list-style', 'list-style-type', 'margin', 'margin-bottom', 'margin-left', 'margin-right',
  'margin-top', 'max-width', 'min-width', 'padding', 'padding-bottom', 'padding-left',
  'padding-right', 'padding-top', 'text-align', 'text-decoration', 'text-indent',
  'text-transform', 'vertical-align', 'white-space', 'width', 'word-break', 'word-wrap',
]);

let hooksInstalled = false;

function installHooks(): void {
  if (hooksInstalled) return;

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;

    // Links: without rel="noopener", a link in hostile mail gets a handle on the Dynamics session
    // window through window.opener.
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }

    // data: URIs are checked HERE, not left to ALLOWED_URI_REGEXP.
    //
    // DOMPurify treats a handful of tags (img, video, audio, source, track, image) as
    // "DATA_URI_TAGS" and permits `data:` on them irrespective of ALLOWED_URI_REGEXP — so a
    // `data:image/svg+xml`, which can carry script, sails straight past the regexp. Caught by test
    // on 2026-09-11; the regexp alone gave a false sense of coverage.
    for (const attr of ['src', 'href']) {
      const value = node.getAttribute(attr);
      if (!value) continue;
      // Padding with spaces, tabs or control bytes ("data: image/svg+xml") is a classic
      // filter-evasion trick; browsers ignore those bytes, so we must too before testing.
      const collapsed = value.replace(BLANKS, '');
      if (/^data:/i.test(collapsed) && !SAFE_DATA_URI.test(collapsed)) {
        node.removeAttribute(attr);
      }
    }

    // Style attribute: keep the declarations that carry meaning, drop the ones that can escape
    // the message. DOMPurify does not parse CSS property-by-property, so this is ours.
    const style = node.getAttribute('style');
    if (style) {
      const kept = style
        .split(';')
        .map((decl) => decl.trim())
        .filter((decl) => decl.length > 0)
        .filter((decl) => {
          const colon = decl.indexOf(':');
          if (colon < 0) return false;
          const prop = decl.slice(0, colon).trim().toLowerCase();
          const value = decl.slice(colon + 1).toLowerCase();
          if (!ALLOWED_CSS_PROPS.has(prop)) return false;
          // A url() would fetch from wherever the sender chose, which is also a read receipt.
          if (value.includes('url(')) return false;
          // expression() is an old IE script vector, and free to exclude.
          if (value.includes('expression(')) return false;
          return true;
        });
      if (kept.length > 0) node.setAttribute('style', kept.join('; '));
      else node.removeAttribute('style');
    }
  });

  hooksInstalled = true;
}

export interface SanitiseResult {
  /** The safe HTML. A fragment — `html`, `head` and `body` wrappers are gone. */
  html: string;
  /** True when the sanitiser changed anything. Diagnostics only; not shown to agents. */
  modified: boolean;
}

/**
 * Sanitises an email body. Returns a fragment, never a document.
 *
 * This does NOT solve layout containment. Sanitising stops script; it does nothing about a
 * 1400px-wide Outlook table, a 96px heading, or a sender who sets white text. The rendering
 * container handles those separately — see docs/design/03-interaction-spec.md.
 */
export function sanitiseEmailBody(html: string | null | undefined): SanitiseResult {
  if (!html) return { html: '', modified: false };

  installHooks();

  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS,
    FORBID_ATTR,
    ALLOWED_URI_REGEXP,
    ADD_URI_SAFE_ATTR: NON_URI_ATTR,
    // NO `USE_PROFILES` here. Setting it makes DOMPurify IGNORE ALLOWED_TAGS and ALLOWED_ATTR and
    // use the profile's lists instead, which silently dropped `colspan` from table cells and
    // re-permitted data: URIs on <img>. Caught by test on 2026-09-11. The explicit lists above
    // are the contract; do not add a profile alongside them.
    //
    // Return a fragment: real bodies are whole documents, and keeping the wrapper would put a
    // second <html> inside the host page.
    WHOLE_DOCUMENT: false,
    // data-* attributes are not needed by mail and are a needless surface.
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
  });

  return { html: clean, modified: clean !== html };
}

/**
 * Is the sanitiser able to run at all? DOMPurify needs a DOM, which a PCF always has — but making
 * the dependency explicit means a host without one fails loudly here rather than quietly
 * rendering something unsafe.
 */
export function isSanitiserAvailable(): boolean {
  return typeof DOMPurify.sanitize === 'function' && DOMPurify.isSupported;
}
