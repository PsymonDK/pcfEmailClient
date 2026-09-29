import { describe, it, expect } from 'vitest';
import { recipientSummary } from '../recipientLine';

const p = (...names: string[]) => names.map((name) => ({ name }));

describe('recipientSummary — Bcc only on OUTGOING mail (issue #11)', () => {
  const parties = { to: p('Kunde'), cc: p('Chef'), bcc: p('Leder') };

  it('shows who was blind-copied on our own sent mail', () => {
    expect(recipientSummary(parties, true)).toBe('To: Kunde · Cc: Chef · Bcc: Leder');
  });

  it('never shows a Bcc list on RECEIVED mail', () => {
    expect(recipientSummary(parties, false)).toBe('To: Kunde · Cc: Chef');
  });

  it('collapses overflow in each field', () => {
    expect(recipientSummary({ to: p('A', 'B', 'C'), cc: [], bcc: p('X', 'Y', 'Z', 'W') }, true))
      .toBe('To: A, B +1 · Bcc: X, Y +2');
  });
});
