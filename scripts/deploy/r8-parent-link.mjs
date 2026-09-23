// TEMPORARY test fixture for R8. Sets (or clears) parentcaseid on the verification case.
//
//   node scripts/deploy/r8-parent-link.mjs set|clear [--confirm]
//
// R8 is "emails on parent/ancestor cases can optionally be included", and NO case in this
// environment has a parent — so the requirement cannot be verified without creating one link.
// This touches ONE lookup field on ONE case and nothing else. The field is currently null, so
// clearing restores it exactly.
//
// Shared environment: run `clear` as soon as the verification is done.
import fs from 'node:fs';

const ORG = 'https://your-org.crm4.dynamics.com';
const TOK = fs.readFileSync(`${import.meta.dirname}/../../.tok`, 'utf8').trim();
const MODE = process.argv[2];
const CONFIRM = process.argv.includes('--confirm');

const CHILD = '40a5d940-0ef6-f011-8406-000d3ab7be36';   // CAS-01021-T1P3C2, 5 emails
const PARENT = '290bf70d-ebf5-f011-8406-7c1e521fcfa3';  // CAS-01016-C3Y9M9, 4 emails

const call = async (path, method = 'GET', body) => {
  const r = await fetch(`${ORG}/api/data/v9.2/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json',
      Accept: 'application/json', 'OData-Version': '4.0',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
};

if (!['set', 'clear'].includes(MODE)) {
  console.log('Usage: node scripts/deploy/r8-parent-link.mjs set|clear [--confirm]');
  process.exit(1);
}

const before = await call(`incidents(${CHILD})?$select=ticketnumber,_parentcaseid_value`);
console.log(`${before.ticketnumber}: parent is currently ${before._parentcaseid_value ?? 'NULL'}`);

if (!CONFIRM) {
  console.log(`\nDRY RUN. Would ${MODE === 'set' ? `set parent -> ${PARENT}` : 'clear the parent'}.`);
  process.exit(0);
}

if (MODE === 'set') {
  await call(`incidents(${CHILD})`, 'PATCH', { 'parentcaseid@odata.bind': `/incidents(${PARENT})` });
  const p = await call(`incidents(${PARENT})?$select=ticketnumber`);
  console.log(`Set parent -> ${p.ticketnumber}. REMEMBER to run "clear --confirm" afterwards.`);
} else {
  // Disassociating a lookup needs the navigation-property $ref endpoint, not a null PATCH.
  await call(`incidents(${CHILD})/parentcaseid/$ref`, 'DELETE');
  const after = await call(`incidents(${CHILD})?$select=_parentcaseid_value`);
  console.log(`Cleared. parent is now ${after._parentcaseid_value ?? 'NULL'}`);
}
