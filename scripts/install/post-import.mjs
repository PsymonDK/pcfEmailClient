// N3 — the steps a solution import cannot do, for ANY target environment. Dry run unless --confirm.
//
//   node scripts/install/post-import.mjs --org https://<env>.crm4.dynamics.com [--team "<team>"] [--confirm]
//
// Run it after importing the JHRBCaseEmailClient solution (managed, downstream). It is the scripted
// form of docs/deploy/install.md, and it only ever ADDS or REGISTERS — it deletes nothing:
//
//   1. checks the solution, the Email Client form, the control and the role actually arrived
//   2. registers the form with the Copilot Service workspace app, and publishes that app
//      (AddAppComponents cannot ship inside our solution: the app is Microsoft's)
//   3. seeds the one default jhrb_emailclientsetting row if the table has none
//      (configuration is data, not solution content — and an empty table silently means
//      "send as the agent")
//   4. with --team, assigns the role to that team (in the team's business unit)
//
// SAFETY. Unlike scripts/deploy/*, this is not locked to the demo org — its whole point is other
// environments. So the target must be NAMED with --org every time (no default, no pac profile, no
// env var fallback), the organisation's own name is printed before anything happens, and nothing
// is written without --confirm. The token comes from DV_TOKEN or `az account get-access-token`.
import { execFileSync } from 'node:child_process';
import { normaliseOrg } from '../lib/dv.mjs';
import { DEFAULT_SETTINGS_ROW } from '../lib/settings-defaults.mjs';

const SOLUTION = 'JHRBCaseEmailClient';
const FORM_ID = '729d9197-cdad-f111-aaac-000d3ab163fb'; // solution import preserves form ids
const CONTROL = 'jhrb_JHRB.CaseEmailClient';
const ROLE_NAME = 'Case Email Client — Read State';
const DEFAULT_APP_NAME = 'Copilot Service workspace';

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const CONFIRM = argv.includes('--confirm');
const ORG = normaliseOrg(arg('--org') ?? '');
const TEAM = arg('--team');
const APP_NAME = arg('--app-name') ?? DEFAULT_APP_NAME;

if (!ORG) {
  console.error('REFUSING: name the target with --org https://<env>.crm4.dynamics.com (a bare origin).');
  process.exit(2);
}

const token = process.env.DV_TOKEN ?? execFileSync(
  process.platform === 'win32' ? 'az.cmd' : 'az',
  ['account', 'get-access-token', '--resource', ORG, '--query', 'accessToken', '-o', 'tsv'],
  { encoding: 'utf8', shell: process.platform === 'win32' },
).trim();

const API = `${ORG}/api/data/v9.2`;
async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json',
      'OData-MaxVersion': '4.0', 'OData-Version': '4.0',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  // Every non-2xx stops the run: a 401/403 must never be read as "absent, nothing to do".
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const org = (await call('organizations?$select=name,organizationid')).value[0];
console.log(`Target: ${ORG}  —  organisation "${org?.name}"`);
console.log(CONFIRM ? 'Mode:   CONFIRM — changes will be made\n' : 'Mode:   DRY RUN — nothing will be changed (add --confirm)\n');

const todo = [];      // writes to perform
const manual = [];    // what is left for a human
let problems = 0;

// ── 1. What the import should have brought ──────────────────────────────────
const sol = (await call(`solutions?$select=version,ismanaged&$filter=uniquename eq ${q(SOLUTION)}`)).value[0];
if (!sol) {
  console.log(`✗ Solution ${SOLUTION} is not installed. Import it first (docs/deploy/install.md).`);
  process.exit(1);
}
console.log(`✓ Solution ${SOLUTION} ${sol.version} (${sol.ismanaged ? 'managed' : 'UNMANAGED'})`);
if (!sol.ismanaged) console.log('  note: downstream environments should run the MANAGED build.');

const form = await call(`systemforms(${FORM_ID})?$select=name,objecttypecode`).catch(() => null);
if (form) console.log(`✓ Form "${form.name}" (${FORM_ID})`);
else { console.log(`✗ Form ${FORM_ID} not found — the solution import did not bring the Email Client form.`); problems += 1; }

const control = (await call(`customcontrols?$select=version&$filter=name eq ${q(CONTROL)}`)).value[0];
if (control) console.log(`✓ Control ${CONTROL} ${control.version}`);
else { console.log(`✗ Control ${CONTROL} not found.`); problems += 1; }

const roles = (await call(
  `roles?$select=roleid,_businessunitid_value,_parentroleid_value&$filter=name eq ${q(ROLE_NAME)}`,
)).value;
if (roles.length > 0) console.log(`✓ Role "${ROLE_NAME}" (${roles.length} business unit${roles.length === 1 ? '' : 's'})`);
else { console.log(`✗ Role "${ROLE_NAME}" not found.`); problems += 1; }

