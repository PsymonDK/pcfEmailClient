# CLAUDE.md — modeldriven-emailclient

Guidance for Claude Code working in this repository. Read this before touching anything.

## What this project is

A **Case-scoped email client** for Dynamics 365 Customer Service, hosted in the **Copilot Service
Workspace (CSW)** app. It gives agents a native mail experience (threading, in-place reply, rich text,
attachments, templates, signatures, drafts) scoped to a single Case — where the OOB Timeline is an
activity feed and the OOB Inbox is queue-scoped rather than Case-scoped.

**What has shipped and what is left lives in
[`docs/project-plan.md`](docs/project-plan.md) — not here.** Keeping the plan in this file meant
maintaining it in two places, and the two drifted. In short: the reading slice and compose/send
are both done and merged; Phase 3 is packaging (N3), templates (R22), accessibility (N6) and
performance (N5).

The control (unmanaged solution `JHRBCaseEmailClient`) is in the demo environment on a dedicated
`Case - Email Client` form, verified in the published app. Design is signed off — see
[`docs/design/`](docs/design/01-design-decisions.md). The editor is **TipTap 2** (S13, 2026-09-23),
and R12's invariant is written and tested in
[`domain/compose.ts`](pcf/CaseEmailClient/domain/compose.ts).

**No research gate remains open.** The architecture is spike-validated on both target placements —
S1 (Case form tab) and S11 (session tab, via an `Entity record` app tab template) both confirmed
live that `setControlState` survives a CSW two-session teardown. S2 confirmed the same inside a
custom page, which S11 then made unnecessary. S6 (attachments) and S7 (real send, receipt
confirmed) have also passed, and S8 is closed — grouping, `conversationindex` ordering and the
depth formula are all verified on a real conversation.

`pcf/` is now the **product**, not a spike: `domain/` holds the tested pure logic (threading, quote
splitting, sanitising), `data/` everything that talks to Dataverse, `host/` the platform-shaped
helpers — **742 tests**, lint and typecheck clean.

**Search cannot see message bodies, and the UI must keep saying so.** Bodies are absent from the
list query (blob storage, N5) and `$filter` on `description` is unsupported anyway — body search is
Dataverse search, a separate path. `domain/filter.ts` exports `SEARCHES` for the scope line the
field renders; if what it searches changes, that sentence changes with it. An agent who searches a
remembered phrase and gets nothing will conclude the mail is not on the case.

**Selection is ONE fact, shared by both panes.** `selectedMessageId` lives in the shell; the list
row and the reading-pane message both read it, and both set it. Expanding a message in the pane
selects it, collapsing it clears it. Whichever pane a change comes from, it must go through the
shell — a pane that tracks its own idea of "selected" is how the two ended up disagreeing.

