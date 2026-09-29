import { describe, it, expect } from 'vitest';
import {
  buildDraftPayload,
  buildDraftUpdate,
  buildPartyRows,
  describeSaved,
  draftArgsFrom,
  draftContinuation,
  DRAFT_STATECODE,
  DRAFT_STATUSCODE,
  PARTY_CC,
  PARTY_SENDER,
  PARTY_TO,
  recipientParty,
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

describe('recipientParty — resolved recipients are BOUND, not just addressed', () => {
  const contact = {
    name: 'Simon Jehrbo',
    address: 'simon.jehrbo@example.com',
    partyId: 'b5e30418-23f2-f011-8406-0022489cf5dd',
    partyEntity: 'contact',
    partyNav: 'partyid_contact',
  };

  it('binds the record when identity is known', () => {
    // THE BUG. Dataverse calls an address-only party "unresolved" and only delivers to one when
    // allowunresolvedpartiesonemailsend is true — false in the demo org. Every reply this client
    // sent before now wrote an unresolved To party.
    expect(recipientParty(contact, PARTY_TO)).toEqual({
      addressused: 'simon.jehrbo@example.com',
      participationtypemask: PARTY_TO,
      'partyid_contact@odata.bind': '/contacts(b5e30418-23f2-f011-8406-0022489cf5dd)',
    });
  });

  it('keeps addressused ALONGSIDE the bind', () => {
    // A contact may hold several addresses; the mail should go to the one the agent saw.
    const row = recipientParty(contact, PARTY_TO);
    expect(row.addressused).toBe('simon.jehrbo@example.com');
  });

  it('uses the nav property the PLATFORM stated, not one composed by hand', () => {
    const odd = { ...contact, partyNav: 'partyid_contact_custom' };
    expect(Object.keys(recipientParty(odd, PARTY_TO)))
      .toContain('partyid_contact_custom@odata.bind');
  });

  it('composes a nav property only when none was supplied', () => {
    const { partyNav: _partyNav, ...noNav } = contact;
    expect(Object.keys(recipientParty(noNav, PARTY_TO))).toContain('partyid_contact@odata.bind');
  });

  it('uses the right entity SET for each table', () => {
    const forEntity = (partyEntity: string, set: string) => {
      const row = recipientParty({ ...contact, partyEntity, partyNav: undefined }, PARTY_TO);
      expect(row[`partyid_${partyEntity}@odata.bind`]).toBe(`/${set}(${contact.partyId})`);
    };
    forEntity('contact', 'contacts');
    forEntity('account', 'accounts');
    forEntity('systemuser', 'systemusers');
    forEntity('queue', 'queues');
    forEntity('lead', 'leads');
  });

  it('strips braces from an id that came straight off the lookup dialog', () => {
    const braced = { ...contact, partyId: '{B5E30418-23F2-F011-8406-0022489CF5DD}' };
    expect(recipientParty(braced, PARTY_TO)['partyid_contact@odata.bind'])
      .toBe('/contacts(b5e30418-23f2-f011-8406-0022489cf5dd)');
  });

  it('falls back to a bare address when there is genuinely no record', () => {
    // Still supported — some orgs enable unresolved parties — but now a last resort rather than
    // the normal path it used to be.
    expect(recipientParty({ name: 'X', address: 'x@y.com' }, PARTY_TO)).toEqual({
      addressused: 'x@y.com', participationtypemask: PARTY_TO,
    });
  });

  it('does not bind a table that cannot be a party', () => {
    const wrong = { ...contact, partyEntity: 'incident', partyNav: undefined };
    expect(Object.keys(recipientParty(wrong, PARTY_TO))).toEqual(
      ['addressused', 'participationtypemask'],
    );
  });
});

describe('draftArgsFrom — what a save writes, from what is on screen', () => {
  const snapshot = {
    mode: 'reply' as const,
    activityId: 'aaaa0000-0000-0000-0000-000000000001',
    subject: 'RE: Ordre',
    to: [{ name: 'Kunde', address: 'kunde@example.com' }],
    cc: [],
    quotedBlock: '<div id="divRplyFwdMsg">quote</div>',
  };

  it('links a reply to the message it answers, so resume can find it', () => {
    const out = draftArgsFrom(snapshot, '<p>Svar</p>', CARE, 'case-1');
    expect(out.inReplyToId).toBe(snapshot.activityId);
    expect(out.bodyHtml).toBe('<p>Svar</p><div id="divRplyFwdMsg">quote</div>');
    expect(out.sender).toBe(CARE);
  });

  it('links a forward to nothing — it is a new message to new people', () => {
    expect(draftArgsFrom({ ...snapshot, mode: 'forward' }, '', AGENT, 'case-1').inReplyToId)
      .toBeUndefined();
  });
});

describe('draftContinuation — a draft is finished, not answered (N7)', () => {
  const ME = '{4F2D39F5-23CC-F011-8544-6045BDE0FA7E}';
  const SENT = 'a53c3fe5-2abb-f111-aaad-000d3ab16615';
  const onCase = new Set([SENT]);
  const draft = {
    statuscode: DRAFT_STATUSCODE, subject: 'RE: Test', parentactivityid: SENT,
    ownerid: '4f2d39f5-23cc-f011-8544-6045bde0fa7e',
  };

  it('is undefined for anything that is not a draft', () => {
    expect(draftContinuation({ ...draft, statuscode: 3 }, onCase, ME)).toBeUndefined();
    expect(draftContinuation({ ...draft, statuscode: 8 }, onCase, ME)).toBeUndefined();
  });

  it("resumes the agent's own draft against the message it answers, ids compared unbraced", () => {
    expect(draftContinuation(draft, onCase, ME)).toEqual({ kind: 'resume', mode: 'reply', answeringId: SENT });
    expect(draftContinuation({ ...draft, parentactivityid: SENT.toUpperCase() }, onCase, ME))
      .toMatchObject({ kind: 'resume', answeringId: SENT });
  });

  it('a forward draft resumes as a forward — told apart by its stored subject', () => {
    expect(draftContinuation({ ...draft, subject: 'FW: RE: Test' }, onCase, ME)).toMatchObject({ mode: 'forward' });
    expect(draftContinuation({ ...draft, subject: 'RE: FW: Test' }, onCase, ME)).toMatchObject({ mode: 'reply' });
  });

  it("another agent's draft is theirs to finish", () => {
    expect(draftContinuation({ ...draft, ownerid: '11111111-1111-1111-1111-111111111111' }, onCase, ME))
      .toEqual({ kind: 'otherAgent' });
  });

  it('cannot resume without an answered message on the case, an owner, or a user', () => {
    expect(draftContinuation({ ...draft, parentactivityid: null }, onCase, ME)).toEqual({ kind: 'cannotResume' });
    expect(draftContinuation(draft, new Set(), ME)).toEqual({ kind: 'cannotResume' });
    expect(draftContinuation({ ...draft, ownerid: null }, onCase, ME)).toEqual({ kind: 'cannotResume' });
    expect(draftContinuation(draft, onCase, undefined)).toEqual({ kind: 'cannotResume' });
  });
});
