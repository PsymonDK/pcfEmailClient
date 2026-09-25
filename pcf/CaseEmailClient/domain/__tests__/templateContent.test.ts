import { describe, it, expect } from 'vitest';
import { extractBody, findUnresolvedTokens, prepareTemplate } from '../templateContent';

/** Shaped like the real `InstantiateTemplate` response, measured 2026-09-23. */
const REAL_DESCRIPTION =
  '<html>\n<head>\n<meta http-equiv="Content-Type" content="text/html; charset=utf-8">\n</head>\n'
  + '<body>\n<p>Dear Metalservice Fyn ApS,</p>\n'
  + '<p>According to our records, your request has been fulfilled and the case '
  + 'FG-2026-0022 - Metalservice Fyn ApS - Mette Nielsen is now closed.</p>\n</body>\n</html>';

describe('extractBody', () => {
  it('takes the body out of a full document', () => {
    // The action returns a complete <html> document, not a fragment. Inserting it whole would
    // nest a document inside the editor's document.
    const body = extractBody(REAL_DESCRIPTION);
    expect(body).toContain('Dear Metalservice Fyn ApS');
    expect(body).not.toContain('<html');
    expect(body).not.toContain('<head');
    expect(body).not.toContain('<meta');
    expect(body).not.toContain('</body>');
  });

  it('keeps the resolved values the platform substituted', () => {
    expect(extractBody(REAL_DESCRIPTION)).toContain('FG-2026-0022');
  });

  it('passes a plain fragment through unchanged', () => {
    expect(extractBody('<p>Just a fragment</p>')).toBe('<p>Just a fragment</p>');
  });

  it('strips a bare wrapper when there is no body tag', () => {
    expect(extractBody('<html><head><title>x</title></head><p>hi</p></html>')).toContain('<p>hi</p>');
    expect(extractBody('<html><head><title>x</title></head><p>hi</p></html>')).not.toContain('<html');
  });

  it('survives a body tag with attributes', () => {
    expect(extractBody('<body style="margin:0"><p>hi</p></body>')).toBe('<p>hi</p>');
  });

  it('uses the LAST closing body tag, so a literal one in the text does not truncate', () => {
    const tricky = '<body><p>about &lt;/body&gt; tags</p></body>';
    expect(extractBody(tricky)).toContain('about');
  });

  it('handles an empty or missing description', () => {
    expect(extractBody('')).toBe('');
  });
});

describe('findUnresolvedTokens — R14’s honesty requirement', () => {
  it('finds a token the platform could not fill', () => {
    // The design is explicit: an unfillable token must be visible to the agent rather than posted
    // to a customer as {!Case:Title;}.
    expect(findUnresolvedTokens('Hello {!Case:Title;} there')).toEqual(['{!Case:Title;}']);
  });

  it('reports each distinct token once, in order', () => {
    const found = findUnresolvedTokens('{!a;} {!b;} {!a;}');
    expect(found).toEqual(['{!a;}', '{!b;}']);
  });

  it('finds nothing in fully resolved content', () => {
    expect(findUnresolvedTokens(extractBody(REAL_DESCRIPTION))).toEqual([]);
  });

  it('does not mistake ordinary braces for a token', () => {
    expect(findUnresolvedTokens('function x() { return 1; }')).toEqual([]);
    expect(findUnresolvedTokens('{"json": true}')).toEqual([]);
  });
});

describe('prepareTemplate', () => {
  it('returns body, subject and no tokens for the real response', () => {
    const out = prepareTemplate('Your case has been closed', REAL_DESCRIPTION);
    expect(out.subject).toBe('Your case has been closed');
    expect(out.html).toContain('Dear Metalservice Fyn ApS');
    expect(out.unresolved).toEqual([]);
  });

  it('reports a token left in the SUBJECT, not just the body', () => {
    const out = prepareTemplate('Re: {!Case:Title;}', '<body><p>ok</p></body>');
    expect(out.unresolved).toEqual(['{!Case:Title;}']);
  });

  it('copes with nulls from the platform', () => {
    const out = prepareTemplate(null, null);
    expect(out).toEqual({ html: '', subject: '', unresolved: [] });
  });
});
