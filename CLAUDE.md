# CLAUDE.md — modeldriven-emailclient

Guidance for Claude Code working in this repository. Read this before touching anything.

## What this project is

A **Case-scoped email client** for Dynamics 365 Customer Service, hosted in the **Copilot Service
Workspace (CSW)** app. It gives agents a native mail experience (threading, in-place reply, rich text,
attachments, templates, signatures, drafts) scoped to a single Case — where the OOB Timeline is an
activity feed and the OOB Inbox is queue-scoped rather than Case-scoped.

**Current state: research only. No implementation code exists yet.** The architecture decision is
recorded but not yet spike-validated. See [`docs/research/00-index.md`](docs/research/00-index.md) and
the ADR at [`docs/research/07-decision.md`](docs/research/07-decision.md).

## The architecture decision — read this before proposing anything

**Decided: a React (virtual) PCF code component**, registered in two places:

| Placement | Mechanism |
|---|---|
| Case form tab | The PCF directly — virtual/React **dataset** component on a single-column tab, bound to a subgrid of `email` where `regardingobjectid` = the Case |
| CSW session tab | The **same PCF** hosted inside a thin **custom page**, opened by a `Custom` application tab template with `recordId` = `{anchor.incidentid}` |

**Rejected, and why — do not re-propose these without new evidence:**

| Candidate | Why not |
|---|---|
| **Generative page** | Unsupported in side panes; no `generative` page type in CSW application tab templates; restricted to a fixed Dataverse data-type list that cannot express `activityparty` recipients or `activitymimeattachment` binaries, with no route to `SendEmail` |
| **Custom page alone** | Cannot sit on a form tab; **state is not persisted across multi-session tab switches** → loses in-progress drafts (fails MUST requirements R16/N1) |
| **Code app via iframe** | Same multi-session state loss; no `Xrm` inside the frame; no Power Platform Git integration; end users need **Power Apps Premium** |
| **Classic HTML web resource** | Same state loss; no `context` API; iframe seams; undocumented `parent`/`window.top` coupling |

The deciding factor was **multi-session state**, not UI capability. PCF is the only host with a
documented preservation contract (`context.mode.setControlState`) for CSW's destroy/reload cycle.

**Reversal conditions** are listed in the ADR. The most likely one to check before building: if the
CSW `Control` application tab template type stops being documented "for internal use only", the custom
page wrapper becomes unnecessary and the architecture simplifies to PCF alone.

## Plugins and skills — which to use, which to avoid

Three Power Platform plugins are installed. **None of them target PCF development**, which is what this
project needs. Getting this wrong means building the architecture we explicitly rejected.

| Plugin / skill | Use here? |
|---|---|
| `model-apps:app-builder` (`/app-builder`) | **Yes, for schema and app plumbing only** — Dataverse tables/columns (e.g. the read-state column for R6), the Case form tab, sitemap, security roles, solution scaffolding |
| `model-apps:genpage` (`/genpage`) | **No.** Builds generative pages — the architecture we eliminated. Do not invoke it for the email client. |
| `code-apps-preview:*` (`create-code-app`, `add-dataverse`, `deploy`, …) | **No.** Targets Power Apps code apps — candidate D, rejected on multi-session state loss and Premium licensing. |
| `mcp-apps:*` | Not relevant. |

**The PCF itself is hand-written**: `pac pcf init` / `pac pcf push` plus standard React tooling. There is
no plugin shortcut, and inventing one by reaching for `/genpage` or the code-app skills is the main
foreseeable failure mode in this repo.

### Reference material that does and does not transfer

The `model-apps` plugin's `references/` are written for the **generative page host**. Do not apply them
wholesale:

- **Does not transfer:** anything about `props.dataApi`, the genpage host's **double-mount**, or
  `window.__pp*Inflight` / `__pp*Cache` de-duping. PCF has a different lifecycle (`init` / `updateView`
  / `destroy`) and uses `context.webAPI`.
