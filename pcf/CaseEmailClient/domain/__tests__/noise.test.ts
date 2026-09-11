import { describe, it, expect } from 'vitest';
import { describeNotice, stripInjectedNotices } from '../noise';

// R21. The fixtures reproduce what was observed in one real round-trip on 2026-09-10: a Defender
// banner, an Outlook first-contact tip, a classification line, the sender's four lines, and a
// signature — in that order, with the actual message fourth.

const REAL_TEXT =
  '<div dir="ltr">Trykprøvningen er nu gennemført på alle tre strenge. ' +
  'Streng 4 og 11 holder 6 bar uden fald.</div>';

const DEFENDER =
  '<div id="ZjQcmQRYFpfptBannerStart" style="background:#fff4ce">' +
  "<b>You don't often get email from kp@ingenior-petersen.example.invalid.</b> " +
  '<a href="https://aka.ms/LearnAboutSenderIdentification">Learn why this is important</a>' +
  '<div id="ZjQcmQRYFpfptBannerEnd"></div></div>';

const TIP =
  '<div style="background:#f3f2f1"><p>Some people who received this message ' +
  "don't often get email from this sender. Learn why this might be important</p></div>";

const CLASSIFICATION = '<p>Classification: Public</p>';

const SIGNATURE =
  '<div><p>Med venlig hilsen</p><p>Kim Petersen<br>Rådgivende ingeniør<br>+45 40 12 34 56</p></div>';

describe('stripInjectedNotices — nothing to do', () => {
  it('handles nothing', () => {
    for (const empty of [null, undefined, '']) {
      expect(stripInjectedNotices(empty)).toEqual({ html: '', notices: [], foldableCount: 0 });
    }
  });

  it('leaves a clean message completely untouched', () => {
    const r = stripInjectedNotices(REAL_TEXT);
    expect(r.html).toBe(REAL_TEXT);
    expect(r.notices).toEqual([]);
    expect(r.foldableCount).toBe(0);
  });
});

describe('the Defender banner — CERTAIN', () => {
  it('removes the whole marked region and keeps the message', () => {
    const r = stripInjectedNotices(DEFENDER + REAL_TEXT);
    expect(r.html).not.toContain('ZjQcmQRYFpfptBanner');
    expect(r.html).not.toContain("don't often get email from");
    expect(r.html).toContain('Trykprøvningen');
    expect(r.notices.map((n) => n.kind)).toContain('defender-banner');
  });

  it('keeps what it removed, verbatim, so the fold can show it', () => {
    const r = stripInjectedNotices(DEFENDER + REAL_TEXT);
    const notice = r.notices.find((n) => n.kind === 'defender-banner');
    expect(notice?.foldable).toBe(true);
    expect(notice?.html).toContain('ZjQcmQRYFpfptBannerStart');
    expect(notice?.html).toContain('Learn why this is important');
  });

  it('leaves no empty wrapper behind', () => {
    // The marker sits INSIDE a div; taking only the marker would leave a hollow element that
    // still renders its background colour as a stray band.
    const r = stripInjectedNotices(DEFENDER + REAL_TEXT);
    expect(r.html).not.toContain('background:#fff4ce');
  });

  it('copes with the end marker being absent', () => {
    const truncated = '<div id="ZjQcmQRYFpfptBannerStart">warning text</div>' + REAL_TEXT;
    const r = stripInjectedNotices(truncated);
    expect(r.html).toContain('Trykprøvningen');
    expect(r.notices.some((n) => n.kind === 'defender-banner')).toBe(true);
  });
});

describe('the first-contact tip — matched on wording', () => {
  it('removes the English tip', () => {
    const r = stripInjectedNotices(TIP + REAL_TEXT);
    expect(r.html).not.toContain('Some people who received this message');
    expect(r.html).toContain('Trykprøvningen');
    expect(r.notices.map((n) => n.kind)).toContain('first-contact-tip');
  });

  it('removes the Danish tip', () => {
    const da = '<div><p>Du modtager ikke ofte e-mail fra denne afsender.</p></div>';
    const r = stripInjectedNotices(da + REAL_TEXT);
    expect(r.notices.map((n) => n.kind)).toContain('first-contact-tip');
  });

  it('does NOT remove a long block that merely mentions the phrase', () => {
    // A customer quoting the warning back at us, or writing about it, is content. The length
    // guard is what separates a tenant banner from a paragraph.
    const long =
      '<div><p>Jeg fik en advarsel der sagde at "you don\'t often get email from" vores ' +
      'adresse, og det bekymrer mig, for vi har skrevet sammen i tre måneder nu. ' +
      'Kan I undersøge om noget er galt med jeres mailserver? Det er vigtigt for os at ' +
      'vores kunder ikke ser den slags advarsler, da det påvirker tilliden til os, og vi ' +
      'har allerede haft to kunder der spurgte om vi var blevet hacket.</p></div>';
    const r = stripInjectedNotices(long + REAL_TEXT);
    expect(r.html).toContain('bekymrer mig');
    expect(r.notices.some((n) => n.kind === 'first-contact-tip')).toBe(false);
  });
});

