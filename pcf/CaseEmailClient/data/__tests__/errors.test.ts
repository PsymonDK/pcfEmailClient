import { describe, it, expect } from 'vitest';
import { agentFacingMessage, normaliseWebApiError } from '../errors';

// The whole point of this module: `context.webAPI` rejects with a PLAIN OBJECT, not an Error.
// Measured 2026-09-10. A naive handler collapses every real failure to "Unknown error", which is
// what the spike control did — so these tests are about never doing that again.

describe('normaliseWebApiError', () => {
  it('handles the shape context.webAPI actually rejects with', () => {
    const r = normaliseWebApiError({
      message: 'The user is not a member of the organization.',
      errorCode: '0x80040217',
      status: 403,
    });
    expect(r.message).toBe('The user is not a member of the organization.');
    expect(r.code).toBe('0x80040217');
    expect(r.status).toBe(403);
  });

  it('digs into a nested error object', () => {
    const r = normaliseWebApiError({
      error: { message: "Could not find a property named 'regardingobjecttypecode'.", code: '0x0' },
    });
    expect(r.message).toContain('regardingobjecttypecode');
    expect(r.code).toBe('0x0');
  });

  it('handles a real Error, which is the uncommon case here', () => {
    const r = normaliseWebApiError(new Error('Network request failed'));
    expect(r.message).toBe('Network request failed');
  });

  it('handles a bare string', () => {
    expect(normaliseWebApiError('Request timed out').message).toBe('Request timed out');
  });

  it('serialises an unrecognised object rather than saying "Unknown error"', () => {
    // Ugly, but actionable: it can be pasted into a bug report. "Unknown error" cannot.
    const r = normaliseWebApiError({ odataError: { detail: 'malformed query' } });
    expect(r.message).toContain('malformed query');
  });

  it('degrades gracefully on the genuinely empty cases', () => {
    for (const nothing of [null, undefined, {}, '', 0]) {
      const r = normaliseWebApiError(nothing);
      expect(r.message.length).toBeGreaterThan(0);
      expect(r.message.toLowerCase()).not.toBe('unknown error');
    }
  });

  it('survives a circular rejection without throwing', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => normaliseWebApiError(circular)).not.toThrow();
    expect(normaliseWebApiError(circular).message.length).toBeGreaterThan(0);
  });

  it('always keeps the original for logging', () => {
    const original = { message: 'x' };
    expect(normaliseWebApiError(original).raw).toBe(original);
  });
});

describe('agentFacingMessage', () => {
  it('answers the agent\'s first question when the list fails', () => {
    const m = agentFacingMessage(normaliseWebApiError({ message: 'boom' }), 'list');
    expect(m.headline).toBe("Couldn't load this case's email");
    expect(m.reassurance).toBe('Your drafts are safe.');
  });

  it('scopes a body failure to the message, with no alarming reassurance', () => {
    const m = agentFacingMessage(normaliseWebApiError({ message: 'blob read failed' }), 'body');
    expect(m.headline).toBe("Message text couldn't be loaded");
    expect(m.reassurance).toBeUndefined();
  });

  it('keeps the platform code in the detail, not the headline', () => {
    // The headline is for a person; the detail is for whoever has to fix it.
    const m = agentFacingMessage(
      normaliseWebApiError({ message: 'Privilege check failed', errorCode: '0x80040220' }),
      'list',
    );
    expect(m.headline).not.toContain('0x80040220');
    expect(m.detail).toContain('0x80040220');
  });

  it('never says just "error"', () => {
    const ops = ['list', 'body', 'attachments', 'attachment-download', 'read-state'] as const;
    for (const op of ops) {
      const m = agentFacingMessage(normaliseWebApiError({ message: 'x' }), op);
      expect(m.headline.trim().toLowerCase()).not.toBe('error');
      expect(m.headline.length).toBeGreaterThan(10);
    }
  });
});
