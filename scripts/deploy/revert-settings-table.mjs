// Removes the email client settings table again. Dry run unless --confirm.
//
//   node scripts/deploy/revert-settings-table.mjs [--confirm]
//
// Environment guard and token acquisition: see scripts/deploy/README.md.
//
// Deleting the table drops its columns, its queue lookups and its rows with it. This is a SHARED
// environment, so the script refuses to touch anything whose name it did not create.
//
// The Read privilege granted by grant-settings-read.mjs disappears with the table, so there is
// nothing to unwind on the role. The role itself belongs to the read-state feature and is left
// alone — see revert-readstate-table.mjs for that one.
import fs from 'node:fs';
import path from 'node:path';
import { CONFIRM, api, getEnv } from '../lib/dv.mjs';

getEnv();
const TABLE = 'jhrb_emailclientsetting';
const IDS_FILES = [
  `${import.meta.dirname}/settings-ids.json`,
  `${import.meta.dirname}/settings-role-ids.json`,
  `${import.meta.dirname}/settings-row-ids.json`,
];

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

try {
  const rows = (await api(`${TABLE}s?$select=jhrb_name&$top=50`)).json.value;
  console.log(`${TABLE} exists (${found.MetadataId}) with ${rows.length} row(s):`);
  for (const r of rows) console.log(`  "${r.jhrb_name}"`);
} catch (e) {
  console.log(`${TABLE} exists (${found.MetadataId}); its rows could not be listed (${e.message}).`);
}

if (!CONFIRM) {
  console.log('\nDRY RUN — nothing deleted. Re-run with --confirm.');
  console.log('Would delete the table, and with it its columns, queue lookups and every row above.');
  console.log('The client then falls back to sending as the agent, which is stock behaviour.');
  process.exit(0);
}

await api(`EntityDefinitions(LogicalName='${TABLE}')`, { method: 'DELETE' });
console.log(`Deleted ${TABLE}.`);
for (const f of IDS_FILES) {
  if (fs.existsSync(f)) {
    fs.unlinkSync(f);
    console.log(`Removed ${path.basename(f)}.`);
  }
}
