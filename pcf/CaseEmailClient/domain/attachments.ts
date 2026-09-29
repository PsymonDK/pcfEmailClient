/**
 * Attaching files to an outgoing reply (R13).
 *
 * Pure: the rules about what may be attached, how it will be uploaded, and what to tell the agent
 * when it cannot. `data/attachmentUpload.ts` does the talking to Dataverse.
 *
 * **Storing is not sending.** S6 measured a 40 MB file stored happily through the chunked API,
 * against an org cap of 5 MB — but that says nothing about whether the message is *deliverable*.
 * Exchange and most receiving systems reject messages well below that, so a client that accepts
 * whatever Dataverse accepts would let an agent spend two minutes uploading something that can
 * never leave. The limits here are therefore about **delivery**, not storage, and that is the only
 * honest basis for them.
 */

/**
 * The size an agent is allowed to attach, and why it is this number.
 *
 * 25 MB is the near-universal default maximum message size for Exchange Online and most receiving
 * mail systems. It is deliberately NOT the Dataverse limit: `Organization.MaxUploadFileSize`
 * (5 MB here) caps only the inline upload path and the chunked path ignores it entirely, so
 * neither number tells the agent anything about whether the customer will get the file.
 *
 * The cap applies to the **message total**, not just each file, because that is what a mail
 * system measures. Three 10 MB files are a 30 MB message.
 */
export const MESSAGE_SIZE_LIMIT = 25 * 1024 * 1024;

/**
 * Where a warning starts.
 *
 * Base64 encoding inflates a message by roughly a third in transit, so a 20 MB payload is already
 * near a 25 MB wire limit. Warn rather than block: the limit varies per recipient and this is the
 * agent's judgement, not ours.
 */
export const MESSAGE_SIZE_WARN = 18 * 1024 * 1024;

/** Dataverse's own default, and the inline/chunked switch point. Overridden by the org's value. */
export const DEFAULT_INLINE_CEILING = 5 * 1024 * 1024;

/** How much of a file goes in one `UploadBlock`. 4 MB matched the S6 measurements. */
export const BLOCK_SIZE = 4 * 1024 * 1024;

export type UploadPath = 'inline' | 'chunked';

/**
 * Inline under the org's cap, chunked above it.
 *
 * Inline is one `context.webAPI.createRecord` — supported, security-trimmed, and the path almost
 * every real attachment takes. Chunked needs `window.Xrm.WebApi.online.execute`, because
 * `context.webAPI` has no `execute`; it is the escape hatch, not the default.
 *
 * The boundary is `<` not `<=`: a file exactly at the cap is the case most likely to fail once
 * base64 overhead is added to the request, and the measured failure is a flat HTTP 400.
 */
export function chooseUploadPath(
  fileSize: number,
  inlineCeiling: number = DEFAULT_INLINE_CEILING,
): UploadPath {
  return fileSize < inlineCeiling ? 'inline' : 'chunked';
}

/**
 * The block offsets a chunked upload will send.
 *
 * Block ids are the zero-padded offset, base64-encoded — the scheme S6 used and Dataverse
 * accepted. They must be the same length as each other, which is what the padding is for.
 */
export function planBlocks(fileSize: number, blockSize: number = BLOCK_SIZE): number[] {
  if (fileSize <= 0) return [];
  const out: number[] = [];
  for (let offset = 0; offset < fileSize; offset += blockSize) out.push(offset);
  return out;
}

/**
 * The byte range of one block.
 *
 * **Blocks are sliced from the BYTES and each is base64-encoded on its own** — the scheme S6
 * measured, which is why a 40 MB file is 10 blocks and not 11.
 *
 * The tempting alternative — encode the whole file once, then slice the string — is a trap
 * twice over. Slicing base64 at anything other than a multiple of 4 characters shifts every
 * byte after it; and sizing the blocks from the byte count while slicing by characters leaves
 * the tail unsent, whereupon the commit still succeeds and the customer receives a silently
 * truncated file. Slicing bytes has neither problem, and matches what was proven to work.
 */
export function blockRange(
  offset: number,
  fileSize: number,
  blockSize: number = BLOCK_SIZE,
): { start: number; end: number } {
  return { start: offset, end: Math.min(offset + blockSize, fileSize) };
}

export function blockIdFor(offset: number): string {
  const padded = String(offset).padStart(16, '0');
  // btoa is available in the browser and in jsdom; Buffer is not, in a virtual PCF bundle.
  return btoa(padded);
}