// ── 2. The form, registered with the Copilot Service workspace app ──────────
const apps = (await call(`appmodules?$select=appmoduleid,appmoduleidunique,name,uniquename&$filter=name eq ${q(APP_NAME)}`)).value;
if (apps.length !== 1) {
  console.log(`✗ Expected exactly one app named "${APP_NAME}", found ${apps.length}. Use --app-name.`);
  problems += 1;
} else if (form) {
  const app = apps[0];
  const has = (await call(
    `appmodulecomponents?$select=objectid&$filter=_appmoduleidunique_value eq ${app.appmoduleidunique}`
    + ` and componenttype eq 60 and objectid eq ${FORM_ID}`,
  )).value.length > 0;
  if (has) console.log(`✓ Form is registered with "${app.name}"`);
  else {
    console.log(`• Form is NOT registered with "${app.name}" — agents would not be able to open it there`);
    todo.push({
      what: `register the form with "${app.name}" and publish the app`,
      run: async () => {
        await call('AddAppComponents', {
          method: 'POST',
          body: { AppId: app.appmoduleid, Components: [{ '@odata.type': 'Microsoft.Dynamics.CRM.systemform', formid: FORM_ID }] },
        });
        await call('PublishXml', {
          method: 'POST',
          body: { ParameterXml: `<importexportxml><appmodules><appmodule>${app.appmoduleid}</appmodule></appmodules></importexportxml>` },
        });
      },
    });
  }
}

// ── 3. The default settings row ─────────────────────────────────────────────
const defaults = (await call(
  'jhrb_emailclientsettings?$select=jhrb_emailclientsettingid,jhrb_name&$filter=statecode eq 0 and jhrb_isdefault eq true',
)).value;
if (defaults.length === 1) console.log(`✓ Default settings row "${defaults[0].jhrb_name}"`);
else if (defaults.length > 1) {
  console.log(`✗ ${defaults.length} default settings rows — ambiguous settings resolve to "send as the agent". Deactivate all but one.`);
  problems += 1;
} else {
  console.log('• No default settings row — mail would silently go out as the agent, not the queue');
  todo.push({ what: 'create the default settings row', run: () => call('jhrb_emailclientsettings', { method: 'POST', body: DEFAULT_SETTINGS_ROW }) });
}

// ── 4. The role, assigned to a team ─────────────────────────────────────────
if (TEAM) {
  const team = (await call(`teams?$select=teamid,name,_businessunitid_value&$filter=name eq ${q(TEAM)}`)).value;
  if (team.length !== 1) { console.log(`✗ Expected exactly one team named "${TEAM}", found ${team.length}.`); problems += 1; } else {
    // A role is copied into every business unit; a team can only hold its own unit's copy.
    const role = roles.find((r) => r._businessunitid_value === team[0]._businessunitid_value);
    if (!role) { console.log(`✗ No copy of the role in team "${TEAM}"'s business unit.`); problems += 1; } else {
      const held = (await call(`teams(${team[0].teamid})/teamroles_association?$select=roleid&$filter=roleid eq ${role.roleid}`)).value.length > 0;
      if (held) console.log(`✓ Team "${TEAM}" holds the role`);
      else {
        console.log(`• Team "${TEAM}" does not hold the role — its members' read state and settings would be refused`);
        todo.push({
          what: `assign the role to team "${TEAM}"`,
          run: () => call(`teams(${team[0].teamid})/teamroles_association/$ref`, {
            method: 'POST', body: { '@odata.id': `${API}/roles(${role.roleid})` },
          }),
        });
      }
    }
  }
} else {
  manual.push(`Assign the role "${ROLE_NAME}" to every agent who uses the client — to their users, or to a team they are in (re-run with --team "<name>" to do it here).`);
}

manual.push('Approve the sending queue\'s mailbox and enable server-side sync for it — the client refuses to Send otherwise (pre-flight, R18).');
manual.push('Optional: an "Entity record" application tab template that opens the Email Client form as a CSW session tab (docs/deploy/install.md).');

// ── Plan / apply ────────────────────────────────────────────────────────────
console.log('');
if (problems > 0) {
  console.log(`${problems} problem(s) above must be fixed first; nothing will be changed.`);
  process.exit(1);
}
if (todo.length === 0) console.log('Nothing to do: every automatable step is already in place.');
for (const step of todo) {
  if (!CONFIRM) { console.log(`WOULD ${step.what}`); continue; }
  await step.run();
  console.log(`DONE  ${step.what}`);
}
console.log('\nStill manual:');
for (const m of manual) console.log(`  - ${m}`);
