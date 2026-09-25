import { describe, it, expect } from 'vitest';
import { evaluateSender, sendBlockedBy, type SenderApproval } from '../preflight';

const approval = (over: Partial<SenderApproval> = {}): SenderApproval => ({
  address: 'care@example.invalid',
  requiresApproval: true,
  approvalState: 1,
  outgoingStatus: 1,
  ...over,
});

describe('evaluateSender — the healthy case', () => {
  it('passes the real Care queue', () => {
    // Measured 2026-09-24: approval 1, mailbox outgoing 1. S7 sent real mail from it.
    expect(evaluateSender(approval(), 'Care')).toEqual({ ok: true });
  });

  it('passes an unapproved sender when the org does not require approval', () => {
    expect(evaluateSender(approval({ requiresApproval: false, approvalState: 2 }), 'Care').ok)
      .toBe(true);
  });
});

describe('evaluateSender — the silent failure this exists to prevent', () => {
  it('blocks an unapproved sender', () => {
    // Measured: HTTP 200, then Pending Send forever, no error recorded anywhere.
    const v = evaluateSender(approval({ approvalState: 2 }), 'Offensive Support');
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('Offensive Support');
    expect(v.reason).toContain('not approved');
  });

  it('says what actually happens, not just that it is blocked', () => {
    // Gate 2 chose block over warn-and-confirm, which puts the whole weight on the reason.
    const v = evaluateSender(approval({ approvalState: 3 }), 'Care');
    expect(v.reason).toContain('Pending Send');
    expect(v.reason).toContain('administrator');
  });
});

describe('evaluateSender — the mailbox', () => {
  it('blocks a mailbox whose outgoing email has never run', () => {
    // This is the agent-fallback case in the demo environment today: the user mailbox is
    // approved but outgoingemailstatus is 0, so "send as me" is genuinely blocked there.
    const v = evaluateSender(approval({ outgoingStatus: 0 }), 'Simon Jehrbo');
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('never run');
  });

  it('blocks a mailbox that is failing, and says so differently', () => {
    expect(evaluateSender(approval({ outgoingStatus: 2 }), 'Care').reason).toContain('failed');
  });

  it('blocks when no mailbox could be read at all', () => {
    // Not knowing is not the same as being fine, and is the shape a permissions problem takes.
    const v = evaluateSender(approval({ outgoingStatus: undefined }), 'Care');
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('no way to tell');
  });
});

describe('evaluateSender — the loud failure', () => {
  it('blocks a sender with no address', () => {
    // A queue with no address fails synchronously with HTTP 400. Catching it here turns a
    // platform code into a sentence, and is checked FIRST because it explains the others.
    for (const address of [undefined, '', '   ']) {
      const v = evaluateSender(approval({ address, approvalState: 2 }), 'Care');
      expect(v.ok).toBe(false);
      expect(v.reason).toContain('no email address');
    }
  });
});

describe('sendBlockedBy', () => {
  it('blocks while the check has not finished', () => {
    // Enabling Send before pre-flight has answered is the same bug as not pre-flighting.
    expect(sendBlockedBy(undefined)).toBeTruthy();
  });

  it('is undefined only when the sender passed', () => {
    expect(sendBlockedBy({ ok: true })).toBeUndefined();
    expect(sendBlockedBy({ ok: false, reason: 'nope' })).toBe('nope');
  });
});
