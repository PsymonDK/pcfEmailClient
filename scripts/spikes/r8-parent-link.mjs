// TEMPORARY test fixture for R8. Sets (or clears) parentcaseid on the verification case.
//
//   node scripts/spikes/r8-parent-link.mjs set|clear [--confirm]
//
// Moved here from scripts/deploy/ on 2026-09-28: it is a verification fixture, not a deployment
// step. Environment guard and token acquisition: see scripts/deploy/README.md.
//
// R8 is "emails on parent/ancestor cases can optionally be included", and NO case in this
// environment has a parent — so the requirement cannot be verified without creating one link.
// This touches ONE lookup field on ONE case and nothing else. The field is currently null, so
// clearing restores it exactly.
//
// Shared environment: run `clear` as soon as the verification is done.
import { CONFIRM, api, envGuid, getEnv } from '../lib/dv.mjs';

getEnv();
const MODE = process.argv[2];

const CHILD = envGuid('DV_R8_CHILD_CASE_ID', 'the id of the child case for the parent-link probe');
const PARENT = envGuid('DV_R8_PARENT_CASE_ID', 'the id of the parent case for the parent-link probe');

const call = async (path, method = 'GET', body) => (await api(path, { method, body })).json;

if (!['set', 'clear'].includes(MODE)) {
  console.log('Usage: node scripts/spikes/r8-parent-link.mjs set|clear [--confirm]');
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
