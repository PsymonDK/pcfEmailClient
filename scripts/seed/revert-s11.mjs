// Reverts the S11 SPIKE changes made to the shared the demo environment environment.
//
//   node scripts/seed/revert-s11.mjs [--confirm]
//
// Environment guard and token acquisition: see scripts/deploy/README.md.
//
// Dry run unless --confirm.
//
// WHAT THIS NO LONGER TOUCHES — deliberately (review finding H6, 2026-09-28). It used to delete
// solution `JHRBCaseEmailClient` and custom control `jhrb_JHRB.CaseEmailClient` as "unmanaged
// leftovers". Since Phase 0 those are the names of the LIVE PRODUCT, so running a spike cleanup
// would have uninstalled the shipped email client. Only spike-only artefacts are removed now: the
// two S11 application tab templates, the S11 tab form, and the old spike-named solution
// `JHRBCaseEmailClientSpike`. To remove the product itself, use scripts/deploy/revert-deploy.mjs.
//
// S11 created, in this order: the PCF control (unmanaged solution) -> a dedicated Case form
// hosting it -> app registration of that form -> two application tab templates (with parameters)
// pointing at it. Removal is the reverse, minus the control:
//
//  1. The form must be unregistered from the app AND the app republished BEFORE the form will
//     delete, or the delete fails with 0x8004f01f.
//  2. Template parameters cascade-delete with their template, so they are not deleted
//     individually. Do NOT try to filter parameter rows by a `jhrb_s11` uniquename prefix: the
//     platform creates its own parameter rows on these templates and such a filter over-deletes
//     them.
import {
  CONFIRM, api, envGuid, getEnv, odataString, publish, runSteps,
} from '../lib/dv.mjs';

const { org: ORG } = getEnv();

const APP_ID = envGuid('DV_CSW_APP_ID', 'the Copilot Service workspace app module id');
const S11_FORM_ID = envGuid('DV_S11_FORM_ID', 'the id of the S11 tab form ("Case - Email Client", S11)');
// Spike-only name. NOT `JHRBCaseEmailClient` — that is the product's solution now (H6).
const SPIKE_SOLUTION_UNIQUE_NAME = 'JHRBCaseEmailClientSpike';
const TAB_TEMPLATES = ['jhrb_s11_entityrecord_emailform', 'jhrb_s11_control_pcfdirect'];

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
    what: `delete the ${TAB_TEMPLATES.length} S11 application tab templates (parameters cascade)`,
    run: async () => {
      let last = null;
      for (const unique of TAB_TEMPLATES) {
        last = (await deleteAll(
          'msdyn_applicationtabtemplates',
          'msdyn_applicationtabtemplateid',
          `msdyn_uniquename eq ${odataString(unique)}`,
        )) ?? last;
      }
      return last;
    },
  },
  {
    what: `unregister form ${S11_FORM_ID} from the CSW app`,
    run: () =>
      api('RemoveAppComponents', {
        method: 'POST',
        allow404: true,
        body: {
          AppId: APP_ID,
          Components: [{ '@odata.type': 'Microsoft.Dynamics.CRM.systemform', formid: S11_FORM_ID }],
        },
      }),
  },
  { what: 'republish the CSW app (required before the form will delete)', run: publishApp },
  {
    what: `delete systemform ${S11_FORM_ID} ("Case - Email Client (S11 tab form)")`,
    run: () => api(`systemforms(${S11_FORM_ID})`, { method: 'DELETE', allow404: true }),
  },
  {
    what: `delete spike solution ${SPIKE_SOLUTION_UNIQUE_NAME} (unmanaged: container only)`,
    run: () => deleteAll('solutions', 'solutionid', `uniquename eq ${odataString(SPIKE_SOLUTION_UNIQUE_NAME)}`),
  },
  { what: 'republish the CSW app', run: publishApp },
];

console.log(`Target: ${ORG}\n`);
const allOk = await runSteps(steps, { confirm: CONFIRM });
if (!CONFIRM) {
  console.log('\nNot touched: solution JHRBCaseEmailClient and control jhrb_JHRB.CaseEmailClient (the live product).');
  process.exit(0);
}
console.log(allOk
  ? '\nDone.'
  : '\nSome steps FAILED — see above. Re-running is safe; finished steps report "already gone".');
if (!allOk) process.exit(1);
