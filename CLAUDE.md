# CLAUDE.md — modeldriven-emailclient

Guidance for Claude Code working in this repository. Read this before touching anything.

## What this project is

A **Case-scoped email client** for Dynamics 365 Customer Service, hosted in the **Copilot Service
Workspace (CSW)** app. It gives agents a native mail experience (threading, in-place reply, rich text,
attachments, templates, signatures, drafts) scoped to a single Case — where the OOB Timeline is an
activity feed and the OOB Inbox is queue-scoped rather than Case-scoped.

**Current state: research plus a spike control.** The architecture decision is **spike-validated for
hosting on both target placements** — S1 (Case form tab) and S2 (custom page) both confirmed live that
`setControlState` survives a CSW two-session teardown. S6 (attachments) and S7 (real send, receipt
confirmed) have also passed, and **S8 is closed** — grouping, `conversationindex` ordering and the
depth formula are all verified on a real conversation. **No research gate remains open.** The spike control in `pcf/` is throwaway
diagnostics, not the product. See [`docs/research/00-index.md`](docs/research/00-index.md) and the ADR
at [`docs/research/07-decision.md`](docs/research/07-decision.md).

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
- Scope and type-guard in one clause with the **typed navigation property**:
  `$filter=regardingobjectid_incident/incidentid eq <caseId>`. This guarantees the regarding object is
  a Case, so GUIDs cannot collide across tables.
- **`regardingobjecttypecode` is NOT a queryable OData property.** It is a FetchXML attribute only;
  filtering on it over the Web API fails with *"Could not find a property named
  'regardingobjecttypecode' on type 'Microsoft.Dynamics.CRM.email'"* (HTTP 400). Verified 2026-09-10 —
  this file previously told you to guard on it, and that was wrong.
- **Never fetch `description` (the body) in a list query.** `Email.Description` now lives in Azure Blob
  storage; fetch it lazily per message on expand. This is a hard performance requirement (N5), not an
  optimisation.
- **Filtering on `description` is unsupported** — not in FetchXML, Quick Find or Advanced Find. Body
  search must go through **Dataverse search**. Don't write a `$filter` against it and expect it to work.
- Select columns explicitly. Never `retrieveMultipleRecords` without `$select`.
- Use `context.webAPI`, not raw `fetch`, so security trimming and the platform's request pipeline apply.
  **Exception — anything that needs an unbound action.** `context.webAPI` exposes only `createRecord`,
  `deleteRecord`, `retrieveMultipleRecords`, `retrieveRecord`, `updateRecord`; there is **no `execute`**.
  Actions (chunked attachment upload, `SendEmail`, `InstantiateTemplate`) must go through
  **`window.Xrm.WebApi.online.execute`** with a hand-built `getMetadata()` per request. Verified 2026-09-10.

**Writing**
- Recipients are **`activityparty` rows**, not strings. `participationtypemask`: **1** Sender,
  **2** To, **3** Cc, **4** Bcc. `email.torecipients` is a read-only display convenience
  (`IsValidForForm: False`) — never write it.
- A draft is `statecode` = 0 (Open) + `statuscode` = 1 (Draft). `Email.StatusCode` **cannot be null**.
- Do **not** write `email.templateid` — documented "For internal use only". Use `InstantiateTemplate`
  to resolve template content without sending, and `SendEmailFromTemplate` to send.
- Sending: `POST /api/data/v9.2/emails(<id>)/Microsoft.Dynamics.CRM.SendEmail` with `{"IssueSend": true}`.
  **Send from the Case's queue, not the user** — that is what the standard email form does. Here that is
  the **Care** queue (`care@example.invalid`, approved, server-side synced).
  **On send the platform rewrites the row:** it assigns `messageid`, `conversationindex` and
  `trackingtoken`, **overwrites `baseconversationindexhash`** (so you cannot force threading by
  writing it), and **appends the tracking token to the subject** (`… CRM:0100009`) — which is why
  `normaliseSubject` must strip `[A-Za-z]{2,8}:d{4,12}` tokens. `SendEmail` returning 200 means
  **Pending Send**, not Sent; poll `statuscode` before claiming delivery. Verified 2026-09-10.
