// Creates the email client's own configuration table, `jhrb_emailclientsetting`.
//
//   node scripts/deploy/create-settings-table.mjs [--confirm]
//
// Environment guard and token acquisition: see scripts/deploy/README.md.
//
// Dry run unless --confirm. This is a SCHEMA change to a shared environment.
//
// Why its OWN table, when `jhrb_queuesetting` already exists in this environment and already has a
// `jhrb_sendfromqueue` flag: that table belongs to a separate customisation with its own lifecycle,
// naming and deployment. A product that reads someone else's table inherits all three, and breaks
// when they rename a column. The behaviour is deliberately the same; the storage is ours.
//
// Why ORGANIZATION-owned, unlike `jhrb_emailreadstate`: this is configuration, not per-agent data.
// Read state is UserOwned precisely so Dataverse trims each agent to their own rows; configuration
// is the opposite — every agent reads the same rows and none of them writes any.
//
// Shape: one default row governs everything, and a row naming a queue overrides it for that queue.
// `domain/sender.ts#pickSetting` applies the precedence and is where the rule is tested.
import {
  CONFIRM, api, getEnv, label, publish, withSettle, writeIds,
} from '../lib/dv.mjs';

const { org: ORG } = getEnv();

const SOLUTION = 'JHRBCaseEmailClient';
const PREFIX = 'jhrb';
const TABLE = `${PREFIX}_emailclientsetting`;
const SCHEMA = `${PREFIX}_EmailClientSetting`;
const IDS_FILE = `${import.meta.dirname}/settings-ids.json`;

// Every request carries the solution header, so each created component lands in our unmanaged
// solution rather than loose in Default. (withSettle — the metadata-cache retry — lives in
// scripts/lib/dv.mjs.)
const dv = (path, opts = {}) => api(path, { solution: SOLUTION, ...opts });

// ── the definitions ──────────────────────────────────────────────────────────

const bool = ({ schema, logical, display, description }) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.BooleanAttributeMetadata',
  SchemaName: schema,
  LogicalName: logical,
  DisplayName: label(display),
  Description: label(description),
  RequiredLevel: { Value: 'None', CanBeChanged: true, ManagedPropertyLogicalName: 'canmodifyrequirementlevelsettings' },
  DefaultValue: false,
  OptionSet: {
    '@odata.type': 'Microsoft.Dynamics.CRM.BooleanOptionSetMetadata',
    TrueOption: { Value: 1, Label: label('Yes') },
    FalseOption: { Value: 0, Label: label('No') },
  },
});

/**
 * A plain text column.
 *
 * The third column shape this table needs, alongside `bool()` and `lookup()`. Kept short
 * deliberately — these hold a table or column *name*, not prose.
 */
const text = ({ schema, logical, display, description, maxLength = 100 }) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata',
  SchemaName: schema,
  LogicalName: logical,
  DisplayName: label(display),
  Description: label(description),
  RequiredLevel: { Value: 'None', CanBeChanged: true, ManagedPropertyLogicalName: 'canmodifyrequirementlevelsettings' },
  MaxLength: maxLength,
  FormatName: { Value: 'Text' },
});

const entity = {
  '@odata.type': 'Microsoft.Dynamics.CRM.EntityMetadata',
  SchemaName: SCHEMA,
  LogicalName: TABLE,
  DisplayName: label('Email client setting'),
  DisplayCollectionName: label('Email client settings'),
  Description: label(
    'Configuration for the JHRB.CaseEmailClient PCF: whether mail on a case is sent as the case\'s '
    + 'queue rather than as the agent. One default row, plus optional per-queue overrides.',
  ),
  // Organization-owned: configuration every agent reads and none writes.
  OwnershipType: 'OrganizationOwned',
  IsActivity: false,
  HasActivities: false,
  HasNotes: false,
  // `IsValidForQueue` / `IsDuplicateDetectionEnabled` are BooleanManagedProperty, not booleans.
  // Sending either shape returns an OData payload error naming neither field. Both default to
  // false on a custom table, so they are left out rather than guessed at.
  Attributes: [{
    '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata',
    SchemaName: `${PREFIX}_Name`,
    LogicalName: `${PREFIX}_name`,
    DisplayName: label('Name'),
    Description: label('A label for administrators, e.g. "Default" or "Care".'),
    RequiredLevel: { Value: 'ApplicationRequired', CanBeChanged: true, ManagedPropertyLogicalName: 'canmodifyrequirementlevelsettings' },
    MaxLength: 100,
    FormatName: { Value: 'Text' },
    IsPrimaryName: true,
  }],
};

