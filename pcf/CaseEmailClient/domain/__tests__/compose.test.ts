// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  buildOutgoingBody, buildQuotedBlock, composeSubject, headerFor, QUOTE_CONTAINER_ID,
  resolveRecipients, roundTrips, stripQuoteMarkers, type OriginalParties,
} from '../compose';
import { splitQuotedHistory } from '../quoting';

const p = (name: string, address: string) => ({ name, address });

const CUSTOMER = p('Mette Nielsen', 'mette@metalservice.example.invalid');
const COLLEAGUE = p('Søren Madsen', 'soren@nordbyg.example.invalid');
const CARE = p('Care', 'care@example.invalid');
const AGENT = p('Simon Jehrbo', 'simon.jehrbo@example.com');

const OURS = [CARE.address, AGENT.address];

const original: OriginalParties = {
  sender: CUSTOMER,
  to: [CARE],
  cc: [COLLEAGUE],
};

describe('resolveRecipients — R9', () => {
  it('reply goes to the sender only', () => {
    expect(resolveRecipients('reply', original, OURS)).toEqual({ to: [CUSTOMER], cc: [] });
  });

  it('reply-all keeps the original To in To and the Cc in Cc', () => {
    const out = resolveRecipients('replyAll', original, OURS);
    expect(out.to).toEqual([CUSTOMER]);   // CARE is us, so it drops out of To
    expect(out.cc).toEqual([COLLEAGUE]);
  });

  it('EXCLUDES us from both To and Cc', () => {
    // A support mailbox that replies to itself is a mail loop, not a cosmetic problem.
    const withUsEverywhere: OriginalParties = {
      sender: CUSTOMER, to: [CARE, COLLEAGUE], cc: [AGENT],
    };
    const out = resolveRecipients('replyAll', withUsEverywhere, OURS);
    expect(out.to.map((r) => r.address)).toEqual([CUSTOMER.address, COLLEAGUE.address]);
    expect(out.cc).toEqual([]);
  });

  it('matches our addresses case-insensitively and ignores surrounding space', () => {
    const shouty: OriginalParties = { sender: CUSTOMER, to: [p('Care', '  care@example.invalid ')], cc: [] };
    expect(resolveRecipients('replyAll', shouty, OURS).to).toEqual([CUSTOMER]);
  });

  it('forward addresses NOBODY', () => {
    // Silently carrying the original recipients into a forward is how mail reaches people it was
    // never meant to.
    expect(resolveRecipients('forward', original, OURS)).toEqual({ to: [], cc: [] });
  });

  it('de-duplicates a person who appears twice, keeping the first slot', () => {
    const dupe: OriginalParties = {
      sender: CUSTOMER,
      to: [p('M. Nielsen', 'METTE@metalservice.example.invalid')],
      cc: [p('Mette', 'mette@metalservice.example.invalid')],
    };
    const out = resolveRecipients('replyAll', dupe, OURS);
    expect(out.to).toEqual([CUSTOMER]);   // the sender's name won, not the To or Cc copy
    expect(out.cc).toEqual([]);
  });

  it('survives a message with no sender', () => {
    expect(resolveRecipients('reply', { to: [CUSTOMER], cc: [] }, OURS)).toEqual({ to: [], cc: [] });
  });

  it('skips blank addresses rather than emitting an empty recipient', () => {
    const blank: OriginalParties = { sender: p('Nobody', '   '), to: [CUSTOMER], cc: [] };
    expect(resolveRecipients('replyAll', blank, OURS).to).toEqual([CUSTOMER]);
  });

  it('replying to our own sent mail leaves To empty rather than addressing ourselves', () => {
    expect(resolveRecipients('reply', { sender: CARE, to: [CUSTOMER], cc: [] }, OURS).to).toEqual([]);
  });
});

