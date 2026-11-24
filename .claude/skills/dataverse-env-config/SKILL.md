---
name: dataverse-env-config
description: Keep environment-specific values (org URL, record ids, approved recipient) out of scripts and source - the .env.local convention for scripts under scripts/, and Dataverse environment variables (solution-aware definitions and values) for configuration that ships with the product. Use when a script needs an id or URL that differs per environment, when adding or running a script against a new environment, or when deciding where a per-environment setting should live.
---

# Environment-specific values, without hardcoding them

"Environment variable" means two different things here. Pick before you write anything.

| | Process environment variable | Dataverse environment variable |
|---|---|---|
| What | `DV_*` in `.env.local` / the shell, read by a **script** | `environmentvariabledefinition` + `environmentvariablevalue` rows, part of a **solution** |
| Who reads it | `scripts/**/*.mjs` on a developer's machine | Flows, canvas/custom pages, Copilot Studio, custom connectors, or code that queries the rows |
| Travels with | nothing — local to one checkout | the solution (definition always, value optionally) |
| Use for | ids of existing rows in *this* environment, the org URL, the test recipient | a setting the **product** needs to differ per environment |

An id a script needs (an app module, a queue, a contact, a spike's form) is the first kind. This project's product configuration is neither: it lives in the `jhrb_emailclientsetting` table, because it needs **per-queue rows** and a Dataverse environment variable holds one value.

## 1. Scripts: `.env.local`

Nothing environment-specific is written into a script. [`scripts/lib/dv.mjs`](../../../scripts/lib/dv.mjs) loads `.env.local` from the repo root when it is imported; [`.env.example`](../../../.env.example) is the committed list of every name.

```bash
cp .env.example .env.local      # then fill it in; .env.* is gitignored, .env.example is not
git check-ignore -v .env.local  # must print the .gitignore rule - run it before the first commit
```

Rules:

- **The shell wins over the file** (`process.loadEnvFile` never overrides a variable that is already set — measured on Node 24). A stale `export DV_ORG=…` in a long-lived terminal silently beats `.env.local`. Check with `env | grep ^DV_` (bash) / `Get-ChildItem Env:DV_*` (PowerShell) when a script targets the wrong place. The environment guard still stops a wrong *org*; nothing stops a wrong *id*.
- **One file per environment:** `DV_ENV_FILE=.env.test node scripts/…`. Keep each file gitignored (`.env.*` covers them).
- **Never put a token or password in the file.** The token comes from `az login` or `DV_TOKEN` in one shell. A bearer token on disk outlives the shell that needed it.
- **The target is named twice:** `DV_ORG` and `DV_ALLOWED_ORG` must both be set and equal, or the script exits before any request. Keep both in the file.
- **In a script, read an id with `envGuid(name, what)`** from `dv.mjs`. It strips braces, lowercases, rejects anything that is not a GUID (so nothing odd reaches an OData URL) and, when the variable is missing, says what the id *is* and where to put it instead of failing on `undefined`.
- **Name** a variable `DV_<WHAT>_ID`, with a spike prefix (`DV_R18_…`) when only one spike needs it. Variables for one script are needed only to run that script; the others stay blank.
- **Windows:** Git Bash `export DV_X=…`; PowerShell `$env:DV_X = '…'`. Neither persists across terminals — which is why the file exists.

### Adding a new id to a script

1. Read it: `const QUEUE = envGuid('DV_CARE_QUEUE_ID', 'the id of the approved service queue');` — a module-level `const`, so a missing value fails before anything runs.
2. Add the name to `.env.example` with a one-line "how to find it" query. Leave it blank there.
3. Add the real value to your `.env.local`.
4. `git grep -nIE "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" -- scripts` — the only hit left should be a project constant (below).

### What may stay hardcoded

An id that is **owned by this repository and identical in every environment**, because the solution source fixes it: the Case - Email Client form id in `scripts/install/post-import.mjs` (also in `solution/src/…/FormXml/`). Downstream installs run that script with no setup, so it must not need an `.env`. Anything an environment *generated* (queues, contacts, apps, cases, mailboxes) is not that.

### Finding an id

Read with the same helpers the scripts use (`api()` from `dv.mjs`), against the allowed org:

```
appmodules?$select=appmoduleid,name&$filter=uniquename eq '<unique name>'
contacts?$select=contactid,fullname&$top=5
queues?$select=queueid,name,emailaddress&$filter=contains(name,'<name>')
```

## 2. Dataverse environment variables (product configuration)

Use these when the **product** needs a per-environment value that is *one value*: an endpoint, a feature switch, a threshold. Facts below are from Microsoft Learn (re-check `ms.date`; the feature changes) and, where marked, measured here.

- **Two tables.** `environmentvariabledefinition` (schema name, type, `defaultvalue`) and `environmentvariablevalue` (`value`, the *current* value, one row per definition per environment). The **default applies only when no value row exists.** The definition is a solution component; whether the value row travels with the solution is a deployment decision.
- **Types** (`type` option values): String `100000000`, Integer `100000001`, Boolean `100000002`, JSON `100000003`, Data Source `100000004`; Secret is a String with a secret store. Copilot Studio maps Decimal→Number, Text→String, Yes/No→Boolean, Data source/Secret→String.
- **Read it** with an expand — the navigation property name was **verified against the demo environment (2026-11-24)**:
  ```
  environmentvariabledefinitions?$select=schemaname,type,defaultvalue
    &$expand=environmentvariabledefinition_environmentvariablevalue($select=value)
    &$filter=schemaname eq 'jhrb_<name>'
  ```
  Effective value = the expanded `value` if present, else `defaultvalue`. A PCF reads it through `context.webAPI.retrieveMultipleRecords` like any other table; it needs Read on both tables.
- **Create or change it** with the `UpsertEnvironmentVariable` action (`SchemaName` required and prefixed, `Type` required, `DisplayName`, `DefaultValue`, `Value` optional), or the maker portal. Name it with the publisher prefix (`jhrb_`).
- **Per-environment values at import:** `pac solution create-settings` writes a deployment-settings JSON (an `EnvironmentVariables` array keyed by `SchemaName`, each with a `Value`); `pac solution import --settings-file <file>` applies it. Keep that file per environment and **out of git** if it holds anything environment-specific.
- **Do not ship your dev environment's current value.** Export the solution without the value rows (or strip them from `solution/src`) so a downstream import falls back to the default or the settings file. A value row copied from the demo environment is the same leak as a hardcoded id.
- **Secrets:** only Azure Key Vault is supported as a store, and the secret is not generally available through the API — Learn lists Power Automate flows, Copilot Studio agents and custom connectors as the places it can be used. A Text variable holding a secret is **not** secure. Never put a client secret in a plain variable.
- **A variable is not a table.** One value per definition. If the setting needs rows (per queue, per team, per user) or a lookup, use a table, as `jhrb_emailclientsetting` does.

## Checklist before committing a script or a solution change

- [ ] `git grep` for GUIDs and for the org host finds no environment-specific value (see 1.4)
- [ ] a new name is in `.env.example`, blank
- [ ] `git status` shows no `.env.local`, no `*-ids.json`, no deployment-settings file
- [ ] a Dataverse environment variable in the solution has no current value in source, or the value is the same everywhere

## Sources

- [Use environment variables in Power Platform solutions](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/environmentvariables)
- [EnvironmentVariableDefinition table reference](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/reference/entities/environmentvariabledefinition) · [EnvironmentVariableValue](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/reference/entities/environmentvariablevalue)
- [UpsertEnvironmentVariable action](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/upsertenvironmentvariable?view=dataverse-latest)
- [Environment variables for Azure Key Vault secrets](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/environmentvariables-azure-key-vault-secrets)
- [Pre-populate connection references and environment variables for automated deployments](https://learn.microsoft.com/en-us/power-platform/alm/conn-ref-env-variables-build-tools) · [`pac solution` commands](https://learn.microsoft.com/en-us/power-platform/developer/cli/reference/solution)
