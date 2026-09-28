import { describe, it, expect } from 'vitest';
import { buildThreads, conversationDepth, normaliseSubject, type EmailRow } from '../threading';

// First tests this module has ever had. It was written during the research spikes, reasoned about
// extensively in docs/research/04-data-model.md, and never once executed under test.
//
// Fixtures follow docs/design/00-fixture.md. The conversationindex values are the real ones
// captured from a genuine round-trip in docs/research/evidence/s7-s8-conversation.json — seeded
// mail can never carry them, because the column is read-only.

const row = (over: Partial<EmailRow> & { activityid: string }): EmailRow => ({
  subject: 'Reklamation: utætte samlinger efter montage',
  directioncode: false,
  statuscode: 4,
  createdon: '2026-09-08T09:14:00Z',
  baseconversationindexhash: 100487241,
  conversationindex: null,
  ...over,
});

// The two real values, from the S7/S8 evidence file.
const CIDX_PARENT = '01E1ECB8719970468FB42521B09111CCB3DD4110A4DE';                 // 44 chars
const CIDX_CHILD = '01E1ECB8719970468FB42521B09111CCB3DD4110A4DEF6A8B3B849';        // 54 chars

describe('normaliseSubject', () => {
  it('strips a single reply prefix', () => {
    expect(normaliseSubject('RE: Faktura 2026-4417')).toBe('faktura 2026-4417');
  });

  it('strips stacked and mixed-language prefixes', () => {
    // Danish SV:, Swedish VS:, German AW:, English FW:/RE: all appear in one real chain
    // once a message has crossed a few mail clients.
    expect(normaliseSubject('RE: FW: SV: Re: Rammeaftale etape 3')).toBe('rammeaftale etape 3');
    expect(normaliseSubject('AW: Antw: VS: Tilbud')).toBe('tilbud');
  });

  it('strips the bracketed count form Outlook produces', () => {
    expect(normaliseSubject('RE[2]: Trykprøve etape 3')).toBe('trykprøve etape 3');
  });

  it('strips the tracking token the platform appends on send', () => {
    // Measured in S7: sending stamps "CRM:0100009" into the subject, so the reply that comes
    // back carries it. Without stripping, a tracked reply looks like a different thread.
    expect(normaliseSubject('Re: Reklamation CRM:0100009')).toBe('reklamation');
    expect(normaliseSubject('Faktura 2026-4417 — etape 3 CRM:0100042')).toBe('faktura 2026-4417 — etape 3');
  });

  it('strips third-party tokens of the same shape', () => {
    expect(normaliseSubject('Sag oprettet MON:026300261')).toBe('sag oprettet');
  });

  it('does NOT eat a clock time', () => {
    // This is why the token pattern requires at least four digits. A subject about a meeting
    // at 10:30 must survive intact, and this case was untested until now.
    expect(normaliseSubject('Møde kl 10:30 om etape 3')).toBe('møde kl 10:30 om etape 3');
    expect(normaliseSubject('Deadline 9:00')).toBe('deadline 9:00');
  });

  it('collapses whitespace and lowercases', () => {
    expect(normaliseSubject('  Reklamation:\n\t utætte   samlinger ')).toBe('reklamation: utætte samlinger');
  });

  it('handles nothing gracefully', () => {
    expect(normaliseSubject(null)).toBe('(no subject)');
    expect(normaliseSubject(undefined)).toBe('(no subject)');
    expect(normaliseSubject('')).toBe('(no subject)');
    expect(normaliseSubject('   ')).toBe('(no subject)');
    expect(normaliseSubject('RE: ')).toBe('(no subject)');
  });

  it('KNOWN RISK: a legitimate reference of the same shape is eaten', () => {
    // Documented rather than fixed. "ABC:1234" is indistinguishable from a tracking token by
    // shape alone. Pinning it here so that if someone ever tightens the pattern, they do it
    // deliberately and this test tells them what changed.
    expect(normaliseSubject('Ordre ABC:1234 mangler')).toBe('ordre mangler');
  });
});

