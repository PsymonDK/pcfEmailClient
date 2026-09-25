import { assertGuid } from './emailQueries';
import { normaliseWebApiError, type NormalisedError } from './errors';
import { resolveXrmExecute, type XrmExecute } from './templates';
import type { DraftApiLike } from './draft';
import {
  blockIdFor, blockRange, BLOCK_SIZE, chooseUploadPath, DEFAULT_INLINE_CEILING, planBlocks,
} from '../domain/attachments';

/**
 * Uploading a file onto a draft email (R13).
 *
 * `activitymimeattachment` rows hang off the email by `objectid` + `objecttypecode: 'email'`, so
 * **the draft row must exist before anything can be attached**. R16 is what makes that true.
 *
 * Two paths, measured in S6 (2026-09-10):
 *
 * | Size | Path | Result |
 * |---|---|---|
 * | 4 MB | inline base64 | OK |
 * | **6 MB** | **inline** | **HTTP 400 — "Attachment file size is too big."** |
 * | 6 MB | chunked | OK, 2 blocks |
 * | **40 MB** | **chunked** | **OK, 10 blocks — 8× the org cap** |
 *
 * `Organization.MaxUploadFileSize` (5 MB here) governs **only** the inline path; the chunked path
 * ignores it entirely. So large attachments do not need an admin to raise a System Setting — they
 * need the chunked API. That removes an admin dependency from the design.
 *
 * **Inline is the default anyway**, because it is one `context.webAPI.createRecord`: supported,
 * security-trimmed, and what almost every real attachment takes. Chunked has to reach
 * `window.Xrm.WebApi.online.execute`, since `context.webAPI` exposes no `execute` — the same
 * documented escape hatch `InstantiateTemplate` uses, and the only one in this project.
 */

export interface UploadRequest {
  emailId: string;
  filename: string;
  mimeType: string;
  /** The file's raw bytes. Encoded per block for chunked, whole for inline. */
  bytes: Uint8Array;
}

export interface UploadOutcome {
  ok: boolean;
  attachmentId?: string;
  error?: NormalisedError;
}

/** Reported per block so a 40 MB upload is not a frozen spinner. */
export type ProgressFn = (sentBlocks: number, totalBlocks: number) => void;

const bare = (id: string) => id.replace(/^\{|\}$/g, '');

/** The `Target` every upload message needs: which email this attaches to. */
function targetFor(req: UploadRequest): Record<string, unknown> {
  return {
    '@odata.type': 'Microsoft.Dynamics.CRM.activitymimeattachment',
    'objectid_email@odata.bind': `/emails(${bare(req.emailId)})`,
    objecttypecode: 'email',
    subject: req.filename,
    filename: req.filename,
    mimetype: req.mimeType || 'application/octet-stream',
  };
}

/**
 * The ordinary path: one create, body as base64.
 *
 * Fails cleanly with HTTP 400 above `MaxUploadFileSize` — no hang, no partial write — which is
 * why `chooseUploadPath` can route by size instead of trying and recovering.
 */
export async function uploadInline(
  webApi: DraftApiLike,
  req: UploadRequest,
): Promise<UploadOutcome> {
  try {
    assertGuid(req.emailId, 'emailId');
  } catch (e) {
    return { ok: false, error: { message: 'No draft to attach to.', raw: e } };
  }

  try {
    const created = await webApi.createRecord('activitymimeattachment', {
      'objectid_email@odata.bind': `/emails(${bare(req.emailId)})`,
      objecttypecode: 'email',
      subject: req.filename,
      filename: req.filename,
      mimetype: req.mimeType || 'application/octet-stream',
      body: bytesToBase64(req.bytes),
    });
    return { ok: true, attachmentId: bare(created.id) };
  } catch (rejection) {
    return { ok: false, error: normaliseWebApiError(rejection) };
  }
}

