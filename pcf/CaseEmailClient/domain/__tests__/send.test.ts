import { describe, it, expect } from 'vitest';
import {
  blockingReasonAfterSave,
  blockingReasonBeforeSend,
  EMAIL_STATUS,
  isInFlight,
  isSettled,
  phaseFor,
  POLL_DELAYS,
  reportFor,
} from '../send';
import type { PendingAttachment } from '../attachments';

describe('EMAIL_STATUS — read from live metadata, not memory', () => {
  it('matches the environment', () => {
    expect(EMAIL_STATUS).toEqual({
      draft: 1, completed: 2, sent: 3, received: 4,
      canceled: 5, pendingSend: 6, sending: 7, failed: 8,
    });
  });
});

describe('isSettled', () => {
  it('treats FAILED as settled, despite its statecode being 0 (Open)', () => {
    // Failed shares `statecode` 0 with Draft. Inferring "still in progress" from the state
    // rather than the status would poll a dead send forever.
    expect(isSettled(EMAIL_STATUS.failed)).toBe(true);
  });

  it('settles on sent, completed and cancelled', () => {
    expect(isSettled(EMAIL_STATUS.sent)).toBe(true);
    expect(isSettled(EMAIL_STATUS.completed)).toBe(true);
    expect(isSettled(EMAIL_STATUS.canceled)).toBe(true);
  });

  it('does NOT settle on pending or sending', () => {
    // The whole point: an unapproved sender parks at Pending Send permanently.
    expect(isSettled(EMAIL_STATUS.pendingSend)).toBe(false);
    expect(isSettled(EMAIL_STATUS.sending)).toBe(false);
    expect(isSettled(undefined)).toBe(false);
  });
});

describe('isInFlight / phaseFor', () => {
  it('knows what is still moving', () => {
    expect(isInFlight(EMAIL_STATUS.pendingSend)).toBe(true);
    expect(isInFlight(EMAIL_STATUS.sending)).toBe(true);
    expect(isInFlight(EMAIL_STATUS.sent)).toBe(false);
  });

  it('maps every status to a phase', () => {
    expect(phaseFor(EMAIL_STATUS.sent)).toBe('sent');
    expect(phaseFor(EMAIL_STATUS.completed)).toBe('sent');
    expect(phaseFor(EMAIL_STATUS.failed)).toBe('failed');
    expect(phaseFor(EMAIL_STATUS.canceled)).toBe('failed');
    expect(phaseFor(EMAIL_STATUS.pendingSend)).toBe('pending');
    expect(phaseFor(EMAIL_STATUS.sending)).toBe('pending');
    expect(phaseFor(EMAIL_STATUS.draft)).toBe('unknown');
    expect(phaseFor(undefined)).toBe('unknown');
  });
});

describe('reportFor — never claim delivery the platform did not confirm', () => {
  it('confirms ONLY on Sent or Completed', () => {
    expect(reportFor(EMAIL_STATUS.sent, false).confirmed).toBe(true);
    expect(reportFor(EMAIL_STATUS.completed, false).confirmed).toBe(true);
  });

  it('does NOT confirm a pending message, exhausted or not', () => {
    // HTTP 200 means accepted, not delivered. An unapproved sender sits here forever with no
    // error recorded anywhere — reporting success here is the failure R18 exists to prevent.
    expect(reportFor(EMAIL_STATUS.pendingSend, false).confirmed).toBe(false);
    expect(reportFor(EMAIL_STATUS.pendingSend, true).confirmed).toBe(false);
    expect(reportFor(EMAIL_STATUS.sending, true).confirmed).toBe(false);
  });

  it('never says the word "Sent" on its own for a pending message', () => {
    for (const exhausted of [false, true]) {
      expect(reportFor(EMAIL_STATUS.pendingSend, exhausted).headline).not.toBe('Sent');
    }
  });

  it('escalates the wording once polling gives up, without promising arrival', () => {
    const quick = reportFor(EMAIL_STATUS.pendingSend, false);
    const gaveUp = reportFor(EMAIL_STATUS.pendingSend, true);
    expect(quick.headline).toBe('Sending');
    expect(gaveUp.headline).toBe('Still sending');
    expect(gaveUp.detail).toContain('administrator');
    // "It will arrive shortly" would be a guess presented as a fact.
    expect(gaveUp.detail).not.toMatch(/shortly|soon|will arrive/i);
  });

  it('tells the agent their work is not lost when a send fails', () => {
    const r = reportFor(EMAIL_STATUS.failed, false);
    expect(r.phase).toBe('failed');
    expect(r.detail).toContain('still on the case');
  });

  it('distinguishes cancelled from failed', () => {
    expect(reportFor(EMAIL_STATUS.canceled, false).headline).toContain('cancelled');
  });

  it('is honest when it cannot tell', () => {
    // Not knowing is not success. The agent is pointed at the case rather than reassured.
    const r = reportFor(undefined, true);
    expect(r.confirmed).toBe(false);
    expect(r.headline).toContain('could not be confirmed');
  });
});

describe('POLL_DELAYS', () => {
  it('backs off rather than hammering', () => {
    for (let i = 1; i < POLL_DELAYS.length; i += 1) {
      expect(POLL_DELAYS[i]).toBeGreaterThan(POLL_DELAYS[i - 1]);
    }
  });

  it('gives up after about half a minute', () => {
    // Long enough for a healthy server-side-synced mailbox; short enough not to pretend a
    // permanently stranded message is still on its way.
    const total = POLL_DELAYS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(20000);
    expect(total).toBeLessThan(45000);
  });
});

