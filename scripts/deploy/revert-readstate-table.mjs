// Removes the read-state table again. Dry run unless --confirm.
//
//   node scripts/deploy/revert-readstate-table.mjs [--confirm]
//
// Environment guard and token acquisition: see scripts/deploy/README.md.
//
// Deleting the table drops its lookups, its key and its rows with it — no need to unwind the
// relationships first. This is a SHARED environment, so the script refuses to touch anything whose
// name it did not create.
import fs from 'node:fs';
import { CONFIRM, api, getEnv } from '../lib/dv.mjs';

getEnv();
const TABLE = 'jhrb_emailreadstate';
const IDS_FILE = `${import.meta.dirname}/readstate-ids.json`;

// Only a 404 means "does not exist". A 401/403 throws: an expired token must never read as
// "nothing to do".
const found = (await api(
  `EntityDefinitions(LogicalName='${TABLE}')?$select=MetadataId,IsCustomEntity`,
  { allow404: true },
))?.json;

if (!found) {
  console.log(`${TABLE} does not exist. Nothing to do.`);
  process.exit(0);
}
// Belt and braces: never delete something the platform owns.
if (found.IsCustomEntity !== true) {
  console.log(`REFUSING: ${TABLE} is not a custom entity.`);
  process.exit(1);
}

let rowNote;
try {
  const rows = (await api(`${TABLE}s?$select=${TABLE}id&$top=50`)).json.value;
  rowNote = `at least ${rows.length} row(s)`;
} catch (e) {
  rowNote = `rows not countable (${e.message})`;
}
console.log(`${TABLE} exists (${found.MetadataId}) with ${rowNote}.`);

if (!CONFIRM) {
  console.log('\nDRY RUN — nothing deleted. Re-run with --confirm.');
  console.log('Would delete the table, and with it its lookups, alternate key and every row.');
  process.exit(0);
}

await api(`EntityDefinitions(LogicalName='${TABLE}')`, { method: 'DELETE' });
console.log(`Deleted ${TABLE}.`);
if (fs.existsSync(IDS_FILE)) {
  fs.unlinkSync(IDS_FILE);
  console.log('Removed readstate-ids.json.');
}
