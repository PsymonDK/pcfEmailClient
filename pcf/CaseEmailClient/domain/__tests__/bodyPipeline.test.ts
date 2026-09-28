// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { prepareBody } from '../bodyPipeline';
import { sanitiseEmailBody } from '../sanitise';

/** Parse a string the way `innerHTML` would, and report anything that could run. */
function liveHazards(html: string): string[] {
  const host = document.createElement('div');
  host.innerHTML = html;
  const found: string[] = [];
  for (const el of Array.from(host.querySelectorAll('*'))) {
    if (el.tagName === 'SCRIPT') found.push('script');
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) found.push(`${el.tagName.toLowerCase()}[${attr.name}]`);
    }
  }
  return found;
}

describe('prepareBody — every piece that reaches the DOM is safe as parsed (M5)', () => {
  it('a quote marker inside an attribute cannot smuggle markup into the quote', () => {
    // DOMPurify keeps this whole — it is an inert attribute. The splitter then cuts INSIDE the
    // attribute value at the marker, and before the re-sanitise the quoted half re-parsed into a
    // live img[onerror] (reproduced in jsdom on 2026-09-28).
    const raw = '<p title="--- Original Message --- <img src=x onerror=alert(1)>">hi</p>';
    const out = prepareBody(raw);
    expect(liveHazards(out.newHtml)).toEqual([]);
    expect(liveHazards(out.quotedHtml)).toEqual([]);
  });

  it('a notice marker inside an attribute cannot smuggle markup into the notice fold', () => {
    const raw = '<p title="ZjQcmQRYFpfptBannerStart <img src=x onerror=alert(1)>">hi</p>'
      + '<p>body</p>';
    const out = prepareBody(raw);
    for (const piece of [out.newHtml, out.quotedHtml, ...out.notices.map((n) => n.html)]) {
      expect(liveHazards(piece)).toEqual([]);
    }
  });

  it('still splits a real reply and keeps both halves', () => {
    const raw = '<p>Tak</p><div id="divRplyFwdMsg"><b>From:</b> x</div><p>old</p>';
    const out = prepareBody(raw);
    expect(out.newHtml).toContain('Tak');
    expect(out.quotedHtml).toContain('old');
    expect(out.quoteDepthLabel).toBe('1 earlier message');
  });
});

describe('remote images (M4)', () => {
  const raw = '<p>Logo</p><img src="https://tracker.example.invalid/p.gif?case=1" alt="logo">'
    + '<img src="cid:image001@01DC">';

  it('holds remote images back by default, and counts them', () => {
    const out = prepareBody(raw);
    expect(out.newHtml).not.toContain('tracker.example.invalid');
    expect(out.newHtml).toContain('cid:image001');
    expect(out.blockedImages).toBe(1);
  });

  it('loads them when the agent asks', () => {
    const out = prepareBody(raw, { allowRemoteImages: true });
    expect(out.newHtml).toContain('tracker.example.invalid');
    expect(out.blockedImages).toBe(0);
  });

  it('never sends a Referer with an image request', () => {
    const out = sanitiseEmailBody(raw, { allowRemoteImages: true }).html;
    expect(out).toContain('referrerpolicy="no-referrer"');
  });
});

describe('CSS fetches — an allow-list, not a substring check (M4)', () => {
  // Each of these resolved to a remote URL in Chromium 152 while the filter looked for "url(".
  it.each([
    'background: u\\rl(https://evil.example.invalid/p.png)',
    'background: \\75 rl(https://evil.example.invalid/p.png)',
    "background: image-set('https://evil.example.invalid/p.png' 1x)",
    "list-style: image-set('https://evil.example.invalid/p.png' 1x)",
    'background: url(https://evil.example.invalid/p.png)',
    'width: expression(alert(1))',
  ])('drops %s', (decl) => {
    const out = sanitiseEmailBody(`<div style="${decl}">x</div>`).html;
    expect(out).not.toContain('evil.example.invalid');
    expect(out).not.toMatch(/expression|image-set|\\/);
  });

  it('keeps colour functions', () => {
    const out = sanitiseEmailBody('<p style="color: rgb(200, 0, 0); background-color: hsla(0,0%,90%,1)">x</p>').html;
    expect(out).toContain('rgb(200, 0, 0)');
    expect(out).toContain('hsla(');
  });
});
