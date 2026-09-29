import { describe, it, expect } from 'vitest';
import {
  admitFiles,
  blockIdFor,
  blockProgress,
  BLOCK_SIZE,
  chooseUploadPath,
  DEFAULT_INLINE_CEILING,
  MESSAGE_SIZE_LIMIT,
  planBlocks,
  blockRange,
  sizeWarning,
  totalSize,
  type PendingAttachment,
} from '../attachments';

const MB = 1024 * 1024;

const file = (name: string, size: number, type = 'application/pdf') => ({ name, size, type });

const attached = (over: Partial<PendingAttachment> = {}): PendingAttachment => ({
  key: 'k1',
  filename: 'rapport.pdf',
  mimeType: 'application/pdf',
  size: 2 * MB,
  status: 'done',
  progress: 100,
  ...over,
});

describe('chooseUploadPath', () => {
  it('uses the supported inline path for ordinary files', () => {
    // One `context.webAPI.createRecord` — security-trimmed, and what almost every real
    // attachment takes. Chunked needs `Xrm.WebApi.online.execute` and is the escape hatch.
    expect(chooseUploadPath(1024)).toBe('inline');
    expect(chooseUploadPath(4 * MB)).toBe('inline');
  });

  it('switches to chunked at and above the org cap', () => {
    // Measured: 6 MB inline fails with HTTP 400 "Attachment file size is too big"; 6 MB chunked
    // succeeds. The boundary is exclusive because a file exactly at the cap is the one most
    // likely to tip over once base64 overhead is added to the request.
    expect(chooseUploadPath(DEFAULT_INLINE_CEILING)).toBe('chunked');
    expect(chooseUploadPath(6 * MB)).toBe('chunked');
  });

  it('honours an org cap that differs from the default', () => {
    expect(chooseUploadPath(9 * MB, 10 * MB)).toBe('inline');
    expect(chooseUploadPath(11 * MB, 10 * MB)).toBe('chunked');
  });
});

