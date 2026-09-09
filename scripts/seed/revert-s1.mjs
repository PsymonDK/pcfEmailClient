// Reverts every S1 change made to the shared the demo environment environment.
//
//   DV_TOKEN=$(az account get-access-token --resource <org> --query accessToken -o tsv) \
//     node scripts/seed/revert-s1.mjs [--confirm]
//
// Dry run unless --confirm. Order matters: unregister from the app, delete the form,
// then delete the managed solution (which removes the PCF).
import fs from 'node:fs';

const ORG = process.env.DV_ORG || 'https://your-org.crm4.dynamics.com';
const TOK = process.env.DV_TOKEN || fs.readFileSync(`${import.meta.dirname}/../../.tok`, 'utf8').trim();
const CONFIRM = process.argv.includes('--confirm');

const APP_ID = '165f4816-a8cc-f011-8544-6045bde0fa7e';        // Copilot Service workspace
const SPIKE_FORM_ID = '0fa036b6-4cac-f111-aaab-000d3ab16615'; // Case - Email Client Spike (S1)
const SOLUTION_UNIQUE_NAME = 'JHRBCaseEmailClientSpike';

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
  if (!r.ok && r.status !== 404) throw new Error(`${r.status} ${path}: ${txt.slice(0, 300)}`);
  return { status: r.status, txt };
};

const steps = [
  {
    what: `remove form ${SPIKE_FORM_ID} from the CSW app`,
    run: () =>
      call('RemoveAppComponents', 'POST', {
        AppId: APP_ID,
        Components: [{ '@odata.type': 'Microsoft.Dynamics.CRM.systemform', formid: SPIKE_FORM_ID }],
      }),
  },
  {
    what: `delete systemform ${SPIKE_FORM_ID} ("Case - Email Client Spike (S1)")`,
    run: () => call(`systemforms(${SPIKE_FORM_ID})`, 'DELETE'),
  },
  {
    what: `delete managed solution ${SOLUTION_UNIQUE_NAME} (removes the jhrb_JHRB.CaseEmailClient PCF)`,
    run: async () => {
      const { txt } = await call(
        `solutions?$select=solutionid,uniquename&$filter=uniquename eq '${SOLUTION_UNIQUE_NAME}'`,
        'GET',
      );
      const rows = JSON.parse(txt).value ?? [];
      if (rows.length === 0) return { status: 404, txt: 'solution not present' };
      return call(`solutions(${rows[0].solutionid})`, 'DELETE');
    },
  },
  {
    what: 'republish the CSW app',
    run: () =>
      call('PublishXml', 'POST', {
        ParameterXml: `<importexportxml><appmodules><appmodule>${APP_ID}</appmodule></appmodules></importexportxml>`,
      }),
  },
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
    console.log(`  ${i + 1}. ${s.what} -> FAILED: ${String(e.message).slice(0, 200)}`);
  }
}
console.log('\nDone. Run cleanup.mjs --confirm to remove the seed Case and its emails too.');
