import { describe, it, expect } from 'vitest';
import {
  buildDraftPayload,
  buildDraftUpdate,
  buildPartyRows,
  describeSaved,
  DRAFT_STATECODE,
  DRAFT_STATUSCODE,
  PARTY_CC,
  PARTY_SENDER,
  PARTY_TO,
  senderParty,
  worthSaving,
  type DraftArgs,
} from '../draft';
import type { SenderCandidate } from '../sender';

const CARE: SenderCandidate = {
  kind: 'queue',
  id: '23b1c48e-1ff2-f011-8406-7ced8d2e4880',
  displayName: 'Care',
  address: 'care@example.invalid',
};

const AGENT: SenderCandidate = {
  kind: 'user',
  id: '4f2d39f5-23cc-f011-8544-6045bde0fa7e',
  displayName: 'Simon Jehrbo',
  address: 'simon.jehrbo@example.invalid',
};

const args = (over: Partial<DraftArgs> = {}): DraftArgs => ({
  caseId: '40a5d940-0ef6-f011-8406-000d3ab7be36',
  subject: 'Re: Test af ny mail tråd',
  bodyHtml: '<p>Hej</p>',
  sender: CARE,
  to: [{ name: 'Kunde', address: 'kunde@example.com' }],
  cc: [],
  inReplyToId: undefined,
  ...over,
});

describe('buildDraftPayload — the four documented traps', () => {
  const p = buildDraftPayload(args());

  it('is Open + Draft, and statuscode is never omitted', () => {
    // `Email.StatusCode` cannot be null. Leaving it out is not "take the default", it fails.
    expect(p.statecode).toBe(DRAFT_STATECODE);
    expect(p.statuscode).toBe(DRAFT_STATUSCODE);
    expect(Object.keys(p)).toContain('statuscode');
  });

  it('NEVER writes torecipients', () => {
    // Read-only display convenience (IsValidForForm: False) that looks exactly like the field
    // you want. Measured 2026-09-25: the platform derives it from the To parties by itself.
    expect(Object.keys(p)).not.toContain('torecipients');
  });

  it('NEVER writes templateid', () => {
    expect(Object.keys(p)).not.toContain('templateid');
  });

  it('scopes to the Case through the TYPED navigation property', () => {
    // Same discipline as the list query: guarantees the regarding object is a Case, so a GUID
    // cannot collide across tables.
    expect(p['regardingobjectid_incident@odata.bind'])
      .toBe('/incidents(40a5d940-0ef6-f011-8406-000d3ab7be36)');
  });

  it('marks the draft OUTGOING', () => {
    // Without this the draft reads as incoming, and `domain/unread.ts` would treat the agent's
    // own unsent draft as something waiting to be read.
    expect(p.directioncode).toBe(true);
  });

  it('carries the full outgoing body, quote included', () => {
    // R12: the quote is concatenated before it gets here. This layer must not re-split it.
    const withQuote = buildDraftPayload(args({ bodyHtml: '<p>new</p><div id="divRplyFwdMsg">old</div>' }));
    expect(withQuote.description).toContain('divRplyFwdMsg');
    expect(withQuote.description).toContain('<p>new</p>');
  });
});

describe('buildPartyRows', () => {
  it('binds a QUEUE sender by its queue lookup', () => {
    // Measured: the platform then fills addressused from the queue's own address.
    expect(senderParty(CARE)).toEqual({
      'partyid_queue@odata.bind': `/queues(${CARE.id})`,
      participationtypemask: PARTY_SENDER,
    });
  });

  it('binds a USER sender by its systemuser lookup', () => {
    expect(senderParty(AGENT)['partyid_systemuser@odata.bind'])
      .toBe(`/systemusers(${AGENT.id})`);
  });

  it('writes recipients as bare addresses with no partyid', () => {
    // The normal case on a Case: customers are frequently not Contacts. Measured to work —
    // partyid comes back null and addressused is preserved.
    const rows = buildPartyRows(args({ cc: [{ name: 'Chef', address: 'chef@example.com' }] }));
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual({ addressused: 'kunde@example.com', participationtypemask: PARTY_TO });
    expect(rows[2]).toEqual({ addressused: 'chef@example.com', participationtypemask: PARTY_CC });
  });

  it('puts the sender first', () => {
    expect(buildPartyRows(args())[0]?.participationtypemask).toBe(PARTY_SENDER);
  });

  it('drops recipients with no address', () => {
    // An activityparty with neither a lookup nor an addressused means nothing, and Dataverse
    // accepts it silently rather than complaining.
    const rows = buildPartyRows(args({ to: [{ name: 'Ghost', address: '   ' }] }));
    expect(rows).toHaveLength(1);
  });

  it('survives a draft with no recipients at all', () => {
    // Forward opens with an empty To by design, and autosave fires before the agent fills it.
    expect(buildPartyRows(args({ to: [], cc: [] }))).toHaveLength(1);
  });
});