describe('blockingReasonBeforeSend', () => {
  const ok = {
    recipientCount: 1,
    subject: 'RE: Test',
    attachments: [] as PendingAttachment[],
    unresolvedAddresses: [] as string[],
    ambiguousAddresses: [] as string[],
    allowUnresolved: false,
  };

  it('allows a well-formed draft', () => {
    expect(blockingReasonBeforeSend(ok)).toBeUndefined();
  });

  it('refuses a message with nobody to send it to', () => {
    expect(blockingReasonBeforeSend({ ...ok, recipientCount: 0 })).toContain('recipient');
  });

  it('refuses a message with no subject — a new email starts with none (2026-10-01)', () => {
    expect(blockingReasonBeforeSend({ ...ok, subject: '' })).toBe('Add a subject first.');
    expect(blockingReasonBeforeSend({ ...ok, subject: '   ' })).toBe('Add a subject first.');
    // The recipient is the more basic complaint, so it is the one shown first.
    expect(blockingReasonBeforeSend({ ...ok, subject: '', recipientCount: 0 })).toContain('recipient');
  });

  it('waits for attachments rather than sending half of them', () => {
    expect(blockingReasonBeforeSend({ ...ok, attachments: [att({ status: 'uploading' })] }))
      .toContain('attachments');
    expect(blockingReasonBeforeSend({ ...ok, attachments: [att({ status: 'pending' })] }))
      .toContain('attachments');
  });

  it('refuses while an attachment is failed — the tray would disagree with what is sent', () => {
    expect(blockingReasonBeforeSend({ ...ok, attachments: [att({ status: 'failed' })] }))
      .toContain('attachment');
  });

  it('does NOT block on a forwarded file before the save — the save is what creates its row', () => {
    expect(blockingReasonBeforeSend({
      ...ok, attachments: [att({ reusedAttachmentId: 'a1' })],
    })).toBeUndefined();
  });

  it('reports the missing recipient before anything else', () => {
    expect(blockingReasonBeforeSend({
      ...ok, recipientCount: 0, attachments: [att({ status: 'uploading' })],
    })).toContain('recipient');
  });

  describe('unresolved recipients', () => {
    it('BLOCKS an address that matches no record, and names it', () => {
      // Dataverse only delivers to an unresolved party when allowunresolvedpartiesonemailsend
      // is true — false in the demo org. Sending anyway is the silent non-delivery this whole
      // feature exists to prevent.
      const reason = blockingReasonBeforeSend({
        ...ok, unresolvedAddresses: ['kunde@example.com'], allowUnresolved: false,
      });
      expect(reason).toContain('kunde@example.com');
    });

    it('allows it where the ORG has enabled unknown recipients', () => {
      expect(blockingReasonBeforeSend({
        ...ok, unresolvedAddresses: ['kunde@example.com'], allowUnresolved: true,
      })).toBeUndefined();
    });

    it('says nothing when every recipient resolves', () => {
      expect(blockingReasonBeforeSend({ ...ok, unresolvedAddresses: [] })).toBeUndefined();
    });

    it('says an address matching SEVERAL records is ambiguous, not unknown (L6)', () => {
      const reason = blockingReasonBeforeSend({
        ...ok,
        unresolvedAddresses: ['kunde@example.com', 'dup@example.com'],
        ambiguousAddresses: ['dup@example.com'],
      });
      expect(reason).toContain('kunde@example.com is not a known record');
      expect(reason).toContain('dup@example.com matches more than one record');
      expect(reason).not.toContain('dup@example.com is not');
    });

    it('reports a more basic problem first', () => {
      // "Add a recipient" is more useful than "that recipient is unknown" when there are none.
      expect(blockingReasonBeforeSend({
        ...ok, recipientCount: 0, unresolvedAddresses: ['x@y.com'],
      })).toContain('recipient first');
    });
  });
});

describe('blockingReasonAfterSave', () => {
  const none = [] as PendingAttachment[];

  it('allows a saved draft', () => {
    expect(blockingReasonAfterSave({ statusCode: EMAIL_STATUS.draft, attachments: none }))
      .toBeUndefined();
  });

  it('refuses to send a message the platform already took', () => {
    // Guards the double-send: re-issuing SendEmail on a Pending Send row.
    expect(blockingReasonAfterSave({ statusCode: EMAIL_STATUS.pendingSend, attachments: none }))
      .toContain('already been sent');
    expect(blockingReasonAfterSave({ statusCode: EMAIL_STATUS.sent, attachments: none }))
      .toContain('already been sent');
  });

  it('FAILS CLOSED when the status could not be read (M3)', () => {
    // Before 2026-09-28 an unreadable status passed as "not sent yet" — the one moment the guard
    // could not see was the moment it let the send through.
    expect(blockingReasonAfterSave({ statusCode: undefined, attachments: none }))
      .toContain('Could not confirm');
  });

  it('allows a FAILED send to be retried, as the failure report promises (L1)', () => {
    expect(blockingReasonAfterSave({ statusCode: EMAIL_STATUS.failed, attachments: none }))
      .toBeUndefined();
    expect(reportFor(EMAIL_STATUS.failed, false).detail).toContain('sent again');
  });

  it('refuses a forwarded file that still has no row after the save (H4)', () => {
    expect(blockingReasonAfterSave({
      statusCode: EMAIL_STATUS.draft, attachments: [att({ reusedAttachmentId: 'a1' })],
    })).toContain('forwarded attachment');
    expect(blockingReasonAfterSave({
      statusCode: EMAIL_STATUS.draft,
      attachments: [att({ reusedAttachmentId: 'a1', attachmentId: 'row1' })],
    })).toBeUndefined();
  });
});

function att(patch: Partial<PendingAttachment>): PendingAttachment {
  return {
    key: 'k', filename: 'f.pdf', mimeType: 'application/pdf', size: 1, status: 'done',
    progress: 100, ...patch,
  };
}
