// Reverts every S11 change made to the shared the demo environment environment.
//
//   DV_TOKEN=$(az account get-access-token --resource $DV_ORG --query accessToken -o tsv) \
//   DV_ORG=https://your-org.crm4.dynamics.com \
//     node scripts/seed/revert-s11.mjs [--confirm]
//
// Dry run unless --confirm.
//
// S11 created, in this order: the PCF control (unmanaged solution) -> a dedicated Case form
// hosting it -> app registration of that form -> two application tab templates (with parameters)
// pointing at it. Removal is the exact reverse, and the same two traps as revert-s1.mjs apply:
//
//  1. The form must be unregistered from the app AND the app republished BEFORE the form will
//     delete, or the delete fails with 0x8004f01f.
//  2. The solution is unmanaged, so deleting it removes the container only - the custom control
//     has to be deleted explicitly, and only after the form that references it is gone.
//
// Template parameters cascade-delete with their template, so they are not deleted individually.
// Do NOT try to filter parameter rows by a `jhrb_s11` uniquename prefix: the platform creates its
// own parameter rows on these templates and such a filter over-deletes them.
import fs from 'node:fs';

const ORG = process.env.DV_ORG || 'https://your-org.crm4.dynamics.com';
const TOK = process.env.DV_TOKEN || fs.readFileSync(`${import.meta.dirname}/../../.tok`, 'utf8').trim();
const CONFIRM = process.argv.includes('--confirm');

const APP_ID = '165f4816-a8cc-f011-8544-6045bde0fa7e';        // Copilot Service workspace
const S11_FORM_ID = '3c4b2679-12ad-f111-aaab-002248a422bc';   // Case - Email Client (S11 tab form)
// Both names: the spike solution was renamed to JHRBCaseEmailClient in Phase 0, so a re-run of
// the spikes now builds under the new name while older leftovers may still carry the old one.
const SOLUTION_UNIQUE_NAMES = ['JHRBCaseEmailClient', 'JHRBCaseEmailClientSpike'];
const CONTROL_NAME = 'jhrb_JHRB.CaseEmailClient';
const TAB_TEMPLATES = ['jhrb_s11_entityrecord_emailform', 'jhrb_s11_control_pcfdirect'];

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
    what: `delete the ${TAB_TEMPLATES.length} S11 application tab templates (parameters cascade)`,
    run: async () => {
      let last = { status: 404 };
      for (const unique of TAB_TEMPLATES) {
        const { txt } = await call(
          `msdyn_applicationtabtemplates?$select=msdyn_applicationtabtemplateid` +
            `&$filter=msdyn_uniquename eq '${unique}'`,
          'GET',
        );
        for (const row of JSON.parse(txt).value ?? [])
          last = await call(`msdyn_applicationtabtemplates(${row.msdyn_applicationtabtemplateid})`, 'DELETE');
      }
      return last;
    },
  },
  {
    what: `unregister form ${S11_FORM_ID} from the CSW app`,
    run: () =>
      call('RemoveAppComponents', 'POST', {
        AppId: APP_ID,
        Components: [{ '@odata.type': 'Microsoft.Dynamics.CRM.systemform', formid: S11_FORM_ID }],
      }),
  },
  { what: 'republish the CSW app (required before the form will delete)', run: publishApp },
  {
    what: `delete systemform ${S11_FORM_ID} ("Case - Email Client (S11 tab form)")`,
    run: () => call(`systemforms(${S11_FORM_ID})`, 'DELETE'),
  },
  {
    what: `delete solution ${SOLUTION_UNIQUE_NAMES.join(' / ')} (unmanaged: container only)`,
    run: async () => {
      let last = { status: 404 };
      for (const name of SOLUTION_UNIQUE_NAMES) {
        const { txt } = await call(
          `solutions?$select=solutionid&$filter=uniquename eq '${name}'`,
          'GET',
        );
        for (const row of JSON.parse(txt).value ?? []) {
          last = await call(`solutions(${row.solutionid})`, 'DELETE');
        }
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
console.log('\nDone.');
