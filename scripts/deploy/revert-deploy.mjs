// Removes everything create-case-form.mjs created, plus the control and its solution.
//
//   node scripts/deploy/revert-deploy.mjs [--confirm]
//
// Environment guard and token acquisition: see scripts/deploy/README.md.
//
// Dry run unless --confirm. THIS REMOVES THE PRODUCT from the environment — the form, the
// JHRBCaseEmailClient solution container and the jhrb_JHRB.CaseEmailClient control — so read the
// dry-run output before confirming.
//
// Order matters, and it is the order the S1/S11 cleanups had to learn the hard way:
//   1. The form must be UNREGISTERED from the app and the app REPUBLISHED before the form will
//      delete. Otherwise the delete fails with 0x8004f01f "referenced by 1 other components".
//   2. The control can only go after the form that uses it.
//   3. The solution is UNMANAGED, so deleting it removes the container only — its components stay
//      in the environment and have to be deleted explicitly. That is why the control is deleted
//      here by name rather than left to the solution delete.
//
// deployed-ids.json is removed only when EVERY step succeeded. A partial run keeps it, so the
// next run still knows which form it is cleaning up.
import fs from 'node:fs';
import {
  CONFIRM, api, assertGuid, assertIdsOrg, envGuid, getEnv, odataString, publish, readIds, runSteps,
} from '../lib/dv.mjs';

const { org: ORG } = getEnv();
const IDS_FILE = `${import.meta.dirname}/deployed-ids.json`;

const APP_ID = envGuid('DV_CSW_APP_ID', 'the Copilot Service workspace app module id');
const CONTROL_NAME = 'jhrb_JHRB.CaseEmailClient';
const SOLUTION_UNIQUE_NAME = 'JHRBCaseEmailClient';

const ids = readIds(IDS_FILE);
if (!ids) {
  console.log('No deployed-ids.json — nothing recorded as deployed. Nothing to do.');
  process.exit(0);
}
// The ids in that file are only meaningful in the environment that wrote them.
assertIdsOrg(ids, ORG);
const FORM_ID = assertGuid(ids.formId, 'deployed-ids.json formId');

const publishApp = () => publish({ appModules: [APP_ID] });

/** Deletes every row a filter matches; `null` when it matched nothing. */
const deleteAll = async (collection, idField, filter) => {
  const rows = (await api(`${collection}?$select=${idField}&$filter=${filter}`)).json.value ?? [];
  if (rows.length === 0) return null;
  let last = null;
  for (const row of rows) last = await api(`${collection}(${row[idField]})`, { method: 'DELETE', allow404: true });
  return last;
};

const steps = [
  {
    what: `unregister form ${FORM_ID} ("${ids.formName}") from the CSW app`,
    run: () =>
      api('RemoveAppComponents', {
        method: 'POST',
        allow404: true,
        body: {
          AppId: APP_ID,
          Components: [{ '@odata.type': 'Microsoft.Dynamics.CRM.systemform', formid: FORM_ID }],
        },
      }),
  },
  { what: 'republish the CSW app (required before the form will delete)', run: publishApp },
  {
    what: `delete systemform ${FORM_ID}`,
    run: () => api(`systemforms(${FORM_ID})`, { method: 'DELETE', allow404: true }),
  },
  {
    what: `delete solution ${SOLUTION_UNIQUE_NAME} (unmanaged: container only)`,
    run: () => deleteAll('solutions', 'solutionid', `uniquename eq ${odataString(SOLUTION_UNIQUE_NAME)}`),
  },
  {
    what: `delete custom control ${CONTROL_NAME} (unmanaged leftovers)`,
    run: () => deleteAll('customcontrols', 'customcontrolid', `name eq ${odataString(CONTROL_NAME)}`),
  },
  { what: 'republish the CSW app', run: publishApp },
];

console.log(`Target: ${ORG}`);
console.log(`Deployed ${ids.createdAt}\n`);

const allOk = await runSteps(steps, { confirm: CONFIRM });

if (!CONFIRM) {
  console.log('\nNote: application tab templates and session templates are NOT covered here — ' +
              'those are created separately and cascade their own parameters.');
  process.exit(0);
}

if (allOk) {
  fs.rmSync(IDS_FILE, { force: true });
  console.log('\nDone. Removed deployed-ids.json.');
} else {
  console.log('\nSome steps FAILED. deployed-ids.json is kept so a re-run can finish the job.');
  process.exit(1);
}
