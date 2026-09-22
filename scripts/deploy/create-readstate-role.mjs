// Grants agents the privileges R6 needs on jhrb_emailreadstate. Dry run unless --confirm.
//
//   node scripts/deploy/create-readstate-role.mjs [--confirm]
//
// WHY THIS EXISTS. A newly created custom table grants privileges to NOBODY except System
// Administrator and System Customizer. So the read-state feature works perfectly for an admin and
// fails for every real agent, whose first mark-read returns "Insufficient privileges" — and because
// the client treats read state as an ornament, that failure is a one-line notice rather than a
// crash. Easy to miss in testing, and guaranteed to be noticed in production.
//
// Deliberately a NEW role rather than an edit to `Customer Service Representative`. This is a
// SHARED environment: adding privileges to an out-of-the-box role changes what every other demo in
// it can do, and carries that edit downstream in the solution. A purpose-built role is additive,
// assignable, and removable.
//
// Scope is USER-level on every privilege, which is the whole point: an agent may create, read,
// write and delete THEIR OWN read state and no one else's. The table is UserOwned, so Dataverse
// enforces that without the client filtering for it.
import fs from 'node:fs';

const ORG = process.env.DV_ORG || 'https://your-org.crm4.dynamics.com';
const TOK = process.env.DV_TOKEN || fs.readFileSync(`${import.meta.dirname}/../../.tok`, 'utf8').trim();
const CONFIRM = process.argv.includes('--confirm');

const SOLUTION = 'JHRBCaseEmailClient';
const TABLE = 'jhrb_emailreadstate';
const ROLE_NAME = 'Case Email Client — Read State';
const IDS_FILE = `${import.meta.dirname}/readstate-role-ids.json`;

// User-level only. Nothing here needs to see another agent's rows.
//
// `Append` and `AppendTo` are here because the row carries three lookups: writing one is an
// *append* operation, and without them a create fails on privileges even though Create is granted.
// Not `Share` or `Assign` — read state is nobody's to hand around.
const WANTED = ['Create', 'Read', 'Write', 'Delete', 'Append', 'AppendTo'];
/**
 * `AddPrivilegesRole` wants `Depth` as the **PrivilegeDepth enum by name** — `Basic` / `Local` /
 * `Deep` / `Global`. Passing the numeric mask (1/2/4/8) that the same concept uses elsewhere in
 * the API is rejected with *"Cannot read the value '1' as a quoted JSON string"* — a message that
 * mentions neither depth, privileges, nor the role. Measured 2026-09-22.
 *
 * `Basic` is the user level: an agent's own rows and nobody else's.
 */
const USER_DEPTH = 'Basic';

/**
 * Privilege names are built from the table's **SchemaName**, not its logical name — so they are
 * `prvCreatejhrb_EmailReadState`, not `…jhrb_emailreadstate`. Dataverse's OData comparison is
 * case-insensitive, so a filter on the logical name still *matches*; the rows just come back with
 * names that no longer equal the string composed to find them, which made the first run report
 * every privilege as missing while having fetched all four. Compare case-insensitively.
 */
const PRIV_TABLE = 'jhrb_EmailReadState';
const eqName = (a, b) => a.toLowerCase() === b.toLowerCase();

