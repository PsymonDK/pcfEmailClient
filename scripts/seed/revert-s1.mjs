// Reverts every S1 change made to the shared the demo environment environment.
//
//   DV_TOKEN=$(az account get-access-token --resource $DV_ORG --query accessToken -o tsv) \
//   DV_ORG=https://your-org.crm4.dynamics.com \
//     node scripts/seed/revert-s1.mjs [--confirm]
//
// Dry run unless --confirm.
//
// Order matters, and two things are easy to get wrong:
//
//  1. The form must be unregistered from the app AND the app republished BEFORE the form can be
//     deleted, otherwise the delete fails with 0x8004f01f ("cannot be deleted because it is
//     referenced").
//  2. The solution is now UNMANAGED (dev). Deleting an unmanaged solution removes only the
//     container - its components stay in the environment. So the custom control has to be deleted
//     explicitly. (Under a managed solution the uninstall removed the control for us; that is the
//     one thing managed was better at, and it is not a reason to install managed into dev.)
//
// The form also depends on the control, so the control can only go after the form.
import fs from 'node:fs';

const ORG = process.env.DV_ORG || 'https://your-org.crm4.dynamics.com';
const TOK = process.env.DV_TOKEN || fs.readFileSync(`${import.meta.dirname}/../../.tok`, 'utf8').trim();
const CONFIRM = process.argv.includes('--confirm');

const APP_ID = '165f4816-a8cc-f011-8544-6045bde0fa7e';        // Copilot Service workspace
const SPIKE_FORM_ID = '4fe309a1-dbac-f111-aaab-000d3ab16615'; // Case - Email Client Spike (S1)
const SOLUTION_UNIQUE_NAME = 'JHRBCaseEmailClientSpike';
const CONTROL_NAME = 'jhrb_JHRB.CaseEmailClient';

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
    what: `unregister form ${SPIKE_FORM_ID} from the CSW app`,
    run: () =>
      call('RemoveAppComponents', 'POST', {
        AppId: APP_ID,
        Components: [{ '@odata.type': 'Microsoft.Dynamics.CRM.systemform', formid: SPIKE_FORM_ID }],
      }),
  },
  { what: 'republish the CSW app (required before the form will delete)', run: publishApp },
  {
    what: `delete systemform ${SPIKE_FORM_ID} ("Case - Email Client Spike (S1)")`,
    run: () => call(`systemforms(${SPIKE_FORM_ID})`, 'DELETE'),
  },
  {
    what: `delete solution ${SOLUTION_UNIQUE_NAME} (unmanaged: container only)`,
    run: async () => {
      const { txt } = await call(
        `solutions?$select=solutionid&$filter=uniquename eq '${SOLUTION_UNIQUE_NAME}'`,
        'GET',
      );
      const rows = JSON.parse(txt).value ?? [];
      if (rows.length === 0) return { status: 404 };
      return call(`solutions(${rows[0].solutionid})`, 'DELETE');
    },
  },
  {
    what: `delete custom control ${CONTROL_NAME} (unmanaged leftovers)`,
    run: async () => {
      const { txt } = await call(
        `customcontrols?$select=customcontrolid&$filter=name eq '${CONTROL_NAME}'`,
        'GET',
      );
      const rows = JSON.parse(txt).value ?? [];
      if (rows.length === 0) return { status: 404 };
      return call(`customcontrols(${rows[0].customcontrolid})`, 'DELETE');
    },
  },
  { what: 'republish the CSW app', run: publishApp },
];

console.log(`Target: ${ORG}\n`);
if (!CONFIRM) {
  console.log('DRY RUN - nothing changed. Re-run with --confirm.\n');
  steps.forEach((s, i) => console.log(`  ${i + 1}. would ${s.what}`));
  console.log('\nNote: the seed Case and its 12 emails are removed separately by cleanup.mjs.');
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
console.log('\nDone. Run cleanup.mjs --confirm to remove the seed Case and its emails too.');
