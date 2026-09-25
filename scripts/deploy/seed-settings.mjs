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
import fs from 'node:fs';

const ORG = process.env.DV_ORG || 'https://your-org.crm4.dynamics.com';
const TOK = process.env.DV_TOKEN || fs.readFileSync(`${import.meta.dirname}/../../.tok`, 'utf8').trim();
const CONFIRM = process.argv.includes('--confirm');

const TABLE = 'jhrb_emailclientsetting';
const IDS_FILE = `${import.meta.dirname}/settings-row-ids.json`;

const DEFAULT_ROW = {
  jhrb_name: 'Default',
  jhrb_isdefault: true,
  // The point of the feature: a customer replying to a case reaches the queue, not a person.
  jhrb_sendfromqueue: true,
  // The agent can still send as themselves when that is genuinely the right thing — pre-flight
  // will tell them if their own mailbox cannot deliver.
  jhrb_allowsenderoverride: true,
  // Where a NEW message's default recipient comes from. `customerid` because it is populated on
  // virtually every Case and accepts either an account or a contact — both valid party targets.
  jhrb_recipiententity: 'incident',
  jhrb_recipientlookup: 'customerid',
};

const api = async (path, method = 'GET', body) => {
  const r = await fetch(`${ORG}/api/data/v9.2/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOK}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'OData-Version': '4.0',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { /* not json */ }
  if (!r.ok) {
    throw new Error(`${method} ${path} -> ${r.status}: ${String(json?.error?.message ?? txt).replace(/\s+/g, ' ').slice(0, 280)}`);
  }
  return { json, id: r.headers.get('OData-EntityId')?.match(/\(([^)]+)\)/)?.[1] };
};

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

fs.writeFileSync(IDS_FILE, JSON.stringify({
  createdAt: new Date().toISOString(), org: ORG, table: TABLE, rowId: created.id, row: DEFAULT_ROW,
}, null, 2) + '\n');
console.log(`Wrote ${IDS_FILE}`);
console.log('\nTo send as the agent instead, set Send from queue to No on this row — no redeploy.');
