import type { WebApiLike } from './emailQueries';
import { normaliseWebApiError, type NormalisedError } from './errors';
import type { SettingRow } from '../domain/sender';

/**
 * The control's own configuration table, `jhrb_emailclientsetting`.
 *
 * Its own, deliberately: the behaviour it drives — send as the Case's queue rather than as the
 * agent — already exists on the standard email form via a separate customisation's table, and a
 * product that reads someone else's table inherits their deployment, their naming and their
 * lifecycle. This one ships in `JHRBCaseEmailClient`.
 *
 * Organization-owned, because it is configuration rather than per-agent data. (`jhrb_emailreadstate`
 * is UserOwned for the opposite reason.) Agents only ever read it.
 *
 * All active rows come back in one query — there will be one to three — and `pickSetting` in
 * `domain/sender.ts` applies the precedence. Doing the choosing client-side keeps the rule in one
 * tested place instead of splitting it between a `$filter` and a function.
 */

export const SETTINGS_ENTITY = 'jhrb_emailclientsetting';

const SETTINGS_COLUMNS = [
  'jhrb_emailclientsettingid',
  'jhrb_name',
  'jhrb_isdefault',
  'jhrb_sendfromqueue',
  'jhrb_allowsenderoverride',
  '_jhrb_queue_value',
  '_jhrb_overridequeue_value',
  'jhrb_recipiententity',
  'jhrb_recipientlookup',
] as const;

export function buildSettingsQuery(): string {
  return (
    `?$select=${SETTINGS_COLUMNS.join(',')}`
    + '&$filter=statecode eq 0'
    // Queue-specific rows first so a page truncated at the cap keeps the more specific ones.
    + '&$orderby=jhrb_isdefault asc'
  );
}

const bool = (v: unknown): boolean => v === true;
const str = (v: unknown): string | undefined =>
  (typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined);
const guid = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

/**
 * Every active settings row.
 *
 * **Returns `[]` on failure, never throws.** No rows resolves to "send as the agent" — exactly
 * what stock Dynamics does — so an unreadable settings table degrades to normal behaviour. The
 * alternative, defaulting to the queue when configuration cannot be read, would change who mail
 * appears to come from on the strength of a failed request.
 *
 * The most likely cause of a failure here is the missing read privilege: a new custom table grants
 * privileges to nobody but System Administrator and System Customizer, so every agent sees zero
 * rows until the security role is assigned. That is silent by design at the Dataverse level, which
 * is why the error is returned rather than swallowed — the caller logs it.
 */
export async function fetchSettings(
  webApi: WebApiLike,
): Promise<{ rows: SettingRow[]; error?: NormalisedError }> {
  try {
    const page = await webApi.retrieveMultipleRecords(SETTINGS_ENTITY, buildSettingsQuery(), 25);
    return { rows: page.entities.map(toSettingRow) };
  } catch (rejection) {
    return { rows: [], error: normaliseWebApiError(rejection) };
  }
}

export function toSettingRow(row: Record<string, unknown>): SettingRow {
  return {
    queueId: guid(row._jhrb_queue_value),
    isDefault: bool(row.jhrb_isdefault),
    sendFromQueue: bool(row.jhrb_sendfromqueue),
    allowSenderOverride: bool(row.jhrb_allowsenderoverride),
    overrideQueueId: guid(row._jhrb_overridequeue_value),
    recipientEntity: str(row.jhrb_recipiententity),
    recipientLookup: str(row.jhrb_recipientlookup),
  };
}