- Attachments: `activitymimeattachment` with `objectid` = the email and `objecttypecode` = `email`.
  **`Organization.MaxUploadFileSize` (5 MB here) caps only the INLINE base64 path** — 6 MB inline fails
  with HTTP 400 *"Attachment file size is too big."* The **chunked** path is not capped by it at all
  (40 MB measured OK). So use chunked upload for anything non-trivial; **don't ask an admin to raise the
  setting.** Chunked upload needs `Xrm.WebApi.online.execute` — `context.webAPI` can't do it.
  On **forward, reuse the existing `attachmentid`** rather than re-uploading — same file BLOB, free.
  Storing is not sending: transport limits are a separate question (S7).
- **PRE-FLIGHT SEND APPROVAL — mandatory, not advisory.** Measured 2026-09-10: sending from an
  addressed-but-**unapproved** queue returns **HTTP 200**, parks the email at `Pending Send`
  **forever**, and records **no error anywhere** (mailbox `outgoingemailstatus` = Not Run,
  `lastsyncerror` null). There is no synchronous guard and no async failure signal, so a client that
  trusts the 200 will tell agents mail was sent that never leaves. Before offering Send, check:
  org `requireapprovalforqueueemail` / `requireapprovalforuseremail`, then the sender's
  `emailrouteraccessapproval` (**1 = Approved**, on `queue` or `systemuser`), then the mailbox's
  `outgoingemailstatus` (want *Success*) and `mailboxstatus`.
  Counter-intuitive companion finding: a queue with **no** address fails **loudly** (synchronous 400);
  a queue with an **unapproved** address fails **silently**. Don't infer one from the other.

**Threading** — group by `baseconversationindexhash` (100% populated), order/nest by
`conversationindex`, then `correlatedactivityid` / `parentactivityid`, with normalised-subject as the
last fallback. Verified on a real conversation: cIdx 44 → 54 chars = depth 0 → 1, i.e.
`(len - 44) / 10`. Notes:
- `conversationtrackingid` is **0% populated** — don't use it.
- `internetmessageheaders` is **null** even on real synced inbound mail — unusable.
- `messageid` **is** assigned on send, contrary to the docs' "received only".
- `normaliseSubject` must strip appended tracking tokens (`CRM:0100009`, `MON:026300261`).
- Hash grouping takes precedence over subject, so groups with differing hashes never merge — a real
  risk for manually created mail. Consider an optional merge pass.
- **Bodies contain content no sender wrote**: Defender external-sender banners
  (`ZjQcmQRYFpfptBanner…`), Outlook first-contact tips, `Classification: Public` lines, and signature
  blocks. Strip or collapse them (R21) or every message renders cluttered.

## PCF conventions (once code exists)

- **Virtual (React) dataset component.** Virtual so it shares the host's React and Fluent instance
  instead of bundling its own.
- **Height must be host-aware.** Measured 2026-09-10:
  - **Form tab:** `allocatedHeight` is **-1** and the host is *content*-sized — every ancestor sizes
    itself to the component's own `min-height`, so `height: 100%` yields nothing. The docs' "grow to
    use 100% of the space" applies to a main/related grid page, not a subgrid cell on a form.
    **Claim height from the viewport**: `window.innerHeight - rootTop - gutter`, recomputed on resize
    (measured 552–658px).
  - **Custom page / side pane:** `allocatedHeight` is a **real number** (the control's configured
    Size). Claiming from the viewport over-claims and overflows. **Honour the host.**
  - Rule: `allocatedHeight > 0` → `height: 100%`; `=== -1` → claim from viewport.
- **The Case id arrives differently per host.** `context.mode.contextInfo` is **form-only** — it is
  empty in a side pane, and a custom page receives the record as a *page* input (`recordId`) that a
  code component cannot read. The manifest therefore has an explicit **`caseId`** input property; a
  custom page binds it to `Param("recordId")`. Prefer the property, fall back to `contextInfo`.
- **Never trust anything measured in Power Apps Studio.** `context.webAPI.retrieveMultipleRecords`
  reports *"Method not implemented"* at author time (the documented custom-page authoring gap), and
  author-time `contextInfo` returns a **dummy Case id**. Only the published app tells the truth.
- Call `context.mode.trackContainerResize(true)` and handle `"layout"` in `context.updatedProperties`
  for width changes.
- **`context.webAPI` rejects with a plain object, not an `Error`.** `err instanceof Error ? … : …`
  collapses real failures to "Unknown error". Dig through `message` / `error.message` / `JSON.stringify`.
- **Persist drafts to Dataverse on blur and on an interval**, not only via `setControlState`. Whether
  `setControlState` survives teardown *inside a custom page* is undocumented — durable drafts remove the
  dependency on the answer. Do this from day one.
