/**
 * Record ids, in one place.
 *
 * The platform hands ids around in two spellings — `4f2d39f5-…` from the Web API, and
 * `{4F2D39F5-…}` from `userSettings.userId` and `Xrm.Utility.lookupObjects` — and until
 * 2026-09-28 about twenty call sites each stripped the braces by hand with `/^\{|\}$/g`. That
 * regex removes EITHER brace independently, so `{guid` passed validation and then went into a URL
 * still carrying its brace (L4). Everything now goes through these three.
 *
 * GUIDs go into filters and `@odata.bind` paths unquoted, so they are the one place a caller could
 * inject OData. Validate rather than escape: a non-GUID here is always a bug, never input.
 */

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Strip ONE balanced pair of braces and lower-case. No validation — for comparing ids, where a
 * malformed one simply matches nothing. Anything going into a request uses `toGuid`.
 */
export function bareId(value: string): string {
  const braced = /^\{(.*)\}$/.exec(value);
  return (braced ? braced[1] : value).toLowerCase();
}

export function isGuid(value: string): boolean {
  return GUID_RE.test(bareId(value));
}

/** The bare, lower-case GUID — or a throw naming what was wrong. For URLs, filters and binds. */
export function toGuid(value: string, what: string): string {
  const id = bareId(value);
  if (!GUID_RE.test(id)) throw new Error(`${what} is not a GUID: ${JSON.stringify(value)}`);
  return id;
}