- **Does transfer:** Fluent UI v9 + Griffel `makeStyles` conventions (no inline styles, no media queries
  as top-level keys), batched state objects to avoid intermediate renders, accessibility and
  localisation practice, and the note that **Fluent UI v9 has no file-uploader component** (relevant to
  R13 drag-and-drop attachments).

## Local environment

Verified present as of 2026-09-09:

| Tool | Version |
|---|---|
| PAC CLI | 2.11.2 |
| Node | v24.13.0 |
| npm | 11.6.2 |
| git | 2.53.0 |

**`pac` is authenticated.** Active profile `[3]`: **the demo environment** —
`https://your-org.crm4.dynamics.com/`. Profile `[2]` is a different environment
(another environment) — **do not target it**.

Always confirm the active profile before any environment-touching command:

```bash
pac auth list
```

### Environment guardrails

- **Never run destructive `pac` commands** without explicit confirmation in the conversation:
  `pac solution delete`, `pac org delete`, `pac admin reset`, `pac data delete`, or anything that
  removes or overwrites solution components in a shared environment.
- Prefer `pac pcf push` into an **unmanaged dev solution**; never push straight at anything managed.

### Managed vs unmanaged — non-negotiable

**Dev is unmanaged. Managed is only for downstream environments and final delivery.** Managed
components cannot be customised in the environment they are installed into, which fights every
iteration loop this project needs.

`solution/solution.cdsproj` therefore sets `<SolutionPackageType>Unmanaged</SolutionPackageType>`.
Two traps to know about:

- **Leaving that property out silently defaults to Managed.** It ships commented out in the
  `pac solution init` template, which is exactly how a managed solution first got installed into the
  dev environment here.
- **A `Condition="'$(SolutionPackageType)' == ''"` guard on it never fires** — the PowerApps `.props`
  import assigns `Managed` before the project's own `PropertyGroup` is evaluated. Set it
  unconditionally.

Release build, only when shipping downstream:

```bash
dotnet build -c Release -p:SolutionPackageType=Managed
```

Verify what you actually built before importing anything:

```bash
unzip -p solution/bin/Release/solution.zip solution.xml | grep -o '<Managed>[01]</Managed>'
```

`<Managed>0</Managed>` = unmanaged. Deleting an **unmanaged** solution removes only the container —
its components stay in the environment and must be deleted explicitly (see
[`scripts/seed/revert-s1.mjs`](scripts/seed/revert-s1.mjs)).
- This is a shared demo environment. Assume other people's work is in it. Do not publish
  customisations app-wide, do not change System Settings (including
  `Organization.MaxUploadFileSize`) without asking, and do not send test email to real addresses.
- Confirm before sending any email from the environment — `SendEmail` with `IssueSend: true` sends for
  real. Use `IssueSend: false` for logging-only tests and be explicit about which you are using.

## Dataverse practice for this project

Full detail in [`docs/research/04-data-model.md`](docs/research/04-data-model.md). The rules that will
bite if forgotten:

**Querying**
- Scope every query by `regardingobjectid` **and** guard on `_regardingobjecttypecode` — GUIDs can
  collide across tables.
- **Never fetch `description` (the body) in a list query.** `Email.Description` now lives in Azure Blob
  storage; fetch it lazily per message on expand. This is a hard performance requirement (N5), not an
  optimisation.
- **Filtering on `description` is unsupported** — not in FetchXML, Quick Find or Advanced Find. Body
  search must go through **Dataverse search**. Don't write a `$filter` against it and expect it to work.
- Select columns explicitly. Never `retrieveMultipleRecords` without `$select`.
- Use `context.webAPI`, not raw `fetch`, so security trimming and the platform's request pipeline apply.

**Writing**
- Recipients are **`activityparty` rows**, not strings. `participationtypemask`: **1** Sender,
  **2** To, **3** Cc, **4** Bcc. `email.torecipients` is a read-only display convenience
  (`IsValidForForm: False`) — never write it.