**The thread list is ONE flat sequence of rows** — [`domain/listRows.ts`](pcf/CaseEmailClient/domain/listRows.ts).
Conversations expand in the list, Outlook-style (issue #4), so group headers, conversations and
message rows all come from `buildListRows`, and rendering and keyboard navigation read the same
array. Do not re-derive the order in the component: it was written out three times before this
existed, and child rows would have made it six. Two rules that follow:

- **The list is newest-first at both levels** — conversations by last activity (`buildThreads`),
  messages within an expanded one by reversing a *copy*. `thread.messages` stays chronological
  because the reading pane stacks that same array; reversing it in place flips the pane silently.
  `position` stays chronological too: "Message 5 of 5" is the fifth message sent, not the fifth row.
- **Address rows by `data-row-id`, never by index into `querySelectorAll`.** Group headers are rows
  in the array but carry no row element, so index-based lookup pointed at the wrong element for
  every row after the first header.

**`dotnet build -c Debug` ships a DEVELOPMENT bundle** — eval devtool, unminified, ~102 KiB
gzipped against the production build's **32.8 KiB**. That is what every deploy to the demo
environment has carried, which is fine for a dev environment but means any size or performance
claim must come from `pcf-scripts build --buildMode production`, not from what is deployed.

**`dotnet build -c Debug` does not reliably rebuild the PCF bundle.** It will package the previous
version and report success — the first issue-#4 deploy shipped nothing that way. Use
`npm run build` in `pcf/` followed by `dotnet build -c Debug -t:Rebuild`, and check the version
actually packaged before believing an import:

```bash
unzip -p solution/bin/Debug/solution.zip Controls/jhrb_JHRB.CaseEmailClient/ControlManifest.xml | grep -o 'version="[0-9.]*"'
```

**`pac solution import` can exit 0 without importing anything.** Measured 2026-09-30: with the pac
profile's MFA expired it printed `AADSTS50078` and exited **0** — no import job was created and the
environment kept the previous build. Confirm an import landed from Dataverse, not from pac's exit
code: the newest `importjobs` row for `JHRBCaseEmailClient` (and, after publishing, the
`customcontrols` version).

**Never write a colour literal in a component (N7).** `T.*` resolves through CSS custom properties
set on the root — see [`ui/theme.ts`](pcf/CaseEmailClient/ui/theme.ts). A hardcoded hex cannot follow
them, looks perfect in the light theme you develop in, and breaks only in dark. Thirteen of them were
found this way on 2026-09-22; a test now greps the components for hex literals. The two deliberate
exceptions are `ui/theme.ts` itself and `BODY_SURFACE` — **a sender's HTML stays on a white card in
dark theme too**, because inverting it would alter a business document.

**"Unread" has one definition and it lives in [`domain/unread.ts`](pcf/CaseEmailClient/domain/unread.ts).**
Only *incoming* mail can be unread — an agent's own sent mail never is. That rule was duplicated in
four places and two of them omitted the direction check, which is how the reading pane came to
treat the agent's own replies as waiting to be read. Use `isUnread` / `messageToOpen` /
`worthPersisting`; do not re-inline the predicate.

**Run the suite from `pcf/`, not the repo root** — `npm test`, `npm run lint`,
`npm run typecheck`. Do **not** use `npx vitest`: it resolves a cached global copy that has no
jsdom and silently skips a test file.

See [`docs/project-plan.md`](docs/project-plan.md) for what is done and what is next,
[`docs/design/01-design-decisions.md`](docs/design/01-design-decisions.md) for what to build,
[`docs/design/02-component-inventory.md`](docs/design/02-component-inventory.md) for what builds it,
[`docs/research/00-index.md`](docs/research/00-index.md) and the ADR at
[`docs/research/07-decision.md`](docs/research/07-decision.md) for why.

## The architecture decision — read this before proposing anything

**Decided: a React (virtual) PCF code component on two _form_ placements.** No custom page — S11
measured that away on 2026-09-10.

| Placement | Mechanism |
|---|---|
| Case form tab | The PCF directly — virtual/React **dataset** component on a single-column tab, bound to a subgrid of `email` where `regardingobjectid` = the Case |
| CSW session tab | The **same PCF on a dedicated Case form**, opened by an **`Entity record`** application tab template: `entityName={anchor.entityName}`, `entityId={anchor.incidentid}`, `formId=<the email form>` |

Because both placements are form tabs, the component gets **one** sizing strategy, **one** context path
(`context.mode.contextInfo.entityId`) and **one** state mechanism. Do not add per-host branches, and do
not reintroduce a canvas layer.

**Rejected, and why — do not re-propose these without new evidence:**

| Candidate | Why not |
|---|---|
| **Generative page** | Unsupported in side panes; no `generative` page type in CSW application tab templates; restricted to a fixed Dataverse data-type list that cannot express `activityparty` recipients or `activitymimeattachment` binaries, with no route to `SendEmail` |
| **Custom page alone** | Cannot sit on a form tab; **state is not persisted across multi-session tab switches** → loses in-progress drafts (fails MUST requirements R16/N1) |
| **Custom page hosting the PCF** (the former A+B plan) | Works — S2 proved it, including `setControlState` survival — but it is a **layer with no payoff**: S11 showed an `Entity record` tab template reaches the same place. Costs it carried: manual per-environment app-designer registration, the `appelement` (type 10088) cleanup tangle, an 8-hour canvas session timeout, third-party-cookie requirement, and app-wide connector consent dialogs. Kept only as a documented fallback |
| **`Control` application tab template** hosting the PCF directly | **Eliminated on function, not support status (S11).** It renders the control full-tab, but the Case id **cannot be passed in at all** — not by `{anchor.incidentid}` slug, not by a JSON `data` object, not by a literal GUID through `Xrm.Navigation.navigateTo`. `contextInfo` is empty there. Same context-free behaviour as the side pane (S2) |
| **Code app via iframe** | Same multi-session state loss; no `Xrm` inside the frame; no Power Platform Git integration; end users need **Power Apps Premium** |
| **Classic HTML web resource** | Same state loss; no `context` API; iframe seams; undocumented `parent`/`window.top` coupling |

The deciding factor was **multi-session state**, not UI capability. PCF is the only host with a
documented preservation contract (`context.mode.setControlState`) for CSW's destroy/reload cycle.

**Reversal conditions** are listed in the ADR. One has already fired: the custom page wrapper *was*
unnecessary, and the architecture simplified to PCF alone on two form placements (S11, 2026-09-10). Note
that the `Control` template's "for internal use only" status turned out to be beside the point — it
cannot receive record context, so its support status would not save it.

## Plugins and skills — which to use, which to avoid

**None of the plugins named below target PCF development**, which is what this project needs. Getting
this wrong means building the architecture we explicitly rejected. Note that **what is actually
installed varies by session** — check the skill listing before reaching for one, rather than trusting
this table. `model-apps:app-builder` was listed here as available and is not.

| Plugin / skill | Use here? |
|---|---|
| `model-apps:app-builder` (`/app-builder`) | **Not installed** — corrected 2026-09-11. This file claimed it was available for schema work; invoking it returns *"Unknown skill"* and it is absent from the skill listing. Do schema work through the **Dataverse Web API**, as every other environment change in this project has been (see `scripts/deploy/`) |
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
- **The scripts do not use the pac profile.** Every script under `scripts/` goes through
  `scripts/lib/dv.mjs`, which refuses to run unless `DV_ORG` resolves to the demo org, takes its
  token from `DV_TOKEN` or `az account get-access-token` (there is no `.tok` file any more), is
  dry-run unless `--confirm`, and refuses any test-send recipient but the approved address. So
  `pac auth list` confirms nothing for a script — check `az account show` too.

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

**Bump the SOLUTION version with the control version** (`solution/src/Other/Solution.xml`). A
managed solution upgrades by its own version; it sat at `1.0` through 26 control releases until
2026-09-30. `host/__tests__/release.test.ts` fails when they differ. The downstream install is
[`docs/deploy/install.md`](docs/deploy/install.md).

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
  `Organization.MaxUploadFileSize`) without asking, and do not send test email to real addresses
  — **with one approved exception: `simon.jehrbo@example.com`.** Test sends may go there, and only
  there, and **you must say so before sending, not after**. Granted 2026-09-25 so R17 can be
  verified against a real delivery instead of a 200 that means nothing. Every other address in
  this shared demo environment belongs to someone who did not agree to receive test mail.
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
  writing it), and **appends the tracking token to the subject** (`… CRM:0100009`) unless the
  subject already carries one it knows, in which case it leaves it — which is why
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
  `outgoingemailstatus` (want *Success*). **Not `mailboxstatus`** — measured 2026-09-28 it says
  nothing about sending: the agent's mailbox reads `mailboxstatus` = Success with outgoing = Not
  Run, and cannot send. This file used to list it as a check.
  Counter-intuitive companion finding: a queue with **no** address fails **loudly** (synchronous 400);
  a queue with an **unapproved** address fails **silently**. Don't infer one from the other.