export type AttachmentStatus = 'pending' | 'uploading' | 'done' | 'failed';

/** One file in the compose surface, from drop to committed row. */
export interface PendingAttachment {
  /** Client-side id; stable across renders, unlike the Dataverse id which arrives late. */
  key: string;
  filename: string;
  mimeType: string;
  size: number;
  status: AttachmentStatus;
  /** 0–100. Meaningful for chunked; inline jumps 0 → 100. */
  progress: number;
  /** `activitymimeattachmentid`, once committed. */
  attachmentId?: string;
  /** Why it failed, in words an agent can act on. */
  error?: string;
  /**
   * Carried from a forwarded message rather than uploaded.
   *
   * On forward the existing `attachmentid` is reused: it points at the same stored blob, so it
   * costs nothing and takes no time. Re-uploading would duplicate the bytes for no benefit.
   */
  reusedAttachmentId?: string;
}

export interface Rejection {
  filename: string;
  reason: string;
}

export function totalSize(items: readonly PendingAttachment[]): number {
  return items.reduce((sum, a) => sum + (a.status === 'failed' ? 0 : a.size), 0);
}

/** Human size. Mirrors `ui/tokens.ts#formatSize` so messages here read like the chips do. */
function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/**
 * Which of these files can be attached, and why the rest cannot.
 *
 * Checked **against the running total**, in order, so a batch drop that would take the message
 * over the limit rejects the files that actually crossed it rather than all of them. An agent who
 * drops five files and is told "too big" with no detail cannot tell which one to remove.
 *
 * An empty file is rejected too: a 0-byte attachment is almost always a failed drag, and it
 * arrives at the customer as a broken-looking file.
 */
export function admitFiles(
  incoming: readonly { name: string; size: number; type: string }[],
  existing: readonly PendingAttachment[],
  /**
   * Bytes on the message that the tray does not show — inline images the platform materialised
   * from `cid:` references in the quoted history.
   *
   * Measured 2026-09-25: replying to a message with an inline image silently added **3.9 MB**
   * to the draft. Invisible to the agent, but entirely real on the wire, so a message could be
   * accepted at 24 MB and actually be 28 MB.
   */
  invisibleBytes = 0,
): { accepted: typeof incoming; rejected: Rejection[] } {
  const accepted: { name: string; size: number; type: string }[] = [];
  const rejected: Rejection[] = [];
  let running = totalSize(existing) + Math.max(0, invisibleBytes);
  const names = new Set(existing.map((a) => a.filename.toLowerCase()));

  for (const file of incoming) {
    if (file.size <= 0) {
      rejected.push({ filename: file.name, reason: 'That file is empty.' });
      continue;
    }
    if (file.size > MESSAGE_SIZE_LIMIT) {
      rejected.push({
        filename: file.name,
        reason: `${mb(file.size)} is larger than the ${mb(MESSAGE_SIZE_LIMIT)} most mail systems `
          + 'accept. Share it as a link instead.',
      });
      continue;
    }
    if (running + file.size > MESSAGE_SIZE_LIMIT) {
      rejected.push({
        filename: file.name,
        reason: `This would take the message over ${mb(MESSAGE_SIZE_LIMIT)}, which most mail `
          + 'systems reject. Remove another attachment first.',
      });
      continue;
    }
    if (names.has(file.name.toLowerCase())) {
      rejected.push({ filename: file.name, reason: 'Already attached.' });
      continue;
    }
    names.add(file.name.toLowerCase());
    running += file.size;
    accepted.push(file);
  }

  return { accepted, rejected };
}

/**
 * The line shown under the attachment list, or nothing when there is nothing to say.
 *
 * Deliberately silent below the warning threshold — a running total on every reply is noise.
 */
export function sizeWarning(
  items: readonly PendingAttachment[],
  invisibleBytes = 0,
): string | undefined {
  // Inline images from the quoted history count: they are not in the tray, but they are on the
  // wire, and a warning that ignores them understates the message by megabytes.
  const total = totalSize(items) + Math.max(0, invisibleBytes);
  if (total < MESSAGE_SIZE_WARN) return undefined;
  return `${mb(total)} total, including images in the quoted message. `
    + 'Messages this large are rejected by some mail systems.';
}

/** Percent complete for a chunked upload that has finished `sent` of `total` blocks. */
export function blockProgress(sent: number, total: number): number {
  if (total <= 0) return 100;
  return Math.min(100, Math.round((sent / total) * 100));
}
