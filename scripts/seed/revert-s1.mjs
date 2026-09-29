// Reverts the S1/S2 SPIKE changes made to the shared the demo environment environment.
//
//   node scripts/seed/revert-s1.mjs [--confirm]
//
// Environment guard and token acquisition: see scripts/deploy/README.md.
//
// Dry run unless --confirm.
//
// WHAT THIS NO LONGER TOUCHES — deliberately (review finding H6, 2026-09-28). It used to delete
// solution `JHRBCaseEmailClient` and custom control `jhrb_JHRB.CaseEmailClient` as "unmanaged
// leftovers". Since Phase 0 those are the names of the LIVE PRODUCT, so running a spike cleanup
// would have uninstalled the shipped email client. Only spike-only artefacts are removed now: the
// S1 form, the S2 custom page, and the old spike-named solution `JHRBCaseEmailClientSpike`. To
// remove the product itself, use scripts/deploy/revert-deploy.mjs — on purpose, not as a side
// effect of cleaning up a spike.
//
// Order matters, and two things are easy to get wrong:
//
//  1. The form must be unregistered from the app AND the app republished BEFORE the form can be
//     deleted, otherwise the delete fails with 0x8004f01f ("cannot be deleted because it is
//     referenced").
//  2. Deleting an unmanaged solution removes only the container - its components stay in the
//     environment. That is fine here: the one component that mattered, the control, is shared
//     with the product and must stay.
import {
  CONFIRM, api, getEnv, odataString, publish, runSteps,
} from '../lib/dv.mjs';

const { org: ORG } = getEnv();

const APP_ID = '165f4816-a8cc-f011-8544-6045bde0fa7e';        // Copilot Service workspace
const SPIKE_FORM_ID = '4fe309a1-dbac-f111-aaab-000d3ab16615'; // Case - Email Client Spike (S1)
// Spike-only name. NOT `JHRBCaseEmailClient` — that is the product's solution now (H6).
const SPIKE_SOLUTION_UNIQUE_NAME = 'JHRBCaseEmailClientSpike';
// S2 custom page: "Case Email Client Page (S2 spike)" / jhrb_caseemailclientpages2spike_314da
const SPIKE_PAGE_ID = 'e7cb7b97-9dde-4f6a-8356-94bc9e1344d0';

const publishApp = () => publish({ appModules: [APP_ID] });

const steps = [
  {
    what: `unregister form ${SPIKE_FORM_ID} from the CSW app`,
    run: () =>
      api('RemoveAppComponents', {
        method: 'POST',
        allow404: true,
        body: {
          AppId: APP_ID,
          Components: [{ '@odata.type': 'Microsoft.Dynamics.CRM.systemform', formid: SPIKE_FORM_ID }],
        },
      }),
  },
  { what: 'republish the CSW app (required before the form will delete)', run: publishApp },
  {
    what: `delete systemform ${SPIKE_FORM_ID} ("Case - Email Client Spike (S1)")`,
    run: () => api(`systemforms(${SPIKE_FORM_ID})`, { method: 'DELETE', allow404: true }),
  },
  // A custom page added through the app designer leaves BOTH an appmodulecomponent-style
  // registration AND an `appelement` row (component type 10088) linking page -> app.
  // `RemoveAppComponents` clears the former; the appelement must be deleted explicitly or
  // the page delete fails with 0x8004f01f "referenced by 1 other components".
  // Discovered the hard way during cleanup on 2026-09-10.
  {
    what: `unregister custom page ${SPIKE_PAGE_ID} from the CSW app`,
    run: () =>
      api('RemoveAppComponents', {
        method: 'POST',
        allow404: true,
        body: {
          AppId: APP_ID,
          Components: [{ '@odata.type': 'Microsoft.Dynamics.CRM.canvasapp', canvasappid: SPIKE_PAGE_ID }],
        },
      }),
  },
  {
    what: 'delete the appelement(s) linking that page to the app',
    run: async () => {
      const rows = (await api(
        `appelements?$select=appelementid,name&$filter=_canvasappid_value eq ${SPIKE_PAGE_ID}`,
      )).json.value ?? [];
      if (rows.length === 0) return null;
      let last = null;
      for (const r of rows) last = await api(`appelements(${r.appelementid})`, { method: 'DELETE', allow404: true });
      return last;
    },
  },
  { what: 'republish the CSW app (so the page reference is really gone)', run: publishApp },
  {
    what: `delete custom page ${SPIKE_PAGE_ID} ("Case Email Client Page (S2 spike)")`,
    run: () => api(`canvasapps(${SPIKE_PAGE_ID})`, { method: 'DELETE', allow404: true }),
  },
  {
    what: `delete spike solution ${SPIKE_SOLUTION_UNIQUE_NAME} (unmanaged: container only)`,
    run: async () => {
      const rows = (await api(
        `solutions?$select=solutionid&$filter=uniquename eq ${odataString(SPIKE_SOLUTION_UNIQUE_NAME)}`,
      )).json.value ?? [];
      if (rows.length === 0) return null;
      let last = null;
      for (const row of rows) last = await api(`solutions(${row.solutionid})`, { method: 'DELETE', allow404: true });
      return last;
    },
  },
  { what: 'republish the CSW app', run: publishApp },
];

console.log(`Target: ${ORG}\n`);
const allOk = await runSteps(steps, { confirm: CONFIRM });
if (!CONFIRM) {
  console.log('\nNot touched: solution JHRBCaseEmailClient and control jhrb_JHRB.CaseEmailClient (the live product).');
  console.log('Note: the seed Case and its 12 emails are removed separately by cleanup.mjs.');
  process.exit(0);
}
console.log(allOk
  ? '\nDone. Run cleanup.mjs --confirm to remove the seed Case and its emails too.'
  : '\nSome steps FAILED — see above. Re-running is safe; finished steps report "already gone".');
if (!allOk) process.exit(1);
