// Writes the one default row into jhrb_emailclientsetting. Dry run unless --confirm.
//
//   node scripts/deploy/seed-settings.mjs [--confirm]
//
// A settings table with no rows is indistinguishable from a settings table the agent cannot read:
// both resolve to "send as the agent". So an empty table is not a neutral starting state, it is a
// silently-off feature. One default row makes the configured behaviour the actual behaviour, and
// gives an administrator something to edit rather than something to invent.
//
// Idempotent: if a default row already exists it is reported and left alone. Editing live
// configuration is an administrator's job, not a deployment script's.
//
// Environment guard and token acquisition: see scripts/deploy/README.md.
import {
  CONFIRM, api as dvApi, getEnv, writeIds,
} from '../lib/dv.mjs';
import { DEFAULT_SETTINGS_ROW } from '../lib/settings-defaults.mjs';

const { org: ORG } = getEnv();

const TABLE = 'jhrb_emailclientsetting';
const IDS_FILE = `${import.meta.dirname}/settings-row-ids.json`;

// Shared with scripts/install/post-import.mjs so the two installers cannot seed different defaults.
const DEFAULT_ROW = DEFAULT_SETTINGS_ROW;

// Data rows, not components — no solution header.
const api = (path, method = 'GET', body) => dvApi(path, { method, body });

console.log(`Target: ${ORG}`);
console.log(`Table:  ${TABLE}\n`);

const existing = (await api(
  `${TABLE}s?$select=jhrb_emailclientsettingid,jhrb_name,jhrb_sendfromqueue,jhrb_allowsenderoverride`
  + ',jhrb_recipiententity,jhrb_recipientlookup'
  + '&$filter=statecode eq 0 and jhrb_isdefault eq true',
)).json.value;

if (existing.length > 0) {
  console.log('A default row already exists:');
  for (const r of existing) {
    console.log(`  "${r.jhrb_name}"  sendFromQueue=${r.jhrb_sendfromqueue}  `
      + `allowOverride=${r.jhrb_allowsenderoverride}  `
      + `recipient=${r.jhrb_recipiententity ?? '(unset)'}/${r.jhrb_recipientlookup ?? '(unset)'}  `
      + `${r.jhrb_emailclientsettingid}`);
  }
  if (existing.length > 1) {
    console.log('\nWARNING: more than one default row. `pickSetting` takes the first the platform');
    console.log('returns, which is not a stable choice. Deactivate all but one.');
  }

  /*
   * Backfill values a NEWER column added after this row was created.
   *
   * Only ever fills a field that is empty — an administrator's own choice is never overwritten.
   * Without this, adding a column leaves every existing deployment with it unset and the
   * feature silently inert, which is the same shape of failure as a guard nothing passes.
   */
  const row = existing[0];
  const backfill = {};
  for (const key of ['jhrb_recipiententity', 'jhrb_recipientlookup']) {
    if (!row[key] && DEFAULT_ROW[key]) backfill[key] = DEFAULT_ROW[key];
  }

  if (Object.keys(backfill).length === 0) {
    console.log('\nNothing to backfill.');
    process.exit(0);
  }
  if (!CONFIRM) {
    console.log('\nDRY RUN — would backfill the empty fields:');
    for (const [k, v] of Object.entries(backfill)) console.log(`  ${k.padEnd(24)} ${v}`);
    console.log('\nRe-run with --confirm.');
    process.exit(0);
  }
  await api(`${TABLE}s(${row.jhrb_emailclientsettingid})`, 'PATCH', backfill);
  console.log('\nBackfilled:');
  for (const [k, v] of Object.entries(backfill)) console.log(`  ${k.padEnd(24)} ${v}`);
  process.exit(0);
}

if (!CONFIRM) {
  console.log('DRY RUN — nothing written. Re-run with --confirm.\n');
  console.log('Would create one row:');
  for (const [k, v] of Object.entries(DEFAULT_ROW)) console.log(`  ${k.padEnd(24)} ${v}`);
  process.exit(0);
}

const created = await api(`${TABLE}s`, 'POST', DEFAULT_ROW);
console.log(`Created the default row -> ${created.id}`);

writeIds(IDS_FILE, {
  createdAt: new Date().toISOString(), org: ORG, table: TABLE, rowId: created.id, row: DEFAULT_ROW,
});
console.log('Wrote settings-row-ids.json');
console.log('\nTo send as the agent instead, set Send from queue to No on this row — no redeploy.');
