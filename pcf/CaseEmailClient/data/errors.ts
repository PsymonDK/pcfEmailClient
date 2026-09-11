/**
 * Turning a Dataverse failure into something an agent can act on.
 *
 * **`context.webAPI` rejects with a plain object, not an `Error`.** Measured 2026-09-10: the usual
 * `err instanceof Error ? err.message : 'Unknown error'` collapses every real failure to "Unknown
 * error", which is exactly what the spike control did and exactly the bar Phase 1 has to clear.
 * So every `catch` in `data/` routes through here, and nothing in this module uses `instanceof`.
 */

export interface NormalisedError {
  /** Something worth showing a person. Never empty, never "Unknown error" if anything better exists. */
  message: string;
  /** Platform error code when one is present, e.g. `0x80040217`. */
  code?: string;
  /** HTTP status when the rejection carries one. */
  status?: number;
  /** The original rejection, for logging. Never rendered. */
  raw: unknown;
}

/** Shapes `context.webAPI` and `Xrm.WebApi` have been observed to reject with. */
interface MaybeErrorShape {
  message?: unknown;
  errorCode?: unknown;
  status?: unknown;
  code?: unknown;
  error?: { message?: unknown; code?: unknown };
  raw?: unknown;
}

const str = (v: unknown): string | undefined => {
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  if (typeof v === 'number') return String(v);
  return undefined;
};

export function normaliseWebApiError(rejection: unknown): NormalisedError {
  // A real Error is the easy case, but it is NOT the common one here.
  if (rejection instanceof Error && rejection.message) {
    return { message: rejection.message, raw: rejection };
  }

  if (typeof rejection === 'string' && rejection.trim().length > 0) {
    return { message: rejection.trim(), raw: rejection };
  }

  if (rejection && typeof rejection === 'object') {
    const o = rejection as MaybeErrorShape;

    const message =
      str(o.message) ??
      str(o.error?.message) ??
      // Last resort: serialise it. Ugly, but an ugly message beats "Unknown error", because it
      // can be pasted into a bug report and acted on.
      safeStringify(rejection);

    const code = str(o.errorCode) ?? str(o.code) ?? str(o.error?.code);
    const status = typeof o.status === 'number' ? o.status : undefined;

    return { message, code, status, raw: rejection };
  }

  return { message: 'The request failed and the platform gave no reason.', raw: rejection };
}

function safeStringify(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (json && json !== '{}' && json !== 'null') return json;
  } catch {
    /* circular, or otherwise unserialisable */
  }
  return 'The request failed and the platform gave no reason.';
}

/**
 * Turns a failure into the sentence a person reads.
 *
 * Deliberately never the raw platform message and never the word "error" on its own: the rules in
 * docs/design/03-interaction-spec.md require saying what failed, whether anything was lost, and
 * what to do next. `detail` stays available for a "Details" disclosure.
 */
export function agentFacingMessage(
  err: NormalisedError,
  operation: 'list' | 'body' | 'attachments' | 'attachment-download' | 'read-state',
): { headline: string; reassurance?: string; detail: string } {
  const detail = err.code ? `${err.message} (${err.code})` : err.message;

  switch (operation) {
    case 'list':
      return {
        headline: "Couldn't load this case's email",
        // The agent's first question, every time.
        reassurance: 'Your drafts are safe.',
        detail,
      };
    case 'body':
      return { headline: "Message text couldn't be loaded", detail };
    case 'attachments':
      return { headline: "Couldn't load the attachment list", detail };
    case 'attachment-download':
      return { headline: "Couldn't download that file", detail };
    case 'read-state':
      // Read state failing is not worth interrupting anyone over: the mail is still readable.
      return { headline: "Couldn't update read status", detail };
  }
}