describe('conversationDepth', () => {
  it('reads the measured anchors', () => {
    // 44 -> 0 and 54 -> 1 are the two values from the real round-trip, and they are the whole
    // evidence base for the formula.
    expect(conversationDepth(CIDX_PARENT)).toBe(0);
    expect(conversationDepth(CIDX_CHILD)).toBe(1);
  });

  it('adds one level per 10 hex characters', () => {
    expect(conversationDepth('0'.repeat(64))).toBe(2);
    expect(conversationDepth('0'.repeat(74))).toBe(3);
  });

  it('treats anything at or below the header length as depth 0', () => {
    expect(conversationDepth('0'.repeat(43))).toBe(0);
    expect(conversationDepth('0'.repeat(44))).toBe(0);
  });

  it('tolerates padding and absence', () => {
    expect(conversationDepth(`  ${CIDX_CHILD}  `)).toBe(1);
    expect(conversationDepth(null)).toBe(0);
    expect(conversationDepth(undefined)).toBe(0);
    expect(conversationDepth('')).toBe(0);
  });
});

describe('buildThreads — grouping', () => {
  it('groups by conversation hash, not by subject', () => {
    // The whole point of R1: six messages whose subjects have diverged are still one thread.
    const rows = [
      row({ activityid: 'a1', subject: 'Reklamation: utætte samlinger', createdon: '2026-09-08T09:14:00Z' }),
      row({ activityid: 'a2', subject: 'RE: Reklamation: utætte samlinger CRM:0100009', createdon: '2026-09-08T11:02:00Z' }),
      row({ activityid: 'a3', subject: 'Sv: noget helt andet', createdon: '2026-09-09T08:41:00Z' }),
    ];
    const threads = buildThreads(rows);
    expect(threads).toHaveLength(1);
    expect(threads[0].groupedBy).toBe('hash');
    expect(threads[0].messages.map((m) => m.activityid)).toEqual(['a1', 'a2', 'a3']);
  });

  it('never merges two different hashes, even on an identical subject', () => {
    // Recorded as a real risk: baseconversationindexhash is writable by any caller, so it is
    // advisory. Two threads with different hashes stay separate and the UI must cope.
    const threads = buildThreads([
      row({ activityid: 'a1', baseconversationindexhash: 100487241 }),
      row({ activityid: 'b1', baseconversationindexhash: 100487299 }),
    ]);
    expect(threads).toHaveLength(2);
  });

  it('falls back to the normalised subject when there is no hash', () => {
    const threads = buildThreads([
      row({ activityid: 'o1', baseconversationindexhash: null, subject: 'Spørgsmål til garantiperiode', createdon: '2026-09-07T14:12:00Z' }),
      row({ activityid: 'o2', baseconversationindexhash: null, subject: 'RE: Spørgsmål til garantiperiode', createdon: '2026-09-07T16:45:00Z' }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].groupedBy).toBe('subject');
  });

  it('stitches a hash-less reply onto its parent through correlatedactivityid', () => {
    const threads = buildThreads([
      row({ activityid: 'a1', baseconversationindexhash: 100487241 }),
      row({ activityid: 'x1', baseconversationindexhash: null, correlatedactivityid: 'a1', subject: 'noget andet' }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(2);
  });

  it('reports the weakest route used to assemble a thread', () => {
    // A thread built partly by hash and partly by correlation must not claim 'hash', or the UI
    // over-states how confident the grouping is.
    const threads = buildThreads([
      row({ activityid: 'a1', baseconversationindexhash: 100487241 }),
      row({ activityid: 'x1', baseconversationindexhash: null, correlatedactivityid: 'a1' }),
    ]);
    expect(threads[0].groupedBy).toBe('correlation');
  });

  it('keeps an orphan with neither hash nor match on its own', () => {
    const threads = buildThreads([
      row({ activityid: 'z1', baseconversationindexhash: null, subject: 'Helt alene' }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].groupedBy).toBe('subject');
  });

  it('handles an empty list', () => {
    expect(buildThreads([])).toEqual([]);
  });
});

describe('buildThreads — ordering', () => {
  it('orders by conversationindex when present, ignoring arrival order', () => {
    const threads = buildThreads([
      row({ activityid: 'child', conversationindex: CIDX_CHILD, createdon: '2026-09-10T10:51:49Z' }),
      row({ activityid: 'parent', conversationindex: CIDX_PARENT, createdon: '2026-09-10T10:39:20Z' }),
    ]);
    expect(threads[0].messages.map((m) => m.activityid)).toEqual(['parent', 'child']);
    expect(threads[0].orderedByCreatedOnFallback).toBe(false);
  });

  it('puts rows that carry conversation data before rows that do not', () => {
    // Drafts have no conversationindex even in real data — they have never been through
    // transport — so they land after the transported messages. That is what artboard 4.5 draws.
    const threads = buildThreads([
      row({ activityid: 'draft', conversationindex: null, statuscode: 1, createdon: '2026-09-10T14:58:00Z' }),
      row({ activityid: 'sent', conversationindex: CIDX_PARENT, createdon: '2026-09-10T10:39:20Z' }),
    ]);
    expect(threads[0].messages.map((m) => m.activityid)).toEqual(['sent', 'draft']);
  });

  it('falls back to createdon and flags that it did', () => {
    const threads = buildThreads([
      row({ activityid: 'later', createdon: '2026-09-08T11:02:00Z' }),
      row({ activityid: 'earlier', createdon: '2026-09-08T09:14:00Z' }),
    ]);
    expect(threads[0].messages.map((m) => m.activityid)).toEqual(['earlier', 'later']);
    expect(threads[0].orderedByCreatedOnFallback).toBe(true);
  });

  it('is deterministic when two messages share a timestamp', () => {
    const same = '2026-09-08T09:14:00Z';
    const a = buildThreads([row({ activityid: 'bbb', createdon: same }), row({ activityid: 'aaa', createdon: same })]);
    const b = buildThreads([row({ activityid: 'aaa', createdon: same }), row({ activityid: 'bbb', createdon: same })]);
    expect(a[0].messages.map((m) => m.activityid)).toEqual(b[0].messages.map((m) => m.activityid));
  });

  it('puts the most recently active thread first', () => {
    const threads = buildThreads([
      row({ activityid: 'old', baseconversationindexhash: 1, createdon: '2026-08-21T10:00:00Z' }),
      row({ activityid: 'new', baseconversationindexhash: 2, createdon: '2026-09-10T13:07:00Z' }),
      row({ activityid: 'mid', baseconversationindexhash: 3, createdon: '2026-09-07T16:45:00Z' }),
    ]);
    expect(threads.map((t) => t.messages[0].activityid)).toEqual(['new', 'mid', 'old']);
  });
});

describe('buildThreads — thread subject', () => {
  it('prefers the shortest subject in the thread as the original', () => {
    const threads = buildThreads([
      row({ activityid: 'a2', subject: 'RE: FW: Reklamation: utætte samlinger CRM:0100009' }),
      row({ activityid: 'a1', subject: 'Reklamation: utætte samlinger' }),
    ]);
    expect(threads[0].subject).toBe('Reklamation: utætte samlinger');
  });

  it('survives a thread where every subject is null', () => {
    const threads = buildThreads([row({ activityid: 'a1', subject: null })]);
    expect(threads[0].subject).toBe('(no subject)');
  });
});

describe('the real captured conversation — regression', () => {
  // Straight from docs/research/evidence/s7-s8-conversation.json: one outgoing message and the
  // reply it provoked, both through a real synced mailbox. This is the only genuine
  // conversationindex nesting available anywhere in the repo, so it is the regression anchor.
  const real: EmailRow[] = [
    {
      activityid: 'sent-1',
      subject: 'RE: Reklamation: utaette samlinger efter montage - Jensen VVS CRM:0100009',
      directioncode: true,
      statuscode: 3,
      createdon: '2026-09-10T10:39:20Z',
      baseconversationindexhash: 100487241,
      conversationindex: CIDX_PARENT,
      attachmentcount: 1,
    },
    {
      activityid: 'recv-1',
      subject: 'Re: Reklamation: utaette samlinger efter montage - Jensen VVS CRM:0100009',
      directioncode: false,
      statuscode: 4,
      createdon: '2026-09-10T10:51:49Z',
      baseconversationindexhash: 100487241,
      conversationindex: CIDX_CHILD,
      attachmentcount: 1,
    },
  ];

  it('is one thread, correctly ordered, with real nesting', () => {
    const threads = buildThreads(real);
    expect(threads).toHaveLength(1);
    expect(threads[0].groupedBy).toBe('hash');
    expect(threads[0].orderedByCreatedOnFallback).toBe(false);
    expect(threads[0].messages.map((m) => m.activityid)).toEqual(['sent-1', 'recv-1']);
    expect(conversationDepth(threads[0].messages[0].conversationindex)).toBe(0);
    expect(conversationDepth(threads[0].messages[1].conversationindex)).toBe(1);
  });

  it('normalises both subjects to the same thread key despite the tracking token', () => {
    const [a, b] = real.map((m) => normaliseSubject(m.subject));
    expect(a).toBe(b);
    expect(a).not.toContain('crm:');
  });
});

describe('a reply that arrives with a NEW conversation hash — CAS-01130-T1M1W1, 2026-09-28', () => {
  // The four real rows, verbatim where it matters. The customer's reply came back with a fresh
  // Thread-Index (a different root and hash), so hash grouping split the conversation in two.
  // The platform still correlated it: correlatedactivityid points at our reply.
  const ORIGINAL = row({
    activityid: '17ad866d', subject: 'Hjælp til selvhjælp', createdon: '2026-09-28T10:36:20Z',
    baseconversationindexhash: 1225932897,
    conversationindex: '0101DD4F34632A96D3F8DF7C934B98FA22AE14BB721EB6E3CBCF31',
    correlatedactivityid: '06f3e0ba', parentactivityid: '06f3e0ba',
  });
  const AUTO_ACK = row({
    activityid: 'e8ddf285', directioncode: true, statuscode: 3, createdon: '2026-09-28T10:37:01Z',
    subject: 'New Case With Number: CAS-01130-T1M1W1 Created CRM:0100015',
    baseconversationindexhash: 87964286,
    conversationindex: '018DDA78785ABE44FAA3EE7FCBB70C795BDD4F354C28',
    parentactivityid: '17ad866d',
  });
  const OUR_REPLY = row({
    activityid: '9c6d2ccd', directioncode: true, statuscode: 3, createdon: '2026-09-28T10:39:04Z',
    subject: 'RE: Hjælp til selvhjælp CRM:0100016',
    baseconversationindexhash: 1225932897,
    conversationindex: '0101DD4F34632A96D3F8DF7C934B98FA22AE14BB721EB6E3CBCF31DD4F35966D',
    parentactivityid: '17ad866d',
  });
  const THEIR_REPLY = row({
    activityid: '5a51e3ff', createdon: '2026-09-28T10:40:25Z',
    subject: 'Re: Hjælp til selvhjælp CRM:0100016',
    baseconversationindexhash: -699962655,
    conversationindex: '0101DD4F35A2EA80DD65F40E7942B22DB47288B07F6BB6E3CD1100',
    correlatedactivityid: '9c6d2ccd', parentactivityid: '9c6d2ccd',
  });
  const threads = buildThreads([ORIGINAL, AUTO_ACK, OUR_REPLY, THEIR_REPLY]);
  const conversation = threads.find((t) => t.messages.some((m) => m.activityid === '17ad866d'))!;

  it('joins the correlated reply to the conversation it answers', () => {
    expect(conversation.messages.map((m) => m.activityid)).toEqual(['17ad866d', '9c6d2ccd', '5a51e3ff']);
    expect(conversation.groupedBy).toBe('correlation');
  });

  it('keeps the automatic acknowledgement apart — it has a parent link, not a correlation', () => {
    expect(threads).toHaveLength(2);
    expect(threads.find((t) => t.messages.some((m) => m.activityid === 'e8ddf285'))!.messages)
      .toHaveLength(1);
  });

  it('keeps the older conversation\'s key, so a selection made before the reply survives', () => {
    expect(conversation.key).toBe('h:1225932897');
  });

  it('orders across two roots by date, and says so', () => {
    // Lexicographic conversationindex order is meaningless across roots.
    expect(conversation.orderedByCreatedOnFallback).toBe(true);
  });
});