const api = async (path, method = 'GET', body, extraHeaders = {}) => {
  const r = await fetch(`${ORG}/api/data/v9.2/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOK}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'OData-Version': '4.0',
      'MSCRM.SolutionUniqueName': SOLUTION,
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { /* not json */ }
  if (!r.ok) {
    throw new Error(`${method} ${path} -> ${r.status}: ${String(json?.error?.message ?? txt).replace(/\s+/g, ' ').slice(0, 280)}`);
  }
  return { json, id: r.headers.get('OData-EntityId')?.match(/\(([^)]+)\)/)?.[1] };
};

// Fetch every privilege on the table and pick from what the platform actually named, rather than
// composing names and hoping. `endswith` covers both the schema and logical spellings.
const all = (await api(
  `privileges?$select=privilegeid,name,accessright&$filter=endswith(name,'${PRIV_TABLE}')`,
)).json.value;

console.log(`Target: ${ORG}`);
console.log(`Role:   ${ROLE_NAME}\n`);

const privileges = [];
for (const w of WANTED) {
  const p = all.find((x) => eqName(x.name, `prv${w}${PRIV_TABLE}`));
  console.log(`  ${w.padEnd(8)} ${p ? `${p.name}  ${p.privilegeid}` : '*** NOT FOUND ***'}`);
  if (p) privileges.push(p);
}
if (privileges.length !== WANTED.length) {
  console.log(`\nFAILED: wanted ${WANTED.length} privileges, matched ${privileges.length} of ${all.length} on the table. Is it published?`);
  process.exit(1);
}

// The role has to live in the root business unit or it cannot be assigned org-wide.
const rootBu = (await api("businessunits?$select=businessunitid,name&$filter=parentbusinessunitid eq null")).json.value[0];
console.log(`\nBusiness unit: ${rootBu.name}`);

if (!CONFIRM) {
  console.log('\nDRY RUN — nothing created. Re-run with --confirm.');
  console.log(`Would create role "${ROLE_NAME}" with USER-level (depth ${USER_DEPTH}) ${WANTED.join('/')} on ${TABLE},`);
  console.log(`add it to solution ${SOLUTION}, and leave ASSIGNING it to agents as a documented step.`);
  process.exit(0);
}

const existing = (await api(`roles?$select=roleid,name&$filter=name eq '${ROLE_NAME.replace(/'/g, "''")}'`)).json.value[0];
let roleId = existing?.roleid;
if (roleId) {
  console.log(`\n1. role already exists -> ${roleId}`);
} else {
  const created = await api('roles', 'POST', {
    name: ROLE_NAME,
    'businessunitid@odata.bind': `/businessunits(${rootBu.businessunitid})`,
  });
  roleId = created.id;
  console.log(`\n1. created role -> ${roleId}`);
}

// AddPrivilegesRole replaces the role's privilege set in one call, which is also what makes this
// script safe to re-run.
await api(`roles(${roleId})/Microsoft.Dynamics.CRM.AddPrivilegesRole`, 'POST', {
  Privileges: privileges.map((p) => ({
    PrivilegeId: p.privilegeid,
    Depth: USER_DEPTH,
  })),
});
console.log(`2. granted USER-level ${WANTED.join(', ')} on ${TABLE}`);

// Verify against the role itself, and report OUR privileges separately from the platform's.
// Dataverse adds a baseline to every new role (SDK message and SharePoint reads), so a raw count
// reads as "I asked for 6 and got 15", which looks like the script over-granted. It did not.
const check = (await api(
  `roles(${roleId})/roleprivileges_association?$select=name,accessright`,
)).json.value;
const onTable = check.filter((p) => /jhrb_EmailReadState/i.test(p.name));
console.log(`3. verified: ${onTable.length} privilege(s) on ${TABLE}, `
  + `plus ${check.length - onTable.length} the platform adds to every new role`);
if (onTable.length !== WANTED.length) {
  console.log(`   WARNING: expected ${WANTED.length} on the table.`);
}

// Depth lives on the role-privilege pairing, not on the association, so it needs the function.
const depths = (await api(`RetrieveRolePrivilegesRole(RoleId=${roleId})`)).json.RolePrivileges ?? [];
const wantedIds = new Set(privileges.map((p) => p.privilegeid.toLowerCase()));
const wrongDepth = depths.filter(
  (p) => wantedIds.has(String(p.PrivilegeId).toLowerCase()) && p.Depth !== USER_DEPTH,
);
console.log(wrongDepth.length === 0
  ? `4. verified: all at ${USER_DEPTH} depth — own rows only`
  : `4. WARNING: ${wrongDepth.length} privilege(s) are not ${USER_DEPTH} depth`);

fs.writeFileSync(IDS_FILE, JSON.stringify({
  createdAt: new Date().toISOString(), org: ORG, roleId, roleName: ROLE_NAME, table: TABLE,
  privileges: privileges.map((p) => p.name), depth: USER_DEPTH,
}, null, 2) + '\n');

console.log(`\nWrote ${IDS_FILE}`);
console.log('\nREMAINING MANUAL STEP: assign this role to the agents who use the email client.');
console.log('Assigning it is intentionally NOT automated — who gets it is a decision about people,');
console.log('not a deployment detail, and this is a shared environment.');