**Sender and signature (R17/R15) — measured 2026-09-24**
- **Send as the Case's queue, and the signature follows the sender.** Resolution lives in
  [`domain/sender.ts`](pcf/CaseEmailClient/domain/sender.ts); the rule is queue-specific settings
  row → default row → no configuration, and **no configuration means send as the agent** (stock
  behaviour). Never invert that fail-safe: a settings table that cannot be read must not silently
  change who mail appears to come from.
- **`queue.emailsignature` is a real Lookup** (SchemaName `EmailSignature`, target
  `emailsignature`). That is how a queue signature is stored — we do not store signature HTML.
  **`systemuser` has no equivalent lookup**: a user's signature is an `emailsignature` row they
  own, ordered `isdefault desc,modifiedon desc` (and *not* filtered to `isdefault eq true`, because
  the only signature here has `isdefault = false`). Two different shapes; `fetchSignatureFor`
  picks.
- **This environment has EXACTLY ONE `emailsignature` row**, and it is simultaneously the row the
  agent owns *and* the row the Care queue points at. Both code paths return the same HTML, so **a
  passing signature test proves nothing about which path ran.** Create a second signature before
  believing any change here. A defect hid behind this for a full release.
- Even a **queue** signature personalises with the acting agent: the real stylesheet selects
  `systemuser/firstname`. Substitution values stay `systemuser/*` for both sender kinds.
- **Do NOT filter `queueitem` to `statecode eq 0`.** A queue item goes Inactive when the item is
  *worked*, not when the Case leaves the queue. Measured 2026-09-25: CAS-01020 sits in Care with an
  Inactive queue item, and an active-only filter resolved no queue, so the client fell back to the
  agent — whose mailbox cannot send. Order `statecode asc,createdon desc` instead.
- **`ourAddresses` is the UNION of the resolved senders and the senders of outgoing mail on the
  case**, never one or the other. Replacing the derived set with the "authoritative" resolved one
  looked like a cleanup and silently removed a safeguard: on a case whose queue does not resolve,
  the service queue ended up in To. See `06-spikes.md`.
- **`queueitem.objecttypecode` is `Edm.Int32` over the Web API.** `objecttypecode eq 'incident'`
  fails with *"A binary operator with incompatible types was detected. Found operand types
  'Edm.Int32' and 'Edm.String'"*, which names neither the column nor the fix. Use `112`.
