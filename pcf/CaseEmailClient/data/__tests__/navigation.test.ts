import { describe, it, expect, vi } from 'vitest';
import { emailDialog, openEmailInForm } from '../navigation';

describe('openEmailInForm', () => {
  it('opens the email record as a centred DIALOG, never by navigating the tab away', async () => {
    const navigateTo = vi.fn(() => Promise.resolve(undefined));
    expect(await openEmailInForm('abc', { navigateTo })).toBe(true);
    expect(navigateTo).toHaveBeenCalledWith(
      { pageType: 'entityrecord', entityName: 'email', entityId: 'abc' },
      expect.objectContaining({ target: 2, position: 1 }),
    );
    expect(emailDialog('abc').options.target).toBe(2);
  });

  it('reports false without a host, or when the host refuses', async () => {
    expect(await openEmailInForm('abc', undefined)).toBe(false);
    expect(await openEmailInForm('abc', { navigateTo: () => Promise.reject(new Error('no')) })).toBe(false);
  });
});