describe('the classification line — CERTAIN', () => {
  it.each([
    '<p>Classification: Public</p>',
    '<p>Classification: Internal</p>',
    '<p>Sensitivity: Confidential</p>',
    '<p>Klassifikation: Offentlig</p>',
  ])('removes %s', (line) => {
    const r = stripInjectedNotices(line + REAL_TEXT);
    expect(r.notices.map((n) => n.kind)).toContain('classification');
    expect(r.html).toContain('Trykprøvningen');
  });

  it('does not remove a sentence that happens to start with the word', () => {
    const sentence = '<p>Classification of the pipe joints is still pending, see attached report.</p>';
    const r = stripInjectedNotices(sentence + REAL_TEXT);
    expect(r.html).toContain('pipe joints');
    expect(r.notices.some((n) => n.kind === 'classification')).toBe(false);
  });
});

describe('the signature — a GUESS, so never folded', () => {
  it('is detected but left in the body', () => {
    const r = stripInjectedNotices(REAL_TEXT + SIGNATURE);
    const sig = r.notices.find((n) => n.kind === 'signature');
    expect(sig).toBeDefined();
    expect(sig?.foldable).toBe(false);
    // Still present: the UI de-emphasises it, it is not removed.
    expect(r.html).toContain('Med venlig hilsen');
    expect(r.html).toContain('+45 40 12 34 56');
  });

  it('does not count towards the number the fold offers to reveal', () => {
    const r = stripInjectedNotices(DEFENDER + REAL_TEXT + SIGNATURE);
    expect(r.notices).toHaveLength(2);
    expect(r.foldableCount).toBe(1); // the banner only
  });

  it.each([
    'Med venlig hilsen',
    'Kind regards',
    'Mit freundlichen Grüßen',
    'Met vriendelijke groet',
  ])('recognises %s', (opener) => {
    const r = stripInjectedNotices(`${REAL_TEXT}<div><p>${opener}</p><p>Kim</p></div>`);
    expect(r.notices.some((n) => n.kind === 'signature')).toBe(true);
  });

  it('ignores a sign-off phrase in the FIRST half of the body', () => {
    // "Kind regards" quoted mid-message is not this message's signature.
    const body = `<div><p>Kind regards, as they wrote, was how the letter ended.</p></div>${REAL_TEXT}${REAL_TEXT}${REAL_TEXT}`;
    const r = stripInjectedNotices(body);
    expect(r.notices.some((n) => n.kind === 'signature')).toBe(false);
  });
});

describe('all four together — the real round-trip shape', () => {
  const FULL = DEFENDER + TIP + CLASSIFICATION + REAL_TEXT + SIGNATURE;

  it('puts the sender\'s words first and offers three notices', () => {
    const r = stripInjectedNotices(FULL);

    // What the agent now reads first.
    expect(r.html.indexOf('Trykprøvningen')).toBeGreaterThanOrEqual(0);
    expect(r.html).not.toContain('ZjQcmQRYFpfptBanner');
    expect(r.html).not.toContain('Some people who received');
    expect(r.html).not.toContain('Classification: Public');

    // Three foldable, plus the signature reported but kept.
    expect(r.foldableCount).toBe(3);
    expect(r.notices.map((n) => n.kind)).toEqual([
      'defender-banner',
      'first-contact-tip',
      'classification',
      'signature',
    ]);
  });

  it('destroys nothing — every notice is recoverable', () => {
    const r = stripInjectedNotices(FULL);
    for (const notice of r.notices) {
      expect(FULL).toContain(notice.html);
    }
  });

  it('is idempotent', () => {
    // Running it twice must not eat anything further — the UI may re-run it on a re-render.
    const once = stripInjectedNotices(FULL);
    const twice = stripInjectedNotices(once.html);
    expect(twice.html).toBe(once.html);
    expect(twice.foldableCount).toBe(0);
  });
});

describe('describeNotice', () => {
  it('gives every kind a label for the fold summary', () => {
    expect(describeNotice('defender-banner')).toBe('External sender warning');
    expect(describeNotice('first-contact-tip')).toBe('First-contact tip');
    expect(describeNotice('classification')).toBe('Classification label');
    expect(describeNotice('signature')).toBe('Signature');
  });
});
