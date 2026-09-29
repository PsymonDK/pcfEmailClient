# Deployment scripts

Environment changes the email client needs beyond the solution import: two custom tables, the
role agents need to use them, the default settings row, and the dedicated Case form. Every script
here is **dry-run unless you pass `--confirm`**: without it, it reads the environment and prints
what it would do, and changes nothing.

## Run order

| # | Script | What it does | Undo |
|---|---|---|---|
| 1 | `create-readstate-table.mjs` | `jhrb_emailreadstate` (UserOwned, R6) | `revert-readstate-table.mjs` |
| 2 | `create-readstate-role.mjs` | Role *Case Email Client — Read State*, User-level CRUD + Append/AppendTo on it | delete the role by hand |
| 3 | `create-settings-table.mjs` | `jhrb_emailclientsetting` (OrganizationOwned) | `revert-settings-table.mjs` |
| 4 | `grant-settings-read.mjs` | Adds Global Read on the settings table to the role from step 2 | goes with the table |
| 5 | `seed-settings.mjs` | The single default settings row (or backfills new columns on it) | goes with the table |
| 6 | `create-case-form.mjs` | The *Case - Email Client* form, registered with the CSW app | `revert-deploy.mjs` |

Each writes a small `*-ids.json` beside itself recording what it created and **which org** it
created it in. Reverts check that org before using the ids.

Two steps stay manual, per environment: **assign the role** to the agents who use the client, and
the application tab template that opens the form as a session tab.

```bash
node scripts/deploy/create-readstate-table.mjs            # dry run: prints the plan
node scripts/deploy/create-readstate-table.mjs --confirm  # does it
```

## Environment guard

All scripts share [`../lib/dv.mjs`](../lib/dv.mjs). It refuses to start unless the target is
**`https://your-org.crm4.dynamics.com`** (pac profile [3], Customer Service Demo
DK). `DV_ORG` is optional; if set, it must name that org (case and a trailing slash are ignored),
or the script exits non-zero before making a single request. This exists because the reverts
delete by name, and pac profile [2] (another environment) is one `pac auth select` away.

## Token

`DV_TOKEN` if set; otherwise the script asks the Azure CLI in-process:

```bash
az login          # once
node scripts/deploy/<script>.mjs
```

which runs `az account get-access-token --resource <org> --query accessToken -o tsv`. The token is
never written to disk or logged. **There is no `.tok` file any more** — a bearer token on disk
outlives the shell that needed it.

## Things that behave differently from what you might expect

- **Only a 404 means "absent".** An existence check that fails with 401/403 (an expired token)
  stops the script instead of being read as "not there, nothing to do" or "not there, create it".
- **`revert-deploy.mjs` removes the product** — the form, the `JHRBCaseEmailClient` solution
  container and the `jhrb_JHRB.CaseEmailClient` control. It deletes `deployed-ids.json` only when
  every step succeeded; after a partial failure the file is kept so a re-run can finish.
- **`create-case-form.mjs` refuses to create a second *Case - Email Client* form.** It creates the
  form in the `JHRBCaseEmailClient` solution and publishes the whole `incident` entity — which also
  publishes anyone else's pending customisations on Case in this shared environment.
- The R8 parent-link fixture that used to live here is a test fixture, not a deploy step; it is
  now [`../spikes/r8-parent-link.mjs`](../spikes/r8-parent-link.mjs).