- **`AddPrivilegesRole` ADDS to a role's privilege set; it does not replace it.**
  `ReplacePrivilegesRoleRequest` is the replacing one
  ([docs](https://learn.microsoft.com/en-us/dotnet/api/microsoft.crm.sdk.messages.addprivilegesrolerequest)).
  A comment in `create-readstate-role.mjs` claimed the opposite until 2026-09-24. Re-running is
  safe because re-adding is a no-op, not because the call resets anything.
- Configuration is `jhrb_emailclientsetting` (**Organization**-owned — configuration, not per-agent
  data, unlike `jhrb_emailreadstate`). Its Read privilege is added to the **same** role as read
  state, so there is still only one role to assign per environment.

**Recipients must name a RECORD — 2026-09-25**
- **A To/Cc party written with only `addressused` is an "unresolved party"**, and Dataverse
  delivers to one only when `Organization.allowunresolvedpartiesonemailsend` is true — **false**
  here. Bind `partyid_<entity>@odata.bind` whenever the record is known; a bare address is a last
  resort, not the normal path it used to be.
- **The party query already carries the identity.** With annotations on (which `context.webAPI`
  sets), `_partyid_value` arrives with `@…lookuplogicalname` **and**
  `@…associatednavigationproperty` — the platform naming the bind property outright. Prefer it
  over composing `partyid_${entity}`. An unresolved party has `_partyid_value: null` and no
  annotations.
- **`Xrm.Utility.lookupObjects` works inside the PCF in CSW** and is the recipient picker. It
  returns `id` **braced and upper-cased** (strip it), resolves with **`[]` on cancel rather than
  rejecting**, and does **not** return an email address.
- **Every party table names its email column differently**: `internalemailaddress` on
  `systemuser`, `emailaddress` on `queue`, `emailaddress1` on contact/account/lead. See
  [`domain/recipients.ts`](pcf/CaseEmailClient/domain/recipients.ts).
- Never resolve an address *to a queue* — that addresses our own service mailbox. The lookup does
  offer queues, because picking one deliberately is different from matching one by accident.
- Two matches for one address is **ambiguous, never a guess**: mailing whichever duplicate sorted
  first is worse than refusing.
- Configured by `jhrb_recipiententity` + `jhrb_recipientlookup` on `jhrb_emailclientsetting`
  (`incident` / `customerid` by default).

**Send (R17) — built 2026-09-25**
- **`SendEmail` is a BOUND action**, unlike every other action here. Through
  `Xrm.WebApi.online.execute` that is `boundParameter: 'entity'` (not `null`), the instance under
  that same key with `entityType`/`id`/`@odata.type`, and
  `entity: { typeName: 'mscrm.email', structuralProperty: 5 }`. Verified live.
- **Status codes** (live metadata): 1 Draft, 2 Completed, 3 Sent, 4 Received, 5 Canceled,
  6 Pending Send, 7 Sending, **8 Failed — `statecode` 0, the same Open state as a Draft.** Decide
  "settled" from the STATUS, never the state, or a failed send polls forever.
- **`IssueSend: false` is not a rehearsal.** It appends the tracking token to the subject and
  assigns `trackingtoken`, but goes **straight to Sent** without passing through Pending Send, and
  assigns neither `messageid` nor `conversationindex`. So the safe mode cannot exercise the
  polling path — only a real send can.
- **There is deliberately no "don't really send" switch in the product.** `IssueSend: false` marks
  mail sent without sending it, which is the silent non-delivery the feature exists to prevent.
  Probe tool only.
- Send order: save → **double-send guard (re-read the row's `statuscode`)** → **re-run pre-flight
  live** → issue → close compose → poll in the background.
- **`statuscode` 3 (Sent) means handed to Exchange, NOT delivered.** Measured 2026-09-25: status 3
  after ~2.5 minutes, actual arrival after **~17**. No status available to the client proves
  receipt — do not report one as if it did.
- **Compose closes on ACCEPTANCE, not on confirmed Sent.** Measured 2026-09-25: a healthy send took
  **~2.5 minutes** to move Pending Send → Sent (server-side sync cadence), so waiting for `Sent`
  meant agents never saw success and learned to ignore the status line. Acceptance means the
  message is already a row on the case, so nothing is lost by closing. The pending state lives on
  as a **`Sending` badge on the thread-list row**, which survives reload. Still nothing claims
  delivery the platform has not confirmed.
- **Watch for inert guards.** `blockingReasonBeforeSend` refused an already-sent message and was
  tested for it, but the shell never passed `statusCode` — the second defect of this exact shape
  after `inReplyToId`. A rule in `domain/` proves nothing until a caller passes its input; unit
  tests cannot see that seam.

**Attachments (R13) — built 2026-09-25**
- **Slice the BYTES into blocks and base64 each one; never slice the encoded string.** Cutting
  base64 anywhere but a multiple of 4 characters shifts every following byte, AND sizing blocks
  from the byte count while slicing by characters leaves the tail unsent — the commit still
  succeeds and the customer gets a **silently truncated file**. Byte-slicing is also what S6
  measured, which is why 40 MB is 10 blocks; string-slicing gives 11. See
  [`domain/attachments.ts`](pcf/CaseEmailClient/domain/attachments.ts).
- **`String.fromCharCode(...bytes)` throws `RangeError: Maximum call stack size exceeded`** past
  ~100 KB. Encode in 32 KB windows; on a 4 MB block the naive spread always fails, and the error
  reads like a browser bug rather than an encoding mistake.
- **The client limit is about DELIVERY, not storage.** Dataverse stores 40 MB happily; most mail
  systems reject messages over 25 MB. Cap the MESSAGE total, not the file, and warn from 18 MB
  because base64 inflates by about a third in transit. Never use `Organization.MaxUploadFileSize`
  as the rule — it governs only the inline path and says nothing about deliverability.
- Inline under the org cap (plain `context.webAPI.createRecord`), chunked above it (needs
  `window.Xrm.WebApi.online.execute`). Inline is the path almost every real attachment takes.
- **An attachment needs the draft row to exist first**, so dropping a file into an empty reply
  forces a draft save — `flushDraft(force)` bypasses the "worth saving?" rule, because an
  attachment IS content even when nothing has been typed.
- **The tray must never lie:** resuming a draft rehydrates its attachments (they are already rows
  on that email and WILL be sent), and forward carries the original's over as reused
  `attachmentid`s rather than re-uploading the bytes.
- **THE PLATFORM ADDS ATTACHMENTS YOU DID NOT UPLOAD.** Saving a description that quotes a message
  containing `<img src="cid:…">` makes Dataverse create an `activitymimeattachment` for that
  inline image, **sharing the original's blob** (measured 2026-09-25: a reply picked up a
  3,988,820-byte `image001.png` by itself). Desirable — otherwise the quoted image arrives broken
  — but it means **the attachments on a saved email are not the set the client uploaded**.
  Anything reasoning about count or total size must read them back, not trust its own tally.
  **`attachmentcontentid` is the discriminator**: null on a real attachment, the Content-ID on an
  inline image. Keep inline ones OUT of the tray (removing one breaks the quote) and IN the size
  total (they are real bytes on the wire).
- **Verified end to end 2026-09-25 (v1.10.0)**: 50 KB inline and 7 MB chunked both round-tripped
  **SHA-256 identical**. The 7 MB case is the one that matters — it crosses the org cap, so it
  exercises Initialize/UploadBlock/Commit, where a block-arithmetic error truncates silently.

**Drafts (R16) — measured 2026-09-25 by creating a real draft and reading it back**
- Create payload shape is in [`domain/draft.ts`](pcf/CaseEmailClient/domain/draft.ts), verified
  live: `statecode` 0 + `statuscode` 1 + `directioncode: true`,
  `regardingobjectid_incident@odata.bind`, and an `email_activity_parties` array.
- **`email_activity_parties` works on create AND on PATCH.** On PATCH it **replaces** the
  sender/To/Cc set and leaves the platform's own owner (mask 9) and regarding (mask 8) rows
  alone — so a recipient change is one request, not delete-then-recreate.
- **…and it replaces BCC (mask 4) too — measured 2026-09-29 (issue #11).** A PATCH without Bcc
  deleted the Bcc party of a draft created with one, and the first save after resuming ANY draft
  rewrites parties. So `DraftArgs.bcc` is required, `buildPartyRows` writes mask 4 on every party
  save, and resume rehydrates the stored Bcc. Bcc is never carried into a reply or forward, and the
  reading pane shows it on OUTGOING mail only (`domain/recipientLine.ts`).
- **A recipient can be a bare `addressused` string with no `partyid`.** That is the *normal* case
  on a Case: customers are frequently not Contacts. A queue sender binds as
  `partyid_queue@odata.bind`, and **the platform then fills that party's `addressused` itself**
  from the queue's address.
- **The platform derives `torecipients` from the To parties.** Further confirmation it is output,
  never input.
- **`parentactivityid` is `IsValidForCreate: true` but `IsValidForUpdate: false`.** Set it once at
  create to link a draft to the message it answers. Without that link, closing compose and
  reopening Reply creates a *second* draft row, then a third. Navigation property is the lowercase
  **`parentactivityid`** — read off `ReferencingEntityNavigationPropertyName`, not guessed from the
  SchemaName `ParentActivityId`.
- Resuming a draft splits the stored body back apart with `splitQuotedHistory`, which is exactly
  what R12's round-trip invariant guarantees: **what we emitted, we can re-split.**

**`npm run typecheck` now checks ALL source, not just test files** (changed 2026-09-28). It runs
`tsc -p tsconfig.json` (every source file, `EmailClientRoot.tsx` and `index.ts` included) and then
`tsc -p tsconfig.test.json`. Until then it covered only files a test imported, so
`EmailClientRoot.tsx` was never checked by it; on its first run it caught a hook dependency
array reading a `const` before its declaration — a runtime crash that no test exercised.
`npm run build` still runs the same checks and remains the final gate. Lint now includes
`eslint-plugin-react-hooks` and `no-unused-vars`; a ref used deliberately to escape a
dependency is commented in place.

**Sender HTML is sanitised for DISPLAY and for SENDING, differently.** `sanitiseEmailBody`
holds back remote images and prefixes sender `id`/`name` values by default (tracking pixels, DOM
clobbering). HTML going OUT — the quoted original in `buildQuotedBlock`, a signature — passes
`{ allowRemoteImages: true, isolateIds: false }`, because the customer's own message must go back
to them as written. Every `dangerouslySetInnerHTML` must render a sanitised expression;
`ui/__tests__/htmlSinks.test.ts` holds the allowlist. See `docs/review/2026-09-28-code-review.md`.

**Read state (R6) — `jhrb_emailreadstate`, created 2026-09-11**
- **UserOwned**, so Dataverse's own security trims each agent to their own rows. `jhrb_emailid` →
  `email`, `jhrb_userid` → `systemuser`, `jhrb_caseid` → `incident` (**denormalised on purpose**:
  one page per case per agent instead of one query per message), `jhrb_readon` DateTime.
- **Mark-read is one PATCH, never a read-then-write.** The alternate key `jhrb_emailperagent` is
  Active, so `PATCH jhrb_emailreadstates(_jhrb_emailid_value=<email>,_jhrb_userid_value=<user>)` upserts.
  Note the **`_value` form** — `(jhrb_emailid=…)` fails with *"The key in the request URI is not valid"*.
- **`@odata.bind` keys are PascalCase: `jhrb_EmailId` / `jhrb_UserId` / `jhrb_CaseId`.** A lookup's
  navigation property comes from its **SchemaName**, not its column name, and using the logical name
  returns an anonymous *"Error identified in Payload"* that does not say which property was wrong.
  Read `ReferencingEntityNavigationPropertyName` off `RelationshipDefinitions` before guessing.
- Creating a duplicate returns **412**, not 409. `data/readState.ts` treats that as success — two
  dwell timers on one message have nothing to reconcile.
- **A new custom table grants privileges to NOBODY** but System Administrator / System Customizer, so
  read state works for an admin and is refused for every agent. A purpose-built role carries
  User-level Create/Read/Write/Delete **plus Append and AppendTo** (the row has three lookups, and
  writing one is an append). Never add privileges to an out-of-the-box role in this shared
  environment. **Assigning the role is a manual per-environment step**, alongside registering the
  form with the CSW app — both are N3 runbook deviations.
- **Privilege names come from the table's SchemaName** (`prvCreatejhrb_EmailReadState`), and OData
  compares strings case-insensitively — so a filter on the logical spelling matches while the
  returned name does not equal what you composed. Match case-insensitively.
- **`AddPrivilegesRole` wants `Depth` as the enum NAME** — `Basic` / `Local` / `Deep` / `Global`.
  The numeric mask the same concept uses elsewhere fails with *"Cannot read the value '1' as a
  quoted JSON string"*, which names neither depth nor privilege. Dataverse also adds 9 baseline
  privileges to every new role, so a role asked for 6 reports 15 — not an over-grant.
- **Only persist read state for INCOMING mail.** A row for an outgoing message can never change
  what anyone sees; before that check the client wrote one per sent message per agent.

**Creating tables over the Web API** — three traps, each measured 2026-09-11, full detail in
[`06-spikes.md`](docs/research/06-spikes.md):
- `IsValidForQueue` / `IsDuplicateDetectionEnabled` are **`BooleanManagedProperty`, not booleans**.
  Omit them; they default to false on a custom table.
- **The metadata cache lags creation by seconds.** `POST EntityDefinitions` returns 201 and the next
  request against that table fails with *"…not found in the MetadataCache.LazyDynamicMetadataCache"*
  or a bare *"An unexpected error occurred."* Retry with a backoff — see
  `withSettle` in [`create-readstate-table.mjs`](scripts/deploy/create-readstate-table.mjs).
- **One parental relationship per table.** A second `CascadeConfiguration.Delete: 'Cascade'` lookup is
  refused outright.

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
  - **Session tab (`Entity record` template):** identical — `allocatedHeight` **-1**, claim from the
    viewport (S11 measured 536px of 1072px, starting 512px down). **Both chosen placements behave the
    same way**, so there is no per-placement branch to write.
  - **Custom page / side pane:** `allocatedHeight` is a **real number** (the control's configured
    Size). Claiming from the viewport over-claims and overflows. **Honour the host.** Only relevant if
    the custom-page fallback is ever taken.
  - Rule: `allocatedHeight > 0` → `height: 100%`; `=== -1` → claim from viewport.
  - **Claim WIDTH too.** Measured 2026-09-11 in the published app: with `height` set and width left
    to inherit, the control rendered **588px wide inside a full-width tab**, because the subgrid
    cell's ancestors content-size their child. `width: 100%` on the root fixes it. Same trap as
    height, same hosts — **claim both dimensions, inherit neither**.
  - **The budget is a RANGE, not 536px.** Three readings on one form gave 531 / 661 / 471px high and
    1354–1414px wide, depending on whether a side pane and the process bar are showing. Design to the
    floor: **471 × 1354**. See [`docs/design/03-interaction-spec.md`](docs/design/03-interaction-spec.md).
- **The Case id comes from `context.mode.contextInfo`, and that is form-only.** It is populated on
  **both chosen placements** — the Case form tab (S1) and the `Entity record` session tab (S11) — so no
  property binding is needed. It is **empty** in a side pane, in a custom page (which receives the
  record as a *page* input, `recordId`, that a code component cannot read), and under a `Control` app
  tab template. In that last case the template's `data` parameter is **not** a substitute: S11 tried a
  `{anchor.incidentid}` slug, a JSON `{"caseId":…}` object and a literal GUID through
  `Xrm.Navigation.navigateTo` — none reached the control. The manifest keeps an optional **`caseId`**
  input property as insurance for the custom-page fallback; prefer it if bound, fall back to
  `contextInfo`.
- **Never trust anything measured in Power Apps Studio.** `context.webAPI.retrieveMultipleRecords`
  reports *"Method not implemented"* at author time (the documented custom-page authoring gap), and
  author-time `contextInfo` returns a **dummy Case id**. Only the published app tells the truth.
- Call `context.mode.trackContainerResize(true)` and handle `"layout"` in `context.updatedProperties`
  for width changes.
- **`context.webAPI` rejects with a plain object, not an `Error`.** `err instanceof Error ? … : …`
  collapses real failures to "Unknown error". Dig through `message` / `error.message` / `JSON.stringify`.
- **Persist drafts to Dataverse on blur and on an interval**, not only via `setControlState`.
  `setControlState` is now measured to survive a real two-session teardown on **both** chosen
  placements (S1, S11), so this is defence in depth rather than a workaround — but still do it from day
  one. It is the difference between losing a draft and losing a draft *silently*.
- **Pre-flight the sender's mailbox approval before offering Send** (R18). `SendEmail` returns HTTP 200
  for an unapproved sender, parks the mail at `Pending Send` forever, and records **no error anywhere**.
  Check org `requireapprovalfor*email`, sender `emailrouteraccessapproval` = 1 and mailbox
  `outgoingemailstatus` = Success. Non-negotiable.
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
  control bundling its own React 18 is the fallback, but forfeits the shared-React bundle win.
  Verified 2026-09-10. **Measured 2026-09-23 (S13)** — gzipped delta on the production bundle,
  whose baseline is 32.8 KiB:
  - **Quill 2.0.3 — +58.3 KiB** plus 3.7 KiB of required theme CSS. Builds on the stock config.
    Delta-based, so `root.innerHTML` is whatever the DOM holds — the **weakest** for R12's
    controlled output.
  - **Lexical 0.50.0 — +67.8 KiB.** Bundles fine, but its types sit behind an `exports` map that
    the build tsconfig's inherited `moduleResolution: "node"` cannot read, so lint fails with 16
    `no-unsafe-*` errors until the control build moves to `"bundler"`.
  - **TipTap 2.27.3 — +88.5 KiB.** Builds on the stock config and is the **best** for R12.
    **TipTap 3 does not build at all**: its extensions carry an `@jsxImportSource` pragma and
    pcf-scripts' Babel uses `runtime: 'classic'`, so v3 pins you to v2.

  No option is cheap — the cheapest nearly triples the control. **CHOSEN 2026-09-23: TipTap 2**
  (`@tiptap/core` + `@tiptap/pm` + `@tiptap/starter-kit`, all pinned `^2`). The extra ~30 KiB over
  Quill buys the requirement most likely to generate bugs (R12's controlled output), and it is the
  only schema-based option that builds on the stock config. **Do not upgrade to TipTap 3** — it
  does not build here; see the pragma note above.

**R12's invariant, written before any compose UI existed and now enforced by tests:
THE INHERITED QUOTE NEVER ENTERS THE EDITOR.** The editor edits only the new text; the quote is an
opaque string shown read-only beneath it and concatenated **verbatim** at send time. That reduces
the editor's job from "round-trip arbitrary Outlook HTML" to "handle what the agent types". It
lives in [`domain/compose.ts`](pcf/CaseEmailClient/domain/compose.ts):

- `buildQuotedBlock` wraps the original body in `divRplyFwdMsg` — deliberately the same id
  `quoting.ts` matches first, so **what we emit is what we can re-split**. Changing one without
  the other breaks the round trip silently.
- `buildOutgoingBody` concatenates and adds **no** wrapper of its own; the quote already carries
  one, which is what makes the round trip byte-exact.
- `stripQuoteMarkers` renames the marker in pasted content, because the splitter cuts at the
  **first** match and pasting a previous reply would otherwise move half the new text into the
  fold. The replacement must **not contain** the marker: `divRplyFwdMsg-quoted` was the first
  attempt and still matched on substring.
- **THE CLIENT NEVER REMOVES A TRACKING TOKEN FROM A SUBJECT — a product requirement
  (2026-09-29), not a style choice.** `composeSubject` carries the inherited subject forward
  verbatim, token included; only the RE:/FW: prefix is added. It used to strip the token (the
  platform appends a fresh one on send, so the worry was two tokens). That worry was wrong: **when
  the subject already carries a token this organisation knows, the platform leaves it and adds
  none.** Two tokens in one subject are legitimate — mail that passed through **another Dynamics
  system** carries that system's token as well as ours, and stripping would sever the other
  system's correlation too (product owner, 2026-09-29). `stripTrackingToken` was **deleted** so
  nothing can reach for it again. Do not reintroduce stripping anywhere a subject is written. `normaliseSubject` still
  drops tokens, but only to build an in-memory grouping key — it never writes a subject — and the
  thread list hides the token on screen only; neither touches the record.

**The editor is mounted imperatively and destroyed on unmount** —
[`ui/Editor.tsx`](pcf/CaseEmailClient/ui/Editor.tsx). Verified live in the published app on
2026-09-23: TipTap 2 mounts inside the PCF, `.ProseMirror` is `contenteditable`, and typed text
round-trips. Two things measured while wiring it:

- **`@tiptap/extension-link` costs 17 KiB gzipped** (it pulls `linkifyjs`), and `autolink: false`
  saves nothing — linkifyjs is imported at module scope, so it bundles regardless of config. Link
  is kept because a dead URL in a support reply looks broken to the customer, but it is half the
  size of the whole reading slice and is the first thing to drop if size becomes a gate.
- Production bundle is now **145 KiB gzipped** against the reading slice's 33 KiB.
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

The environment has been cleaned **twice** — after the S1/S2/S6/S7 run, and again after S11 on the same
day. Verified afterwards by query: no solution, custom control, custom page, spike form (S1's or S11's),
`appelement`, S11 application tab template or template parameter remains; the seed Case, all 12 seeded
emails and every S6/S7 attachment probe are gone; and the org email count is back to its pre-spike **48**.

Nothing needs cleaning up. If you re-run the spikes, the scripts in
[`scripts/seed/`](scripts/seed/README.md) and [`scripts/spikes/`](scripts/spikes/README.md) recreate
and remove everything — every cleanup script is dry-run unless you pass `--confirm`.
`revert-s1.mjs` unwinds the S1/S2 artefacts (including the custom page); `revert-s11.mjs` unwinds the
S11 form and application tab templates.

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

## Session tab (the chosen placement) — `Entity record` app tab template

Measured in S11, 2026-09-10. The session tab is **a second app tab on the same Case**, opened on a
dedicated form whose single tab hosts the PCF. Nothing canvas-shaped is involved.

```
pagetype   = Entity record   (msdyn_pagetype option 509180001)
entityName = {anchor.entityName}
entityId   = {anchor.incidentid}
formId     = <the email-client form>
```

- CSW is happy showing **the same record twice in one session** — anchor tab on the default form, a
  second tab on the email form. No warning, no navigation fight.
- Parameters are `msdyn_templateparameter` rows. Bind the lookup as
  **`msdyn_applicationtabtemplateid@odata.bind`** — `msdyn_ApplicationTabTemplate` is not the
  navigation property name and fails.
- **The platform creates its own parameter rows** on these templates. Never clean up parameters by
  `startswith(msdyn_uniquename, …)` — that over-deletes the platform's rows. Delete the *template*;
  parameters cascade.
- The form must be registered with the CSW app and the app published. That is one app-designer action
  per environment (see the designer URL below) — everything else ships in the solution.
- `Control` (option 509180003) is **not** an alternative: it renders the PCF but cannot pass it record
  context at all. Detail in [`docs/research/06-spikes.md`](docs/research/06-spikes.md#s11-result--2026-09-10-passed-route-c-works-the-custom-page-is-unnecessary).

## Custom page (FALLBACK ONLY — not the chosen architecture)

Retained because it was measured and works, not because it should be built. S11 removed the need for
it; reach for this section only if the `Entity record` route regresses. Things learned the hard way
(S2, 2026-09-10):

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
