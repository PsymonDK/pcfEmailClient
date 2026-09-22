// Creates the per-agent read-state table (R6).
//
//   DV_TOKEN=$(az account get-access-token --resource $DV_ORG --query accessToken -o tsv) \
//   DV_ORG=https://your-org.crm4.dynamics.com \
//     node scripts/deploy/create-readstate-table.mjs [--confirm]
//
// Dry run unless --confirm. This is a SCHEMA change to a shared environment, so it is deliberately
// step-by-step and each step reports what it did.
//
// Why a table and not a column on `email`:
//   - R6 is per-AGENT ("an unopened incoming email is visually distinct"), and a column on `email`
//     is single-valued org-wide: the first agent to open a message marks it read for everyone.
//   - `email` is a core system table in a SHARED environment. Adding a column to it has the widest
//     blast radius available here, and it makes the delivered solution carry a dependency on
//     `email` that complicates downstream managed imports.
//   - Decided in docs/design/01-design-decisions.md (Gate 2).
//
// The `incident` lookup is DENORMALISED on purpose. Without it, reading state for a case means one
// query per message; with it, the client fetches one page filtered by case + user. That is the
// difference between 1 request and 50 on a busy case.
import fs from 'node:fs';

const ORG = process.env.DV_ORG || 'https://your-org.crm4.dynamics.com';
const TOK = process.env.DV_TOKEN || fs.readFileSync(`${import.meta.dirname}/../../.tok`, 'utf8').trim();
const CONFIRM = process.argv.includes('--confirm');

const SOLUTION = 'JHRBCaseEmailClient';
const PREFIX = 'jhrb';
const TABLE = `${PREFIX}_emailreadstate`;
const IDS_FILE = `${import.meta.dirname}/readstate-ids.json`;

const label = (text) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.Label',
  LocalizedLabels: [{
    '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel',
    Label: text,
    LanguageCode: 1033,
  }],
});

const api = async (path, method = 'GET', body) => {
  const r = await fetch(`${ORG}/api/data/v9.2/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOK}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'OData-Version': '4.0',
      // Puts every created component straight into our unmanaged solution, so nothing is left
      // loose in the Default solution where it would be missed at export time.
      'MSCRM.SolutionUniqueName': SOLUTION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { /* not json */ }
  if (!r.ok) {
    const message = json?.error?.message ?? txt.slice(0, 400);
    throw new Error(`${method} ${path} -> ${r.status}: ${String(message).replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  return { json, headers: r.headers };
};

/**
 * Retries a step through the metadata cache lag that follows a table creation.
 *
 * Measured 2026-09-11: `POST EntityDefinitions` returns 201 with a MetadataId, and for several
 * seconds afterwards every request that touches that table fails with *"was not found in the
 * MetadataCache.LazyDynamicMetadataCache"* — or, on the Attributes endpoint, with a bare
 * "An unexpected error occurred." So the first run created the table and then failed every
 * column on it. Without this, whether the script works depends on how fast the server settles.
 */
const withSettle = async (what, attempt) => {
  for (let i = 1; i <= 6; i += 1) {
    try {
      return await attempt();
    } catch (e) {
      const transient = /MetadataCache|unexpected error occurred/i.test(e.message);
      if (!transient || i === 6) throw e;
      console.log(`   ${what}: metadata cache not settled, retrying (${i}/5)…`);
      await new Promise((r) => setTimeout(r, i * 4000));
    }
  }
  throw new Error('unreachable');
};

// ── the definitions ──────────────────────────────────────────────────────────

const entity = {
  '@odata.type': 'Microsoft.Dynamics.CRM.EntityMetadata',
  SchemaName: `${PREFIX}_EmailReadState`,
  LogicalName: TABLE,
  DisplayName: label('Email read state'),
  DisplayCollectionName: label('Email read states'),
  Description: label(
    'Per-agent read state for email on a case (R6). One row per email per user. ' +
    'Written by the JHRB.CaseEmailClient PCF; not intended for manual editing.',
  ),
  // User-owned, so Dataverse's own security trims each agent to their own rows. That is the
  // isolation R6 needs, for free, rather than us filtering and hoping.
  OwnershipType: 'UserOwned',
  IsActivity: false,
  HasActivities: false,
  HasNotes: false,
  // `IsValidForQueue` and `IsDuplicateDetectionEnabled` are NOT plain booleans here — they are
  // BooleanManagedProperty, and sending either shape on create returns a bare OData payload error
  // that names neither field. Both already default to false for a custom table, so the fix is to
  // leave them out rather than to guess the wrapper.
  Attributes: [{
    '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata',
    SchemaName: `${PREFIX}_Name`,
    LogicalName: `${PREFIX}_name`,
    DisplayName: label('Name'),
    Description: label('Set by the client to "<email id>|<user id>" for readability in admin views.'),
    RequiredLevel: { Value: 'None', CanBeChanged: true, ManagedPropertyLogicalName: 'canmodifyrequirementlevelsettings' },
    MaxLength: 100,
    FormatName: { Value: 'Text' },
    IsPrimaryName: true,
  }],
};

const lookup = ({ schema, logical, display, description, referenced, referencedCollection, cascadeDelete }) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata',
  SchemaName: `${PREFIX}_${referenced}_${TABLE}`,
  ReferencedEntity: referenced,
  ReferencingEntity: TABLE,
  // Keep these out of the parent's form and navigation: this is machine data, and an agent has no
  // reason to browse read-state rows from an email or a case.
  AssociatedMenuConfiguration: {
    Behavior: 'DoNotDisplay',
    Group: 'Details',
    Label: label(referencedCollection),
    Order: 10000,
  },
  CascadeConfiguration: {
    // Delete cascades so read-state rows cannot outlive the email they describe. Everything else
    // is NoCascade: reassigning or sharing an email must not touch read state.
    Assign: 'NoCascade',
    Delete: cascadeDelete,
    Merge: 'NoCascade',
    Reparent: 'NoCascade',
    Share: 'NoCascade',
    Unshare: 'NoCascade',
  },
  Lookup: {
    '@odata.type': 'Microsoft.Dynamics.CRM.LookupAttributeMetadata',
    SchemaName: schema,
    LogicalName: logical,
    DisplayName: label(display),
    Description: label(description),
    RequiredLevel: { Value: 'ApplicationRequired', CanBeChanged: true, ManagedPropertyLogicalName: 'canmodifyrequirementlevelsettings' },
  },
});

