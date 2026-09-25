// Removes the email client settings table again. Dry run unless --confirm.
//
//   node scripts/deploy/revert-settings-table.mjs [--confirm]
//
// Deleting the table drops its columns, its queue lookups and its rows with it. This is a SHARED
// environment, so the script refuses to touch anything whose name it did not create.
//
// The Read privilege granted by grant-settings-read.mjs disappears with the table, so there is
// nothing to unwind on the role. The role itself belongs to the read-state feature and is left
// alone — see revert-readstate-table.mjs for that one.
import fs from 'node:fs';

const ORG = process.env.DV_ORG || 'https://your-org.crm4.dynamics.com';
const TOK = process.env.DV_TOKEN || fs.readFileSync(`${import.meta.dirname}/../../.tok`, 'utf8').trim();
const CONFIRM = process.argv.includes('--confirm');
const TABLE = 'jhrb_emailclientsetting';
const IDS_FILES = [
  `${import.meta.dirname}/settings-ids.json`,
  `${import.meta.dirname}/settings-role-ids.json`,
  `${import.meta.dirname}/settings-row-ids.json`,
];

const api = async (path, method = 'GET') => {
  const r = await fetch(`${ORG}/api/data/v9.2/${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOK}`, Accept: 'application/json', 'OData-Version': '4.0' },
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${txt.replace(/\s+/g, ' ').slice(0, 250)}`);
  return txt ? JSON.parse(txt) : null;
};

const found = await api(`EntityDefinitions(LogicalName='${TABLE}')?$select=MetadataId,IsCustomEntity`)
  .catch(() => null);

if (!found) {
  console.log(`${TABLE} does not exist. Nothing to do.`);
  process.exit(0);
}
// Belt and braces: never delete something the platform owns.
if (found.IsCustomEntity !== true) {
  console.log(`REFUSING: ${TABLE} is not a custom entity.`);
  process.exit(1);
}

const rows = await api(`${TABLE}s?$select=jhrb_name&$top=50`).catch(() => ({ value: [] }));
console.log(`${TABLE} exists (${found.MetadataId}) with ${rows.value.length} row(s):`);
for (const r of rows.value) console.log(`  "${r.jhrb_name}"`);

if (!CONFIRM) {
  console.log('\nDRY RUN — nothing deleted. Re-run with --confirm.');
  console.log('Would delete the table, and with it its columns, queue lookups and every row above.');
  console.log('The client then falls back to sending as the agent, which is stock behaviour.');
  process.exit(0);
}

await api(`EntityDefinitions(LogicalName='${TABLE}')`, 'DELETE');
console.log(`Deleted ${TABLE}.`);
for (const f of IDS_FILES) {
  if (fs.existsSync(f)) {
    fs.unlinkSync(f);
    console.log(`Removed ${f}.`);
  }
}
