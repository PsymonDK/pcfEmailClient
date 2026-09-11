import { describe, it, expect } from 'vitest';
import { quoteDepth, splitQuotedHistory } from '../quoting';

// R4 / R12. There is no column, marker or API for this — Dataverse stores one HTML blob — so
// this module is a heuristic, and it is recorded as the largest functional risk in the build.
// These are its first tests.
//
// Fixture shapes are real: Outlook's divRplyFwdMsg wrapper with Danish Fra:/Sendt:/Til:/Emne:
// headers is exactly what the demo tenant produces, and 8 of 12 real inbound bodies measured on
// 2026-09-11 are full HTML documents carrying <style> in the head.

const NEW_TEXT = '<div dir="ltr">Tak for trykrapporten. Vi sender en montør i morgen.</div>';

describe('splitQuotedHistory — the invariant', () => {
  // The mechanical guarantee behind "never re-serialise an inherited quote". This module does
  // index slicing and nothing else, so the two halves must reassemble byte-for-byte. If a future
  // change breaks this, R12 is no longer provable and the test must be replaced deliberately
  // rather than deleted.
  const bodies = [
    '',
    NEW_TEXT,
    `${NEW_TEXT}<div id="divRplyFwdMsg"><b>Fra:</b> Care</div>`,
    `${NEW_TEXT}<div class="gmail_quote">quoted</div>`,
    `${NEW_TEXT}<hr><b>Fra:</b> Care &lt;care@x&gt;`,
    `${NEW_TEXT}-----Original Message-----\nFrom: Care`,
    `${NEW_TEXT}<blockquote>quoted</blockquote>`,
    '<html><head><style>p{margin:0}</style></head><body>no quote at all</body></html>',
  ];

  it.each(bodies)('newHtml + quotedHtml reassembles the input exactly', (html) => {
    const { newHtml, quotedHtml } = splitQuotedHistory(html);
    expect(newHtml + quotedHtml).toBe(html);
  });
});

describe('splitQuotedHistory — one case per rule', () => {
  it('rule 1: Outlook divRplyFwdMsg, by id', () => {
    const quote = '<div id="divRplyFwdMsg"><hr><b>Fra:</b> Care<br><b>Sendt:</b> 9. september 2026 15:20<br><b>Til:</b> Morten<br><b>Emne:</b> RE: Reklamation</div>';
    const r = splitQuotedHistory(NEW_TEXT + quote);
    expect(r.matchedBy).toBe('divRplyFwdMsg');
    expect(r.newHtml).toBe(NEW_TEXT);
    expect(r.quotedHtml).toBe(quote);
  });

  it('rule 1: Outlook divRplyFwdMsg, by class', () => {
    const quote = '<div class="x divRplyFwdMsg y">quoted</div>';
    expect(splitQuotedHistory(NEW_TEXT + quote).matchedBy).toBe('divRplyFwdMsg');
  });

  it('rule 2: gmail_quote', () => {
    const quote = '<div class="gmail_quote"><div dir="ltr">On Tue, 9 Sep 2026, Care wrote:</div><blockquote class="gmail_quote">earlier</blockquote></div>';
    const r = splitQuotedHistory(NEW_TEXT + quote);
    expect(r.matchedBy).toBe('gmail_quote');
    expect(r.quotedHtml).toBe(quote);
  });

  it.each([
    ['-----Original Message-----', 'English'],
    ['-----Oprindelig meddelelse-----', 'Danish'],
    ['-----Ursprungliche Nachricht-----', 'German'],
    ['-----Mensaje original-----', 'Spanish'],
    ['-----Originalmeddelande-----', 'Swedish'],
    ['-----Alkuperäinen viesti-----', 'Finnish'],
  ])('rule 3: the original-message delimiter in %s', (marker) => {
    const r = splitQuotedHistory(`${NEW_TEXT}${marker}\nFrom: Care`);
    expect(r.matchedBy).toBe('original-message');
    expect(r.newHtml).toBe(NEW_TEXT);
  });

  it('rule 3: matches the delimiter case-insensitively but cuts at the original casing', () => {
    // lower-casing is only used to FIND the offset; the slice must come out of the original
    // string or the quote is silently altered.
    const r = splitQuotedHistory(`${NEW_TEXT}-----ORIGINAL MESSAGE-----\nFrom: Care`);
    expect(r.matchedBy).toBe('original-message');
    expect(r.quotedHtml).toContain('-----ORIGINAL MESSAGE-----');
  });

  it.each([
    ['Fra', 'Danish'],
    ['From', 'English'],
    ['Von', 'German'],
    ['Lähettäjä', 'Finnish'],
    ['Nadawca', 'Polish'],
  ])('rule 4: an <hr> followed by a bolded %s: header block', (label) => {
    const r = splitQuotedHistory(`${NEW_TEXT}<hr><b>${label}:</b> Care &lt;care@x&gt;<br>`);
    expect(r.matchedBy).toBe('header-block');
    expect(r.newHtml).toBe(NEW_TEXT);
    expect(r.quotedHtml).toMatch(/^<hr>/);
  });

  it('rule 4: also matches <strong> and a standalone label with no <hr>', () => {
    expect(splitQuotedHistory(`${NEW_TEXT}<strong>Fra:</strong> Care`).matchedBy).toBe('header-block');
  });

  it('rule 5: a bare blockquote, last and least', () => {
    const r = splitQuotedHistory(`${NEW_TEXT}<blockquote type="cite">earlier message</blockquote>`);
    expect(r.matchedBy).toBe('blockquote');
  });

  it('no quote at all', () => {
    const r = splitQuotedHistory(NEW_TEXT);
    expect(r.matchedBy).toBe('none');
    expect(r.newHtml).toBe(NEW_TEXT);
    expect(r.quotedHtml).toBe('');
  });

  it('nothing at all', () => {
    for (const empty of [null, undefined, '']) {
      expect(splitQuotedHistory(empty)).toEqual({ newHtml: '', quotedHtml: '', matchedBy: 'none' });
    }
  });
});