/**
 * The large-file path: Initialize → UploadBlock × n → Commit.
 *
 * Every parameter is declared `Edm.String` except the block list, which is a collection of them.
 * That is not laziness: `Xrm.WebApi.online.execute` was measured (2026-09-23, on
 * `InstantiateTemplate`) to reject `Edm.Guid` parameters with an anonymous *"Error identified in
 * Payload provided by the user for Entity :''"*. The raw Web API accepts either, so this only
 * shows up from inside the client.
 */
export async function uploadChunked(
  req: UploadRequest,
  onProgress?: ProgressFn,
  execute: XrmExecute | undefined = resolveXrmExecute(),
  blockSize: number = BLOCK_SIZE,
): Promise<UploadOutcome> {
  if (!execute) {
    return {
      ok: false,
      error: {
        message: 'Large attachments need the platform API, which is not available here.',
        raw: undefined,
      },
    };
  }

  try {
    assertGuid(req.emailId, 'emailId');
  } catch (e) {
    return { ok: false, error: { message: 'No draft to attach to.', raw: e } };
  }

  const target = targetFor(req);

  try {
    const init = await execute({
      Target: target,
      getMetadata: () => ({
        boundParameter: null,
        parameterTypes: {
          // structuralProperty 5 = EntityType. The Target really is an entity instance, not a
          // complex type, and declaring it 2 is rejected.
          Target: { typeName: 'mscrm.activitymimeattachment', structuralProperty: 5 },
        },
        operationType: 0,
        operationName: 'InitializeAttachmentBlocksUpload',
      }),
    });
    const initBody = await init.json() as { FileContinuationToken?: string };
    const token = initBody.FileContinuationToken;
    if (!token) {
      return { ok: false, error: { message: 'The upload could not be started.', raw: initBody } };
    }

    /*
     * Base64 is 4 characters per 3 bytes, so a block boundary must land on a multiple of 4
     * characters or every following byte shifts.
     *
     * **The loop is driven by the base64 LENGTH, not by the byte size.** Deriving the block count
     * from bytes while slicing by characters does not divide evenly: at a 4 MB block a 40 MB file
     * plans 10 blocks but needs 5592404 characters each, and 10 × that is 16 characters short of
     * the encoded string. Those 16 characters would simply never be sent, and the commit would
     * succeed — a silently truncated file at the customer's end. Count the slices.
     */
    // Blocks are sliced from the BYTES and each is encoded on its own — S6's scheme, and the
    // only one measured against Dataverse. See `domain/attachments.ts#blockRange` for why
    // slicing the encoded string instead is wrong in two separate ways.
    const offsets = planBlocks(req.bytes.length, blockSize);
    const totalBlocks = offsets.length;
    const blockIds: string[] = [];

    for (let i = 0; i < totalBlocks; i += 1) {
      const { start, end } = blockRange(offsets[i], req.bytes.length, blockSize);
      const blockId = blockIdFor(start);
      blockIds.push(blockId);
      await execute({
        BlockId: blockId,
        BlockData: bytesToBase64(req.bytes.subarray(start, end)),
        FileContinuationToken: token,
        getMetadata: () => ({
          boundParameter: null,
          parameterTypes: {
            BlockId: { typeName: 'Edm.String', structuralProperty: 1 },
            BlockData: { typeName: 'Edm.String', structuralProperty: 1 },
            FileContinuationToken: { typeName: 'Edm.String', structuralProperty: 1 },
          },
          operationType: 0,
          operationName: 'UploadBlock',
        }),
      });
      onProgress?.(i + 1, totalBlocks);
    }

    const commit = await execute({
      BlockList: blockIds,
      FileContinuationToken: token,
      Target: target,
      getMetadata: () => ({
        boundParameter: null,
        parameterTypes: {
          // structuralProperty 4 = Collection.
          BlockList: { typeName: 'Collection(Edm.String)', structuralProperty: 4 },
          FileContinuationToken: { typeName: 'Edm.String', structuralProperty: 1 },
          Target: { typeName: 'mscrm.activitymimeattachment', structuralProperty: 5 },
        },
        operationType: 0,
        operationName: 'CommitAttachmentBlocksUpload',
      }),
    });
    const body = await commit.json() as {
      ActivityMimeAttachmentId?: string; activitymimeattachmentid?: string;
    };
    const id = body.ActivityMimeAttachmentId ?? body.activitymimeattachmentid;
    return id
      ? { ok: true, attachmentId: bare(id) }
      : { ok: false, error: { message: 'The upload finished but returned no id.', raw: body } };
  } catch (rejection) {
    return { ok: false, error: normaliseWebApiError(rejection) };
  }
}