describe('planBlocks / blockIdFor', () => {
  it('splits 10 MB into 3 blocks, as measured', () => {
    // S6: 10 MB uploaded in 3 blocks at a 4 MB block size.
    expect(planBlocks(10 * MB)).toEqual([0, 4 * MB, 8 * MB]);
  });

  it('gives one block to a file smaller than the block size', () => {
    expect(planBlocks(1024)).toEqual([0]);
  });

  it('does not emit an empty trailing block on an exact multiple', () => {
    expect(planBlocks(8 * MB)).toHaveLength(2);
  });

  it('plans nothing for an empty file', () => {
    expect(planBlocks(0)).toEqual([]);
  });

  it('produces equal-length block ids, which Dataverse requires', () => {
    const ids = planBlocks(12 * MB).map(blockIdFor);
    expect(new Set(ids.map((i) => i.length)).size).toBe(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('block ids are base64 of the zero-padded offset', () => {
    expect(atob(blockIdFor(0))).toBe('0000000000000000');
    expect(atob(blockIdFor(BLOCK_SIZE))).toBe('0000000004194304');
  });
});

describe('admitFiles — the limit is about DELIVERY, not storage', () => {
  it('accepts an ordinary file', () => {
    const out = admitFiles([file('rapport.pdf', 2 * MB)], []);
    expect(out.accepted).toHaveLength(1);
    expect(out.rejected).toEqual([]);
  });

  it('rejects a file bigger than most mail systems accept, and says what to do instead', () => {
    // The design fixture's 180 MB case. Dataverse would store it happily via chunked upload —
    // which is exactly why the client must not use the Dataverse limit as its rule.
    const out = admitFiles([file('video.mp4', 180 * MB)], []);
    expect(out.accepted).toHaveLength(0);
    expect(out.rejected[0]?.reason).toContain('25 MB');
    expect(out.rejected[0]?.reason).toContain('link');
  });

  it('measures the MESSAGE total, not just each file', () => {
    // Three 10 MB files are a 30 MB message, and that is what a mail system rejects.
    const out = admitFiles(
      [file('a.pdf', 10 * MB), file('b.pdf', 10 * MB), file('c.pdf', 10 * MB)],
      [],
    );
    expect(out.accepted.map((f) => f.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0]?.filename).toBe('c.pdf');
  });

  it('names the file that actually crossed the line, not the whole batch', () => {
    // An agent told only "too big" after dropping five files cannot tell which to remove.
    const out = admitFiles(
      [file('small.pdf', 1 * MB), file('huge.mp4', 30 * MB), file('also-small.pdf', 1 * MB)],
      [],
    );
    expect(out.accepted.map((f) => f.name)).toEqual(['small.pdf', 'also-small.pdf']);
    expect(out.rejected.map((r) => r.filename)).toEqual(['huge.mp4']);
  });

  it('counts what is ALREADY attached', () => {
    const out = admitFiles([file('b.pdf', 10 * MB)], [attached({ size: 20 * MB })]);
    expect(out.rejected[0]?.reason).toContain('Remove another attachment');
  });

  it('ignores failed uploads when totalling', () => {
    // A failed upload occupies no bytes anywhere; counting it would block a legitimate retry.
    const failed = attached({ size: 20 * MB, status: 'failed' });
    expect(admitFiles([file('b.pdf', 10 * MB)], [failed]).accepted).toHaveLength(1);
  });

  it('rejects an empty file rather than attaching a broken one', () => {
    // Almost always a failed drag, and it reaches the customer looking corrupt.
    expect(admitFiles([file('ghost.pdf', 0)], []).rejected[0]?.reason).toBe('That file is empty.');
  });

  it('rejects a duplicate name, case-insensitively', () => {
    const out = admitFiles([file('Rapport.PDF', 1 * MB)], [attached({ filename: 'rapport.pdf' })]);
    expect(out.rejected[0]?.reason).toBe('Already attached.');
  });

  it('rejects a duplicate WITHIN one batch', () => {
    const out = admitFiles([file('a.pdf', 1 * MB), file('a.pdf', 1 * MB)], []);
    expect(out.accepted).toHaveLength(1);
    expect(out.rejected).toHaveLength(1);
  });

  it('accepts a file exactly at the limit', () => {
    expect(admitFiles([file('edge.zip', MESSAGE_SIZE_LIMIT)], []).accepted).toHaveLength(1);
  });
});

describe('sizeWarning', () => {
  it('says nothing for an ordinary message', () => {
    // A running total on every reply is noise.
    expect(sizeWarning([attached({ size: 2 * MB })])).toBeUndefined();
  });

  it('warns near the wire limit, because base64 inflates by about a third', () => {
    const w = sizeWarning([attached({ size: 20 * MB })]);
    // No decimal at 10 MB and above — '20 MB' reads better than '20.0 MB'.
    expect(w).toContain('20 MB');
    expect(w).toContain('rejected by some mail systems');
  });
});

describe('totalSize / blockProgress', () => {
  it('totals only what still counts', () => {
    expect(totalSize([attached({ size: 1 * MB }), attached({ size: 2 * MB, status: 'failed' })]))
      .toBe(1 * MB);
  });

  it('reports block progress as a percentage', () => {
    expect(blockProgress(0, 4)).toBe(0);
    expect(blockProgress(2, 4)).toBe(50);
    expect(blockProgress(4, 4)).toBe(100);
  });

  it('never divides by zero, and never exceeds 100', () => {
    expect(blockProgress(0, 0)).toBe(100);
    expect(blockProgress(9, 4)).toBe(100);
  });
});

describe('blockRange — slice BYTES, not the encoded string', () => {
  it('covers the whole file with no gaps and no overlap', () => {
    // The failure this guards: a tail that is never sent, a commit that still succeeds, and a
    // silently truncated file at the customer's end.
    for (const size of [1, 1024, 4 * MB, 10 * MB, 40 * MB, 40 * MB + 1]) {
      const ranges = planBlocks(size).map((o) => blockRange(o, size));
      expect(ranges[0]?.start).toBe(0);
      expect(ranges[ranges.length - 1]?.end).toBe(size);
      for (let i = 1; i < ranges.length; i += 1) expect(ranges[i].start).toBe(ranges[i - 1].end);
      expect(ranges.reduce((n, r) => n + (r.end - r.start), 0)).toBe(size);
    }
  });

  it('is TEN blocks for 40 MB, as S6 measured', () => {
    // Slicing the base64 STRING instead would give 11 — proof the two schemes differ, and a
    // reminder that only the byte-slicing one was actually measured against Dataverse.
    expect(planBlocks(40 * MB)).toHaveLength(10);
  });

  it('clamps the final block to the end of the file', () => {
    expect(blockRange(8 * MB, 10 * MB)).toEqual({ start: 8 * MB, end: 10 * MB });
  });
});

describe('invisible bytes — inline images from the quoted history', () => {
  /**
   * Measured 2026-09-25: replying to a message containing `<img src="cid:…">` makes the platform
   * create an `activitymimeattachment` for it, reusing the original's blob. It never appears in
   * the tray — it is body content, and "removing" it would break the quote for the customer —
   * but it is 3.9 MB on the wire. Ignoring it lets a 24 MB message actually be 28 MB.
   */
  const INLINE = 3_988_820;

  it('counts them against the limit', () => {
    const out = admitFiles([file('big.zip', 22 * MB)], [], INLINE);
    expect(out.accepted).toHaveLength(0);
    expect(out.rejected[0]?.reason).toContain('over');
  });

  it('accepts the same file when there is no inline weight', () => {
    expect(admitFiles([file('big.zip', 22 * MB)], [], 0).accepted).toHaveLength(1);
  });

  it('includes them in the warning, and says where the weight came from', () => {
    const w = sizeWarning([attached({ size: 15 * MB })], INLINE);
    expect(w).toContain('quoted message');
  });

  it('can trigger the warning on its own, with nothing attached', () => {
    expect(sizeWarning([], 20 * MB)).toBeTruthy();
  });

  it('ignores a negative or absent value rather than crediting it', () => {
    expect(sizeWarning([attached({ size: 2 * MB })], -999)).toBeUndefined();
    expect(admitFiles([file('a.pdf', 1 * MB)], []).accepted).toHaveLength(1);
  });
});