- **The platform rich-text editor is NOT reusable from a PCF** (S10, 2026-09-10). `context.factory`
  exposes 11 undocumented functions at runtime (only 2 are typed), and `createComponent` +
  `bindDOMComponent` really do mount `MscrmControls.RichTextEditorV2.RichTextEditorControlV2` inside a
  PCF's DOM — but it never initialises into an editor (0 `contenteditable`). **Don't build on it.**
  R11 needs a bundled editor — and **React 16 constrains which one**. A virtual PCF shares the
  platform's React (**16.14.0** here), so the React *bindings* of modern editors are unusable:
  `@tiptap/react` needs React ^17/18/19, `@lexical/react` needs >=18. Their **framework-agnostic cores
  are fine** — `@tiptap/core`+`@tiptap/pm`, `lexical`, and `quill` declare no React peer. **Mount the
  editor core imperatively into a ref'd div**, don't reach for its React wrapper. Prefer a
  headless/schema editor for *controlled HTML output*, which R12 depends on. A standard (non-virtual)
  control bundling its own React 18 is the fallback, but forfeits the shared-React bundle win
  (39.2 KiB today). Verified 2026-09-10.
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

## Spike artefacts and seed data — REMOVED 2026-09-10

The environment has been cleaned. Verified afterwards: solution, custom control, custom page, spike
form, the page's `appelement`, the seed Case, all 12 seeded emails and every S6/S7 attachment probe
are gone, and the org email count is back to its pre-spike **48**.

Nothing needs cleaning up. If you re-run the spikes, the scripts in
[`scripts/seed/`](scripts/seed/README.md) and [`scripts/spikes/`](scripts/spikes/README.md) recreate
and remove everything — both cleanup scripts are dry-run by default.

Two things worth knowing before you re-seed:

- **`conversationindex` is null on any seeded row** and always will be (`IsValidForCreate: false` /
  `IsValidForUpdate: false`). Seeded data validates grouping and the `createdon` ordering fallback; it
  cannot validate `conversationindex` nesting. That needs a real send + reply.
- **`baseconversationindexhash` is writable but the platform overwrites it on send**, so seeded
  hashes do not survive a real send and cannot be used to force outbound threading.

### Removing a custom page from an app takes THREE steps, not one

Learned during cleanup. `RemoveAppComponents` alone is not enough — the designer also leaves an
**`appelement`** row (component type 10088) linking page → app, and the page delete fails with
`0x8004f01f` *"referenced by 1 other components"* until it is gone:

1. `RemoveAppComponents` with `Microsoft.Dynamics.CRM.canvasapp` (this **is** accepted for removal,
   even though `AddAppComponents` refuses it for addition — note the asymmetry).
2. Delete every `appelements` row where `_canvasappid_value` is the page.
3. Republish the app, *then* delete the `canvasapp`.

Then the custom control can be deleted (it was blocked by the page). Order matters:
app → appelement → page → control.

## Custom page (session-tab placement)

`Case Email Client Page (S2 spike)` / `jhrb_caseemailclientpages2spike_314da` hosts the PCF for the
session-tab placement. Things learned the hard way (S2, 2026-09-10):

- **A custom page must be registered in the app, and that is NOT automatable.** `AddAppComponents`
  rejects `canvasapp`; `appmodulecomponent` cannot be created via the API. Use the app designer:
  **+ Add page → Custom page →** pick the existing page **→ Add → Save → Publish**. CSW is absent from
  the maker Apps list, so reach its designer directly:
  `https://make.powerapps.com/e/{envId}/s/00000001-0000-0000-0001-00000000009b/app/edit/{appModuleId}`
- Registered pages do **not** appear as `appmodulecomponent` rows (they live in the sitemap). Use
  `appmodule.modifiedon` / `publishedon` to confirm a change landed.
- After publishing, **reload with `&flags=DisableWebResourceCache%3Dtrue`** or the client keeps saying
  *"Page does not exist in this app."*
- Bind the control's `caseId` property to `Param("recordId")` **as a formula in the formula bar**, not
  as a literal in the properties pane.
- A dataset property triggers a data-source prompt on insert. Ours is unused (we query via `webAPI`)
  and the page works with it left unbound.
- **Probable, unconfirmed:** a page pins the code-component version from its last publish, so a PCF
  update may not reach it until the page is republished. Verify before relying on it.
