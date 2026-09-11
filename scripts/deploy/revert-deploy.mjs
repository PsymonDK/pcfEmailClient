// Removes everything create-case-form.mjs created, plus the control and its solution.
//
//   DV_TOKEN=$(az account get-access-token --resource $DV_ORG --query accessToken -o tsv) \
//   DV_ORG=https://your-org.crm4.dynamics.com \
//     node scripts/deploy/revert-deploy.mjs [--confirm]
//
// Dry run unless --confirm.
//
// Order matters, and it is the order the S1/S11 cleanups had to learn the hard way:
//   1. The form must be UNREGISTERED from the app and the app REPUBLISHED before the form will
//      delete. Otherwise the delete fails with 0x8004f01f "referenced by 1 other components".
//   2. The control can only go after the form that uses it.
//   3. The solution is UNMANAGED, so deleting it removes the container only — its components stay
//      in the environment and have to be deleted explicitly. That is why the control is deleted
//      here by name rather than left to the solution delete.
import fs from 'node:fs';

const ORG = process.env.DV_ORG || 'https://your-org.crm4.dynamics.com';
const TOK = process.env.DV_TOKEN || fs.readFileSync(`${import.meta.dirname}/../../.tok`, 'utf8').trim();
const CONFIRM = process.argv.includes('--confirm');
const IDS_FILE = `${import.meta.dirname}/deployed-ids.json`;

const APP_ID = '165f4816-a8cc-f011-8544-6045bde0fa7e';
const CONTROL_NAME = 'jhrb_JHRB.CaseEmailClient';
const SOLUTION_UNIQUE_NAME = 'JHRBCaseEmailClient';

if (!fs.existsSync(IDS_FILE)) {
  console.log(`No ${IDS_FILE} — nothing recorded as deployed. Nothing to do.`);
  process.exit(0);
}
const ids = JSON.parse(fs.readFileSync(IDS_FILE, 'utf8'));

const call = async (path, method, body) => {
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
  if (!r.ok && r.status !== 404) throw new Error(`${r.status}: ${txt.slice(0, 240)}`);
  return { status: r.status, txt };
};

const publishApp = () =>
  call('PublishXml', 'POST', {
    ParameterXml: `<importexportxml><appmodules><appmodule>${APP_ID}</appmodule></appmodules></importexportxml>`,
  });

const steps = [
  {
    what: `unregister form ${ids.formId} ("${ids.formName}") from the CSW app`,
    run: () =>
      call('RemoveAppComponents', 'POST', {
        AppId: APP_ID,
        Components: [{ '@odata.type': 'Microsoft.Dynamics.CRM.systemform', formid: ids.formId }],
      }),
  },
  { what: 'republish the CSW app (required before the form will delete)', run: publishApp },
  {
    what: `delete systemform ${ids.formId}`,
    run: () => call(`systemforms(${ids.formId})`, 'DELETE'),
  },
  {
    what: `delete solution ${SOLUTION_UNIQUE_NAME} (unmanaged: container only)`,
    run: async () => {
      const { txt } = await call(
        `solutions?$select=solutionid&$filter=uniquename eq '${SOLUTION_UNIQUE_NAME}'`,
        'GET',
      );
      let last = { status: 404 };
      for (const row of JSON.parse(txt).value ?? []) {
        last = await call(`solutions(${row.solutionid})`, 'DELETE');
      }
      return last;
    },
  },
  {
    what: `delete custom control ${CONTROL_NAME} (unmanaged leftovers)`,
    run: async () => {
      const { txt } = await call(
        `customcontrols?$select=customcontrolid&$filter=name eq '${CONTROL_NAME}'`,
        'GET',
      );
      let last = { status: 404 };
      for (const row of JSON.parse(txt).value ?? []) {
        last = await call(`customcontrols(${row.customcontrolid})`, 'DELETE');
      }
      return last;
    },
  },
  { what: 'republish the CSW app', run: publishApp },
];

console.log(`Target: ${ORG}`);
console.log(`Deployed ${ids.createdAt}\n`);

if (!CONFIRM) {
  console.log('DRY RUN — nothing changed. Re-run with --confirm.\n');
  steps.forEach((s, i) => console.log(`  ${i + 1}. would ${s.what}`));
  console.log('\nNote: application tab templates and session templates are NOT covered here — ' +
              'those are created separately and cascade their own parameters.');
  process.exit(0);
}

for (const [i, s] of steps.entries()) {
  try {
    const r = await s.run();
    console.log(`  ${i + 1}. ${s.what} -> ${r.status === 404 ? 'already gone' : 'ok'}`);
  } catch (e) {
    console.log(`  ${i + 1}. ${s.what} -> FAILED: ${String(e.message).slice(0, 220)}`);
  }
}

fs.rmSync(IDS_FILE, { force: true });
console.log(`\nDone. Removed ${IDS_FILE}.`);
