// Creates the dedicated Case form that hosts the email client, and registers it with the
// Copilot Service Workspace app.
//
//   node scripts/deploy/create-case-form.mjs [--confirm]
//
// Environment guard and token acquisition: see scripts/deploy/README.md.
//
// Dry run unless --confirm. Refuses to run if a "Case - Email Client" form already exists: a
// second copy would be registered with the app alongside the first, and revert-deploy.mjs would
// only know about one of them.
//
// This is the SESSION-TAB placement from docs/design/01-design-decisions.md: an `Entity record`
// application tab template points at this form, so the agent gets a second app tab on the same
// case showing nothing but the email client. It is also the quickest way to verify the control in
// the PUBLISHED app, which is the only place that tells the truth — Studio reports "Method not
// implemented" for data calls and hands out a dummy case id.
//
// Why a dedicated form rather than editing the out-of-the-box one: this is a SHARED environment.
// Exporting a modified OOB Case form is how you carry someone else's customisations out, or
// overwrite them on import. See docs/design/01-design-decisions.md.
import crypto from 'node:crypto';
import {
  CONFIRM, api as dvApi, envGuid, getEnv, odataString, publish, writeIds,
} from '../lib/dv.mjs';

const { org: ORG } = getEnv();

const SOLUTION = 'JHRBCaseEmailClient';
const APP_ID = envGuid('DV_CSW_APP_ID', 'the Copilot Service workspace app module id');
const CONTROL = 'jhrb_JHRB.CaseEmailClient';
const SOURCE_FORM_NAME = 'Enhanced full case form';       // what CSW opens a case on today
const NEW_FORM_NAME = 'Case - Email Client';
const IDS_FILE = `${import.meta.dirname}/deployed-ids.json`;

const api = async (path, method = 'GET', body, opts = {}) =>
  (await dvApi(path, { method, body, ...opts })).json;

const guid = () => `{${crypto.randomUUID().toUpperCase()}}`;

console.log(`Target: ${ORG}\n`);

// ── 0. refuse a duplicate ────────────────────────────────────────────────────
// Checked before anything else, including in a dry run, so the plan never describes a create
// that --confirm would refuse.
const already = await api(
  `systemforms?$select=formid,name&$filter=objecttypecode eq 'incident' and name eq ${odataString(NEW_FORM_NAME)}`,
);
if (already.value?.length) {
  console.log(`REFUSING: a "${NEW_FORM_NAME}" Case form already exists:`);
  for (const f of already.value) console.log(`  ${f.formid}`);
  console.log('Remove it first (node scripts/deploy/revert-deploy.mjs --confirm) or edit it in place.');
  process.exit(1);
}

// ── 1. the source form ───────────────────────────────────────────────────────
// Fetched live rather than from a local copy, so the new form starts from whatever the
// environment actually has today.
const found = await api(
  `systemforms?$select=formid,name,formxml&$filter=objecttypecode eq 'incident' and name eq ${odataString(SOURCE_FORM_NAME)}`,
);
if (!found.value?.length) throw new Error(`source form "${SOURCE_FORM_NAME}" not found`);
const source = found.value[0];
console.log(`Source form: ${source.name} (${source.formid}), ${source.formxml.length} bytes of XML`);

// ── 2. inject the tab ────────────────────────────────────────────────────────
const tabId = guid();
const sectionId = guid();
const cellId = guid();
const ctrlUnique = guid();

// A single-column, single-section tab with the grid cell filling it, so the control gets the whole
// tab. `rowspan` is what gives the cell its height; `showlabel="false"` keeps the section chrome
// out of the 536px budget (docs/design/03-interaction-spec.md).
const newTab =
  `<tab name="tab_emailclient" id="${tabId}" IsUserDefined="1" locklevel="0" showlabel="true" verticallayout="true">` +
    `<labels><label description="Email" languagecode="1033" /></labels>` +
    `<columns><column width="100%"><sections>` +
      `<section name="section_emailclient" id="${sectionId}" IsUserDefined="1" locklevel="0" ` +
        `showlabel="false" showbar="false" layout="varwidth" celllabelalignment="Left" ` +
        `celllabelposition="Left" columns="1" labelwidth="115">` +
        `<labels><label description="" languagecode="1033" /></labels>` +
        `<rows><row>` +
          `<cell id="${cellId}" locklevel="0" colspan="1" rowspan="20" auto="false" showlabel="false">` +
            `<labels><label description="Case Email Client" languagecode="1033" /></labels>` +
            // A FIELD cell on `title`, not a subgrid (1.45.0, S18). The control never reads or writes
            // the column; binding it to one is what lets a PCF occupy a whole form tab without the
            // platform running a subgrid view query first.
            `<control id="title" classid="{4273EDBD-AC1D-40D3-9FB2-095C621B552D}" ` +
              `datafieldname="title" uniqueid="${ctrlUnique}" disabled="false" />` +
          `</cell>` +
        `</row></rows>` +
      `</section>` +
    `</sections></column></columns>` +
  `</tab>`;

