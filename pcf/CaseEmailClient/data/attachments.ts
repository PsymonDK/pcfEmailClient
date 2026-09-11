import { assertGuid, buildAttachmentBodyQuery, type WebApiLike } from './emailQueries';
import { normaliseWebApiError } from './errors';

/**
 * Downloading an attachment (R5).
 *
 * Acceptance sentence: *"Click an attachment; the correct file downloads."* Until now
 * `onDownloadAttachment` was a stub, so R5 was half-built — the chips listed correctly and did
 * nothing.
 *
 * The body is fetched **on click, never with the metadata**. Selecting `body` alongside the
 * filename would download every attachment on the case just to render a list, which is the same
 * blob-storage trap as fetching message bodies in a list query.
 */

/** Above this, the inline base64 path is the wrong tool — see the note on chunked download below. */
export const INLINE_DOWNLOAD_CEILING = 8 * 1024 * 1024;

export interface DownloadRequest {
  activityMimeAttachmentId: string;
  filename: string;
  mimeType: string;
  fileSize: number;
}

export interface DownloadOutcome {
  ok: boolean;
  /** Set when the download could not be offered. Already agent-facing. */
  reason?: string;
  detail?: string;
}

/**
 * Fetches one attachment and hands it to the browser.
 *
 * Deliberately takes its DOM dependencies as parameters so the orchestration is testable without
 * a browser: what gets fetched, what gets refused, and that the object URL is always revoked.
 */
export async function downloadAttachment(
  webApi: WebApiLike,
  request: DownloadRequest,
  io: DownloadIo,
): Promise<DownloadOutcome> {
  try {
    assertGuid(request.activityMimeAttachmentId, 'activityMimeAttachmentId');
  } catch {
    return { ok: false, reason: "Couldn't download that file", detail: 'The attachment id was not valid.' };
  }

  // Refuse rather than hang. `body` is base64, so a 40 MB file arrives as ~54 MB of string through
  // a JSON payload; the platform has a chunked download API (`BlocksDownloadRequest`) for this, and
  // it needs `Xrm.WebApi.online.execute` because `context.webAPI` has no `execute`. Until that path
  // is built, say so plainly instead of freezing the tab.
  if (request.fileSize > INLINE_DOWNLOAD_CEILING) {
    return {
      ok: false,
      reason: 'This file is too large to download here yet',
      detail:
        `${request.filename} is ${(request.fileSize / (1024 * 1024)).toFixed(1)} MB. ` +
        'Open the email record to download it. Chunked download is not built yet.',
    };
  }

  let base64: string;
  try {
    const row = await webApi.retrieveRecord(
      'activitymimeattachment',
      request.activityMimeAttachmentId,
      buildAttachmentBodyQuery(),
    );
    base64 = typeof row.body === 'string' ? row.body : '';
  } catch (rejection) {
    // context.webAPI rejects with a plain object, not an Error.
    const err = normaliseWebApiError(rejection);
    return { ok: false, reason: "Couldn't download that file", detail: err.code ? `${err.message} (${err.code})` : err.message };
  }

  if (base64.length === 0) {
    return {
      ok: false,
      reason: "Couldn't download that file",
      detail: 'The platform returned no content for this attachment.',
    };
  }

  let url: string | undefined;
  try {
    const blob = io.toBlob(base64, request.mimeType);
    url = io.createObjectUrl(blob);
    io.save(url, request.filename);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: "Couldn't download that file",
      detail: e instanceof Error ? e.message : 'The browser refused the download.',
    };
  } finally {
    // Always revoked, on every path. An object URL held open pins the whole file in memory, and a
    // case with a dozen attachments would accumulate them for the life of the session.
    if (url) io.revokeObjectUrl(url);
  }
}

/** The browser bits, injected so the logic above can be tested without one. */
export interface DownloadIo {
  toBlob(base64: string, mimeType: string): Blob;
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  save(url: string, filename: string): void;
}

/** The real implementation, for the control. */
export const browserDownloadIo: DownloadIo = {
  toBlob(base64, mimeType) {
    // atob gives a binary string; it has to go through a byte array or non-ASCII content corrupts.
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
  },
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  save(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    // Must be in the document for Firefox to honour the click.
    document.body.appendChild(a);
    a.click();
    a.remove();
  },
};