const lookups = [
  lookup({
    schema: `${PREFIX}_EmailId`,
    logical: `${PREFIX}_emailid`,
    display: 'Email',
    description: 'The email this read state is about.',
    referenced: 'email',
    referencedCollection: 'Email read states',
    cascadeDelete: 'Cascade',
  }),
  lookup({
    schema: `${PREFIX}_UserId`,
    logical: `${PREFIX}_userid`,
    display: 'Agent',
    description: 'The agent who read it. Explicit as well as implied by the owner, so it can take part in the alternate key.',
    referenced: 'systemuser',
    referencedCollection: 'Email read states',
    cascadeDelete: 'RemoveLink',
  }),
  lookup({
    schema: `${PREFIX}_CaseId`,
    logical: `${PREFIX}_caseid`,
    display: 'Case',
    description: 'DENORMALISED from the email. Lets the client read one page per case per agent instead of one query per message.',
    referenced: 'incident',
    referencedCollection: 'Email read states',
    // NOT Cascade, though a case's read state should certainly die with the case. Dataverse allows a
    // child table exactly ONE parental relationship, and `email` has it: asking for a second returns
    // *"Cannot create another parental relation with Entity: Incident"*. Nothing is lost — deleting a
    // case already cascades to its emails, and each of those cascades to its read-state rows.
    cascadeDelete: 'RemoveLink',
  }),
];

const readOnAttribute = {
  '@odata.type': 'Microsoft.Dynamics.CRM.DateTimeAttributeMetadata',
  SchemaName: `${PREFIX}_ReadOn`,
  LogicalName: `${PREFIX}_readon`,
  DisplayName: label('Read on'),
  Description: label('When the dwell timer confirmed the agent had actually read it.'),
  RequiredLevel: { Value: 'None', CanBeChanged: true, ManagedPropertyLogicalName: 'canmodifyrequirementlevelsettings' },
  Format: 'DateAndTime',
  DateTimeBehavior: { Value: 'UserLocal' },
};

const alternateKey = {
  '@odata.type': 'Microsoft.Dynamics.CRM.EntityKeyMetadata',
  SchemaName: `${PREFIX}_EmailPerAgent`,
  LogicalName: `${PREFIX}_emailperagent`,
  DisplayName: label('One row per email per agent'),
  KeyAttributes: [`${PREFIX}_emailid`, `${PREFIX}_userid`],
};

// ── run ──────────────────────────────────────────────────────────────────────

console.log(`Target: ${ORG}`);
console.log(`Solution: ${SOLUTION} (unmanaged)\n`);

