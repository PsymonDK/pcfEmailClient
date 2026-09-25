import { describe, it, expect, vi } from 'vitest';
import { issueSend, pollUntilSettled, readSendStatus } from '../send';
import { EMAIL_STATUS, POLL_DELAYS } from '../../domain/send';
import type { DraftApiLike } from '../draft';

const EMAIL = 'c477f2e0-c0b8-f111-aaad-000d3ab16615';

/** A `webApi` that returns a scripted sequence of statuses, one per read. */
const statusApi = (sequence: (number | undefined)[]): DraftApiLike => {
  let i = 0;
  return {
    retrieveRecord: () => {
      const statuscode = sequence[Math.min(i, sequence.length - 1)];
      i += 1;
      return Promise.resolve(statuscode === undefined ? {} : { statuscode });
    },
    retrieveMultipleRecords: () => Promise.resolve({ entities: [] }),
    createRecord: () => Promise.resolve({ id: '' }),
    updateRecord: () => Promise.resolve({ id: '' }),
    deleteRecord: () => Promise.resolve({ id: '' }),
  };
};

const noWait = () => Promise.resolve();

describe('issueSend — the bound-action shape', () => {
  it('binds to the email and passes IssueSend as a boolean', async () => {
    // SendEmail is BOUND, unlike every other action here. `boundParameter: 'entity'` must match
    // the key the instance is passed under; getting it wrong yields an anonymous payload error.
    const calls: Record<string, unknown>[] = [];
    const execute = vi.fn((req: unknown) => {
      calls.push(req as Record<string, unknown>);
      return Promise.resolve({ json: () => Promise.resolve({}) });
    });

    const out = await issueSend(EMAIL, true, execute);
    expect(out.accepted).toBe(true);

    const req = calls[0] as {
      entity: { entityType: string; id: string };
      IssueSend: boolean;
      getMetadata: () => { boundParameter: string; parameterTypes: Record<string, unknown> };
    };
    expect(req.entity.entityType).toBe('email');
    expect(req.entity.id).toBe(EMAIL);
    expect(req.IssueSend).toBe(true);

    const meta = req.getMetadata();
    expect(meta.boundParameter).toBe('entity');
    expect(meta.parameterTypes.IssueSend).toEqual({
      typeName: 'Edm.Boolean', structuralProperty: 1,
    });
  });

  it('passes IssueSend false through unchanged — the safe mode', async () => {
    // Marks the mail sent WITHOUT sending it. The default for developing against a shared
    // environment; a real send has to be asked for explicitly.
    const execute = vi.fn((_req: unknown) => Promise.resolve({ json: () => Promise.resolve({}) }));
    await issueSend(EMAIL, false, execute);
    expect((execute.mock.calls[0][0] as { IssueSend: boolean }).IssueSend).toBe(false);
  });

  it('strips braces from the id', async () => {
    const execute = vi.fn((_req: unknown) => Promise.resolve({ json: () => Promise.resolve({}) }));
    await issueSend(`{${EMAIL.toUpperCase()}}`, false, execute);
    expect((execute.mock.calls[0][0] as { entity: { id: string } }).entity.id)
      .toBe(EMAIL.toUpperCase());
  });

  it('refuses an unsaved draft without calling the platform', async () => {
    const execute = vi.fn((_req: unknown) => Promise.resolve({ json: () => Promise.resolve({}) }));
    const out = await issueSend('not-a-guid', true, execute);
    expect(out.accepted).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('reports a missing platform API rather than throwing', async () => {
    const out = await issueSend(EMAIL, true, undefined);
    expect(out.accepted).toBe(false);
    expect(out.error?.message).toContain('platform API');
  });

  it('normalises a rejection', async () => {
    /* eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors */
    const execute = vi.fn(() => Promise.reject({ message: 'no privilege to send' }));
    const out = await issueSend(EMAIL, true, execute);
    expect(out.accepted).toBe(false);
    expect(out.error?.message).toBe('no privilege to send');
  });
});

describe('pollUntilSettled — the 200 is not the answer', () => {
  it('stops as soon as the message is Sent', async () => {
    const seen: (number | undefined)[] = [];
    const out = await pollUntilSettled(
      statusApi([EMAIL_STATUS.pendingSend, EMAIL_STATUS.sending, EMAIL_STATUS.sent]),
      EMAIL,
      (s) => seen.push(s),
      noWait,
    );
    expect(out).toEqual({ statusCode: EMAIL_STATUS.sent, exhausted: false });
    expect(seen).toEqual([EMAIL_STATUS.pendingSend, EMAIL_STATUS.sending, EMAIL_STATUS.sent]);
  });

  it('stops on Failed, which shares statecode 0 with Draft', async () => {
    const out = await pollUntilSettled(statusApi([EMAIL_STATUS.failed]), EMAIL, undefined, noWait);
    expect(out).toEqual({ statusCode: EMAIL_STATUS.failed, exhausted: false });
  });

  it('GIVES UP on a message stranded at Pending Send, rather than spinning forever', async () => {
    // The measured failure: an unapproved sender parks here permanently with no error recorded
    // anywhere. A poll loop without a bound would show a spinner meaning "this is fine" until
    // the agent navigated away.
    const out = await pollUntilSettled(
      statusApi([EMAIL_STATUS.pendingSend]), EMAIL, undefined, noWait,
    );
    expect(out).toEqual({ statusCode: EMAIL_STATUS.pendingSend, exhausted: true });
  });

  it('polls no more times than the delay schedule allows', async () => {
    let reads = 0;
    const api = {
      retrieveRecord: () => { reads += 1; return Promise.resolve({ statuscode: EMAIL_STATUS.pendingSend }); },
      retrieveMultipleRecords: () => Promise.resolve({ entities: [] }),
      createRecord: () => Promise.resolve({ id: '' }),
      updateRecord: () => Promise.resolve({ id: '' }),
      deleteRecord: () => Promise.resolve({ id: '' }),
    } as DraftApiLike;
    await pollUntilSettled(api, EMAIL, undefined, noWait);
    expect(reads).toBe(POLL_DELAYS.length);
  });

  it('waits before the FIRST read, not after', async () => {
    // Reading immediately would catch the row mid-transaction and report Draft.
    const waits: number[] = [];
    await pollUntilSettled(
      statusApi([EMAIL_STATUS.sent]), EMAIL, undefined,
      (ms) => { waits.push(ms); return Promise.resolve(); },
    );
    expect(waits).toEqual([POLL_DELAYS[0]]);
  });

  it('survives a read that fails, reporting unknown rather than crashing', async () => {
    const api = {
      /* eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors */
      retrieveRecord: () => Promise.reject({ message: 'boom' }),
      retrieveMultipleRecords: () => Promise.resolve({ entities: [] }),
      createRecord: () => Promise.resolve({ id: '' }),
      updateRecord: () => Promise.resolve({ id: '' }),
      deleteRecord: () => Promise.resolve({ id: '' }),
    } as DraftApiLike;
    const out = await pollUntilSettled(api, EMAIL, undefined, noWait);
    expect(out.statusCode).toBeUndefined();
    expect(out.exhausted).toBe(true);
  });
});

describe('readSendStatus', () => {
  it('returns the status code', async () => {
    expect(await readSendStatus(statusApi([EMAIL_STATUS.sent]), EMAIL)).toBe(EMAIL_STATUS.sent);
  });

  it('returns undefined rather than throwing when the row cannot be read', async () => {
    expect(await readSendStatus(statusApi([undefined]), EMAIL)).toBeUndefined();
  });
});
