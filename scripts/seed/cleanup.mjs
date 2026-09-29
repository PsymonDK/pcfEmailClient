// Deletes the seed data created by seed.mjs: the email activities listed in seeded-ids.json, and
// then the seed Case itself.
//
//   node scripts/seed/cleanup.mjs [--confirm]
//
// Environment guard and token acquisition: see scripts/deploy/README.md.
//
// Defaults to a dry run unless --confirm is passed, because this deletes rows. When every delete
// succeeds (or finds the row already gone) the manifest is emptied, which is what lets seed.mjs
// run again; after a partial failure it is kept so a re-run can finish the job.
import {
  CONFIRM, api, assertGuid, assertIdsOrg, getEnv, readIds, writeIds,
} from '../lib/dv.mjs';

const SP = import.meta.dirname;
const { org: ORG } = getEnv();
const MANIFEST = `${SP}/seeded-ids.json`;

const manifest = readIds(MANIFEST);
if (!manifest?.caseId && !manifest?.emails?.length) {
  console.log('seeded-ids.json lists nothing. Nothing to do.');
  process.exit(0);
}
// Ids only mean something in the environment that created them.
assertIdsOrg(manifest, ORG);
const CASE = manifest.caseId ? assertGuid(manifest.caseId, 'seeded-ids.json caseId') : null;
const emails = (manifest.emails ?? []).map((e) => ({ ...e, id: assertGuid(e.id, 'seeded-ids.json email id') }));

let allOk = true;
const del = async (path) => {
  try {
    // 404 genuinely means "already gone" here; every other failure is reported, not swallowed.
    const r = await api(path, { method: 'DELETE', allow404: true });
    return r === null ? 'already gone' : 'deleted';
  } catch (e) {
    allOk = false;
    return `FAILED ${e.message.slice(0, 200)}`;
  }
};

console.log(`Target: ${ORG}`);
console.log(`Case:   ${CASE ?? '(none)'}`);
console.log(`Emails: ${emails.length}`);

if (!CONFIRM) {
  console.log('\nDRY RUN - nothing deleted. Re-run with --confirm to actually delete.');
  for (const e of emails) console.log(`  would delete email ${e.id}  ${String(e.subject ?? '').slice(0, 50)}`);
  if (CASE) console.log(`  would delete case  ${CASE}`);
  process.exit(0);
}

for (const e of emails) {
  console.log(`  email ${e.id}  ${await del(`emails(${e.id})`)}`);
}
if (CASE) console.log(`  case  ${CASE}  ${await del(`incidents(${CASE})`)}`);

if (allOk) {
  writeIds(MANIFEST, { org: ORG, caseId: null, emails: [], cleanedAt: new Date().toISOString() });
  console.log('\nDone. seeded-ids.json emptied.');
} else {
  console.log('\nSome deletes FAILED. seeded-ids.json is kept so a re-run can finish the job.');
  process.exit(1);
}
