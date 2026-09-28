// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { isSanitiserAvailable, sanitiseEmailBody } from '../sanitise';
import { splitQuotedHistory } from '../quoting';

// The adversarial half of this suite is the exact payload S12 pushed through Dataverse on
// 2026-09-11 and got back byte-identical. Every block below therefore represents something that
// IS storable in the environment today, not a hypothetical.

describe('the sanitiser is actually running', () => {
  it('reports itself available under a DOM', () => {
    expect(isSanitiserAvailable()).toBe(true);
  });

  it('passes nothing through unchanged', () => {
    expect(sanitiseEmailBody(null)).toEqual({ html: '', modified: false, blockedImages: 0 });
    expect(sanitiseEmailBody(undefined)).toEqual({ html: '', modified: false, blockedImages: 0 });
    expect(sanitiseEmailBody('')).toEqual({ html: '', modified: false, blockedImages: 0 });
  });
});

describe('removes what S12 proved the platform will store', () => {
  const gone = (html: string, needle: string) => {
    const out = sanitiseEmailBody(html).html.toLowerCase();
    expect(out).not.toContain(needle.toLowerCase());
  };

  it('strips inline script', () => {
    gone('<div>hej</div><script>window.__pwned=1</script>', '__pwned');
  });

  it('strips event-handler attributes', () => {
    gone('<img src="x" onerror="window.__pwned=2">', 'onerror');
    gone('<div onmouseover="window.__pwned=2">hover</div>', 'onmouseover');
  });

  it('strips SVG entirely, handlers and all', () => {
    gone('<svg onload="window.__pwned=3"></svg>', 'svg');
  });

  it('strips a javascript: href but keeps the link text', () => {
    const { html } = sanitiseEmailBody('<a href="javascript:window.__pwned=4">klik her</a>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('klik her');
  });

  it('strips iframe, object and embed', () => {
    gone('<iframe src="https://example.invalid/x"></iframe>', 'iframe');
    gone('<object data="https://example.invalid/x"></object>', 'object');
    gone('<embed src="https://example.invalid/x">', 'embed');
  });

  it('strips a credential-harvesting form completely', () => {
    const html = '<form action="https://example.invalid/steal" method="post">' +
      '<input name="pw" type="password"><button>Log ind</button></form>';
    const out = sanitiseEmailBody(html).html.toLowerCase();
    expect(out).not.toContain('<form');
    expect(out).not.toContain('<input');
    expect(out).not.toContain('example.invalid/steal');
  });

  it('strips meta refresh and base', () => {
    gone('<meta http-equiv="refresh" content="0;url=https://example.invalid/x">', 'refresh');
    gone('<base href="https://example.invalid/">', '<base');
  });

  it('strips a data: SVG image, which can carry script', () => {
    const html = '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9J3gnPjwvc3ZnPg==">';
    expect(sanitiseEmailBody(html).html).not.toContain('data:image/svg');
  });

  it('strips data:text/html', () => {
    expect(sanitiseEmailBody('<a href="data:text/html,<h1>x</h1>">x</a>').html).not.toContain('data:text/html');
  });
});

describe('the <style> tag — forbidden because of measured data, not theory', () => {
  // 8 of 12 real received bodies carry one, holding UNSCOPED rules. Left in place they restyle
  // the Dynamics chrome around the control.
  it('removes a stylesheet that would restyle the host app', () => {
    const html = '<style>.ms-Button{display:none!important}p.MsoNormal{margin:0}</style><p>hej</p>';
    const out = sanitiseEmailBody(html).html;
    expect(out).not.toContain('<style');
    expect(out).not.toContain('ms-Button');
    expect(out).toContain('hej');
  });

  it('removes the real Outlook stylesheet shape seen in the environment', () => {
    const html =
      '<style type="text/css" style="display:none"><!-- p {margin-top:0; margin-bottom:0} --></style>' +
      '<div class="elementToProof">Trykprøvningen er gennemført.</div>';
    const out = sanitiseEmailBody(html).html;
    expect(out).not.toContain('<style');
    expect(out).toContain('Trykprøvningen er gennemført.');
    // The class survives — quote and notice detection depend on class surviving.
    expect(out).toContain('elementToProof');
  });
});

describe('keeps what our own features depend on', () => {
  // If any of these fails, R4, R12, R21, R3 or R5 breaks — and it breaks looking like a
  // heuristic bug rather than a sanitiser bug.
  it('KEEPS id, because the quote split matches div#divRplyFwdMsg', () => {
    // Prefixed for display (L10) — the split matches on substring, so it still finds it.
    const shown = sanitiseEmailBody('<div id="divRplyFwdMsg">quoted</div>').html;
    expect(shown).toContain('id="user-content-divRplyFwdMsg"');
    expect(splitQuotedHistory(`<p>new</p>${shown}`).matchedBy).toBe('divRplyFwdMsg');
    // Verbatim for HTML going out.
    const sent = sanitiseEmailBody('<div id="divRplyFwdMsg">quoted</div>', { isolateIds: false }).html;
    expect(sent).toContain('id="divRplyFwdMsg"');
  });

  it('isolates a sender id that would shadow a host global (L10)', () => {
    const out = sanitiseEmailBody('<a id="Xrm" name="opener" href="https://example.invalid">x</a>').html;
    expect(out).not.toMatch(/id="Xrm"|name="opener"/);
  });

  it('drops aria attributes a sender could use to mislead a screen reader (L10)', () => {
    expect(sanitiseEmailBody('<p aria-hidden="true" aria-label="Safe">x</p>').html).not.toContain('aria-');
  });

  it('KEEPS class, because the quote split matches .gmail_quote', () => {
    expect(sanitiseEmailBody('<div class="gmail_quote">quoted</div>').html).toContain('gmail_quote');
  });

  it('KEEPS the Defender banner markers, because R21 matches on them', () => {
    const html = '<div id="ZjQcmQRYFpfptBannerStart">You don\'t often get email from…</div>';
    expect(sanitiseEmailBody(html).html).toContain('ZjQcmQRYFpfptBannerStart');
  });

  it('KEEPS tables and their structure', () => {
    const html = '<table border="1"><thead><tr><th colspan="2">Position</th></tr></thead>' +
      '<tbody><tr><td align="right">485,00</td><td>3 stk</td></tr></tbody></table>';
    const out = sanitiseEmailBody(html).html;
    for (const frag of ['<table', '<thead', '<tbody', '<th', '<td', 'colspan="2"', 'align="right"']) {
      expect(out).toContain(frag);
    }
  });

  it('KEEPS a cid: image reference for later resolution', () => {
    const out = sanitiseEmailBody('<img src="cid:image001@01DC0000.00000000">').html;
    expect(out).toContain('cid:image001');
  });

  it('KEEPS http(s), mailto and tel links', () => {
    const out = sanitiseEmailBody(
      '<a href="https://jensenvvs.example.invalid">web</a>' +
      '<a href="mailto:mbj@jensenvvs.example.invalid">mail</a>' +
      '<a href="tel:+4540123456">ring</a>',
    ).html;
    expect(out).toContain('https://jensenvvs.example.invalid');
    expect(out).toContain('mailto:mbj@');
    expect(out).toContain('tel:+4540123456');
  });

  it('KEEPS Danish and other non-ASCII text intact', () => {
    const out = sanitiseEmailBody('<p>utætte samlinger · trykprøve · Sørensen · ÆØÅ</p>').html;
    expect(out).toContain('utætte samlinger · trykprøve · Sørensen · ÆØÅ');
  });
});

describe('the style attribute — kept, but filtered', () => {
  it('keeps colour, weight and alignment', () => {
    const out = sanitiseEmailBody('<p style="color:#a4262c;font-weight:bold;text-align:right">rød</p>').html;
    expect(out).toContain('color:');
    expect(out).toContain('font-weight:');
    expect(out).toContain('text-align:');
  });

  it('drops positioning, which could cover the application', () => {
    const out = sanitiseEmailBody('<div style="position:fixed;top:0;left:0;color:#000">x</div>').html;
    expect(out).not.toContain('position');
    expect(out).not.toContain('top:');
    expect(out).toContain('color:');
  });

  it('drops url() and expression()', () => {
    const a = sanitiseEmailBody('<div style="background:url(https://example.invalid/track.gif)">x</div>').html;
    expect(a).not.toContain('url(');
    const b = sanitiseEmailBody('<div style="width:expression(alert(1))">x</div>').html;
    expect(b).not.toContain('expression(');
  });

  it('removes the attribute entirely when nothing survives', () => {
    const out = sanitiseEmailBody('<div style="position:absolute">x</div>').html;
    expect(out).not.toContain('style=');
  });
});

describe('links get rel=noopener', () => {
  it('adds target and rel to an external link', () => {
    const out = sanitiseEmailBody('<a href="https://example.invalid/x">ekstern</a>').html;
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it('overwrites an existing target that has no rel', () => {
    // Without rel, window.opener gives the opened page a handle on the Dynamics session window.
    const out = sanitiseEmailBody('<a href="https://example.invalid/x" target="_blank">x</a>').html;
    expect(out).toContain('rel="noopener noreferrer"');
  });
});

describe('whole documents become fragments', () => {
  it('unwraps html/head/body, which is the normal real shape', () => {
    const html =
      '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8">' +
      '<style>p{margin:0}</style></head><body dir="ltr"><div>Hej Kim</div></body></html>';
    const out = sanitiseEmailBody(html).html;
    expect(out).not.toContain('<html');
    expect(out).not.toContain('<head');
    expect(out).not.toContain('<body');
    expect(out).not.toContain('<meta');
    expect(out).not.toContain('<style');
    expect(out).toContain('Hej Kim');
  });
});

describe('the full S12 payload, end to end', () => {
  // Every hostile block from the probe in one body, as it would actually arrive.
  const HOSTILE = [
    '<script>window.__pwned=1</script>',
    '<img src="x" onerror="window.__pwned=2">',
    '<svg onload="window.__pwned=3"></svg>',
    '<a href="javascript:window.__pwned=4">klik</a>',
    '<iframe src="https://example.invalid/x"></iframe>',
    '<object data="https://example.invalid/x"></object>',
    '<form action="https://example.invalid/steal"><input name="pw" type="password"></form>',
    '<style>.ms-Button{display:none}</style>',
    '<meta http-equiv="refresh" content="0;url=https://example.invalid/x">',
    '<base href="https://example.invalid/">',
    '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">',
  ].join('\n');

  const KEEP = [
    '<div id="divRplyFwdMsg">marker</div>',
    '<div class="gmail_quote">marker</div>',
    '<table><tr><th>Position</th><td>485,00</td></tr></table>',
    '<p style="color:#a4262c">rød tekst</p>',
    '<img src="cid:image001@01DC">',
  ].join('\n');

  it('removes every hostile block and keeps every required one', () => {
    const { html, modified } = sanitiseEmailBody(`<html><body>${HOSTILE}\n${KEEP}</body></html>`);
    expect(modified).toBe(true);

    for (const needle of [
      '__pwned', 'onerror', 'onload', 'javascript:', '<iframe', '<object', '<form', '<input',
      '<style', 'refresh', '<base', 'data:image/svg', 'example.invalid/steal',
    ]) {
      expect(html.toLowerCase(), `should have removed ${needle}`).not.toContain(needle.toLowerCase());
    }

    for (const needle of [
      'divRplyFwdMsg', 'gmail_quote', '<table', 'Position', '485,00', 'color:', 'rød tekst',
      'cid:image001',
    ]) {
      expect(html, `should have kept ${needle}`).toContain(needle);
    }
  });

  it('leaves nothing executable behind in a real DOM', () => {
    // The point of the whole module: attach the result to a live document and confirm nothing
    // fires and nothing dangerous survived parsing.
    const { html } = sanitiseEmailBody(`<html><body>${HOSTILE}</body></html>`);
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(host.querySelectorAll('script, iframe, object, embed, form, input, style, svg, base, meta'))
      .toHaveLength(0);
    for (const el of Array.from(host.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.toLowerCase().startsWith('on'), `${el.tagName} kept ${attr.name}`).toBe(false);
      }
    }
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });
});