const flags = [
  bool({
    schema: `${PREFIX}_IsDefault`,
    logical: `${PREFIX}_isdefault`,
    display: 'Is default',
    description: 'Marks the single org-wide fallback row, used when no row names the case\'s queue.',
  }),
  bool({
    schema: `${PREFIX}_SendFromQueue`,
    logical: `${PREFIX}_sendfromqueue`,
    display: 'Send from queue',
    description:
      'Send outgoing mail as the case\'s queue rather than as the agent. Off means stock behaviour.',
  }),
  bool({
    schema: `${PREFIX}_AllowSenderOverride`,
    logical: `${PREFIX}_allowsenderoverride`,
    display: 'Allow sender override',
    description:
      'Let the agent switch the From line between the queue and themselves while composing.',
  }),
  /*
   * Where a NEW message's default recipient comes from, as an entity + field pair.
   *
   * Dataverse only reliably delivers to a recipient that matches a record — an address alone is
   * an "unresolved party", refused unless `allowunresolvedpartiesonemailsend` is on. So the
   * client needs to know which lookup on the hosting record names the person to write to.
   *
   * The ENTITY is named as well as the field so a row is self-describing and a future non-Case
   * placement can carry its own row, rather than the control assuming it is always on a Case.
   */
  text({
    schema: `${PREFIX}_RecipientEntity`,
    logical: `${PREFIX}_recipiententity`,
    display: 'Recipient entity',
    description:
      'Logical name of the table this control is hosted on, e.g. "incident". Paired with '
      + 'Recipient lookup.',
    maxLength: 64,
  }),
  text({
    schema: `${PREFIX}_RecipientLookup`,
    logical: `${PREFIX}_recipientlookup`,
    display: 'Recipient lookup',
    description:
      'Logical name of the lookup on that table naming the default recipient, e.g. '
      + '"customerid" or "primarycontactid". Must point at a contact, account, user, lead or '
      + 'queue.',
    maxLength: 64,
  }),
];

const lookup = ({ schema, logical, display, description }) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata',
  SchemaName: `${PREFIX}_${logical}_queue_${TABLE}`,
  ReferencedEntity: 'queue',
  ReferencingEntity: TABLE,
  AssociatedMenuConfiguration: {
    Behavior: 'DoNotDisplay',
    Group: 'Details',
    Label: label('Email client settings'),
    Order: 10000,
  },
  CascadeConfiguration: {
    // Nothing parental here. A settings row is configuration ABOUT a queue, not a child of it,
    // and deleting a queue should leave an obviously-stale row rather than silently removing
    // configuration an administrator wrote. (Dataverse also allows only one parental
    // relationship per table, so two Cascade lookups would be refused outright anyway.)
    Assign: 'NoCascade',
    Delete: 'RemoveLink',
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
    RequiredLevel: { Value: 'None', CanBeChanged: true, ManagedPropertyLogicalName: 'canmodifyrequirementlevelsettings' },
  },
});

const lookups = [
  lookup({
    schema: `${PREFIX}_Queue`,
    logical: `${PREFIX}_queue`,
    display: 'Queue',
    description: 'The queue this row configures. Leave empty on the default row.',
  }),
  lookup({
    schema: `${PREFIX}_OverrideQueue`,
    logical: `${PREFIX}_overridequeue`,
    display: 'Override queue',
    description:
      'Send from THIS queue whatever queue the case is in. Normally empty — the case\'s own queue '
      + 'is the right sender, and this exists only for a shared-mailbox arrangement.',
  }),
];

// ── run ──────────────────────────────────────────────────────────────────────

