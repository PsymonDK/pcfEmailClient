# Moving a dev environment to the `jhrb` prefix

**Status: done in the dev (demo) environment on 2026-11-23, steps 1–8.** The source was renamed to
the `jhrb` prefix that day. Any other environment set up from the earlier source still holds the
objects under the **old prefix** and needs this plan. The concrete old names are in
`docs/deploy/prefix-migration.local.md`, which is deliberately **not** in git.

What the run found, for the next environment:

- **Component ids must be regenerated.** Renaming the files is not enough: the views, forms, role and
  web resource of the renamed objects kept their old GUIDs, and the first import failed with
  *"…because its 'savedqueryid' already exists on the system"* before changing anything. Every such
  component got a fresh GUID (the form of the Case entity keeps its id on purpose — it is updated in
  place). Without that the role and web resource would have overwritten the old ones.
- **`pac solution import` without a publish leaves the form unpublished.** The Case form still read
  the old control until `incident` (and the new tables, `email` and the new web resources) were
  published with `PublishXml`. Publishing `incident` also publishes anyone else's pending Case
  customisations.
- **A table delete can lose its response.** Two deletes returned `fetch failed` (a dropped
  connection / DNS lookup); one had in fact succeeded. After any failed delete, query the state
  before retrying.
- **The old publisher was shared** (seven other visible solutions) and was left alone.
- Nobody held the old role, so nothing needed reassigning.

## Why this is a migration and not a rename

Dataverse cannot rename a publisher prefix, a table's schema name or a custom control. The new
objects are created beside the old ones, data is copied across, and the old ones are deleted last.

| Kind | Old | New |
|---|---|---|
| Publisher | `<old>` | `jhrb` (prefix `jhrb`, option value prefix `63249`) |
| Solution | the old solution | `JHRBCaseEmailClient` |
| Control | `<old>_<OLD>.CaseEmailClient` | `jhrb_JHRB.CaseEmailClient` |
| Tables | `<old>_emailreadstate`, `<old>_emailclientsetting` | `jhrb_emailreadstate`, `jhrb_emailclientsetting` |
| Columns / keys / relationships | `<old>_*` | `jhrb_*` |
| Web resources | `<old>_/CaseEmailClient/…` | `jhrb_/CaseEmailClient/…` |
| Security role | the old role name | `Case Email Client — Read State` |

The option value prefix `63249` was chosen arbitrarily (valid range 10000–99999). **It must be unique
in the environment** — step 1 checks it.

## Before anything

- [ ] Work in the dev environment only. Set `DV_ALLOWED_ORG` and `DV_ORG` to it; every script
      refuses to run otherwise. Check `az account show` — the scripts do not use the pac profile.
- [ ] Export the current unmanaged solution (`pac solution export`) and keep it. This is the rollback.
- [ ] Export the data. Read state is per-agent and cheap to lose; **settings are configuration and
      are not**.
- [ ] Nothing is deleted until step 8, and step 8 needs an explicit yes.

## Steps

1. **Create the publisher.** Query `publishers` for an existing row with option value prefix `63249`;
   if one exists, pick another and change `CustomizationOptionValuePrefix` in
   `solution/src/Other/Solution.xml`. (The solution import creates the publisher from `Solution.xml`;
   creating it first just lets you check.)
2. **Build the new solution.** `npm run build` in `pcf/`, then `dotnet build -c Debug -t:Rebuild` in
   `solution/`, then confirm what was packaged (the commands are in `CLAUDE.md`): `Managed` is 0 and
   `Controls/jhrb_JHRB.CaseEmailClient/…` is present.
3. **Import it** (unmanaged, dev). Confirm from Dataverse, not from pac's exit code: the newest
   `importjobs` row for `JHRBCaseEmailClient`. This creates the new tables, role, web resources and
   control, and **updates the `Case - Email Client` form in place** (same form id) to point at the new
   control. Publish.
4. **Copy the data** with a one-off script (to be written, dry-run by default, `--confirm` to write):
   - the settings table, every row and column including the queue lookups; compare row counts after;
   - the read-state table: optional. Without it every agent sees every message as unread once.
     Upsert on the alternate key `jhrb_emailperagent`.
5. **Assign the new role** to every agent who used the old one
   (`node scripts/install/post-import.mjs --org … --confirm`, or by hand). A new custom table grants
   privileges to nobody else — without this read state is refused for every agent.
6. **Register the form with the CSW app** only if the form id changed (it should not have).
7. **Verify in the published app**, with a hard reload (Ctrl+Shift+R) and a check of the bundle the
   page actually loaded, not the control version:
   - the thread list loads; read state persists across a reload;
   - compose opens, the editor appears, a draft saves and resumes;
   - a settings row takes effect (sender queue, recipient default);
   - a real send **only to the address in `DV_APPROVED_RECIPIENT`**, announced before it is sent.
8. **Retire the old objects**, in this order, each with an explicit confirmation naming what goes:
   1. the old control (it only deletes once nothing references it — step 3 moved the form off it);
   2. the two old tables — **destructive, data is gone** — only after step 4's counts match and
      step 7 passed;
   3. the old role, the old web resources (the RTE config is also unused since 1.44.0) and the
      unused "compose body" email form;
   4. the old solution container — it is unmanaged, so deleting it removes only the container, which
      is why the components above are deleted explicitly;
   5. the old publisher **only if no other solution uses it** (check `solutions` for
      `_publisherid_value`). In a shared environment other teams' solutions may. If any do, leave it.

   A cleanup script with the **old** names is needed for this (to be written, dry-run by default);
   `scripts/deploy/revert-deploy.mjs` now only knows the new names.

## Rollback

Up to step 8 the old objects are untouched. If step 7 fails: point the form back at the old control
(re-import the exported solution from "Before anything"), and delete the new objects. After step 8
the exported solution plus the data export are the only way back.