if (!CONFIRM) {
  console.log('DRY RUN — nothing created. Re-run with --confirm.\n');
  console.log(`Would create table ${TABLE} (UserOwned) with:`);
  console.log(`  ${PREFIX}_name     primary name, text(100)`);
  for (const l of lookups) {
    console.log(`  ${l.Lookup.LogicalName.padEnd(14)} lookup -> ${l.ReferencedEntity}  (delete: ${l.CascadeConfiguration.Delete})`);
  }
  console.log(`  ${PREFIX}_readon   datetime, UserLocal`);
  console.log(`  alternate key ${alternateKey.LogicalName} on (${alternateKey.KeyAttributes.join(', ')})`);
  console.log('\nThen publish, and write ids to readstate-ids.json.');
  console.log('Reversible with: node scripts/deploy/revert-readstate-table.mjs --confirm');
  process.exit(0);
}

const created = { createdAt: new Date().toISOString(), org: ORG, table: TABLE, solution: SOLUTION };

// 1. the table
try {
  const existing = await api(`EntityDefinitions(LogicalName='${TABLE}')?$select=MetadataId`).catch(() => null);
  if (existing?.json?.MetadataId) {
    created.metadataId = existing.json.MetadataId;
    console.log(`1. table ${TABLE} -> already exists (${created.metadataId})`);
  } else {
    const r = await api('EntityDefinitions', 'POST', entity);
    created.metadataId = r.headers.get('OData-EntityId')?.match(/\(([^)]+)\)/)?.[1];
    console.log(`1. created table ${TABLE} -> ${created.metadataId ?? 'ok'}`);
  }
} catch (e) {
  console.log(`1. FAILED to create the table: ${e.message}`);
  process.exit(1);
}

// Re-running this script is the normal way to finish a partial run, so "already exists" is a
// success, not a failure. Reporting it as FAILED made a complete table look broken.
const EXISTS = /already exists|is not unique within an entity|Duplicate.*key/i;

// 2. the lookups
created.lookups = [];
for (const l of lookups) {
  const name = l.Lookup.LogicalName;
  try {
    await withSettle(name, () => api('RelationshipDefinitions', 'POST', l));
    console.log(`2. created lookup ${name} -> ${l.ReferencedEntity}`);
    created.lookups.push(name);
  } catch (e) {
    if (EXISTS.test(e.message)) {
      console.log(`2. lookup ${name} -> ${l.ReferencedEntity} already exists`);
      created.lookups.push(name);
    } else {
      // A lookup can be refused outright; report it rather than pretending.
      console.log(`2. lookup ${name} -> ${l.ReferencedEntity} FAILED: ${e.message}`);
    }
  }
}

// 3. the timestamp
try {
  await withSettle(`${PREFIX}_readon`, () =>
    api(`EntityDefinitions(LogicalName='${TABLE}')/Attributes`, 'POST', readOnAttribute));
  console.log(`3. created ${PREFIX}_readon`);
  created.readOn = true;
} catch (e) {
  created.readOn = EXISTS.test(e.message);
  console.log(created.readOn
    ? `3. ${PREFIX}_readon already exists`
    : `3. ${PREFIX}_readon FAILED: ${e.message}`);
}

// 4. the alternate key — only meaningful if both its columns exist
if (created.lookups.includes(`${PREFIX}_emailid`) && created.lookups.includes(`${PREFIX}_userid`)) {
  try {
    await withSettle(alternateKey.LogicalName, () =>
      api(`EntityDefinitions(LogicalName='${TABLE}')/Keys`, 'POST', alternateKey));
    console.log(`4. created alternate key on (${alternateKey.KeyAttributes.join(', ')})`);
    created.alternateKey = alternateKey.LogicalName;
  } catch (e) {
    // Keys are built by a background job and can take a moment; a failure here is not fatal,
    // because the client tolerates a duplicate row (harmless) rather than depending on the key.
    if (EXISTS.test(e.message)) {
      created.alternateKey = alternateKey.LogicalName;
      console.log('4. alternate key already exists');
    } else {
      console.log(`4. alternate key FAILED (not fatal): ${e.message}`);
    }
  }
} else {
  console.log('4. alternate key SKIPPED — one of its lookups was not created');
}

// 5. publish
try {
  await api('PublishXml', 'POST', {
    ParameterXml: `<importexportxml><entities><entity>${TABLE}</entity></entities></importexportxml>`,
  });
  console.log('5. published');
} catch (e) {
  console.log(`5. publish FAILED: ${e.message}`);
}

fs.writeFileSync(IDS_FILE, JSON.stringify(created, null, 2) + '\n');
console.log(`\nWrote ${IDS_FILE}`);
console.log('Remove it again with: node scripts/deploy/revert-readstate-table.mjs --confirm');
