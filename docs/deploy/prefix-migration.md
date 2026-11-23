# Moving the dev environment from the `<old>` prefix to `jhrb`

**Status: a plan. Nothing here has been run.** The source was renamed on 2026-11-23 (branch
`tinymce-editor`); the environment still holds the old objects, so source and environment disagree
until this is done.

## Why this is a migration and not a rename

Dataverse cannot rename a publisher prefix, a table's schema name or a custom control. The old
objects stay as they are; the new ones are created beside them, data is copied across, and the old
ones are deleted last.

| Kind | Old | New |
|---|---|---|
| Publisher | `<old>` (prefix `<old>`, option value prefix `47766`) | `jhrb` (prefix `jhrb`, option value prefix `63249`) |
| Solution | `JHRBCaseEmailClient` | `JHRBCaseEmailClient` |
| Control | `jhrb_JHRB.CaseEmailClient` | `jhrb_JHRB.CaseEmailClient` |
| Tables | `jhrb_emailreadstate`, `jhrb_emailclientsetting` | `jhrb_emailreadstate`, `jhrb_emailclientsetting` |
| Columns / keys / relationships | `jhrb_*` (e.g. `jhrb_emailperagent`) | `jhrb_*` |
| Web resources | `jhrb_/CaseEmailClient/…` | `jhrb_/CaseEmailClient/…` |
| Security role | `Case Email Client — Read State` | `Case Email Client — Read State` |

The option value prefix `63249` was chosen arbitrarily (valid range 10000–99999). **It must be unique
in the environment** — step 1 checks it.

## Before anything

- [ ] Work in the dev environment only. Set `DV_ALLOWED_ORG` and `DV_ORG` to it; every script now
      refuses to run otherwise. Check `az account show` — the scripts do not use the pac profile.
- [ ] Export the current unmanaged solution (`pac solution export`) and keep it. This is the rollback.
- [ ] Export the data (below). Read state is per-agent and cheap to lose; **settings are
      configuration and are not**.
- [ ] Nothing is deleted until step 8, and step 8 needs an explicit yes.

## Steps

1. **Create the publisher.** `jhrb`, prefix `jhrb`, option value prefix `63249`. First query
   `publishers` for an existing row with that option value prefix; if one exists, pick another and
   change `CustomizationOptionValuePrefix` in `solution/src/Other/Solution.xml` to match. (The
   solution import creates the publisher from `Solution.xml`; creating it first just lets you check.)
2. **Build the new solution.** `npm run build` in `pcf/`, then `dotnet build -c Debug -t:Rebuild` in
   `solution/`, then confirm what was packaged (the commands are in `CLAUDE.md`):
   `Managed` is 0 and `Controls/jhrb_JHRB.CaseEmailClient/…` is present.
3. **Import it** (unmanaged, dev). Confirm from Dataverse, not from pac's exit code: the newest
   `importjobs` row for `JHRBCaseEmailClient`. This creates the new tables, role, web resources and
   control, and **updates the `Case - Email Client` form in place** (same form id) to point at the new
   control. Publish.
4. **Copy the data** with a one-off script (to be written, dry-run by default, `--confirm` to write):
   - `jhrb_emailclientsetting` → `jhrb_emailclientsetting`: every row, all columns, including the
     queue lookups. Compare row counts afterwards.
   - `jhrb_emailreadstate` → `jhrb_emailreadstate`: optional. Without it every agent sees every
     message as unread once. Upsert on the alternate key `jhrb_emailperagent`.
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
   1. the old control `jhrb_JHRB.CaseEmailClient` (it only deletes once nothing references it — step 3
      moved the form off it);
   2. the old tables `jhrb_emailreadstate` and `jhrb_emailclientsetting` — **destructive, data is
      gone** — only after step 4's counts match and step 7 passed;
   3. the old role, the old web resources (`jhrb_/CaseEmailClient/EmailRTEconfig.js` is also unused
      since 1.44.0) and the unused "compose body" email form;
   4. the old solution container `JHRBCaseEmailClient` — it is unmanaged, so deleting it removes only
      the container, which is why the components above are deleted explicitly;
   5. the old publisher `<old>` **only if no other solution uses it** (check `solutions` for
      `_publisherid_value`). In a shared environment other teams' solutions may. If any do, leave it.

   A cleanup script with the **old** names is needed for this (to be written, dry-run by default);
   `scripts/deploy/revert-deploy.mjs` now only knows the new names.

## Rollback

Up to step 8 the old objects are untouched. If step 7 fails: point the form back at the old control
(re-import the exported solution from "Before anything"), and delete the new objects. After step 8
the exported solution plus the data export are the only way back.

## Also before publishing the repository

- **Git history still contains** the old names, a corporate e-mail address, the demo environment URL and
  tenant names (in commits, and in the earlier versions of the files changed here). Renaming files
  does not remove them. Either publish from a fresh history, or rewrite it first
  (`git filter-repo`) and force-push — that is a separate, deliberate decision.
- The test fixtures still use the maintainer's name with `@example.com` addresses.
