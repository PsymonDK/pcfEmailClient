import { describe, it, expect, vi } from 'vitest';
import { downloadAttachment, INLINE_DOWNLOAD_CEILING, type DownloadIo } from '../attachments';
import type { WebApiLike } from '../emailQueries';

const ATT = '5e45a3e4-c8ad-f111-aaab-0022489d55b0';

const request = (over: Partial<Parameters<typeof downloadAttachment>[1]> = {}) => ({
  activityMimeAttachmentId: ATT,
  filename: 'Fotodokumentation_etape3.pdf',
  mimeType: 'application/pdf',
  fileSize: 2_516_582,
  ...over,
});

/** Records what the browser was asked to do, without needing one. */
const stubIo = () => {
  const calls = { toBlob: 0, created: 0, revoked: 0, saved: [] as [string, string][] };
  const io: DownloadIo = {
    toBlob: () => { calls.toBlob += 1; return {} as Blob; },
    createObjectUrl: () => { calls.created += 1; return 'blob:stub'; },
    revokeObjectUrl: () => { calls.revoked += 1; },
    save: (url, filename) => { calls.saved.push([url, filename]); },
  };
  return { io, calls };
};

/**
 * Returns the stub AND the mock separately. Asserting on `webApi.retrieveRecord` trips
 * `unbound-method`, and capturing the mock here is clearer than suppressing the rule.
 */
const api = (body: unknown) => {
  // Typed with the real parameter list so the captured `options` is checkable. A bare
  // `vi.fn(() => …)` infers a zero-arg signature, and then `mock.calls[0][2]` does not typecheck.
  let options: string | undefined;
  const retrieveRecord = vi.fn(
    (_entity: string, _id: string, opts?: string) => {
      options = opts;
      return Promise.resolve(body as Record<string, unknown>);
    },
  );
  const webApi: WebApiLike = { retrieveMultipleRecords: vi.fn(), retrieveRecord };
  return { webApi, retrieveRecord, lastOptions: () => options };
};

describe('downloadAttachment — the happy path', () => {
  it('fetches the body and hands the file to the browser under its real name', async () => {
    const { io, calls } = stubIo();
    const result = await downloadAttachment(api({ body: 'aGVsbG8=' }).webApi, request(), io);

    expect(result.ok).toBe(true);
    expect(calls.saved).toEqual([['blob:stub', 'Fotodokumentation_etape3.pdf']]);
  });

  it('fetches the body ONLY on click, and only the body', async () => {
    const { webApi, lastOptions } = api({ body: 'aGVsbG8=' });
    const { io } = stubIo();
    await downloadAttachment(webApi, request(), io);

    // The metadata query must never carry `body` — that would download every attachment on the
    // case just to render a filename. Here, on click, it is exactly what we ask for.
    expect(lastOptions()).toContain('body');
    expect(lastOptions()).toContain('filename');
  });
});

describe('downloadAttachment — always revokes the object URL', () => {
  it('revokes after a successful save', async () => {
    const { io, calls } = stubIo();
    await downloadAttachment(api({ body: 'aGVsbG8=' }).webApi, request(), io);
    expect(calls.created).toBe(1);
    expect(calls.revoked).toBe(1);
  });

  it('revokes even when the browser refuses the save', async () => {
    // An object URL left open pins the whole file in memory; a case with a dozen attachments
    // would accumulate them for the life of the session.
    const { io, calls } = stubIo();
    const failing: DownloadIo = { ...io, save: () => { throw new Error('download blocked'); } };
    const result = await downloadAttachment(api({ body: 'aGVsbG8=' }).webApi, request(), failing);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('download blocked');
    expect(calls.revoked).toBe(1);
  });
});

describe('downloadAttachment — refuses rather than hangs', () => {
  it('refuses a file above the inline ceiling, and says what to do instead', async () => {
    // `body` is base64, so 40 MB arrives as ~54 MB of string through a JSON payload. The platform
    // has a chunked download API for this; until it is built, say so rather than freezing the tab.
    const { webApi, retrieveRecord } = api({ body: 'x' });
    const { io } = stubIo();
    const result = await downloadAttachment(
      webApi,
      request({ filename: 'Drone_gennemgang_raw.mp4', fileSize: 180 * 1024 * 1024 }),
      io,
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('too large');
    expect(result.detail).toContain('180.0 MB');
    // And it did not even try.
    expect(retrieveRecord).not.toHaveBeenCalled();
  });

  it('allows a file right at the ceiling', async () => {
    const { io } = stubIo();
    const result = await downloadAttachment(
      api({ body: 'aGVsbG8=' }).webApi,
      request({ fileSize: INLINE_DOWNLOAD_CEILING }),
      io,
    );
    expect(result.ok).toBe(true);
  });

  it('refuses a non-GUID id without calling the platform', async () => {
    const { webApi, retrieveRecord } = api({ body: 'x' });
    const { io } = stubIo();
    const result = await downloadAttachment(webApi, request({ activityMimeAttachmentId: 'nope' }), io);

    expect(result.ok).toBe(false);
    expect(retrieveRecord).not.toHaveBeenCalled();
  });
});

describe('downloadAttachment — failures say something usable', () => {
  it('survives context.webAPI rejecting with a plain object', async () => {
    const rejecting: WebApiLike = {
      retrieveMultipleRecords: vi.fn(),
      // Plain object, not an Error: the measured platform behaviour. A real Error here would test
      // a case context.webAPI never produces.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      retrieveRecord: vi.fn(() => Promise.reject({ message: 'Access denied', errorCode: '0x80040220' })),
    };
    const { io, calls } = stubIo();
    const result = await downloadAttachment(rejecting, request(), io);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('Access denied');
    expect(result.detail).toContain('0x80040220');
    // Nothing was created, so nothing needed revoking.
    expect(calls.created).toBe(0);
  });

  it('says so when the platform returns an empty body', async () => {
    const { io } = stubIo();
    const result = await downloadAttachment(api({ body: '' }).webApi, request(), io);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('no content');
  });

  it('never says just "error"', async () => {
    const { io } = stubIo();
    const result = await downloadAttachment(api({ body: '' }).webApi, request(), io);
    expect(result.reason?.trim().toLowerCase()).not.toBe('error');
    expect((result.reason ?? '').length).toBeGreaterThan(10);
  });
});
