import { describe, it, expect } from 'vitest';
import { runSend, type SendDeps, type SendInput } from '../sendFlow';
import type { DraftApiLike } from '../draft';
import type { PendingAttachment } from '../../domain/attachments';
import { EMAIL_STATUS } from '../../domain/send';

const EMAIL = 'c477f2e0-c0b8-f111-aaad-000d3ab16615';
const QUEUE = '23b1c48e-1ff2-f011-8406-7ced8d2e4880';
const MAILBOX = '0b8c1d2e-3f40-4152-8637-48495a6b7c8d';

const input: SendInput = {
  to: [{ name: 'Kunde', address: 'kunde@example.invalid', partyId: 'p1', partyEntity: 'contact' }],
  cc: [],
  sender: { kind: 'queue', id: QUEUE, displayName: 'Care', address: 'care@example.invalid' },
  allowUnresolved: false,
};

/**
 * A fake platform: routes reads by table, and records the order things were asked for, because
 * the order IS the contract.
 */
function platform(opts: {
  status?: number | 'unreadable';
  approval?: number;
  outgoing?: number;
} = {}) {
  const log: string[] = [];
  const api: DraftApiLike = {
    retrieveRecord: (entity: string) => {
      log.push(`read:${entity}`);
      if (entity === 'email') {
        return opts.status === 'unreadable'
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({ statuscode: opts.status ?? EMAIL_STATUS.draft });
      }
      if (entity === 'queue') {
        return Promise.resolve({
          queueid: QUEUE, name: 'Care', emailaddress: 'care@example.invalid',
          emailrouteraccessapproval: opts.approval ?? 1, _defaultmailbox_value: MAILBOX,
        });
      }
      if (entity === 'mailbox') {
        return Promise.resolve({ outgoingemailstatus: opts.outgoing ?? 1 });
      }
      return Promise.resolve({});
    },
    retrieveMultipleRecords: (entity: string) => {
      log.push(`list:${entity}`);
      return Promise.resolve({
        entities: [{ requireapprovalforqueueemail: true, requireapprovalforuseremail: true }],
      });
    },
    createRecord: () => Promise.resolve({ id: '' }),
    updateRecord: () => Promise.resolve({ id: '' }),
    deleteRecord: () => Promise.resolve({ id: '' }),
  };
  return { api, log };
}

function deps(
  api: DraftApiLike,
  log: string[],
  over: Partial<SendDeps> & { tray?: PendingAttachment[]; savedTray?: PendingAttachment[] } = {},
): SendDeps {
  return {
    api,
    attachments: () => over.tray ?? [],
    save: over.save ?? (() => {
      log.push('save');
      return Promise.resolve({ emailId: EMAIL, attachments: over.savedTray ?? over.tray ?? [] });
    }),
    issue: over.issue ?? ((id) => { log.push(`issue:${id}`); return Promise.resolve({ accepted: true }); }),
  };
}

const file = (patch: Partial<PendingAttachment>): PendingAttachment => ({
  key: 'k', filename: 'a.pdf', mimeType: 'application/pdf', size: 1, status: 'done', progress: 100,
  ...patch,
});

describe('runSend — the order is the contract', () => {
  it('saves, re-reads the row, pre-flights live, THEN issues', async () => {
    const { api, log } = platform();
    const out = await runSend(input, deps(api, log));
    expect(out).toEqual({ ok: true, emailId: EMAIL });
    const save = log.indexOf('save');
    const status = log.indexOf('read:email');
    const preflight = log.indexOf('read:mailbox');
    const issue = log.indexOf(`issue:${EMAIL}`);
    expect(save).toBeGreaterThanOrEqual(0);
    expect(save).toBeLessThan(status);
    expect(status).toBeLessThan(preflight);
    expect(preflight).toBeLessThan(issue);
  });

  it('refuses before saving when there is nobody to send to', async () => {
    const { api, log } = platform();
    const out = await runSend({ ...input, to: [] }, deps(api, log));
    expect(out.ok).toBe(false);
    expect(log).not.toContain('save');
  });

  it('refuses an undeliverable address before saving', async () => {
    const { api, log } = platform();
    const out = await runSend(
      { ...input, to: [{ name: '', address: 'loose@example.invalid' }] },
      deps(api, log),
    );
    expect(out.ok).toBe(false);
    expect(log).not.toContain('save');
  });

  it('does not issue when the save fails', async () => {
    const { api, log } = platform();
    const out = await runSend(input, deps(api, log, {
      save: () => Promise.resolve({ emailId: undefined, attachments: [] }),
    }));
    expect(out).toMatchObject({ ok: false });
    expect(log.some((l) => l.startsWith('issue'))).toBe(false);
  });

  it('FAILS CLOSED when the row status cannot be read (M3)', async () => {
    const { api, log } = platform({ status: 'unreadable' });
    const out = await runSend(input, deps(api, log));
    expect(out).toMatchObject({ ok: false });
    expect(log.some((l) => l.startsWith('issue'))).toBe(false);
  });

  it('refuses a row the platform has already taken', async () => {
    const { api, log } = platform({ status: EMAIL_STATUS.pendingSend });
    const out = await runSend(input, deps(api, log));
    expect(out).toMatchObject({ ok: false, detail: expect.stringContaining('already been sent') });
  });

  it('retries a Failed send (L1)', async () => {
    const { api, log } = platform({ status: EMAIL_STATUS.failed });
    expect((await runSend(input, deps(api, log))).ok).toBe(true);
  });

  it('refuses when a forwarded file still has no row after the save (H4)', async () => {
    const { api, log } = platform();
    const forwarded = file({ reusedAttachmentId: 'blob-1' });
    const out = await runSend(input, deps(api, log, { tray: [forwarded], savedTray: [forwarded] }));
    expect(out).toMatchObject({ ok: false, detail: expect.stringContaining('forwarded') });
    expect(log.some((l) => l.startsWith('issue'))).toBe(false);
  });

  it('sends once the save has carried the forwarded file over', async () => {
    const { api, log } = platform();
    const out = await runSend(input, deps(api, log, {
      tray: [file({ reusedAttachmentId: 'blob-1' })],
      savedTray: [file({ reusedAttachmentId: 'blob-1', attachmentId: 'row-1' })],
    }));
    expect(out.ok).toBe(true);
  });

  it('waits for uploads, before saving anything', async () => {
    const { api, log } = platform();
    const out = await runSend(input, deps(api, log, { tray: [file({ status: 'uploading' })] }));
    expect(out.ok).toBe(false);
    expect(log).not.toContain('save');
  });

  it('returns the verdict when pre-flight refuses, and does not issue', async () => {
    const { api, log } = platform({ approval: 0 });
    const out = await runSend(input, deps(api, log));
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.verdict?.ok).toBe(false);
    expect(log.some((l) => l.startsWith('issue'))).toBe(false);
  });

  it('reports a refused issue rather than claiming anything', async () => {
    const { api, log } = platform();
    const out = await runSend(input, deps(api, log, {
      issue: () => Promise.resolve({ accepted: false, error: { message: 'nope', raw: undefined } }),
    }));
    expect(out).toEqual({ ok: false, detail: 'nope' });
  });
});