describe('R12 — the closed loop', () => {
  const NEW = '<p>Tak for din henvendelse.</p>';
  const ORIGINAL_BODY = '<div><p>Hej Kvadrat team,</p><p>Kan I bekræfte?</p></div>';
  const header = {
    from: 'Mette Nielsen <mette@metalservice.example.invalid>',
    sent: '20-01-2026 15:42',
    to: 'Care <care@example.invalid>',
    subject: 'Forespørgsel på ordrestatus',
  };

  it('splitting our own message returns BOTH halves byte-for-byte', () => {
    // This is the whole of R12. If it fails, an outgoing message cannot survive being read back
    // by our own reader.
    const quoted = buildQuotedBlock(header, ORIGINAL_BODY);
    const sent = buildOutgoingBody(NEW, quoted);
    const split = splitQuotedHistory(sent);

    expect(split.newHtml).toBe(NEW);
    expect(split.quotedHtml).toBe(quoted);
    expect(split.matchedBy).toBe('divRplyFwdMsg');
  });

  it('keeps a clean original body byte-identical inside the quote', () => {
    // Sanitised once, and sanitising well-formed mail must not alter it: every transformation is
    // a chance to alter a business document.
    const quoted = buildQuotedBlock(header, ORIGINAL_BODY);
    expect(quoted).toContain(ORIGINAL_BODY);
  });

  it('sanitises the original body — it is the sender\'s raw HTML (C1, 2026-09-28)', () => {
    // The body arrives exactly as Dataverse stores it, and S12 measured that the platform
    // sanitises nothing. Before this, Reply → expand quote ran the sender's script as the agent.
    const hostile = '<p>Hej</p><img src=x onerror="alert(1)"><script>alert(2)</script>'
      + '<a href="javascript:alert(3)">link</a><style>body{display:none}</style>'
      + '<form action="https://evil.example"><input type="password"></form>';
    const quoted = buildQuotedBlock(header, hostile);
    expect(quoted).toContain('<p>Hej</p>');
    expect(quoted).not.toMatch(/onerror|<script|javascript:|<style|<form|<input/i);
  });

  it('still round-trips after sanitising a hostile body', () => {
    const quoted = buildQuotedBlock(header, '<p>x</p><img src=x onerror="alert(1)">');
    expect(roundTrips(NEW, quoted)).toBe(true);
  });

  it('round-trips a quote that ALREADY contains a quote', () => {
    // The third reply in a chain. The inherited block carries its own container; we wrap once
    // more, and the split must still cut at ours.
    const inner = buildQuotedBlock(header, ORIGINAL_BODY);
    const secondReply = buildOutgoingBody('<p>Andet svar</p>', inner);
    const outer = buildQuotedBlock({ ...header, sent: '21-01-2026 09:00' }, secondReply);
    const third = buildOutgoingBody('<p>Tredje svar</p>', outer);

    const split = splitQuotedHistory(third);
    expect(split.newHtml).toBe('<p>Tredje svar</p>');
    expect(split.quotedHtml).toBe(outer);
  });

  it('round-trips through the guard function too', () => {
    expect(roundTrips(NEW, buildQuotedBlock(header, ORIGINAL_BODY))).toBe(true);
  });

  it('handles an empty quote — a brand new message has none', () => {
    expect(buildOutgoingBody(NEW)).toBe(NEW);
    expect(buildOutgoingBody(NEW, '')).toBe(NEW);
  });

  it('escapes the header values so a name with markup cannot break out', () => {
    const nasty = buildQuotedBlock({ ...header, from: '<img src=x onerror=alert(1)>' }, ORIGINAL_BODY);
    expect(nasty).not.toContain('<img');
    expect(nasty).toContain('&lt;img');
  });

  it('includes Cc only when there is one', () => {
    expect(buildQuotedBlock(header, '')).not.toContain('Cc:');
    expect(buildQuotedBlock({ ...header, cc: 'Søren' }, '')).toContain('Cc:');
  });
});

describe('stripQuoteMarkers — the paste trap', () => {
  it('neutralises our marker inside text the agent pasted', () => {
    // splitQuotedHistory cuts at the FIRST marker. Pasting a previous reply into a new one would
    // otherwise move half the new text into the fold, silently.
    const pasted = `<p>before</p><div id="${QUOTE_CONTAINER_ID}">pasted old quote</div><p>after</p>`;
    const quoted = buildQuotedBlock({ from: 'a', sent: 'b', to: 'c', subject: 'd' }, '<p>orig</p>');
    const sent = buildOutgoingBody(pasted, quoted);

    const split = splitQuotedHistory(sent);
    // The cut lands on OUR block, so everything the agent wrote survives in the new text.
    expect(split.quotedHtml).toBe(quoted);
    expect(split.newHtml).toContain('before');
    expect(split.newHtml).toContain('after');
  });

  it('renames rather than deletes, so pasted content is not destroyed', () => {
    const out = stripQuoteMarkers(`<div id="${QUOTE_CONTAINER_ID}">keep me</div>`);
    expect(out).toContain('keep me');
    // The behaviour that matters: the splitter no longer sees a container here. Asserting the
    // replacement STRING would have passed for `divRplyFwdMsg-quoted`, which still contains the
    // marker and still matched — the bug this test exists for.
    expect(splitQuotedHistory(out).matchedBy).not.toBe('divRplyFwdMsg');
  });

  it('catches the marker in a class as well as an id', () => {
    const out = stripQuoteMarkers(`<div class="x ${QUOTE_CONTAINER_ID}">q</div>`);
    expect(out).toContain('q');
    expect(splitQuotedHistory(out).matchedBy).not.toBe('divRplyFwdMsg');
  });

  it('the replacement does not itself contain the marker', () => {
    // Directly pins the mistake: a replacement containing the token is still matched by a
    // substring search, so renaming to `<marker>-quoted` fixes nothing.
    const out = stripQuoteMarkers(`<div id="${QUOTE_CONTAINER_ID}">x</div>`);
    expect(out).not.toContain(QUOTE_CONTAINER_ID);
  });

  it('leaves ordinary text alone', () => {
    const plain = '<p>Just a normal reply.</p>';
    expect(stripQuoteMarkers(plain)).toBe(plain);
  });
});

