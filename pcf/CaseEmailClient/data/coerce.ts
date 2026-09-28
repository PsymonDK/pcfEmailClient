/**
 * Dataverse rows arrive as `Record<string, unknown>`, and `String(unknown)` happily produces
 * "[object Object]" for anything that is not a primitive. This keeps that out of the UI.
 *
 * One copy (R4, 2026-09-28) of what four files each defined for themselves. `errors.ts` and
 * `settings.ts` keep their own on purpose: they TRIM and return `undefined` for blank, because
 * for them blank means "not set", not "empty string".
 */
export function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}