describe('splitQuotedHistory — rule precedence', () => {
  it('prefers divRplyFwdMsg over everything else present', () => {
    const html = `${NEW_TEXT}<div id="divRplyFwdMsg">A</div><div class="gmail_quote">B</div><blockquote>C</blockquote>`;
    expect(splitQuotedHistory(html).matchedBy).toBe('divRplyFwdMsg');
  });

  it('prefers gmail_quote over a bare blockquote', () => {
    const html = `${NEW_TEXT}<blockquote>C</blockquote><div class="gmail_quote">B</div>`;
    // Note: gmail wins on RULE order even though the blockquote appears EARLIER in the document.
    // That is deliberate — confidence beats position — and it means newHtml can contain a
    // blockquote. Pinned so the behaviour is a decision, not an accident.
    const r = splitQuotedHistory(html);
    expect(r.matchedBy).toBe('gmail_quote');
    expect(r.newHtml).toContain('<blockquote>');
  });
});

describe('splitQuotedHistory — the cases that will go wrong in the wild', () => {
  it('KNOWN FALSE POSITIVE: a blockquote used for emphasis is treated as a quote', () => {
    // The acknowledged weakest rule. A sender who pull-quotes their own sentence loses it into
    // the fold. It is recoverable — the fold is one click from open, which is exactly why the
    // affordance is visible rather than the content being deleted.
    const html = '<div>Vi mener:</div><blockquote>Arbejdet skal udføres inden fredag.</blockquote><div>Er det muligt?</div>';
    const r = splitQuotedHistory(html);
    expect(r.matchedBy).toBe('blockquote');
    // The trailing question — real new text — ends up in the quoted half. Documented, not fixed.
    expect(r.quotedHtml).toContain('Er det muligt?');
  });

  it('KNOWN FALSE POSITIVE: the marker inside a <style> block still splits', () => {
    // 8 of 12 real inbound bodies carry a <style> tag (measured 2026-09-11), so a sender's
    // stylesheet mentioning the token is a live possibility rather than a contrived one.
    const html = `<html><head><style>/* -----original message----- */p{margin:0}</style></head><body>${NEW_TEXT}</body></html>`;
    const r = splitQuotedHistory(html);
    expect(r.matchedBy).toBe('original-message');
    // The real new text is now in the "quoted" half. This is the strongest argument for
    // re-implementing the split against a parsed DOM once sanitising guarantees well-formed
    // markup — see docs/design/02-component-inventory.md.
    expect(r.quotedHtml).toContain('Tak for trykrapporten');
  });

  it('does not split on divRplyFwdMsg appearing in a non-div element', () => {
    // The rule is anchored to <div, so a mention elsewhere is ignored.
    const html = `${NEW_TEXT}<p>see divRplyFwdMsg for details</p>`;
    expect(splitQuotedHistory(html).matchedBy).toBe('none');
  });

  it('handles a body that is nothing but quote', () => {
    const html = '<div id="divRplyFwdMsg">only quoted history</div>';
    const r = splitQuotedHistory(html);
    expect(r.newHtml).toBe('');
    expect(r.quotedHtml).toBe(html);
  });

  it('handles the first byte being the match', () => {
    // The index-0 case: a falsy offset must not be mistaken for "no match". This is the
    // off-by-one that was found and fixed by hand during the spikes; it now has a test.
    const html = '<div class="gmail_quote">quote first</div>';
    const r = splitQuotedHistory(html);
    expect(r.matchedBy).toBe('gmail_quote');
    expect(r.newHtml).toBe('');
    expect(r.quotedHtml).toBe(html);
  });

  it('handles a full HTML document rather than a fragment', () => {
    // Real bodies are whole documents: <html><head><meta><style>…</head><body>…
    const html = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><style>p{margin:0}</style></head><body>${NEW_TEXT}<div id="divRplyFwdMsg">quoted</div></body></html>`;
    const r = splitQuotedHistory(html);
    expect(r.matchedBy).toBe('divRplyFwdMsg');
    expect(r.newHtml).toContain('<head>');
    expect(r.quotedHtml).toBe('<div id="divRplyFwdMsg">quoted</div></body></html>');
  });
});

describe('quoteDepth', () => {
  it('counts nested Outlook wrappers', () => {
    const html = '<div id="divRplyFwdMsg">a<div id="divRplyFwdMsg">b<div id="divRplyFwdMsg">c</div></div></div>';
    expect(quoteDepth(html)).toBe(3);
  });

  it('counts nested blockquotes', () => {
    expect(quoteDepth('<blockquote><blockquote>deep</blockquote></blockquote>')).toBe(2);
  });

  it('takes the largest of the three signals rather than their sum', () => {
    // Gmail wraps a quote in BOTH a div.gmail_quote and a blockquote, so this is one level of
    // quoting expressed twice. Summing would report 2 and double-count every Gmail reply in a
    // chain; max reports 1, which is the truth. (This test originally asserted 2 — the
    // assertion was wrong, the module was right.)
    const html = '<div class="gmail_quote"><blockquote class="gmail_quote">one level, really</blockquote></div>';
    expect(quoteDepth(html)).toBe(1);
  });

  it('counts a two-deep Gmail chain as two', () => {
    const html =
      '<div class="gmail_quote"><blockquote class="gmail_quote">newer' +
      '<div class="gmail_quote"><blockquote class="gmail_quote">older</blockquote></div>' +
      '</blockquote></div>';
    expect(quoteDepth(html)).toBe(2);
  });

  it('is 0 for no quote and for nothing', () => {
    expect(quoteDepth(NEW_TEXT)).toBe(0);
    expect(quoteDepth(null)).toBe(0);
    expect(quoteDepth(undefined)).toBe(0);
    expect(quoteDepth('')).toBe(0);
  });
});

describe('real Dynamics mail — found in the published app, 2026-09-11', () => {
  // Structurally faithful to the bodies actually stored in the demo environment, anonymised.
  // Every detail below is what broke the original rules:
  //   - the container id is `replyfwdmessage`, Dynamics' OWN marker, NOT Outlook's divRplyFwdMsg
  //   - the delimiter has NINETEEN dashes and spaces: "---…--- Original Message ---…---"
  //   - the bolded `From:` sits ~60 bytes AFTER the delimiter
  const DYNAMICS_REPLY =
    '<div data-wrapper="true" dir="ltr" style="font-family:\'Segoe UI\'; font-size:9pt">' +
    '<p style="margin:0">Venlig hilsen</p><p style="margin:0"><span>Lene</span></p>' +
    '<p style="margin:0">Customer Care</p></div>' +
    '<div dir="ltr" id="replyfwdmessage"><font face="Tahoma, Verdana, Arial" size="2">' +
    '------------------- Original Message -------------------<br>' +
    '<b>From:</b> Morten Bach Jensen &lt;mbj@jensenvvs.example.invalid&gt;; <br>' +
    '<b>Received:</b> Tue Jan 20 2026 15:42:04 GMT+0100<br>' +
    '<b>To:</b> Care Demo &lt;care@example.invalid&gt;;<br>' +
    '<b>Subject:</b> Forespørgsel på ordrestatus</font></div>';

  it('cuts at the Dynamics container, so the delimiter lands INSIDE the fold', () => {
    const r = splitQuotedHistory(DYNAMICS_REPLY);
    expect(r.matchedBy).toBe('divRplyFwdMsg');
    // The bug this fixes: the delimiter line was rendering as new text, above the fold.
    expect(r.newHtml).not.toContain('Original Message');
    expect(r.quotedHtml).toContain('Original Message');
    expect(r.quotedHtml).toMatch(/^<div dir="ltr" id="replyfwdmessage">/);
  });

  it('keeps the agent\'s own sign-off in the new text', () => {
    const r = splitQuotedHistory(DYNAMICS_REPLY);
    expect(r.newHtml).toContain('Venlig hilsen');
    expect(r.newHtml).toContain('Customer Care');
  });

  it('still reassembles exactly', () => {
    const r = splitQuotedHistory(DYNAMICS_REPLY);
    expect(r.newHtml + r.quotedHtml).toBe(DYNAMICS_REPLY);
  });

  it.each([
    '----- Original Message -----',
    '------------------- Original Message -------------------',
    '---Original Message---',
    '----- ORIGINAL MESSAGE -----',
    '----- Oprindelig meddelelse -----',
    '------- Oorspronkelijk bericht -------',
  ])('matches the delimiter as %s when no container wraps it', (delimiter) => {
    // Dash count and spacing are cosmetic and vary by client, so they must not be part of the
    // match. The original literal list required exactly five dashes and no spaces.
    const r = splitQuotedHistory(`<p>Hej</p>${delimiter}<br><b>From:</b> x`);
    expect(r.matchedBy).toBe('original-message');
    expect(r.newHtml).toBe('<p>Hej</p>');
  });

  it('prefers the delimiter over the bolded From: that follows it', () => {
    // Rule 3 must stay above rule 4: the From: is ~60 bytes later, and matching it first
    // strands the delimiter in the new text.
    const html = '<p>Hej</p>----- Original Message -----<br><b>From:</b> someone';
    const r = splitQuotedHistory(html);
    expect(r.matchedBy).toBe('original-message');
    expect(r.newHtml).not.toContain('Original Message');
  });
});