/** Route by size, then upload. One entry point so callers cannot pick the wrong path. */
export async function uploadAttachment(
  webApi: DraftApiLike,
  req: UploadRequest,
  inlineCeiling: number = DEFAULT_INLINE_CEILING,
  onProgress?: ProgressFn,
): Promise<UploadOutcome> {
  return chooseUploadPath(req.bytes.length, inlineCeiling) === 'inline'
    ? uploadInline(webApi, req)
    : uploadChunked(req, onProgress);
}

/**
 * Attach a file that already exists in Dataverse, by pointing at its stored blob.
 *
 * Used on **forward**: `attachmentid` refers to the same underlying `attachment` row, so reusing
 * it costs one small create and no bytes at all. Re-uploading would duplicate storage and make
 * the agent wait for something the platform already has.
 */
export async function reuseAttachment(
  webApi: DraftApiLike,
  emailId: string,
  attachmentId: string,
): Promise<UploadOutcome> {
  try {
    assertGuid(emailId, 'emailId');
    assertGuid(attachmentId, 'attachmentId');
    const created = await webApi.createRecord('activitymimeattachment', {
      'objectid_email@odata.bind': `/emails(${bare(emailId)})`,
      objecttypecode: 'email',
      'attachmentid@odata.bind': `/attachments(${bare(attachmentId)})`,
    });
    return { ok: true, attachmentId: bare(created.id) };
  } catch (rejection) {
    return { ok: false, error: normaliseWebApiError(rejection) };
  }
}

/** Remove an attachment the agent changed their mind about. */
export async function removeAttachment(
  webApi: DraftApiLike,
  activityMimeAttachmentId: string,
): Promise<{ ok: boolean; error?: NormalisedError }> {
  try {
    assertGuid(activityMimeAttachmentId, 'activityMimeAttachmentId');
    await webApi.deleteRecord('activitymimeattachment', bare(activityMimeAttachmentId));
    return { ok: true };
  } catch (rejection) {
    return { ok: false, error: normaliseWebApiError(rejection) };
  }
}

/**
 * The org's inline ceiling.
 *
 * Read rather than hardcoded because it is an org setting an admin may have raised — and if they
 * have, more files can take the cheaper, supported inline path. Falls back to the documented
 * default rather than failing: getting the switch point slightly wrong costs one retry on the
 * other path, not the attachment.
 */
export async function fetchInlineCeiling(webApi: DraftApiLike): Promise<number> {
  try {
    const page = await webApi.retrieveMultipleRecords(
      'organization', '?$select=maxuploadfilesize', 1,
    );
    const value = page.entities[0]?.maxuploadfilesize;
    return typeof value === 'number' && value > 0 ? value : DEFAULT_INLINE_CEILING;
  } catch {
    return DEFAULT_INLINE_CEILING;
  }
}

/**
 * Base64-encode bytes.
 *
 * **Fed through `String.fromCharCode` in small runs on purpose.** Spreading a whole file into
 * `fromCharCode(...bytes)` blows the argument limit and throws `RangeError: Maximum call stack
 * size exceeded` somewhere around 100 KB — on a 4 MB block it is certain. The failure looks like
 * a browser bug rather than an encoding mistake, which is why this is a named function and not
 * an inline one-liner.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const RUN = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += RUN) {
    binary += String.fromCharCode(...bytes.subarray(i, i + RUN));
  }
  return btoa(binary);
}

/** Read a browser `File` into memory. */
export async function fileToBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
