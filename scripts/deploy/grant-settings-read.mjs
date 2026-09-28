// Grants agents READ on jhrb_emailclientsetting. Dry run unless --confirm.
//
//   node scripts/deploy/grant-settings-read.mjs [--confirm]
//
// WHY THIS EXISTS, and why the failure it prevents is nasty. A newly created custom table grants
// privileges to NOBODY except System Administrator and System Customizer. Without this, the
// settings table works for an admin and returns **zero rows** for every real agent — not an error,
// zero rows. The client reads that as "no configuration", falls back to sending as the agent, and
// nobody sees anything wrong until a customer replies to an individual's inbox instead of the
// queue. Dataverse's security trimming is silent by design; that is the whole trap.
//
// It extends the role `create-readstate-role.mjs` already creates rather than making a second one.
// Assigning a role is a manual per-environment step (an N3 runbook deviation), and one deviation
// should not quietly become two. The role's display name is narrower than what it now grants;
// renaming it would break this script's idempotency, so the description carries the correction.
//
// READ ONLY, at GLOBAL depth. Agents never write configuration, and the table is
// OrganizationOwned — user-level depth on an org-owned table returns nothing at all.
//
// Environment guard and token acquisition: see scripts/deploy/README.md.
import {
  CONFIRM, api as dvApi, getEnv, odataString, writeIds,
} from '../lib/dv.mjs';

const { org: ORG } = getEnv();

const SOLUTION = 'JHRBCaseEmailClient';
const TABLE = 'jhrb_emailclientsetting';
const ROLE_NAME = 'Case Email Client — Read State';
const IDS_FILE = `${import.meta.dirname}/settings-role-ids.json`;
// A NAME, not a path: this goes into a committed ids file, and an absolute path there leaked the
// author's local checkout location (L16).
const READSTATE_IDS = 'readstate-role-ids.json';

/**
 * Privilege names come from the table's **SchemaName**, not its logical name — so
 * `prvReadjhrb_EmailClientSetting`. OData compares strings case-insensitively, so a filter on the
 * logical spelling still matches while the returned name does not equal what was composed to find
 * it; that mismatch made an earlier script report every privilege missing having fetched them all.
 * Compare case-insensitively.
 */
const PRIV_TABLE = 'jhrb_EmailClientSetting';
const eqName = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * `AddPrivilegesRole` wants `Depth` as the PrivilegeDepth enum **by name** — the numeric mask the
 * same concept uses elsewhere fails with *"Cannot read the value '8' as a quoted JSON string"*.
 *
 * `Global` because the table is OrganizationOwned: its rows have no owning user, so `Basic` grants
 * access to nothing and the agent sees an empty table — the exact silent failure above.
 */
const ORG_DEPTH = 'Global';

const api = (path, method = 'GET', body) => dvApi(path, { method, body, solution: SOLUTION });

console.log(`Target: ${ORG}`);
console.log(`Role:   ${ROLE_NAME}\n`);

const all = (await api(
  `privileges?$select=privilegeid,name,accessright&$filter=endswith(name,'${PRIV_TABLE}')`,
)).json.value;

const readPriv = all.find((p) => eqName(p.name, `prvRead${PRIV_TABLE}`));
if (!readPriv) {
  console.log(`FAILED: no prvRead${PRIV_TABLE} among ${all.length} privileges on the table.`);
  console.log('Has create-settings-table.mjs run, and did it publish?');
  process.exit(1);
}
console.log(`  Read     ${readPriv.name}  ${readPriv.privilegeid}`);

const role = (await api(
  `roles?$select=roleid,name&$filter=name eq ${odataString(ROLE_NAME)}`,
)).json.value[0];
if (!role) {
  console.log(`\nFAILED: role "${ROLE_NAME}" does not exist.`);
  console.log('Run scripts/deploy/create-readstate-role.mjs --confirm first.');
  process.exit(1);
}
console.log(`  Role     ${role.roleid}`);

if (!CONFIRM) {
  console.log('\nDRY RUN — nothing granted. Re-run with --confirm.');
  console.log(`Would add ${ORG_DEPTH}-depth Read on ${TABLE} to the existing role,`);
  console.log('leaving its other privileges untouched.');
  process.exit(0);
}

// **AddPrivilegesRole ADDS; it does not replace.** (`ReplacePrivilegesRole` is the one that
// replaces.) That is what makes this safe to run against a role that already carries the
// read-state privileges — and it is why this script must not be rewritten to "set" the full list.
await api(`roles(${role.roleid})/Microsoft.Dynamics.CRM.AddPrivilegesRole`, 'POST', {
  Privileges: [{ PrivilegeId: readPriv.privilegeid, Depth: ORG_DEPTH }],
});
console.log(`\n1. granted ${ORG_DEPTH}-depth Read on ${TABLE}`);

const check = (await api(
  `roles(${role.roleid})/roleprivileges_association?$select=name,accessright`,
)).json.value;
const onSettings = check.filter((p) => new RegExp(PRIV_TABLE, 'i').test(p.name));
const onReadState = check.filter((p) => /jhrb_EmailReadState/i.test(p.name));
console.log(`2. verified: ${onSettings.length} on ${TABLE}, `
  + `${onReadState.length} still on jhrb_emailreadstate (unchanged)`);
if (onReadState.length !== 6) {
  console.log('   WARNING: the read-state privileges look disturbed. Expected 6.');
}

const depths = (await api(`RetrieveRolePrivilegesRole(RoleId=${role.roleid})`)).json.RolePrivileges ?? [];
const mine = depths.find(
  (p) => String(p.PrivilegeId).toLowerCase() === readPriv.privilegeid.toLowerCase(),
);
console.log(mine?.Depth === ORG_DEPTH
  ? `3. verified: Read is at ${ORG_DEPTH} depth`
  : `3. WARNING: Read is at ${mine?.Depth ?? 'unknown'} depth, not ${ORG_DEPTH} — agents will see no rows`);

writeIds(IDS_FILE, {
  createdAt: new Date().toISOString(),
  org: ORG,
  roleId: role.roleid,
  roleName: ROLE_NAME,
  table: TABLE,
  privilege: readPriv.name,
  depth: ORG_DEPTH,
  note: `Extends the role recorded in ${READSTATE_IDS}. One role to assign, not two.`,
});
console.log('\nWrote settings-role-ids.json');
console.log('\nThe manual step is unchanged: assign this ONE role to the agents who use the client.');
