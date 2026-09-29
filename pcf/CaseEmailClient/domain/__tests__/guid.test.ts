import { describe, it, expect } from 'vitest';
import { bareId, isGuid, toGuid } from '../guid';

const ID = '4f2d39f5-23cc-f011-8544-6045bde0fa7e';

describe('record ids (L4)', () => {
  it('accepts both spellings the platform uses, and normalises to bare lower-case', () => {
    expect(toGuid(ID, 'x')).toBe(ID);
    expect(toGuid(`{${ID.toUpperCase()}}`, 'x')).toBe(ID);
  });

  it('REFUSES an unbalanced brace — the hand-rolled regex let `{guid` through into URLs', () => {
    expect(() => toGuid(`{${ID}`, 'emailId')).toThrow('emailId is not a GUID');
    expect(() => toGuid(`${ID}}`, 'emailId')).toThrow();
    expect(isGuid(`{${ID}`)).toBe(false);
  });

  it('refuses anything that could carry OData', () => {
    expect(() => toGuid(`${ID}) or (true`, 'x')).toThrow();
    expect(() => toGuid('', 'x')).toThrow();
  });

  it('bareId compares without validating', () => {
    expect(bareId(`{${ID.toUpperCase()}}`)).toBe(ID);
    expect(bareId('not-an-id')).toBe('not-an-id');
  });
});
