// Deletes the seed data created by seed.mjs: the 12 email activities listed in
// seeded-ids.json, and then the seed Case itself.
//
//   DV_TOKEN=$(az account get-access-token --resource <org> --query accessToken -o tsv) \
//     node scripts/seed/cleanup.mjs [--dry-run]
//
// Defaults to a dry run unless --confirm is passed, because this deletes rows.
import fs from 'node:fs';

const SP = import.meta.dirname;
const ORG = process.env.DV_ORG || 'https://your-org.crm4.dynamics.com';
const TOK = process.env.DV_TOKEN || fs.readFileSync(`${SP}/../../.tok`, 'utf8').trim();
const CONFIRM = process.argv.includes('--confirm');

const manifest = JSON.parse(fs.readFileSync(`${SP}/seeded-ids.json`, 'utf8'));

const del = async (path) => {
  const r = await fetch(`${ORG}/api/data/v9.2/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${TOK}`, 'OData-Version': '4.0' },
  });
  if (!r.ok && r.status !== 404) {
    return `FAILED ${r.status}: ${(await r.text()).slice(0, 200)}`;
  }
  return r.status === 404 ? 'already gone' : 'deleted';
};

console.log(`Target: ${ORG}`);
console.log(`Case:   ${manifest.caseId}`);
console.log(`Emails: ${manifest.emails.length}`);

if (!CONFIRM) {
  console.log('\nDRY RUN - nothing deleted. Re-run with --confirm to actually delete.');
  for (const e of manifest.emails) console.log(`  would delete email ${e.id}  ${e.subject.slice(0, 50)}`);
  console.log(`  would delete case  ${manifest.caseId}`);
  process.exit(0);
}

for (const e of manifest.emails) {
  console.log(`  email ${e.id}  ${await del(`emails(${e.id})`)}`);
}
console.log(`  case  ${manifest.caseId}  ${await del(`incidents(${manifest.caseId})`)}`);
console.log('\nDone.');