describe('composeSubject', () => {
  it('prefixes RE: and FW:', () => {
    expect(composeSubject('reply', 'Ordrestatus')).toBe('RE: Ordrestatus');
    expect(composeSubject('replyAll', 'Ordrestatus')).toBe('RE: Ordrestatus');
    expect(composeSubject('forward', 'Ordrestatus')).toBe('FW: Ordrestatus');
  });

  it('does NOT stack prefixes', () => {
    // "RE: RE: RE:" is how a thread's subject becomes unreadable.
    expect(composeSubject('reply', 'RE: Ordrestatus')).toBe('RE: Ordrestatus');
    expect(composeSubject('reply', 'SV: Ordrestatus')).toBe('SV: Ordrestatus');
    expect(composeSubject('forward', 'FW: Ordrestatus')).toBe('FW: Ordrestatus');
  });

  it('recognises the same prefixes normaliseSubject strips, including Danish', () => {
    for (const s of ['AW: x', 'Ang: x', 'Re[2]: x']) {
      expect(composeSubject('reply', s)).toBe(s);
    }
    for (const s of ['VS: x', 'VB: x', 'Fwd: x']) {
      expect(composeSubject('forward', s)).toBe(s);
    }
  });

  it('adds a DIFFERENT prefix (N8)', () => {
    // Forwarding a reply went out as "RE: X": any prefix at all suppressed the new one.
    expect(composeSubject('forward', 'RE: Ordrestatus')).toBe('FW: RE: Ordrestatus');
    expect(composeSubject('forward', 'SV: Ordrestatus')).toBe('FW: SV: Ordrestatus');
    expect(composeSubject('reply', 'FW: Ordrestatus')).toBe('RE: FW: Ordrestatus');
    expect(composeSubject('replyAll', 'VS: Ordrestatus')).toBe('RE: VS: Ordrestatus');
  });

  it('handles a null subject', () => {
    expect(composeSubject('reply', null)).toBe('RE: ');
  });
});

describe('headerFor', () => {
  const when = (iso: string) => `formatted(${iso})`;

  it('renders names with addresses, semicolon separated', () => {
    const h = headerFor(
      { subject: 'Ordrestatus', createdon: '2026-01-20T14:42:00Z' },
      { sender: CUSTOMER, to: [CARE, COLLEAGUE], cc: [] },
      when,
    );
    expect(h.from).toBe('Mette Nielsen <mette@metalservice.example.invalid>');
    expect(h.to).toContain('; ');
    expect(h.sent).toBe('formatted(2026-01-20T14:42:00Z)');
    expect(h.cc).toBeUndefined();
  });

  it('falls back to the bare address when there is no name', () => {
    const h = headerFor(
      { subject: 'x', createdon: '2026-01-20T14:42:00Z' },
      { sender: p('', 'nobody@example.com'), to: [], cc: [] },
      when,
    );
    expect(h.from).toBe('nobody@example.com');
  });
});

describe('composeSubject — the tracking token', () => {
  it('STRIPS the inherited tracking token', () => {
    // Seen in the published app 2026-09-23: the reply subject read
    // "Re: Test af ny mail tråd CRM:0100012", and the platform appends a FRESH token on send —
    // so the sent subject would have carried two.
    expect(composeSubject('reply', 'Test af ny mail tråd CRM:0100012'))
      .toBe('RE: Test af ny mail tråd');
  });

  it('strips the token but keeps an existing prefix, without stacking', () => {
    expect(composeSubject('reply', 'Re: Test af ny mail tråd CRM:0100012'))
      .toBe('Re: Test af ny mail tråd');
  });

  it('handles the other token shape too', () => {
    expect(composeSubject('forward', 'Ordrestatus MON:026300261')).toBe('FW: Ordrestatus');
  });

  it('leaves a subject with no token alone', () => {
    expect(composeSubject('reply', 'Ordrestatus')).toBe('RE: Ordrestatus');
  });
});