- A draft is `statecode` = 0 (Open) + `statuscode` = 1 (Draft). `Email.StatusCode` **cannot be null**.
- Do **not** write `email.templateid` — documented "For internal use only". Use `InstantiateTemplate`
  to resolve template content without sending, and `SendEmailFromTemplate` to send.
- Sending: `POST /api/data/v9.2/emails(<id>)/Microsoft.Dynamics.CRM.SendEmail` with `{"IssueSend": true}`.
- Attachments: `activitymimeattachment` with `objectid` = the email and `objecttypecode` = `email`.
  Default ceiling is **5 MB** (`Organization.MaxUploadFileSize`, raisable to 125 MB); use chunked upload
  above the inline comfort zone. On **forward, reuse the existing `attachmentid`** rather than
  re-uploading — it points at the same file BLOB for free.
- Pre-flight mailbox approval (`SystemUser.EmailRouterAccessApproval`) and warn the agent up front
  rather than failing at send (R18).

**Threading** — use `baseconversationindexhash` to group, `conversationindex` to order and nest, then
`correlatedactivityid` / `parentactivityid` to stitch gaps, with normalised-subject matching as the last
fallback. `internetmessageheaders` is capped at 500 chars — do not design around full RFC-5322
reconstruction. `messageid` is populated for **received** mail only.

## PCF conventions (once code exists)

- **Virtual (React) dataset component.** Virtual so it shares the host's React and Fluent instance
  instead of bundling its own.
- Call `context.mode.trackContainerResize(true)`; expect `allocatedHeight` = **-1** on dataset
  components and fill 100% with CSS. Handle `"layout"` in `context.updatedProperties`.
- **Persist drafts to Dataverse on blur and on an interval**, not only via `setControlState`. Whether
  `setControlState` survives teardown *inside a custom page* is undocumented — durable drafts remove the
  dependency on the answer. Do this from day one.
- Keep the bundle disciplined: code-split the rich-text editor. Bundling an editor plus a mail UI in one
  control is the known bundle-size risk.
- Declare `<external-service-usage>` in the manifest **only** if calling external services. Our
  Dataverse-only scope should not need it — adding it makes the component premium.
- Quoted-history splitting (R4/R12) is a **client-side heuristic**, not an API: `blockquote`,
  `div#divRplyFwdMsg`, `gmail_quote`, `-----Original Message-----`, and localised `From:/Sent:/To:`
  header blocks. On compose, control the structure we emit and **never re-serialise an inherited
  quote** — append to it verbatim.

## Working conventions

- **Research changes go in `docs/research/`.** If a spike or a doc check contradicts something recorded
  there, update the file rather than leaving a stale claim, and say what changed. Dead ends are findings
  — record them in [`06-spikes.md`](docs/research/06-spikes.md), don't discard them.
- Microsoft's docs on these features changed repeatedly through 2026. **Check `ms.date` / "updated_at"
  on any Learn page before trusting it**, and re-verify limitation claims rather than quoting this file
  back as fact. Two of my own starting assumptions in this repo's research were already stale.
- Cite sources for non-obvious platform claims, with links, the way the existing research files do.
- Don't commit or push unless asked.

## Seed data in the demo environment

A seed Case exists for spike work: **`TEST - Email client threading seed (deep chain)`** — 12 emails
across a 7-message thread, a 3-message thread, and 2 hash-less orphans. Created and removable via
[`scripts/seed/`](scripts/seed/README.md) (`cleanup.mjs` is dry-run by default; pass `--confirm`).

Two things to remember when using it:

- **`conversationindex` is null on every seeded row** and always will be — the column is
  `IsValidForCreate: false` / `IsValidForUpdate: false`. Seeded data validates grouping and the
  `createdon` ordering fallback; it cannot validate `conversationindex` nesting.
- **`baseconversationindexhash` is writable**, so it is advisory rather than platform-guaranteed.
  Degrade gracefully if two unrelated threads collide on a hash.

Clean the seed up when the spikes are done — this is a shared environment.
