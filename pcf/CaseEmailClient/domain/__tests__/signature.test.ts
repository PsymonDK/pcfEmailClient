import { describe, it, expect } from 'vitest';
import { extractSignatureHtml, initialBodyWithSignature } from '../signature';

/**
 * The REAL `emailsignature.body` from the demo environment, byte for byte (2026-09-23).
 *
 * Kept verbatim because the whole point of these tests is the shape nobody would invent: two
 * CDATA sections with an `xsl:choose` between them. A hand-written fixture would have had one
 * section and every test would have passed on a broken extractor.
 */
const REAL_SIGNATURE =
  '<?xml version="1.0" ?><xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" '
  + 'version="1.0"><xsl:output method="text" indent="no"/><xsl:template match="/data">'
  + '<![CDATA[<div data-wrapper="true" dir="ltr" style="font-family: &quot;Segoe UI&quot;; '
  + 'font-size: 9pt;"><p style="margin: 0;">Venlig hilsen</p><p style="margin: 0;"><span>]]>'
  + '<xsl:choose><xsl:when test="systemuser/firstname">'
  + '<xsl:value-of select="systemuser/firstname" /></xsl:when>'
  + '<xsl:otherwise></xsl:otherwise></xsl:choose>'
  + '<![CDATA[</span></p><p style="margin: 0;">Customer Care</p>'
  + '<p style="margin: 0;">Kvadrat</p></div>]]></xsl:template></xsl:stylesheet>';

describe('extractSignatureHtml — the real stylesheet', () => {
  it('keeps EVERY CDATA section, not just the first', () => {
    // The bug this exists for: taking the first section yields a truncated signature ending in an
    // unclosed <span>, with "Customer Care" and "Kvadrat" silently missing.
    const html = extractSignatureHtml(REAL_SIGNATURE);
    expect(html).toContain('Venlig hilsen');
    expect(html).toContain('Customer Care');
    expect(html).toContain('Kvadrat');
  });

  it('produces balanced markup', () => {
    const html = extractSignatureHtml(REAL_SIGNATURE);
    expect((html.match(/<span>/g) ?? []).length).toBe((html.match(/<\/span>/g) ?? []).length);
    expect((html.match(/<div/g) ?? []).length).toBe((html.match(/<\/div>/g) ?? []).length);
    expect(html.startsWith('<div')).toBe(true);
    expect(html.endsWith('</div>')).toBe(true);
  });

  it('substitutes the value the stylesheet asks for, in the right place', () => {
    const html = extractSignatureHtml(REAL_SIGNATURE, { 'systemuser/firstname': 'Simon' });
    expect(html).toContain('<span>Simon</span>');
  });

  it('escapes a substituted value — it is text, not markup (L5)', () => {
    const html = extractSignatureHtml(REAL_SIGNATURE, {
      'systemuser/firstname': '<img src=x onerror=alert(1)> & Co',
    });
    expect(html).toContain('<span>&lt;img src=x onerror=alert(1)&gt; &amp; Co</span>');
    expect(html).not.toContain('<img');
  });

  it('leaves the slot empty when the value is unknown, as the stylesheet itself says', () => {
    // `<xsl:otherwise></xsl:otherwise>` — its own instruction for "no value" is an empty string.
    expect(extractSignatureHtml(REAL_SIGNATURE)).toContain('<span></span>');
  });

  it('never leaks XSLT into the agent’s editor', () => {
    const html = extractSignatureHtml(REAL_SIGNATURE, { 'systemuser/firstname': 'Simon' });
    expect(html).not.toContain('xsl:');
    expect(html).not.toContain('CDATA');
    expect(html).not.toContain('<?xml');
  });
});

describe('extractSignatureHtml — the shapes that are not that', () => {
  it('passes plain HTML through unchanged', () => {
    const plain = '<div><p>Kind regards</p></div>';
    expect(extractSignatureHtml(plain)).toBe(plain);
  });

  it('returns empty for XSLT with no CDATA at all rather than emitting markup', () => {
    expect(extractSignatureHtml('<xsl:stylesheet><xsl:template/></xsl:stylesheet>')).toBe('');
  });

  it('returns empty for nothing', () => {
    expect(extractSignatureHtml('')).toBe('');
    expect(extractSignatureHtml(null)).toBe('');
    expect(extractSignatureHtml(undefined)).toBe('');
  });

  it('handles a single CDATA section', () => {
    expect(extractSignatureHtml('<xsl:template><![CDATA[<p>Hi</p>]]></xsl:template>'))
      .toBe('<p>Hi</p>');
  });

  it('handles three sections with two substitutions', () => {
    const three =
      '<![CDATA[<p>]]><xsl:value-of select="a" /><![CDATA[ and ]]>'
      + '<xsl:value-of select="b" /><![CDATA[</p>]]>';
    expect(extractSignatureHtml(three, { a: 'X', b: 'Y' })).toBe('<p>X and Y</p>');
  });
});

describe('initialBodyWithSignature', () => {
  it('puts blank lines above the signature so the cursor is not inside it', () => {
    // An agent whose cursor lands inside their own signature has to navigate out of it before
    // typing, every single time.
    const body = initialBodyWithSignature('<div>sig</div>');
    expect(body.indexOf('<p></p>')).toBeLessThan(body.indexOf('<div>sig</div>'));
    expect((body.match(/<p><\/p>/g) ?? []).length).toBe(2);
  });

  it('adds nothing when there is no signature', () => {
    expect(initialBodyWithSignature('')).toBe('');
  });
});