describe('buildDraftUpdate', () => {
  it('sends body and subject only', () => {
    // Autosave fires for typing far more often than for recipient changes; rewriting three
    // activityparty rows per sentence would be waste.
    expect(buildDraftUpdate({ subject: 's', bodyHtml: 'b' })).toEqual({
      subject: 's', description: 'b',
    });
  });

  it('does not resend statecode, which would fight the platform on a sent mail', () => {
    expect(Object.keys(buildDraftUpdate({ subject: 's', bodyHtml: 'b' }))).not.toContain('statecode');
  });
});

describe('worthSaving', () => {
  const SIG = '<div><p>Venlig hilsen</p><p>Simon</p></div>';

  it('does not save an untouched reply that holds only the signature', () => {
    // Otherwise opening Reply and closing it again litters the Case with blank drafts.
    expect(worthSaving(`<p></p><p></p>${SIG}`, SIG)).toBe(false);
  });

  it('saves as soon as the agent has typed something', () => {
    expect(worthSaving(`<p>Tak for din henvendelse</p>${SIG}`, SIG)).toBe(true);
  });

  it('does not save genuinely empty content', () => {
    expect(worthSaving('', SIG)).toBe(false);
    expect(worthSaving('<p></p><p></p>', SIG)).toBe(false);
    expect(worthSaving('<p>&nbsp;</p>', SIG)).toBe(false);
  });

  it('saves when there is no signature configured and the agent typed', () => {
    expect(worthSaving('<p>Hej</p>', '')).toBe(true);
    expect(worthSaving('<p></p>', '')).toBe(false);
  });

  it('ignores markup differences, comparing text', () => {
    // The editor re-serialises what it is given, so the signature's tags will not match
    // byte-for-byte once TipTap has had it.
    expect(worthSaving('<div><p>Venlig hilsen</p><p>Simon</p></div>', SIG)).toBe(false);
  });
});

describe('describeSaved', () => {
  const at = new Date('2026-09-25T14:32:00');

  it('says so plainly before the first save', () => {
    expect(describeSaved(undefined)).toBe('Not saved yet');
  });

  it('reads as "just now" immediately after', () => {
    expect(describeSaved(at, new Date('2026-09-25T14:32:03'))).toBe('Saved just now');
  });

  it('counts seconds within the first minute', () => {
    expect(describeSaved(at, new Date('2026-09-25T14:32:30'))).toBe('Saved 30s ago');
  });

  it('falls back to a clock time once it is stale', () => {
    // A relative age stops being reassuring past a minute; agents want to know *when*.
    expect(describeSaved(at, new Date('2026-09-25T14:40:00'))).toBe('Saved 14:32');
  });

  it('zero-pads the clock', () => {
    expect(describeSaved(new Date('2026-09-25T09:05:00'), new Date('2026-09-25T10:00:00')))
      .toBe('Saved 09:05');
  });
});

describe('parentactivityid — the link that stops duplicate drafts', () => {
  it('binds the message being replied to, via the LOWERCASE navigation property', () => {
    // Read off `ReferencingEntityNavigationPropertyName`, not guessed from the SchemaName
    // `ParentActivityId` — guessing from SchemaName is the documented way to fail here.
    const p = buildDraftPayload(args({ inReplyToId: 'de1b0e6c-b6b8-f111-aaaf-000d3ab163fb' }));
    expect(p['parentactivityid@odata.bind'])
      .toBe('/emails(de1b0e6c-b6b8-f111-aaaf-000d3ab163fb)');
  });

  it('strips braces from the id', () => {
    const p = buildDraftPayload(args({ inReplyToId: '{DE1B0E6C-B6B8-F111-AAAF-000D3AB163FB}' }));
    expect(p['parentactivityid@odata.bind']).not.toContain('{');
  });

  it('is absent when there is nothing to link to', () => {
    // A forward is a new message to new people; it has no draft to resume.
    expect(Object.keys(buildDraftPayload(args()))).not.toContain('parentactivityid@odata.bind');
  });

  it('is NEVER in an update payload', () => {
    // Measured: IsValidForCreate true, IsValidForUpdate FALSE. Sending it on a PATCH fails.
    expect(Object.keys(buildDraftUpdate({ subject: 's', bodyHtml: 'b' })))
      .not.toContain('parentactivityid@odata.bind');
  });
});
