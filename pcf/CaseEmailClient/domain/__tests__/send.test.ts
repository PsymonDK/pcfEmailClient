import { describe, it, expect } from 'vitest';
import {
  blockingReasonBeforeSend,
  EMAIL_STATUS,
  isInFlight,
  isSettled,
  phaseFor,
  POLL_DELAYS,
  reportFor,
} from '../send';

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
  const ok = { recipientCount: 1, statusCode: EMAIL_STATUS.draft, uploadsInFlight: false };

  it('allows a well-formed draft', () => {
    expect(blockingReasonBeforeSend(ok)).toBeUndefined();
  });

  it('refuses a message with nobody to send it to', () => {
    expect(blockingReasonBeforeSend({ ...ok, recipientCount: 0 })).toContain('recipient');
  });

  it('waits for attachments rather than sending half of them', () => {
    expect(blockingReasonBeforeSend({ ...ok, uploadsInFlight: true })).toContain('attachments');
  });

  it('refuses to send a message the platform already took', () => {
    // Guards the double-send: re-issuing SendEmail on a Pending Send row.
    expect(blockingReasonBeforeSend({ ...ok, statusCode: EMAIL_STATUS.pendingSend }))
      .toContain('already been sent');
    expect(blockingReasonBeforeSend({ ...ok, statusCode: EMAIL_STATUS.sent }))
      .toContain('already been sent');
  });

  it('allows a draft whose status is not yet known', () => {
    // A draft that has not saved yet has no statuscode; that is not a reason to block.
    expect(blockingReasonBeforeSend({ ...ok, statusCode: undefined })).toBeUndefined();
  });

  it('reports the missing recipient before anything else', () => {
    expect(blockingReasonBeforeSend({ recipientCount: 0, uploadsInFlight: true }))
      .toContain('recipient');
  });
});