// Bind the PCF to that field. The control name MUST carry the publisher prefix
// (jhrb_JHRB.CaseEmailClient, not JHRB.CaseEmailClient) or the form silently renders a plain grid.
// formFactor 0/1/2 = desktop/tablet/phone; register all three so it renders everywhere.
const customControls = [0, 1, 2]
  .map((f) => `<customControl formFactor="${f}" name="${CONTROL}"><parameters><hostField>title</hostField></parameters></customControl>`)
  .join('');
const desc = `<controlDescription forControl="${ctrlUnique}">${customControls}</controlDescription>`;

// A SELF-CONTAINED form: the email tab, the source form's header, its display conditions — and
// nothing else (R7, 2026-09-28). This used to append the tab to a full copy of the main Case
// form, which carried that form's other tabs, script libraries, events, footer and navigation —
// in this shared environment, another project's customisations (the Feriegaranti BPF fields,
// team_fg_* columns). The solution then declared 88 missing dependencies and a managed release
// could not import into a clean environment.
const pick = (re) => source.formxml.match(re)?.[0] ?? '';
const root = pick(/<form[^>]*>/) || '<form>';
const header = pick(/<header[\s\S]*?<\/header>/);
const display = pick(/<DisplayConditions[\s\S]*?<\/DisplayConditions>|<DisplayConditions[^>]*\/>/);
const foreign = header.match(/jhrb_[A-Za-z_]+/g);
if (foreign) throw new Error(`the source header references other customisations: ${[...new Set(foreign)].join(', ')}`);

const xml = `${root}<tabs>${newTab}</tabs>${header}<controlDescriptions>${desc}</controlDescriptions>${display}</form>`;

console.log(`Built form xml: ${xml.length} bytes (source ${source.formxml.length})`);
console.log(`  tab id      ${tabId}`);
console.log(`  control uid ${ctrlUnique}`);

if (!CONFIRM) {
  console.log('\nDRY RUN — nothing created. Re-run with --confirm.');
  console.log(`Would create systemform "${NEW_FORM_NAME}" (incident, type 2),`);
  console.log(`register it with app ${APP_ID}, publish, and write ids to deployed-ids.json.`);
  process.exit(0);
}

// ── 3. create it ─────────────────────────────────────────────────────────────
// With the solution header, so the form lands in JHRBCaseEmailClient rather than loose in the
// Default solution where it would be missed at export time.
const created = await api('systemforms', 'POST', {
  name: NEW_FORM_NAME,
  description:
    'Hosts the JHRB.CaseEmailClient PCF on a single "Email" tab. Opened as a CSW session tab by an ' +
    'Entity record application tab template. See docs/design/01-design-decisions.md.',
  objecttypecode: 'incident',
  type: 2,          // Main
  formpresentation: 1, // Unified Interface
  formxml: xml,
}, { solution: SOLUTION, headers: { Prefer: 'return=representation' } });

console.log(`\nCreated systemform ${created.formid}`);

// Recorded straight away, so a failure below still leaves revert-deploy.mjs knowing the form id.
const record = {
  createdAt: new Date().toISOString(),
  org: ORG,
  formId: created.formid,
  formName: NEW_FORM_NAME,
  sourceFormId: source.formid,
  tabId,
  controlUniqueId: ctrlUnique,
  controlName: CONTROL,
  appId: APP_ID,
};
writeIds(IDS_FILE, record);

// ── 4. register with the app and publish ─────────────────────────────────────
// Without this the form exists but CSW will not open it.
await api('AddAppComponents', 'POST', {
  AppId: APP_ID,
  Components: [{ '@odata.type': 'Microsoft.Dynamics.CRM.systemform', formid: created.formid }],
});
console.log('Registered with the Copilot Service workspace app');

// NOTE: publishing the whole `incident` entity also publishes any OTHER pending customisations on
// Case in this shared environment — other people's unpublished work, not only this form. A new
// form is not visible until its entity is published, so the scope cannot be narrowed further.
await publish({ entities: ['incident'], appModules: [APP_ID] });
console.log('Published incident + the app');

console.log('\nWrote deployed-ids.json');
console.log('Remove it all again with: node scripts/deploy/revert-deploy.mjs --confirm');
