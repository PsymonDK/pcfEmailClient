// Removes the read-state table again. Dry run unless --confirm.
//
//   node scripts/deploy/revert-readstate-table.mjs [--confirm]
//
// Deleting the table drops its lookups, its key and its rows with it — no need to unwind the
// relationships first. This is a SHARED environment, so the script refuses to touch anything whose
// name it did not create.
import fs from 'node:fs';

const ORG = process.env.DV_ORG || 'https://your-org.crm4.dynamics.com';
const TOK = process.env.DV_TOKEN || fs.readFileSync(`${import.meta.dirname}/../../.tok`, 'utf8').trim();
const CONFIRM = process.argv.includes('--confirm');
const TABLE = 'jhrb_emailreadstate';
const IDS_FILE = `${import.meta.dirname}/readstate-ids.json`;

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

const rows = await api(`${TABLE}s?$select=${TABLE}id&$top=50`).catch(() => ({ value: [] }));
console.log(`${TABLE} exists (${found.MetadataId}) with at least ${rows.value.length} row(s).`);

if (!CONFIRM) {
  console.log('\nDRY RUN — nothing deleted. Re-run with --confirm.');
  console.log('Would delete the table, and with it its lookups, alternate key and every row.');
  process.exit(0);
}

await api(`EntityDefinitions(LogicalName='${TABLE}')`, 'DELETE');
console.log(`Deleted ${TABLE}.`);
if (fs.existsSync(IDS_FILE)) {
  fs.unlinkSync(IDS_FILE);
  console.log(`Removed ${IDS_FILE}.`);
}