console.log(`Target: ${ORG}`);
console.log(`Solution: ${SOLUTION} (unmanaged)\n`);

if (!CONFIRM) {
  console.log('DRY RUN — nothing created. Re-run with --confirm.\n');
  console.log(`Would create table ${TABLE} (OrganizationOwned) with:`);
  console.log(`  ${PREFIX}_name                 primary name, text(100), required`);
  for (const f of flags) {
    const kind = f['@odata.type'].includes('String') ? 'text' : 'boolean, default No';
    console.log(`  ${f.LogicalName.padEnd(24)} ${kind}`);
  }
  for (const l of lookups) console.log(`  ${l.Lookup.LogicalName.padEnd(21)} lookup -> queue (delete: RemoveLink)`);
  console.log('\nThen publish, and write ids to settings-ids.json.');
  console.log('\nAfterwards, and both are required for agents to see any of it:');
  console.log('  node scripts/deploy/grant-settings-read.mjs --confirm   (read privilege)');
  console.log('  node scripts/deploy/seed-settings.mjs --confirm         (the default row)');
  console.log('\nReversible with: node scripts/deploy/revert-settings-table.mjs --confirm');
  process.exit(0);
}

const created = { createdAt: new Date().toISOString(), org: ORG, table: TABLE, solution: SOLUTION };

// 1. the table
try {
  // Only a 404 means "absent". Anything else (an expired token's 401) throws, rather than being
  // read as "not there" and followed by a create.
  const existing = await dv(`EntityDefinitions(LogicalName='${TABLE}')?$select=MetadataId`, { allow404: true });
  if (existing?.json?.MetadataId) {
    created.metadataId = existing.json.MetadataId;
    console.log(`1. table ${TABLE} -> already exists (${created.metadataId})`);
  } else {
    const r = await dv('EntityDefinitions', { method: 'POST', body: entity });
    created.metadataId = r.id;
    console.log(`1. created table ${TABLE} -> ${created.metadataId ?? 'ok'}`);
  }
} catch (e) {
  console.log(`1. FAILED to create the table: ${e.message}`);
  process.exit(1);
}

// Re-running is the normal way to finish a partial run, so "already exists" is a success.
const EXISTS = /already exists|is not unique within an entity|Duplicate.*key/i;

// 2. the flags
created.flags = [];
for (const f of flags) {
  try {
    await withSettle(
      () => dv(`EntityDefinitions(LogicalName='${TABLE}')/Attributes`, { method: 'POST', body: f }),
      f.LogicalName,
    );
    console.log(`2. created ${f.LogicalName}`);
    created.flags.push(f.LogicalName);
  } catch (e) {
    if (EXISTS.test(e.message)) {
      console.log(`2. ${f.LogicalName} already exists`);
      created.flags.push(f.LogicalName);
    } else {
      console.log(`2. ${f.LogicalName} FAILED: ${e.message}`);
    }
  }
}

// 3. the queue lookups
created.lookups = [];
for (const l of lookups) {
  const name = l.Lookup.LogicalName;
  try {
    await withSettle(() => dv('RelationshipDefinitions', { method: 'POST', body: l }), name);
    console.log(`3. created lookup ${name} -> queue`);
    created.lookups.push(name);
  } catch (e) {
    if (EXISTS.test(e.message)) {
      console.log(`3. lookup ${name} -> queue already exists`);
      created.lookups.push(name);
    } else {
      console.log(`3. lookup ${name} -> queue FAILED: ${e.message}`);
    }
  }
}

// 4. publish
try {
  // Scoped to our own new table, which nobody else customises.
  await publish({ entities: [TABLE] });
  console.log('4. published');
} catch (e) {
  console.log(`4. publish FAILED: ${e.message}`);
}

writeIds(IDS_FILE, created);
console.log('\nWrote settings-ids.json');
console.log('\nSTILL TO DO — the table is useless to agents without both:');
console.log('  node scripts/deploy/grant-settings-read.mjs --confirm');
console.log('  node scripts/deploy/seed-settings.mjs --confirm');
console.log('Remove it all again with: node scripts/deploy/revert-settings-table.mjs --confirm');
