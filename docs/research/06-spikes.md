# 06 — Spikes

## Status: S1, S2, S6, S7, S11 PASSED; S8 CLOSED; S10, R18, S12 answered. **S12 confirmed the platform does not sanitise email bodies — that work is ours.**

**S1 has passed**, observed live in Copilot Service workspace: `setControlState` survives a genuine
two-session teardown (`state RESTORED`, `init #2`) with no cross-session bleed, and the threading and
quoted-history logic render correctly on the seed Case. It forced three corrections, including one to
`04`/`CLAUDE.md` and one to `02`. See [S1 result](#s1-result--2026-09-10-passed-observed-in-the-live-app).
**S2 has passed.** `setControlState` **also survives teardown inside a custom page** (`state
RESTORED`, `init #2`), the `caseId = Param("recordId")` binding delivers the Case id, and
`context.webAPI` works at runtime there. The side-pane route also renders — correcting a
treat-as-unsupported note — though it gets no record context. See
[S2 result](#s2-result--2026-09-10-passed-both-halves).

**S6 has passed**, and corrected [`04`](04-data-model.md): `MaxUploadFileSize` caps only the *inline*
attachment path (6 MB fails with a clean HTTP 400), while the **chunked path ignores it entirely** —
40 MB uploaded against a 5 MB cap. Large attachments therefore need the chunked API, not an admin
raising a setting. See [S6 result](#s6-result--2026-09-10-passed-and-it-corrects-the-data-model-doc).

**S7 has passed** — a real email was sent from the approved Care queue and **confirmed received**,
with a chunk-uploaded 1 MB attachment. It broke two of my own assumptions: the platform **overwrites
`baseconversationindexhash` on send**, and it **appends the tracking token to the subject** (which my
`normaliseSubject` failed to strip — now fixed). See
[S7 result](#s7-result--2026-09-10-sent-successfully-and-it-broke-two-of-my-own-assumptions).

**S10 answered, negatively.** The platform rich-text editor **cannot be reused** from a PCF in any
supportable way. The undocumented `factory.createComponent` / `bindDOMComponent` pair does mount
`RichTextEditorControlV2` inside a PCF's DOM, but it never initialises into a usable editor. **R11 still
needs a bundled editor**, so that risk stands rather than being removed. See
[S10 result](#s10-result--2026-09-10-no--do-not-depend-on-it-mechanism-works-editor-does-not).

**R18 answered, 2026-09-10 — and it inverts the requirement.** Sending from an addressed-but-unapproved
queue returns **HTTP 200**, parks the email at `Pending Send` **forever**, and records **no error
anywhere** (mailbox `outgoingemailstatus` = Not Run, `lastsyncerror` null). There is neither a
synchronous guard nor an async failure signal, so R18 can only be met by **pre-flighting the sender's
approval state before offering Send**. See
[R18 result](#r18-result--2026-09-10-there-is-no-failure-signal-at-all-pre-flight-is-mandatory).

**S11 PASSED, 2026-09-10 — and it removed a layer from the architecture.** The custom page *was* an
unnecessary layer. An `Entity record` app tab template accepts a `formId`, so a session tab opens the
same Case on a dedicated form hosting the PCF — the S1 placement reused, with no canvas host and no
manual app registration. Measured: CSW shows the same record twice in one session happily, the Case id
arrives via `contextInfo` (the `caseId` property is not needed on this route), and `setControlState`
survives a real two-session teardown. The `Control` route was tested at the same time and is
**eliminated on function** — it renders the PCF but cannot be handed the Case id at all, by slug, by
JSON `data`, or by a literal value through `navigateTo`. Raised by the requester on 2026-09-10. See
[S11 result](#s11-result--2026-09-10-passed-route-c-works-the-custom-page-is-unnecessary).

**S8 is CLOSED.** The S7 send plus the requester's reply produced a genuine two-message conversation
(`conversationindex` 44 → 54 chars, same hash), so grouping, **cIdx ordering** and the depth formula are
all verified on real platform data. See [S8 (partial)](#s8-result-partial--2026-09-09) for the
population survey and [S8 CLOSED](#s8-closed--2026-09-10-via-the-s7-round-trip) for the closure.

Environment: `pac` CLI 2.11.2 authenticated against **the demo environment**
(`https://your-org.crm4.dynamics.com/`), Node v24.13.0, npm 11.6.2. The requester
confirmed CSW is installed, and the **Care queue** provides the approved, server-side-synced mailbox
used for S7. Only S3/S4 prerequisites remain unverified, and both are deprioritised.

Note that this is a **shared demo environment** — see the environment guardrails in
[`CLAUDE.md`](../../CLAUDE.md) before running anything that writes, sends email, or changes
System Settings.

### Artefacts removed — 2026-09-10

All spike artefacts and seed data have been deleted and the removal verified: solution, custom control,
custom page, spike form, the page's `appelement`, the seed Case, all 12 seeded emails, and every
S6/S7 attachment probe. **Org email count is back to its pre-spike 48.**

The two *real* S7 emails lived on the seed Case and went with it. Their metadata — the
`conversationindex` 44 → 54 chain and matching hash that closed S8 — was captured first to
[`evidence/s7-s8-conversation.json`](evidence/s7-s8-conversation.json). **Bodies were deliberately
excluded**: they contain the recipient's signature and phone number, which do not belong in the repo.
The delivered `.msg` also still exists outside Dataverse, in the requester's own mailbox and Downloads.

**Cleanup taught one thing worth keeping:** removing a custom page from an app takes three steps, not
one. `RemoveAppComponents` clears the registration but the designer also leaves an **`appelement`**
(component type 10088) linking page → app, and the page delete fails with `0x8004f01f` until that row
is deleted too. Note the asymmetry: `RemoveAppComponents` **accepts** `canvasapp` for removal even
though `AddAppComponents` **refuses** it for addition. `revert-s1.mjs` now does all three steps in the
right order (app → appelement → page → control).

[`03`](03-candidates.md) remains desk research from Microsoft documentation and community prior art.
[`02`](02-hosting-and-placement.md) and [`04`](04-data-model.md) have both now been **corrected by
measurement** (RQ1 real estate, side-pane support, and the `regardingobjecttypecode` / threading
findings). The recommendation in [`07-decision.md`](07-decision.md) now has its load-bearing claim
**confirmed for BOTH placements** — form tab (S1) and custom page (S2). S6 and S7 have since passed,
each correcting `04`. No gate remains open on the hosting decision.

### Prerequisites before any spike can run

| # | Prerequisite | Confirmed? |
|---|---|---|
| P1 | Dataverse environment with **Dynamics 365 Customer Service** and the **Copilot Service Workspace** app | ✅ **Confirmed by the requester**, 2026-09-09 — the demo environment is the right environment and CSW is present |
| P2 | System Administrator (or System Customizer + admin center access) on that environment | ❓ Not verified |
| P3 | `pac` CLI installed and authenticated against it (`pac auth create`) | ✅ pac 2.11.2, profile `[3]` active |
| P4 | Node.js LTS + npm | ✅ Node v24.13.0, npm 11.6.2 |
| P5 | A Case with a **real, long email chain** — required to close S8 | ✅ **Met.** A 7-message seed chain covers depth, and the S7 round-trip supplied genuine `conversationindex` data (44 → 54 chars) that seeded mail can never carry. |
| P6 | An approved mailbox — required for S7 | ✅ **Met via the Care queue** (`caredemo@…`, approval 1, outgoing *Success*, server-side sync). The *user* mailbox is approved too but unsynced; sending from the queue is the correct pattern from a Case anyway. |
| P7 | For S3 only: **Power Apps code apps** feature enabled on the environment, plus ability to edit CSP `frame-ancestors` in the admin center | ❓ Not verified; S3 is deprioritised anyway |

## Spike definitions

Each spike names the specific claim it confirms or breaks, so that a spike result changes a documented
conclusion rather than producing a general impression.

### S1 — React PCF on a Case form tab *(run this first)*

**Build.** `pac pcf init` React/virtual dataset component. Bind to a subgrid of `email` where
`regardingobjectid` = the Case. Render the 20 most recent rows via `context.webAPI`. Place on a
single-column tab of the enhanced Case form in CSW.

**Confirms / breaks:**
- RQ1 — that a dataset PCF gets usable full-tab vertical real estate on the *enhanced* Case form
  (`allocatedHeight` returns -1; CSS must fill 100%). **Currently marked Provisional in [`02`](02-hosting-and-placement.md).**
- RQ5 / C3 — that `context.mode.setControlState` genuinely restores state after a CSW session switch.
- **The undocumented question:** whether `setControlState` also survives teardown when the same PCF is
  hosted **inside a custom page**. [`05`](05-capability-matrix.md) discounts C3 from 3 to 2 purely
  because this is unknown. This is the highest-value unknown in the whole research pass.

**Success signal.** Renders at full tab height; open two Cases, set some component state in the first,
switch away and back — state restored, and the second Case never shows the first's state.

#### S1 result — 2026-09-10: **PASSED**, observed in the live app

Read directly from the control's diagnostics panel in Copilot Service workspace, on the seed Case.

| Question | Answer |
|---|---|
| **RQ5 — does `setControlState` survive a CSW session switch?** | **YES.** After a genuine two-Case-session switch the control re-initialised (`init #2`) and the panel showed **`state RESTORED`**, with the draft probe text `RQ5-PROBE-unsent-reply-42` intact. `state saved at 08:44:53Z` → `init at 08:50:23Z`, so a real destroy/reload cycle happened in between. |
| **No cross-session bleed** | **Confirmed.** The second Case session reported `state NOT restored`, `init #1`, an empty draft box, its own Case id, and `0 messages → 0 threads` (that Case has no email) — which also proves the Case-scoping filter. |
| **RQ1 — real estate** | `allocatedHeight` = **-1** as documented, `allocatedWidth` = full width (1857–2262px across window sizes). Height needed **claiming** — see the correction below. |
| Threading, live | `12 messages → 3 threads`, badged `hash` (7), `hash` (3), `subject` (2) — identical to the offline run. All three badged `createdon order`, correct for seeded rows with no `conversationindex`. |
| Quoted history, live | The deepest message in the 7-chain rendered **only its new text** ("Tusind tak - det ser taet ud nu…") with history collapsed by default and `matched divRplyFwdMsg · depth 6`. R2/R3/R4 demonstrated. |

**Three things had to be fixed before it worked, all worth keeping.**

**1. `regardingobjecttypecode` is not a queryable OData property.** The first deploy failed with
*"Could not find a property named 'regardingobjecttypecode' on type 'Microsoft.Dynamics.CRM.email'"*.
It exists as a FetchXML attribute, but not in the Web API. Verified against the live environment:

| Filter | Result |
|---|---|
| `_regardingobjectid_value eq <id>` | HTTP 200, 12 rows — works, but no type guard |
| `regardingobjectid_incident/incidentid eq <id>` | HTTP 200, 12 rows — **works and is inherently type-safe** |
| `_regardingobjectid_value eq <id> and regardingobjecttypecode eq 'incident'` | **HTTP 400** |

The typed navigation property is the correct way to express "scope to this Case *and* guarantee the
regarding object is a Case". `CLAUDE.md` previously said to "guard on `_regardingobjecttypecode`",
which is wrong for the Web API path; it has been corrected.

**2. RQ1 correction — a subgrid cell on a form tab is CONTENT-sized, not viewport-sized.** This
contradicts what [`02-hosting-and-placement.md`](02-hosting-and-placement.md) originally assumed.
Measured: `allocatedHeight` = -1, and **every ancestor sized itself to the component's own
`min-height`** (`cssHeight: 320px` on four levels of `pa-cu flexbox` parents). So `height: 100%`
resolves to nothing — the parent flexes to the child, not the reverse. The docs' "grow to use 100% of
the space" applies to a **main grid or related-records grid page**, not a subgrid cell on a form tab.

A mail client must therefore **claim** its height from the viewport rather than inherit it. The control
now sets `height = window.innerHeight - rootTop - gutter` on mount and on resize, which yielded
**658px** at one window size and **552px** at another — adapting correctly. Fixed `calc(100vh - …)` in
CSS would work too but hard-codes the form chrome offset.

**3. Error reporting.** `context.webAPI` rejects with a plain object, not an `Error`, so
`err instanceof Error ? err.message : …` collapsed the real failure to "Unknown error" and cost time.
The control now digs through `message` / `error.message` / `JSON.stringify`. Worth doing in the real
client from the start.

**Deployment notes for anyone repeating this:** the control bundle is cached hard — bump the manifest
`version` (0.0.1 → 0.0.2) and reimport, then reload with
`&flags=DisableWebResourceCache%3Dtrue`. Also, driving this via browser automation, `element.click()`
on the tab `<li role="tab">` works, but coordinate clicks need the **screenshot** coordinate frame
(1568×684 here), which differs from the page's CSS pixel frame (~1878×1134) — mixing them silently
clicks the wrong place. And React inputs need the native value setter plus a bubbling `input` event.

##### What this means for the architecture decision

The load-bearing claim in [`07-decision.md`](07-decision.md) — that PCF's `setControlState` genuinely
survives CSW's destroy/reload where custom pages, web resources and code apps do not — is now
**empirically confirmed for the Case form tab placement**. That was the whole basis of the
recommendation.

Still open, and unchanged: whether the same holds **inside a custom page** (the session-tab placement).
That needs S2. The durable-draft mitigation stays recommended regardless.

One nuance worth recording so nobody over-reads this: a **Home ↔ Case** session switch and an
**in-session tab switch** did *not* tear the control down at all — it stayed mounted (`init #1`,
React state simply never lost). Only switching between **two record sessions** produced a real
re-init. So "CSW tears controls down on every switch" is too strong; the teardown is driven by
memory pressure across concurrent sessions, which is exactly when it matters.

#### S1 build record — 2026-09-09

The control is written, built, deployed and wired to a Case form in CSW. **The three on-screen
measurements have not been read yet**, because no signed-in browser was drivable from this session
(the in-app browser has no Dataverse session, and no Claude browser extension is connected). The
control was therefore built to be **self-reporting** — its diagnostics panel states each answer
directly, so a human with the app open can read them off in about a minute. Steps below.

**What is verified**

| Check | Result |
|---|---|
| React virtual dataset PCF builds | ✅ `control-type="virtual"`, ESLint + tsc clean |
| Bundle size | ✅ **39.2 KiB** — React and Fluent resolve to platform externals (`Reactv16`, `FluentUIReactv940`), so nothing is duplicated |
| Solution builds and imports | ✅ `JHRBCaseEmailClientSpike` v1.0, **unmanaged** (dev) |
| Control registered | ✅ as **`jhrb_JHRB.CaseEmailClient`** — note the publisher prefix |
| Form wiring | ✅ new tab `tab_emailclient`, subgrid on `Incident_Emails`, `customControl` bound by `uniqueid` for formFactor 0/1/2 |
| Reachable in CSW | ✅ form registered as an app component and the app republished |
| Threading logic against real data | ✅ see [S8 follow-up](#s8-follow-up--seed-data-created-2026-09-09) and below |
| Quote splitting against real data | ✅ **48/48 correct** on pre-existing mail, 0 missed, 0 false positives |

**What is NOT verified — the actual S1 questions**

| Question | Status |
|---|---|
| RQ1 real estate: does the dataset PCF fill the tab? `allocatedHeight` expected `-1`; the panel prints the measured rendered box | ⬜ unread |
| RQ5: does `setControlState` survive a CSW session switch? Panel shows **state RESTORED / NOT restored** and an init counter | ⬜ unread |
| **The undocumented one:** does that state survive inside a **custom page**? | ⬜ unread — needs S2's custom page first |

**Findings worth keeping even before observation**

1. **The scaffold's default Fluent platform-library version is not deployable here.** `pac pcf init`
   generated `<platform-library name="Fluent" version="9.68.0" />`; import failed with *"platform
   library fluent_9_68_0 with version 9.68.0 is not supported by the platform."* **9.46.2** imports
   cleanly. Pin Fluent to a version the target environment's platform actually supports, and treat
   this as an environment-compatibility check in any future pipeline.
2. **Custom controls are referenced in form XML with the publisher prefix** — `jhrb_JHRB.CaseEmailClient`,
   not `JHRB.CaseEmailClient`. Referencing the manifest name fails with *"Custom control with name … not found."*
3. **Form XML: a dataset PCF is bound in two places, not one.** A subgrid `<control>` (classid
   `{E7A81278-8635-4D9E-8D4D-59480B391C5B}`) carries a `uniqueid`, and a separate
   `<controlDescriptions><controlDescription forControl="{that uniqueid}">` holds the
   `<customControl>` entries. `<row>` takes no `id` attribute — adding one fails schema validation.
4. **`MscrmControls.RichTextEditor.RichTextEditorControl` exists as a platform control** and is
   already used on the enhanced Case form for `description`. Relevant to R11: there may be a supported
   in-platform rich-text editor to reuse rather than bundling TinyMCE. **Worth a dedicated spike**
   before committing to a third-party editor — it would remove the biggest bundle-size risk in
   [`03-candidates.md`](03-candidates.md).
5. **Threading, run against real data:** the 48 pre-existing emails resolve to 34 threads grouped
   **100% by hash** — no correlation or subject fallback needed. Real `conversationindex` values are
   present with lengths 44 / 54 / 64, confirming the depth formula `(len - 44) / 10`.
6. **A real ordering limitation surfaced.** `compareMessages` puts all rows *with* a
   `conversationindex` before all rows without. For drafts that is correct — a draft belongs at the
   bottom of its thread. But a **non-draft** row lacking `conversationindex` (manually created or
   imported) that belongs chronologically mid-thread will be pushed to the end. Acceptable for the
   spike, must be fixed for the real client.
7. `-----Original Message-----` (Rule 3) matched **nothing** on real mail even where the ground-truth
   probe found that marker, while the localised bold-`Fra:` header-block rule (Rule 4) caught all 10.
   Rule 3's marker strings are too literal — loosen them.

**To finish S1 (about a minute, needs the app open)**

1. Open the seed Case in Copilot Service workspace:
   `.../main.aspx?appid=165f4816-a8cc-f011-8544-6045bde0fa7e&pagetype=entityrecord&etn=incident&id=4f6aa008-48ac-f111-aaab-000d3ab16615`
2. Switch the form to **"Case - Email Client Spike (S1)"** and open the **"Email (spike)"** tab.
3. Read the diagnostics row: `allocatedHeight`, the measured rendered box, and the threads summary
   (expect **12 messages → 3 threads**, one badged `subject` for the hash-less orphans).
4. Type into **"Draft proxy"**. Open a second Case in another session, switch back.
   - Badge still **state RESTORED** with your text intact → `setControlState` survives. RQ5 answered.
   - Badge **state NOT restored** and init counter incremented → it does not, and the durable-draft
     mitigation in [`07-decision.md`](07-decision.md) becomes mandatory rather than belt-and-braces.
5. Expand a thread and a message to see quoted history collapse, with the matched rule named.

**Reverting.** [`scripts/seed/revert-s1.mjs`](../../scripts/seed/revert-s1.mjs) (dry-run by default,
`--confirm` to apply): unregister the form from the CSW app → republish → delete the form → delete the
solution → delete the leftover custom control → republish. `cleanup.mjs` removes the seed Case
separately.

#### Correction, 2026-09-10 — dev must be unmanaged

S1 was first deployed as a **managed** solution, which was wrong: managed components cannot be
customised in the environment they are installed into, so they fight the dev loop. It has been
reinstalled **unmanaged** (`ismanaged = false`, verified on both the solution and the control), and the
spike form recreated — its id is now **`4fe309a1-dbac-f111-aaab-000d3ab16615`**.

Four things learned in the process, all worth keeping:

1. **`pac solution init` ships `SolutionPackageType` commented out, and the effective default is
   Managed.** That is how a managed solution reached dev unnoticed. Set it explicitly.
2. **A `Condition="'$(SolutionPackageType)' == ''"` guard on that property never fires** — the
   PowerApps `.props` import assigns `Managed` before the project's own `PropertyGroup` is evaluated,
   so the condition is already false. Set it unconditionally. Confirm with
   `unzip -p …/solution.zip solution.xml | grep -o '<Managed>[01]</Managed>'` → `0` is unmanaged.
3. **Uninstalling was blocked by a published dependency.** `0x8004f01d` — *"Solution dependencies
   exist… DependentComponentObject: SystemForm 'Case - Email Client Spike (S1)' … DependencyType:
   Published"*. And the form itself would not delete (`0x8004f01f`) until it had been unregistered
   from the app **and the app republished**. The republish is the step that is easy to miss.
4. **Deleting an unmanaged solution removes only the container** — components stay in the environment.
   The managed uninstall did remove the control for us; that is the one thing managed was better at
   here, and it is not a reason to install managed into a dev environment. `revert-s1.mjs` now deletes
   the custom control explicitly.

### S2 — Placement matrix confirmation

Place the S1 component (a) inside a custom page opened as a `Custom` CSW application tab with
`recordId` = `{anchor.incidentid}`, and (b) in an app side pane via `pageType: "control"`.

**Confirms / breaks:** RQ2 (slug-based Case id delivery), and whether the community-documented
PCF-in-side-pane route works at all — currently recorded in [`02`](02-hosting-and-placement.md) as
community-documented only, treat-as-unsupported.

#### S2 result — 2026-09-10: **PASSED** (both halves)

**The last open architectural question is answered: `setControlState` DOES survive teardown inside a
custom page.**

Measured in Copilot Service workspace after the page was added to the app (see *Registration* below):

| Question | Answer |
|---|---|
| **Does `setControlState` survive a session teardown inside a custom page?** | **YES.** After switching to a second concurrent Case session and back, the control re-initialised (`init #2`) and reported **`state RESTORED`** with the probe text `S2-CUSTOMPAGE-PROBE-77` intact. `state saved at 10:18:58.605Z` → `init at 10:19:31.081Z`. |
| Does the Case id reach the component? | **YES, `via caseId property`.** The page's `caseId = Param("recordId")` binding delivered the Case GUID end to end. This is exactly why the property was added. |
| Does `context.webAPI` work at runtime in a custom page? | **YES** — `12 messages → 3 threads`, with the same hash/hash/subject badges as the form-tab placement. Studio's *"retrieveMultipleRecords: Method not implemented"* is an **author-time-only** limitation, as the docs imply. |
| `allocatedHeight` / `allocatedWidth` in a custom page | Real numbers (**700 / 1180**), matching the control's configured Size — not -1 as on a form. |

**Registration was the blocker, and it needs the app designer.** `navigateTo({pageType:'custom'})`
resolves but the app reports *"Page does not exist in this app"* until the page is added to the app.
None of these worked:

| Attempt | Result |
|---|---|
| `AddAppComponents` with `Microsoft.Dynamics.CRM.canvasapp` | `0x80050112` — *"An app can't reference the component type 'canvasapp'."* |
| `POST /appmodulecomponents` (componenttype 300 / 10333 / 80) | *"The 'Create' method does not support entities of type 'appmodulecomponent'."* |

The working route is the **model-driven app designer** → **+ Add page** → **Custom page** → select the
existing page → **Add**, then **Save** and **Publish**. Two things make this awkward:

- **Copilot Service workspace is not listed in the maker portal Apps list** (that list showed only the
  6 user-owned apps, while the API reports 17). The designer is still reachable directly at
  `https://make.powerapps.com/e/{envId}/s/00000001-0000-0000-0001-00000000009b/app/edit/{appModuleId}`
  — a pattern derived by opening a listable app's designer and substituting the CSW app id.
- After publishing, the page is **not** recorded as an `appmodulecomponent` (0 rows) — pages live in
  the app's sitemap. `appmodule.modifiedon` / `publishedon` is the reliable signal that the change
  landed. A **cache-busting reload** (`&flags=DisableWebResourceCache%3Dtrue`) was needed before the
  client stopped saying "Page does not exist in this app".

**One unresolved observation.** The page rendered the **pre-v0.0.4** height logic (it printed
"claimed … from viewport" even though `allocatedHeight` was 700, where v0.0.4 prints "honouring host
allocatedHeight"), while the environment had **v0.0.4** registered. The likely explanation is that a
custom page **pins the code-component version from when the page was last published**, so a PCF update
does not flow into hosting pages until they are republished. I could not cleanly separate that from
client-side bundle caching, so treat it as **probable, not proven** — but verify it before relying on
"deploy the PCF and every host picks it up".

##### (b) PCF in an app side pane — WORKS, but with no record context

`Xrm.App.sidePanes.createPane(...)` then `pane.navigate({pageType:'control', controlName:'jhrb_JHRB.CaseEmailClient'})`
**renders the control**. This **contradicts** the treat-as-unsupported note previously in
[`02`](02-hosting-and-placement.md) — the community-documented route is real, at least in this version.
`allocatedWidth` came through as the pane width I requested (520), `allocatedHeight` as -1.

**But the control cannot tell which record it is on.** The panel reported
`case (unresolved) · via unresolved`: `context.mode.contextInfo` is **empty** in a side pane, and
`Xrm.Utility.getPageContext()` returns an internal object with `_pageId: "0"` and no usable record.
`pageType: "control"` has no documented parameter mechanism, so the Case id would have to arrive by
some out-of-band route (a global set by form script, or reading the focused session). **That makes the
side pane the weakest of the three placements for a Case-scoped client** — worth knowing, though side
pane was only ever a bonus placement, not a requirement.

##### (a) PCF inside a custom page — authoring detail

Kept for the mechanics. The runtime result is in the table at the top of this section; registration was
the only blocker and is covered under *Registration* above.

What worked at author time:

- The page was created (Studio → New → App → **Page**) and saved into the spike solution as
  `jhrb_caseemailclientpages2spike_314da`, listed with Type **Page**.
- The control imports via **Insert → Get more components → Code**, where it appeared as
  *Case Email Client (S1 spike)*, and then **renders on the page in Studio**.
- **The new `caseId` input property works.** It appears in the Properties pane and in the property
  dropdown, and `Param("recordId")` binds cleanly as a formula (evaluating to *Blank* at author time,
  data type text). This property was **added because of S2** — see the finding below.

What blocked it until the page was registered:

**A custom page must be registered in the model-driven app, and there is no API route to do it.**
`Xrm.Navigation.navigateTo({pageType:'custom', name:'…'})` resolves but the app shows
**"Page not found — Page does not exist in this app."** Attempts to register it:

| Attempt | Result |
|---|---|
| `AddAppComponents` with `Microsoft.Dynamics.CRM.canvasapp` | `0x80050112` — *"An app can't reference the component type 'canvasapp'."* |
| `POST /appmodulecomponents` (componenttype 300 / 10333 / 80) | *"The 'Create' method does not support entities of type 'appmodulecomponent'."* |
| Model-driven app designer | **Copilot Service workspace is not listed in the maker portal apps list** — it is a Microsoft-managed app |

So the remaining route is the app designer reached from somewhere other than the apps list, or the
Copilot Service admin center. **The core S2 question — does `setControlState` survive teardown inside
a custom page — is therefore still unanswered.**

##### Findings that stand regardless

1. **`allocatedHeight` semantics differ per host, and this broke the S1 height fix.** On a form tab it
   is **-1** (host is content-sized; the component must claim height from the viewport). In a custom
   page it is a **real number** — the control's configured Size (200 by default, then 700 after I
   resized it). The S1 viewport-claiming logic therefore **over-claimed**: it computed 994px inside a
   200px control box. The control is now **host-aware** (v0.0.4): honour `allocatedHeight` when it is
   positive, claim from the viewport only when it is -1. Any real implementation needs this.
2. **`context.mode.contextInfo` is a form-only mechanism.** Empty in a side pane; a custom page gets
   the record as a *page* input the component cannot read. Hence the explicit `caseId` property. **This
   is a genuine design consequence for the recommended hybrid**: the same component must accept its
   Case id two different ways depending on placement.
3. **The Studio authoring environment is not a faithful runtime.** `retrieveMultipleRecords: Method
   not implemented` appears in Studio — matching the documented note that custom page authoring lacks
   Web API support while the published app has it. Also, author-time `contextInfo` returns a **dummy
   Case id** (`4ff37a24-3cf6-e711-8105-000d3aa167ac`), so the control reported `via contextInfo` in
   Studio even though no real record was in play. **Do not trust anything measured in Studio.**
4. **A dataset property forces a data-source binding prompt** in a custom page. Ours is unused (the
   component queries via `webAPI`), and the page works with the dataset left unbound — but it is
   friction, and an argument for dropping the dataset property if the form-tab placement is ever
   dropped.

##### What this means for the architecture — a cost the scorecard missed

The session-tab placement requires **adding a custom page to the Copilot Service workspace app**, which
is a Microsoft **managed** app. That is an unmanaged customisation layer over a managed app, repeated in
every environment, and it is **not automatable through the documented APIs** — it needs the app
designer. [`05`](05-capability-matrix.md) scored the A+B hybrid's ALM at 3 on the assumption that both
placements ship in one solution. The PCF does; **wiring the page into CSW does not**. That is a real
deployment cost for the hybrid that was not previously accounted for.

This does not overturn the decision — every candidate that occupies a CSW session tab needs app-level
wiring of some kind — but it should be weighed before build, and it strengthens the case for checking
the reversal condition in [`07`](07-decision.md) about the `Control` app tab template type.

### S3 — Code app behind an iframe web resource

Deploy a minimal code app, surface it via an iframe HTML web resource on the Case form, pass the Case
id as a query parameter, read it with `getContext()` → `ctx.app.queryParams`.

**Confirms / breaks:** RQ4 — the CSP `frame-ancestors` requirement, whether auth completes without a
prompt inside the frame, and the state-loss behaviour on tab switch. **Deprioritised**: candidate D is
already excluded on a MUST failure, so this spike is only worth running if R16/N1 are relaxed.

### S4 — Generative page with Case context

Create a generative page accepting `recordId` / `entityName`, launch it from a Case command bar button.

**Confirms / breaks:** RQ3. **Deprioritised** — candidate C is excluded on documented platform facts,
not on uncertainty. Run only to sanity-check that the documented side-pane and app-tab limitations are
still current, if the decision is being revisited later.

### S5 — CSW session template auto-open

Session template that opens the S2 custom page tab on Case open, titled from the Case.

**Confirms / breaks:** RQ2 end-to-end, including that the tab is non-closable and correctly titled.

### S6 — Attachment round-trip *(gate on this before deciding)*

Upload a ~1 KB and a ~10 MB file to a draft email from inside the component, then download both.

**Confirms / breaks:** RQ7 — the environment's **actual** `Organization.MaxUploadFileSize` (default is
5 MB, so the 10 MB case is expected to fail until raised), that the failure above the ceiling is a
catchable error rather than a hang, and whether chunked upload is required at the target size.

#### S6 result — 2026-09-10: **PASSED**, and it corrects the data model doc

`Organization.MaxUploadFileSize` read as **5242880 bytes (exactly 5 MB)** — the documented default,
unchanged. Per the environment guardrails I did **not** raise it; I probed both sides of it instead.

| Upload | Path | Result |
|---|---|---|
| 1 KB | inline base64 → `activitymimeattachment.body` | ✅ OK (1299 ms) |
| 4 MB | inline | ✅ OK (860 ms) |
| **6 MB** | **inline** | ❌ **HTTP 400 — *"Attachment file size is too big."*** |
| **6 MB** | **chunked** (Initialize / UploadBlock / Commit) | ✅ **OK** (1623 ms, 2 blocks) |
| 4 MB | chunked | ✅ OK (1130 ms) |
| 10 MB | chunked | ✅ OK (2358 ms, 3 blocks) |
| 20 MB | chunked | ✅ OK (3564 ms, 5 blocks) |
| **40 MB** | **chunked** | ✅ **OK** (7015 ms, 10 blocks) — 8× the org cap |

**Download round-trip verified byte-for-byte**: every successful upload was read back via
`$select=body`, and the SHA-256 of the returned bytes matched the source, with `filesize` exact
(1024 / 4194304 / 6291456 / 4194304).

##### The correction

[`04-data-model.md`](04-data-model.md) said the ceiling is `Organization.MaxUploadFileSize` and that
chunked upload is for getting large files "above the inline-payload comfort zone" through. **That is
wrong.** Measured behaviour:

- **`MaxUploadFileSize` governs only the inline path** (base64 into `activitymimeattachment.body`).
  Exceeding it fails fast with a clean, catchable **HTTP 400** — no hang, no partial write.
- **The chunked path is not governed by it at all.** 40 MB uploaded successfully against a 5 MB cap.

So supporting large attachments (R13) does **not** require an admin to raise a System Setting — it
requires using the chunked API. That is a materially better answer than "ask for the limit to be
raised", and it removes an admin dependency from the design.

Caveat worth carrying: this says nothing about whether **sending** such an email succeeds. Exchange
transport limits and any send-time size check are S7's territory, and a 40 MB attachment that stores
happily may still be undeliverable.

##### An architectural consequence: `context.webAPI` cannot do this

Checked against the shipped type definitions (`@types/powerapps-component-framework`): the PCF
`WebApi` interface exposes exactly **`createRecord`, `deleteRecord`, `retrieveMultipleRecords`,
`retrieveRecord`, `updateRecord`** — there is **no `execute`**. The chunked upload messages are
unbound actions, so they are **unreachable through `context.webAPI`**.

Verified the working route from inside the running app: **`Xrm.WebApi.online.execute`** exists and a
6 MB chunked upload through it succeeded from the browser (2 blocks, committed, attachment id
returned). So a PCF must reach `window.Xrm.WebApi.online.execute` for attachment upload, with a
hand-built `getMetadata()` on each request.

This **qualifies the "always use `context.webAPI`" rule** in [`CLAUDE.md`](../../CLAUDE.md): it holds
for CRUD, but attachment upload has to go through `Xrm.WebApi.online.execute`.

##### Cleanup

All 8 test attachments (90.0 MB) and the draft email were deleted after measuring. Nothing left behind.

### S7 — Send round-trip *(gate on this before deciding)*

Compose a reply with rich text and quoted history, send via
`POST emails(<id>)/Microsoft.Dynamics.CRM.SendEmail` with `{ "IssueSend": true }`, and verify the
received message in Outlook.

**Confirms / breaks:**
- RQ8 — send semantics, and that `IssueSend: false` behaves as "mark sent without sending" (so the flag
  is never set wrongly in production code).
- RQ6 / R12 — **that the quoted chain is not mangled**. This is flagged in [`04`](04-data-model.md) as
  the largest functional risk in the build. It is host-independent, so it does not change the
  architecture choice, but a failure here changes the effort estimate substantially.
- R18 — the error surfaced when sending from an unapproved mailbox.

#### S7 result — 2026-09-10: **SENT SUCCESSFULLY**, and it broke two of my own assumptions

A real email was sent, with the requester's explicit authorisation, from the **approved Care queue**
(`care@example.invalid`, outgoing status *Success*, server-side sync both ways) to
the requester's own address. **They confirmed receipt.**

| Check | Result |
|---|---|
| `SendEmail` with `IssueSend: true` | ✅ HTTP 200 in 4010 ms |
| Status transition | `Open`/`Draft` → `Completed`/**Pending Send**, then `Completed`/**Sent** |
| Delivery | ✅ **Confirmed received by the recipient** |
| Attachment | ✅ 1 MB uploaded via the **chunked** API on a draft, then sent — so chunk-uploaded attachments are deliverable, closing S6's open question at this size |
| `messageid` | Assigned on send: `<880ACBC28F0D454F93A14C10C458409A1DD4110A4DE0@CAREDEMO…>` |
| `conversationindex` | **Assigned by the platform on send** — 44 chars (`01E1ECB8719970468FB42521B09111CCB3DD4110A4DE`), i.e. a base/depth-0 index |
| `trackingtoken` | `CRM:0100009` |

Sending from the **Care queue** rather than the user is the correct pattern — the requester pointed out
that the standard email form does exactly this from a Case, and the environment's pre-existing outbound
mail all originates from that same queue address.

##### Two assumptions broken

**1. The platform OVERWRITES `baseconversationindexhash` on send.** I set `111000001` to make the reply
join the 7-message seed thread. After sending, the row carried **`100487241`** — recomputed by the
platform from the `conversationindex` it assigned. Consequence: the sent mail formed **its own
one-message thread** instead of joining the chain (verified by re-running the threading logic: the Case
went from 3 threads to 5).

So `baseconversationindexhash` is writable but **not durable for outbound mail** —
[`04-data-model.md`](04-data-model.md) already flagged it as advisory; this is the concrete mechanism.
**You cannot force outbound threading by writing the hash.** For real mail this is the *right*
behaviour (the platform knows the true conversation); it only bit here because the seed hashes are
synthetic. But it does expose a genuine precedence gap: **hash grouping wins over subject**, so two
groups with different hashes never merge even when their normalised subjects match. Worth considering
an optional post-pass that merges hash-groups sharing a normalised subject.

**2. The tracking token is appended to the outgoing SUBJECT, and my `normaliseSubject` didn't strip
it.** The sent subject became `RE: Reklamation: … - Jensen VVS CRM:0100009`, which normalised to
`… jensen vvs crm:0100009` — **not** matching `… jensen vvs`. Subject-fallback threading would
therefore fragment on any tracked reply. **Fixed** in `threading.ts` with a generic
`\b[A-Za-z]{2,8}:\d{4,12}\b` strip — generic because the prefix is configurable and the seed data also
contains third-party tokens of the same shape (`MON:026300261`). 8/8 unit cases pass, including
`Meeting at 10:30 tomorrow` staying intact (the 4-digit minimum avoids matching clock times).

Neither of these was findable without a real send. They are exactly what S7 was for.

##### R12 verified against what transport actually delivered — 10/10

The requester supplied the received `.msg`. Parsed it and ran `quoting.ts` against the **delivered**
HTML (21734 chars — Exchange inflated my ~3 KB body with styles), which is a much better test than the
copy Dataverse stored:

| Check | Result |
|---|---|
| Split rule matched | `divRplyFwdMsg`, `quoteDepth` 2 |
| New text isolated (greeting + table) | ✅ |
| New text free of quoted content | ✅ |
| Quoted level 1 ("Teknikeren har vaeret forbi…") | ✅ |
| Quoted level 2 ("Tusind tak…") | ✅ |
| Danish `Fra:` / `Sendt:` headers retained | ✅ |
| Bold / link / table survived transport | ✅ |

**10/10.** And the attachment arrived as `s7-1MB-chunked.bin` at **exactly 1048576 bytes** — so a
chunk-uploaded attachment is delivered intact, which closes S6's remaining question at that size.

##### The inbound reply — a real Outlook-generated quote structure

The requester replied; server-side sync brought it in within minutes. This is the strongest test yet,
because *their* Outlook built the quote structure, not me:

- Split matched `divRplyFwdMsg`, depth 3. **New text correctly isolated to 185 chars** — their actual
  reply ("Her er mit svar.") plus signature — with 1521 chars of quoted chain separated out.
- **The header block was in English** (`From:` / `Sent:` / `To:` / `Subject:`) where the seed data used
  Danish. Both handled by the same rule, which is exactly why it was built localisation-aware.
- **Auto-association worked (R20):** the reply arrived already `regarding` the Case, matched by the
  `CRM:0100009` tracking token. No manual linking.

##### NEW FINDING: transport and tenant policy inject content into the body

Three things appeared in the body that **no sender wrote**, all of which land in the new-text region:

1. Outlook's first-contact tip — *"You don't often get email from … Learn why this is important"*.
2. A **Microsoft Defender external-sender banner**, bilingual EN/FR, wrapped in
   `ZjQcmQRYFpfptBannerStart` / `…BannerEnd` markers.
3. the tenant's **`Classification: Public`** line, prepended to outbound mail by tenant policy.

Plus the sender's **signature block** (name, title, phone, links), which is legitimately part of the
new text at the MIME level but which a mail client normally collapses.

A client that renders the body verbatim will show all of this on **every message**, which is precisely
the kind of clutter that makes the OOB Timeline feel unlike a mail client. Stripping the banners is
tractable — the Defender wrapper has stable markers. Signature detection is the harder half. Recorded
as a new requirement (**R21** in [`01-requirements.md`](01-requirements.md)).

##### `internetmessageheaders` is not populated at all

Null on the real synced inbound reply. The 500-character cap noted earlier is therefore moot — the
column is simply empty here, so it is unusable for threading regardless of its size.

##### R18 result — 2026-09-10: **there is no failure signal at all.** Pre-flight is mandatory.

The requester created a queue in exactly the state needed: **Offensive Support**,
`doesntexists@invalid.local`, `emailrouteraccessapproval = 2 (Pending Approval)`, with the org set to
`requireapprovalforqueueemail = true`. Sent from it:

| Observation | Result |
|---|---|
| `SendEmail` with `IssueSend: true` | **HTTP 200 OK** in 6181 ms — **no synchronous guard** |
| Email state afterwards | `Completed` / **`Pending Send`** |
| After ~2 minutes of polling (8 polls) | **still `Pending Send`** — never reaches Failed or Sent |
| Mailbox `outgoingemailstatus` | `Not Run` |
| Mailbox `mailboxstatus` | `Not Run` |
| Mailbox `lastsyncerror` / `lastsyncerrorcode` / `lastsyncerrorcount` | **all null** |

**Nothing anywhere says why.** The mailbox was never enabled because it is unapproved, so no sync ever
runs and no error is recorded. The email is silently stranded forever, while the API reported success.

**This inverts R18's acceptance criterion.** R18 said *"Send from an unapproved mailbox; the agent sees
why, not a silent failure."* The platform **gives** a silent failure and cannot be made to report one —
so R18 is **unachievable by reacting to the platform**. It can only be met by **pre-flighting before
offering Send**, checking:

- org `requireapprovalforqueueemail` / `requireapprovalforuseremail`, and if set:
- the sender's `emailrouteraccessapproval` — `1` = Approved (queue or systemuser), and
- the mailbox's `outgoingemailstatus` (want *Success*) and `mailboxstatus` (want *Run*).

The data-model doc already *recommended* pre-flighting. This makes it **mandatory**, and names the
exact columns.

**A counter-intuitive detail worth keeping:** a queue with **no email address** fails **loudly** —
synchronous HTTP 400, *"Could not find email address for recipient of type 'Queue'"* (the earlier
probe). A queue with an **unapproved address** fails **silently**. The more complete the
misconfiguration, the quieter the failure. Do not infer from one that the other is covered.

The stranded probe email was deleted; left in place it would have sat in `Pending Send` on the Case
indefinitely. The queue itself was left alone — it is the requester's.

##### Earlier R18 attempt — invalid, kept for the record

The probe sent from `<Care Agents>` (approval = 0) failed with a clean HTTP 400 —
*"Could not find email address for recipient of type 'Queue' with ID …"* — but that is a **missing
address** error, not the approval guard, because that queue has no email address at all. The
*property* R18 needs (a fast, specific, catchable failure rather than a silent one) held. **The
approval-guard path itself remains untested**; it needs a queue that has an address but is unapproved.
The probe draft was deleted, having never sent.

### S8 — Threading fidelity against real data

Run the [`04`](04-data-model.md) threading strategy against a real Case with a long chain. Score how
correctly it groups and orders.

**Confirms / breaks:** RQ10. Specifically, how often `baseconversationindexhash` and `conversationindex`
are actually **populated** — they depend on server-side sync having created the records, and manually
created, imported or Flow-created email may have none of them. Record the measured fallback rate; it
determines how much effort the subject-normalisation fallback deserves.

#### S8 CLOSED — 2026-09-10, via the S7 round-trip

The nesting half was open because seeded mail can never carry a `conversationindex`. The S7 send plus
the requester's reply produced a **genuine two-message conversation**, which settles it:

| Message | `conversationindex` | Depth | `baseconversationindexhash` |
|---|---|---|---|
| Outbound (S7 send) | 44 chars | 0 | `100487241` |
| Inbound (their reply) | **54 chars** | **1** | `100487241` — *same* |

- **Grouping:** both share the hash, so they group into one thread. Confirmed by re-running
  `buildThreads`.
- **Ordering:** the thread is badged **`(cIdx)`**, not `createdon` — the first time real conversation
  index ordering has been exercised, and it ordered parent-before-child correctly.
- **`conversationDepth` formula confirmed on real data:** `(len - 44) / 10` gives 0 and 1 for 44 and 54
  chars, matching the 22-byte header + 5-byte-per-reply structure assumed in `threading.ts`.

**RQ10 is now fully answered.** Grouping, ordering and depth all verified on genuine platform-generated
conversation data, and the fallbacks verified separately on seeded and pre-existing mail.

One structural note carried forward: the real thread (hash `100487241`) stays separate from the seed
thread (`111000001`) even though the subjects match, because **hash grouping takes precedence over
subject**. That is correct behaviour here — the seed hashes are synthetic — but it is the precedence gap
described in the [S7 result](#s7-result--2026-09-10-sent-successfully-and-it-broke-two-of-my-own-assumptions),
and a real environment could hit it with manually created mail.

#### S8 result (partial) — 2026-09-09

Run read-only against **the demo environment** with `pac org fetch` aggregates. No writes.

**Population**, over all 48 `email` rows: `baseconversationindexhash` **100%** (48/48),
`conversationindex` 83% (40/48), `messageid` 83%, `trackingtoken` 25%,
`conversationtrackingid` **0%**. Full table and interpretation in
[`04-data-model.md`](04-data-model.md#measured-population-customer-service-demo-dk-2026-09-09).

**Verdict on the strategy: it holds.** Grouping by `baseconversationindexhash` works on 100% of rows,
so the layered fallback is a safety net rather than a load-bearing component. Two corrections came out
of it:

1. `conversationtrackingid` is **entirely unpopulated** and was demoted from first place in the
   precedence list.
2. The `conversationindex` gap is **precisely the drafts** — 8/8 of the null rows are `statuscode` = 1,
   and no draft has one. Drafts still group correctly via the hash but must be **ordered by `createdon`**.

**Thread shape in this environment** — 48 emails resolve to 34 threads:

| Thread size | Count |
|---:|---:|
| 1 message | 26 |
| 2 messages | 5 |
| 3 messages | 1 |
| 4 messages | 1 |
| 5 messages | 1 |

**Why this was only partial.** The dataset was shallow: 26 of 34 threads were single messages and the
deepest chain was 5 — enough to smoke-test grouping, not enough to stress ordering, nesting, or the
subject-normalisation fallback.

Useful for other spikes: **12 rows have `attachmentcount` > 0**, so S6 has real attachments to read
against, and **44 of 48 regard an incident**, confirming the Case-scoped query shape.

#### S8 follow-up — seed data created, 2026-09-09

To close the depth gap, a seed Case was created with a deliberately deep chain. Script, manifest and
cleanup: [`scripts/seed/`](../../scripts/seed/README.md).

Seed Case `TEST - Email client threading seed (deep chain)` — 12 emails: a **7-message** thread
(hash `111000001`), a **3-message** thread (hash `111000002`), and **2 orphans with no hash** to force
the subject-normalisation fallback. Bodies carry 6 levels of genuine Outlook `divRplyFwdMsg` nesting
with **Danish** `Fra:/Sendt:/Til:/Emne:` header blocks, so S7's quote-splitting heuristic has
localised test material. All addresses are RFC-2606 `.invalid` — nothing can be sent.

Environment-wide after seeding: **60 emails → 38 threads**, with the distribution now
`28 × 1, 5 × 2, 2 × 3, 1 × 4, 1 × 5, 1 × 7`.

**What the seed confirmed:**
- `baseconversationindexhash` **is writable and persists exactly as written** — grouping is now fully
  testable, including two distinct threads on one Case.
- `overriddencreatedon` **backdates correctly**: the platform moves the supplied value into `createdon`
  and records the real insert time in `overriddencreatedon`. Chronology in the seed is realistic.
- `statecode`/`statuscode` can be PATCHed to Sent (3) / Received (4) after create, so seeded mail is
  not stuck as Draft.

**What the seed cannot confirm, permanently.** Every seeded row has a **null `conversationindex`**,
because that column is `IsValidForCreate: false` / `IsValidForUpdate: false` — see
[writability](04-data-model.md#writability-of-the-correlation-columns-metadata-2026-09-09). No amount
of seeding will change this.

**S8 therefore splits:**

| Half | Status |
|---|---|
| Grouping by `baseconversationindexhash`, plus `createdon` ordering fallback, plus subject-normalisation fallback | ✅ **Testable now** against the seed Case |
| Ordering and parent/child **nesting** by `conversationindex` | ⚠️ **Still open** — requires mail that has round-tripped through a synced mailbox (a real send + external reply), which is S7 territory and needs an approved mailbox (P6) |

### S10 — Can the platform rich-text editor be reused from a PCF? *(added 2026-09-10)*

**Why.** R11 (rich-text compose with paste-from-Word cleanup) was the largest remaining risk against the
recommended architecture, because it implied bundling a third-party editor. S1 spotted
`MscrmControls.RichTextEditor.RichTextEditorControl` already in use on the enhanced Case form, which
raised the possibility of reusing a platform editor instead.

**Confirms / breaks:** whether R11 can be satisfied without a bundled editor.

#### S10 result — 2026-09-10: **NO — do not depend on it.** Mechanism works, editor does not.

**Six** rich-text controls exist in the environment, all `ismanaged=true` (Microsoft-owned):

| Control | Type | Notes |
|---|---|---|
| `MscrmControls.RichTextEditor.RichTextEditorControl` v1.26082.1 | `standard` | The legacy one, on the Case form for `description` |
| **`MscrmControls.RichTextEditorV2.RichTextEditorControlV2`** v1.26083.1 | **`virtual`** | Modern. Props: `value` (bound), `isReadOnly`, `configurationJson`, `configUrl`, `mentionableEntitiesConfig`, `autoExpand`, `enableReadonlyTranslation`. React 16.8.6 + Fluent 9.4.0 |
| `MscrmControls.RichTextEditor.StructuredTemplatesControl` | virtual | Template picker, not an editor |
| `MsdynmktControls.RichTextEditorV3.RichTextEditorControlV3` | virtual, **hidden** | Marketing |
| `MsdynmktControls.RichTextControl.RichTextControl` | virtual, **hidden** | Marketing; large surface incl. Copilot |
| `MsdynmktControls.FieldControls.UTMRichTextWrapperControl` | virtual | Marketing |

##### The typings hide most of the factory

`ComponentFramework.Factory` in the shipped `@types/powerapps-component-framework` declares exactly
**two** members — `getPopupService()` and `requestRender()`. At runtime the same object exposes
**eleven**:

```
createElement, createComponent, bindDOMElement, bindDOMComponent, createFileObject,
fireEvent, getControlDefaultMapping, getPopupService, requestRender,
unbindDOMComponent, updateComponent
```

That is a complete component-hosting lifecycle, plus `createFileObject` (potentially interesting for
attachments). **All of it is untyped and undocumented.**

##### The mechanism works — the editor doesn't

`factory.createComponent('MscrmControls.RichTextEditorV2.RichTextEditorControlV2', id, props)` returns a
descriptor (`{IsVirtualComponent: true, _type, _componentId, _properties, _children, render}`), and
`factory.bindDOMComponent(descriptor, hostElement)` **genuinely mounts it inside the PCF's own DOM** —
verified: 2864 characters of platform markup appeared, tagged
`data-lp-id="MscrmControls.RichTextEditorV2.RichTextEditorControlV2|Subgrid_emailclient.rteSpike1|incident"`.

But it never becomes an editor. Two attempts — a plain `value` string, then a full reconstructed PCF
property descriptor (`raw`/`formatted`/`type`/`attributes`/`security`) plus `configurationJson`,
`autoExpand` and an `onChange` — both produced the same inert shell: **zero `contenteditable`
elements**, no toolbar, no text, one stray button. The host box rendered empty.

##### Verdict

**R11 needs a bundled editor.** Making the platform RTE work would mean reverse-engineering
undocumented internal property shapes, and even then it would rest on an **undocumented API that
Microsoft can change without notice** — exactly the upgrade risk that C5 penalises other candidates
for. The risk against the architecture therefore **stands rather than being removed**.

##### BONUS FINDING: React 16 rules out the React bindings of every modern editor

The bundle benchmark failed to install — and the failure was the finding. `npm install @tiptap/react`
returned **ERESOLVE**:

> `Found: @types/react@16.14.70` · `Could not resolve dependency: peer @types/react@"^17.0.0 || ^18.0.0 || ^19.0.0" from @tiptap/react@3.31.3`

A **virtual** PCF shares the *platform's* React, which is **16.14.0** here (and the platform's own RTE
V2 declares React 16.8.6). Modern editors' React bindings require 17+. Checked across the field:

| Package | React peer requirement | Usable in a React-16 virtual PCF? |
|---|---|---|
| `@tiptap/react` | `^17 \|\| ^18 \|\| ^19` | ❌ |
| **`@tiptap/core` + `@tiptap/pm`** | **none** | ✅ mount imperatively into a ref'd DOM node |
| **`quill`** | **none** (deps: parchment, quill-delta, lodash-es, eventemitter3) | ✅ |
| **`lexical`** (core) | only `typescript >=5.2` | ✅ |
| `@lexical/react` | `react >=18` | ❌ |

**The pattern: the framework-agnostic cores are fine; only the React wrappers are blocked.** So R11's
real constraint is not "which editor is best" but **"use the editor's core and mount it imperatively,
not its React bindings"** — a standard pattern (a `useRef` host div plus an effect that instantiates
and tears down the editor).

The alternative — a **standard** (non-virtual) control bundling its own React 18 — would work but
forfeits the platform-React sharing that keeps the current bundle at **39.2 KiB**, since React and
Fluent would ship inside the component.

**Bundle cost is still unmeasured.** No number was produced, because the install never resolved. Redo
it against `@tiptap/core` (not `@tiptap/react`) to get a real figure before committing to an editor.

Two consolations:
- `createComponent` / `bindDOMComponent` being real is worth knowing for *other* problems, with the
  same caveat attached. `createFileObject` in the same list may be relevant to R13.
- The choice of editor is a genuine design lever, not just a size cost: a **headless/schema-based**
  editor (TipTap/ProseMirror, Lexical) gives *controlled HTML output*, which directly serves R12's
  "never re-serialise an inherited quote" rule. TinyMCE gives better paste-from-Word cleanup out of the
  box but emits looser HTML and carries a commercial licensing question. That trade-off — clean output
  vs. clean paste — should drive the pick, not bundle size alone.

### S11 — Can an `Entity record` tab host the PCF, making the custom page unnecessary? *(added 2026-09-10)*

**Why.** The A+B hybrid assumed a custom page was the only supported route to a session tab, because
`Control` is documented "for internal use only". That skipped the **`Entity record`** page type, which
takes `entityName`, `entityId` **and `formId`** — so a session tab can open the same Case on a
*dedicated form* whose tab hosts the PCF. That is the S1 placement reused, with no canvas layer.

**Build.** Recreate the spike form (or a form containing only the email-client tab), then an app tab
template of type **Entity record** with `entityName={anchor.entityName}`,
`entityId={anchor.incidentid}`, `formId=<that form>`. Attach it to a Case session template, or open it
with the CSW tab API, and read the control's diagnostics panel.

**Confirms / breaks:**
- Whether CSW will show **the same record twice in one session** (anchor tab on the default form, a
  second tab on the email form). Precedent exists — the OOB *Customer Summary* tab does something
  similar.
- Whether `setControlState` survives a two-session teardown in that host. Expected yes, since it is the
  same form host S1 measured, but it should be confirmed rather than assumed.
- Whether the Case id arrives via `contextInfo` (as on a form) rather than needing the `caseId`
  property — which would make the property optional for this route.

**If it passes**, the architecture drops the custom page entirely: one PCF, two form placements. That
also retires the manual per-environment app-designer registration and the `appelement` cleanup tangle,
and removes the canvas host's 8-hour timeout, third-party-cookie requirement and app-wide connector
consent dialogs. Route comparison in
[`02-hosting-and-placement.md`](02-hosting-and-placement.md#reopened-2026-09-10--the-custom-page-may-be-an-unnecessary-layer).

**Secondary, cheap:** the same run can test route **B** — an app tab template of type `Control` with
`controlName = jhrb_JHRB.CaseEmailClient`. Shape confirmed from the OOB `msdyn_omnichannel_pbi`
template (`controlName` + `data`), and 7 of 13 OOB templates use `Control`, so it functions. It stays
a fallback rather than a plan because it is unsupported.

**Not worth testing: a web resource hosting the PCF.** Ruled out on reasoning — there is no
`ComponentFramework` runtime inside a web resource iframe, and web-resource tabs lose state on CSW tab
switch, which is the exact defect that eliminated candidates D and E.

#### S11 result — 2026-09-10: **PASSED. Route C works; the custom page is unnecessary.**

Run in the live app, on Case `40a5d940-0ef6-f011-8406-000d3ab7be36` (5 emails, 1 thread), against
control v0.0.8 in an **unmanaged** solution (`<Managed>0</Managed>` verified before import).

**Setup built and measured**

| Artefact | Value |
|---|---|
| Form | `3c4b2679-12ad-f111-aaab-002248a422bc` — *Case - Email Client (S11 tab form)*, one tab hosting the PCF, registered with the CSW app and published |
| Route C template | `jhrb_s11_entityrecord_emailform` — page type **Entity record** (509180001), title `Email`, params `entityName={anchor.entityName}`, `entityId={anchor.incidentid}`, `formId=3c4b2679-…` |
| Route B template | `jhrb_s11_control_pcfdirect` — page type **Control** (509180003), title `Email (direct)`, params `controlName=jhrb_JHRB.CaseEmailClient`, `data={anchor.incidentid}` |

Tabs were opened with `Microsoft.Apm.createTab({ templateName })` and focused with
`Microsoft.Apm.focusTab(...)`.

**Route C — every question in the definition answered yes**

1. **CSW will show the same record twice in one session.** The session carried its anchor tab
   (*FG-2026-0022 · Metalservice Fyn ApS*) **and** a second app tab titled *Email*, the second one
   showing the same Case on the S11 form. No warning, no tab collapse, no navigation fight.
2. **The Case id arrives via `contextInfo`.** Diagnostics reported
   `case 40a5d940-0ef6-f011-8406-000d3ab7be36 · via contextInfo` and `5 messages → 1 threads` — so on
   this route the `caseId` **input property is not needed at all**. It survives in the manifest only
   for the custom-page and side-pane hosts, which now have no role.
3. **`setControlState` survives a two-session teardown in this host.** Sequence: typed the probe
   `S11-ROUTE-C-PROBE-99` into the draft field (state saved `12:32:08Z`) → focused a different Case
   session (`Xrm.Navigation.openForm` on Case `290bf70d-…`, giving `session-id-3`, at which point
   `cecRoots` was **0** — the control was genuinely torn down, not merely hidden) → focused back and
   re-selected the *Email* tab. The panel then read:

   ```
   state RESTORED · init #2 · init at 2026-09-10T12:34:05.157Z
   state saved at 2026-09-10T12:32:08.202Z
   ```

   with the input still holding `S11-ROUTE-C-PROBE-99`. Confirmed rather than assumed, as the
   definition required.
4. **Sizing behaves exactly as on the Case form tab** — `allocatedHeight -1`, `allocatedWidth 1627`,
   `rendered box: 536px high x 1627px wide (claimed 536px from viewport 1072px, top 512px)`. The
   host-aware height logic needs no new branch for this route.

**Route B — renders, but cannot be told which Case. Dead as a fallback.**

The `Control` tab template worked as a *host*: the tab opened, the PCF mounted, and it got **more**
real estate than route C (`884px high x 1676px wide`, `top 164px` — no form header or process bar
above it). But:

```
case (unresolved) · via unresolved
Error: Could not resolve the Case id.
```

`contextInfo` is empty — as expected, there is no record context — and the `data` parameter did **not**
reach the control's `caseId` property. Tested three ways, deliberately:

- `data = {anchor.incidentid}` (bare slug) → unresolved.
- `data = {"caseId":"{anchor.incidentid}"}` (JSON object, the shape the side-pane API documents) →
  unresolved.
- Belt and braces: a direct
  `Xrm.Navigation.navigateTo({ pageType:'control', controlName, data:{ caseId:'40a5d940-…' } })` with a
  **literal** GUID, no slug involved → still `via unresolved`.

So this is not a slug-substitution bug. The `Control` host does not bind input properties on this
route, which matches S2's finding that the side pane renders the control but hands it no record
context. **A host that cannot receive the Case id cannot host a Case-scoped client.** Route B is
eliminated on function, before its "internal use only" support status even matters — which is a firmer
reason than the one previously recorded.

**Consequence: the architecture simplifies from A+B to A+A.** One React PCF, two *form* placements: a
tab on the Case form, and a dedicated form opened as a session tab by an `Entity record` app tab
template. What that retires:

- the custom page and everything canvas-shaped behind it (8-hour session timeout, third-party-cookie
  requirement, app-wide connector consent dialogs);
- the **non-automatable per-environment app-designer registration** (S2's Medium-high risk) — a form is
  an ordinary solution component that ships dev → test → prod like any other;
- the `appelement` (component type 10088) cleanup tangle that cost a debugging session on 2026-09-10;
- one whole hosting technology from the maintenance surface.

What it does *not* retire: the app tab template and session template still have to exist in each
environment — but those are ordinary solution-aware Dataverse rows, not app-designer clicks.

**Artefacts removed.** [`scripts/seed/revert-s11.mjs`](../../scripts/seed/revert-s11.mjs) (dry-run by
default) deletes the two tab templates — parameters cascade with them — then unregisters, republishes
and deletes the form, then the unmanaged solution container and the custom control, then republishes.
Verified afterwards: 0 rows for each of the tab templates, the form, the control, the solution and any
spike canvas page; org email count back to its baseline **48**.

One trap worth keeping: **do not filter template parameter rows by a `jhrb_s11` uniquename prefix in
order to clean them up.** The platform creates its own parameter rows on these templates, and that
filter over-deleted them during setup. Deleting the template cascades correctly; do that instead.

### S12 — Does Dataverse sanitise the email body for us? *(added 2026-09-11)*

**Why.** Raised by the requester at design review, and it is the right question to ask: *we do not
handle raw MIME, we handle a Dataverse `email` row.* If the platform strips hostile markup on the
way in, a client-side sanitiser is redundant weight and a redundant dependency.

**Method.** Two halves, because a body arrives by two different routes.
[`scripts/spikes/s12-sanitise-probe.mjs`](../../scripts/spikes/s12-sanitise-probe.mjs), read-only by
default.

- **A — we write it.** Round-trip 17 probe blocks through `description` on a draft email: 12
  hostile, 5 that must survive because our own features depend on them. Created one draft, never
  sent, deleted immediately.
- **B — the platform writes it.** Inspect the 12 most recent genuinely received emails (30.8 KiB of
  real stored bodies) for markup a sanitiser would act on.

#### S12 result — 2026-09-11: **NO. The platform does not sanitise anything.**

**Half A — the round-trip is byte-identical.**

```
Wrote 1442 bytes, read back 1442 bytes  — IDENTICAL LENGTH
17 of 17 probe blocks survived the round-trip.
```

Every one of these went in and came back out intact: `<script>`, `<img onerror>`,
`<svg onload>`, `javascript:` href, `<iframe>`, `<object>`, a credential-harvesting `<form>`
with a password input, `<style>`, `<meta http-equiv="refresh">`, `<base href>`, a
`data:image/svg+xml` carrying script, and `target="_blank"` with no `rel`.

The five that had to survive did: `id="divRplyFwdMsg"`, `class="gmail_quote"`, a `<table>`, a
`style` attribute, and a `cid:` image reference. So the column is a faithful store — which is
exactly the problem.

**Half B — real inbound bodies carry things a sanitiser must handle.** Of 12 received emails:

| Present in real stored bodies | Count | |
|---|---:|---|
| `<style>` **tag** | **8 / 12** | Unscoped CSS: `.EmailQuote {…}`, `p.MsoNormal {…}`, `@font-face {…}` |
| `<meta>` tag | 12 / 12 | `Content-Type` charset, `Generator: Microsoft Exchange Server` |
| `style` attribute | 12 / 12 | expected, must keep |
| `class` attribute | 10 / 12 | expected, must keep |
| `id` attribute | 6 / 12 | expected, must keep |
| `<table>` | 5 / 12 | expected, must keep |
| `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `javascript:`, `data:` SVG, `position:fixed` | 0 / 12 | — |

The zeroes prove nothing on their own: these are twelve legitimate business emails, and their not
containing a script is not evidence the platform would have removed one. Half A is what settles
that, and it settles it the other way.

**Correction to my own first pass.** I initially reported event-handler attributes in 12/12 bodies.
That was a bug in my probe, not a finding: the pattern `on\w+\s*=\s*["']` matches `content="` as
`ontent="`, so every Exchange body false-positived. With a word boundary the real count is **0/12**.
The word boundary is now in the script with a comment explaining why it must stay.

**Two consequences beyond "we still need to sanitise".**

1. **Bodies are whole HTML documents, not fragments.** `<html><head><meta><style>…</style></head><body>…`
   is the normal shape. Injecting that into a `<div>` hoists the `<head>` content into the host
   page, and 8 of 12 real bodies carry unscoped rules like `p.MsoNormal { margin: 0 }` and
   `.EmailQuote { border-left: #800000 2px solid }` that would then restyle the Dynamics chrome
   around us. **Forbidding the `<style>` tag is not a theoretical hardening measure — it is
   required by the data that is already in the environment.**
2. **The quote-splitting heuristic has to survive `<style>` blocks.** A sender's stylesheet
   mentioning `-----original message-----` or `gmail_quote` inside a CSS comment will steer the
   split. That is now a pinned test in `domain/__tests__/quoting.test.ts` documenting the known
   false positive, and it is the strongest argument for re-implementing the split against a parsed
   DOM once sanitising guarantees well-formed markup.

**What the platform presumably does instead** is sanitise at *render* time inside its own controls —
Timeline renders these bodies without executing them. That does not help us: we render the body
ourselves, so the sanitising is ours to do. Confirmed by measurement rather than assumed, which is
what the question deserved.

**Artefact removed.** The one draft email created by half A was deleted in the same run
(`Deleted draft 5e45a3e4-c8ad-f111-aaab-0022489d55b0 -> ok`). Nothing was sent.

### Phase 0 deploy verification — *(2026-09-11)*

Not a spike: the first deployment of the real control, recorded here because it measured three
things and **corrected two** design assumptions.

Control `jhrb_JHRB.CaseEmailClient` v1.0.1, unmanaged solution `JHRBCaseEmailClient`, on a dedicated
Case form (`Case - Email Client`) registered with the CSW app. Read from the **published app** —
Studio reports "Method not implemented" for data calls and hands out a dummy case id, so nothing it
says counts.

**Confirmed as designed**

| Fact | Reading |
|---|---|
| `allocatedHeight` | **−1**, so height must be claimed from the viewport |
| Case id | `40a5d940-0ef6-f011-8406-000d3ab7be36`, correct |
| Source of the id | **`contextInfo`** — the form-host path both placements rely on |
| Sanitiser | **available** — DOMPurify runs in the real host |
| `setControlState` round-trip | **`init #2`, `state RESTORED`, probe `PHASE0-STATE-PROBE-42` intact** after a real two-session teardown, with the control verifiably unmounted in between |

**Correction 1: width must be claimed as well as height.** Setting `height` and leaving width to
inherit produced a control **588px wide inside a full-width tab** — the subgrid cell's ancestors
content-size their child, exactly as S1 found for height. Fixed with `width: 100%`; re-measured at
1354px, matching `allocatedWidth`. The rule is now **claim both dimensions, inherit neither**, and
it is commented in the code so it is not learned a third time.

**Correction 2: the height budget is a range, not 536px.** Three readings from the same form:

| Chrome showing | `allocatedWidth` | Top edge | Height claimed |
|---|---:|---:|---:|
| Copilot pane, process bar | 1354 | 455px | 531px |
| Copilot pane, process bar collapsed | 1354 | 325px | **661px** |
| Customer Details pane, process bar | 1414 | 515px | **471px** |

536 was a valid reading of one configuration, not a constant. The real floor is **471px high and
1354px wide**, because agents work with a side pane open. [`03-interaction-spec.md`](../design/03-interaction-spec.md#1-the-height-budget--binding)
has been rewritten around the floor; the scroll region shrinks from 404px to **339px** in the worst
case, which is about five collapsed thread rows.

**One half not tested live.** Cross-session *bleed* — case Y must never show case X's state — was not
exercised, because the second session opened on the standard Case form, which does not host the
control. The guard (discard restored state whose `caseId` does not match) is unit-tested in
`host/__tests__/caseId.test.ts` and implemented in `index.ts`, but the live half needs the email
form on two cases at once. Worth doing when the session template exists.

**Deployed and left in place**, deliberately — this is the product now, not a spike:
control v1.0.1, solution `JHRBCaseEmailClient` (unmanaged, verified `<Managed>0</Managed>` before
import), and form `729d9197-cdad-f111-aaac-000d3ab163fb`. Removable with
[`scripts/deploy/revert-deploy.mjs`](../../scripts/deploy/revert-deploy.mjs) (dry-run by default).

### R6 read-state table — `jhrb_emailreadstate` *(2026-09-11)*

Created for R6's **durable, per-agent** read state. Until now read state lived only in
`setControlState`, so it survived a session switch but not a browser restart.

Created by [`scripts/deploy/create-readstate-table.mjs`](../../scripts/deploy/create-readstate-table.mjs),
removable by [`revert-readstate-table.mjs`](../../scripts/deploy/revert-readstate-table.mjs) (both
dry-run by default). Verified from environment metadata, not from the script's own output.

| Component | Value |
|---|---|
| Table | `jhrb_emailreadstate`, **UserOwned**, set name `jhrb_emailreadstates` |
| `jhrb_emailid` | Lookup → `email`, delete **Cascade** |
| `jhrb_userid` | Lookup → `systemuser`, delete RemoveLink |
| `jhrb_caseid` | Lookup → `incident`, delete RemoveLink — **denormalised on purpose** |
| `jhrb_readon` | DateTime, UserLocal |
| `jhrb_emailperagent` | Alternate key on (`jhrb_emailid`, `jhrb_userid`) — status **Active** |

**Why a table and not a column on `email`:** R6 is per-*agent*. A column on `email` is single-valued
org-wide, so the first agent to open a message would mark it read for everyone. UserOwned also means
Dataverse's own security trims each agent to their own rows — the isolation is free rather than
filtered-and-hoped-for.

**Why the `incident` lookup is there at all:** without it, read state for a case means one query per
message. With it, the client fetches one page filtered by case + user. On a 50-message case that is
the difference between 1 request and 50.

#### Five things measured, each of which cost a failed attempt

1. **`IsValidForQueue` / `IsDuplicateDetectionEnabled` are `BooleanManagedProperty`, not booleans.**
   Sending either as `false` on create returns a bare OData *"A 'PrimitiveValue' node with non-null
   value was found…"* that names neither field. Both default to false on a custom table — omit them.
2. **The metadata cache lags table creation by seconds.** `POST EntityDefinitions` returns 201 with a
   MetadataId, and for several seconds afterwards every request touching that table fails —
   *"was not found in the MetadataCache.LazyDynamicMetadataCache"*, or on `/Attributes` just
   *"An unexpected error occurred."* The first run therefore created the table and then failed all
   four columns. The script now retries these two messages with a backoff.
3. **A table gets exactly ONE parental relationship.** `email` took it, so a second `Cascade` lookup
   is refused: *"Cannot create another parental relation with Entity: Incident"*. Nothing is lost —
   deleting a case already cascades to its emails, and each of those cascades to its read-state rows.
4. **A lookup's navigation property is PascalCase from the SchemaName, not the column name.** The
   `@odata.bind` keys are **`jhrb_EmailId` / `jhrb_UserId` / `jhrb_CaseId`**, not `jhrb_emailid`. Using
   the logical name returns the same anonymous *"Error identified in Payload"* as (1) — it does not
   tell you which property it disliked. Read
   `ReferencingEntityNavigationPropertyName` off `RelationshipDefinitions` rather than guessing.
5. **The alternate key in a URI takes the lookup's `_value` form.** `jhrb_emailreadstates(jhrb_emailid=…)`
   fails with *"The key in the request URI is not valid"*; `(_jhrb_emailid_value=…,_jhrb_userid_value=…)`
   works.

#### Functional probe — passed, rows cleaned up afterwards

| Operation | Result |
|---|---|
| Create a row against a real email + case | **204** |
| Create the identical row again | **412** — *"Entity Key One row per email per agent violated"* |
| Read `$filter=_jhrb_caseid_value eq <case> and _jhrb_userid_value eq <me>` | **200**, 1 row |
| `PATCH jhrb_emailreadstates(_jhrb_emailid_value=…,_jhrb_userid_value=…)` | **204** |

That last row is the useful one: **upsert by alternate key means mark-read is a single PATCH with no
read first.** The client never has to ask whether a row exists — which matters, because the dwell
timer fires per message as the agent scrolls.

Both probe rows were deleted; the table is left empty (verified: 0 rows).

#### The table alone does not make the feature work — privileges do

**A newly created custom table grants privileges to nobody** except System Administrator and System
Customizer. So read state works perfectly for an admin and fails for every real agent, whose first
mark-read is refused. Worse, it fails *quietly by design*: the client treats read state as an
ornament on a list of mail, so a refused write surfaces as one notice rather than an error. Exactly
the kind of thing that passes a developer's test and is noticed in production.

[`create-readstate-role.mjs`](../../scripts/deploy/create-readstate-role.mjs) creates a purpose-built
role — **not** an edit to `Customer Service Representative`, because this is a shared environment and
adding privileges to an out-of-the-box role changes what every other demo in it can do and carries
that edit downstream.

| | |
|---|---|
| Role | `Case Email Client — Read State`, root business unit |
| Privileges | Create, Read, Write, Delete, **Append, AppendTo** |
| Depth | **User (1)** — an agent may touch their own read state and nobody else's |
| Not granted | Share, Assign. Read state is nobody's to hand around |

Two things measured here:

- **`Append` / `AppendTo` are needed, not optional.** The row carries three lookups, and writing one
  is an *append*; without them a create is refused on privileges even with Create granted.
- **Privilege names are built from the table's SchemaName, not its logical name** —
  `prvCreatejhrb_EmailReadState`. And because Dataverse's OData string comparison is
  case-insensitive, a filter on the logical spelling still **matches**: the first run fetched all
  four privileges and then reported every one as missing, because the returned `name` no longer
  equalled the string composed to find it. Match case-insensitively, or read the names off the rows.

**Assigning the role to agents is deliberately not automated** — who gets it is a decision about
people, not a deployment detail. That is a second manual per-environment step alongside registering
the form with the CSW app, and belongs in the N3 runbook deviation.

One more thing the API got wrong in a way that named nothing: `AddPrivilegesRole` takes `Depth` as
the **PrivilegeDepth enum by name** (`Basic` / `Local` / `Deep` / `Global`). Passing the numeric
mask (1/2/4/8) that the same concept uses elsewhere is rejected with *"Cannot read the value '1' as
a quoted JSON string"* — a message that mentions neither depth, privileges nor the role. Also note
Dataverse adds **9 baseline privileges** (SDK message and SharePoint reads) to every new role, so
the role carries 15 while we asked for 6; the script now reports the two groups separately, and
verifies the depth through `RetrieveRolePrivilegesRole`, because the association endpoint does not
return it.

#### R6 verified end to end in the published app — 2026-09-22

Walked on case `CAS-01021-T1P3C2`, a real 5-message thread (1 incoming, 4 outgoing), control v1.2.2.

| Step | Result |
|---|---|
| Open the Email tab | Thread list renders, 5 messages grouped into 1 thread, `1 unread`, Draft badge, attachment marker |
| Select the thread | Opens the **incoming** message, expanded, body rendered |
| Dwell | Exactly **one** row written, for the incoming message only |
| **Full page reload** | Badge gone, group header reads *Earlier* not *Unread*, no unread dot |

That last row is the whole point: a fresh page load is a brand-new control instance with no
`setControlState` to restore from, so it is the case the old mechanism could never survive.

**The published app found two bugs the 232 unit tests did not.** Both are now in `domain/unread.ts`
with tests, and both were invisible until real data with a real direction mix went through it:

1. **"Unread" meant two different things in one component.** The list badge and the thread summary
   restricted unread to *incoming* mail; the per-message state and the "open the newest unread
   message" selection did not. So the pane treated the agent's own four sent replies as waiting to
   be read, auto-expanded the newest one, and wrote a read-state row for it — **one useless row per
   outgoing message per agent**, on a table that grows with every reply. Every reload marked one
   more. The rule now lives in one function used by all four call sites.
2. **The fold could hide the message it had just chosen to open.** A thread shows its last three
   messages and collapses the rest, but the only unread message here was the *oldest*. Selecting
   the thread expanded it and then folded it out of sight, so the thread opened showing **nothing**.
   `collapsedOlderCount` never folds past the message being opened.

Two smaller observations, neither fixed:

- The unread badge **flashes the pre-read-state count** for about a second on load, because read
  state is fetched after the list. That ordering is deliberate — the mail must never wait on an
  ornament — but the flash is visible and worth designing away later.
- The **tab hang recurred** (script injection times out while the tab is otherwise alive) and was
  again cleared by opening a fresh tab. Still no evidence it is our code: a new tab on the same
  build works immediately.

### R7 filter and search — *(2026-09-22, v1.3.1)*

Built and verified in the published app. The starting point was worse than "not built": the list
rendered a search box, a filter button and a compose button, and **none of them did anything** — the
search "field" was a `<span>`. Three dead controls, which by this project's own standard is worse
than their absence.

| Control | Now |
|---|---|
| Search | Real input over **subject and participant names/addresses**, all terms required (AND) |
| Filter panel | Has-attachment, unread-only, participant, date from/to — inline, not a popover |
| Chips | One per active clause, each removable, one line that scrolls rather than wraps |
| Compose `+` | **Greyed and inert**, labelled *"New email — not built yet"* |

**What search cannot do, and why the UI says so.** Message bodies are not searched: they are
deliberately absent from the list query (blob storage, N5), and `$filter` on `description` is
unsupported by the platform anyway — body search is Dataverse search, a different path. So the field
carries the line *"Searches subject and participants — not message text"*. Without it, an agent who
searches a phrase they remember from a message and gets nothing concludes the mail is not on the
case, which is the worst failure available to a search feature because it is invisible.

Two deliberate design choices worth knowing:

- **A matching thread is kept whole.** Filtering individual messages out of a surviving thread would
  hide the reply that quotes the match, making the result misleading rather than focused.
- **A filter that hides the open thread does not close it.** The reading pane keeps showing it; the
  list stops listing it and the chips say why. Losing your place for having narrowed the list beside
  it would be a strange punishment.

Verified live: zero-results states the real total (*"This case has 1 thread. They are hidden by the
filters, not missing"*); multi-term AND works across fields (`jehrbo ordre` — one term from a
participant, one from the subject); chips remove individually and restore the list; `Unread only`
correctly matched nothing once the incoming message had been read.

**The published app again found two defects the unit tests could not**, both purely about the DOM:

1. **The search field had two ✕ buttons.** Chrome renders its own clear button inside
   `type="search"`, next to ours. Changed to `type="text"` — ours is kept because the native one is
   unstyleable and absent in Firefox, so relying on it would give different agents different
   controls.
2. **The participant dropdown listed strings, not people.** Built from the same list that free-text
   search matches against, it offered *"Care"* and *"caredemo@…onmicrosoft.com"* as two separate
   choices for one person — six entries for four people. The index now exposes two views:
   `searchable` (names **and** addresses, so searching a domain still finds the thread) and `people`
   (one display name each, for the panel and for exact matching). Down to four entries.

### R8 parent-case mail and N7 dark theme — *(2026-09-22, v1.4.1)*

Both verified together in the published app, which turned out to be the efficient order: the R8
markings are warn-toned surfaces, and dark theme is where warn-toned surfaces go wrong.

#### R8 — include parent case

The three markings the design demands (*"one marker is not enough"*) were **already built** in
`ThreadList`; what was missing was the data. Added `fetchAncestry` (walks `parentcaseid`) and
`buildListQueryForCases` (one request across the case and its ancestors, rather than one per case),
and `EmailRow` now carries `regardingCaseId` so a thread knows which case it came from.

| | |
|---|---|
| Toggle | In the filter panel, below a rule — it is not a filter, it fetches more |
| Persisted | Yes, through `setControlState`: a standing choice about what the list is *for* |
| Markings | Group header *"Parent case CAS-01016-C3Y9M9"*, gold left edge, per-row case badge, footer link |

Two things worth knowing:

- **The ancestry walk is capped and cycle-guarded.** `parentcaseid` is an ordinary lookup; nothing
  stops an import or a plugin pointing two cases at each other, and an uncapped walk would hang the
  control *on load* — the most expensive place to discover it. It also stops if a case reappears,
  which catches a cycle sooner than the cap.
- **A failed ancestry walk falls back to this case's own mail**, not to an error. A broken parent
  link must not cost the agent the case they are actually looking at.

**Verification needed a data change, because no case in this environment has a parent** — R8 was
literally unverifiable as the data stood. [`r8-parent-link.mjs`](../../scripts/spikes/r8-parent-link.mjs)
sets and clears `parentcaseid` on the verification case: one lookup field, on one case, previously
null. Set → verified (2 threads, all four markings present) → cleared. Confirmed afterwards by
query: **0 cases environment-wide have a parent, as before.**

#### N7 — dark theme

Implemented as **CSS custom properties**, not a React context. `T.bg1` is now `var(--cec-bg1)` and
the root element sets 60-odd variables for the active mode. The alternative was threading a theme
object through ~200 inline-style sites across six files, which is a large mechanical change with a
bug in every place it was missed.

- **The mode follows the HOST, not the OS.** N7 is "consistent with the surrounding app", so an
  agent who set Dynamics to dark gets this dark whatever their OS says. OS preference is the
  fallback; light is the last resort, because the control has always rendered light and an unknown
  host should keep today's behaviour rather than flip on a guess.
- **The host theme is read by measuring its background**, not by an `isDark` flag — there is no
  documented flag, and a custom Dynamics theme need not call itself dark. `fluentDesignLanguage` is
  not in `@types/powerapps-component-framework` ^1.3.16, so it is read through a narrow shim, the
  same treatment as `contextInfo`.
- **The sender's body stays on a literal white card**, per the frozen decision. Verified in dark
  theme: exactly **one** white surface remained in the whole control, and it was the body card.

### Issue #4 — expandable conversations in the thread list — *(2026-09-22, v1.5.1)*

Outlook-style: a conversation expands **in the list** into one row per message, and clicking a
message row opens that message. Built and verified in the published app.

The load-bearing change is not the UI, it is
[`domain/listRows.ts`](../../pcf/CaseEmailClient/domain/listRows.ts): **the list is now one flat
sequence of rows**, built once and read by both rendering and keyboard navigation. The order was
already spelled out three times across three `.map()` calls and would have become six with child
rows — two descriptions of the same order that drift apart. Group headers are rows too, but not
focusable, so arrow keys step over them.

| Decision | Choice, and why |
|---|---|
| Reading pane | **Keeps the stack** (option (b) in the issue) and scrolls to the chosen message. A strictly single-message pane would move the R6 dwell trigger, and R6 is the requirement most recently and expensively made to work |
| Clicking a conversation row | **Toggles expansion.** `Enter` still selects without expanding; a single-message conversation selects, since there is nothing to expand |
| Keyboard | `↑↓` walk into and out of children, `→` expands, `←` collapses (and from a child, moves focus to its header first), `Space` toggles, `Enter` selects |
| First load | Expands the one conversation holding the message worth landing on, and opens it |
| Persistence | Expansion and the selected message go through `setControlState` — session UI state, not durable |

**One behaviour change worth flagging rather than burying.** First load now *opens* a message, so
the dwell timer marks it read shortly after the case opens, without the agent clicking anything.
That follows from landing on it — expanded and on screen is exactly what Gate 2 defined as read —
but it did not happen before, when the pane started empty. If it proves too eager the fix is to
land without selecting, **not** to weaken the dwell rule.

Verified live on CAS-01021-T1P3C2 (5 messages): first load expanded the conversation and opened the
incoming January message; clicking the last child row selected it (`Message 5 of 5. Sent to Care,
11-06-2026 14:58. Has attachments.`) and the pane switched to it with the older two folded;
clicking the header collapsed to 0 child rows while the pane kept the conversation; clicking again
re-expanded with the selection intact.

#### Follow-up: both panes select — *(v1.5.3)*

Once conversations expanded in the list, selection was **one-way**. Clicking a message in the
reading pane expanded it but told the list nothing, so the list kept highlighting whatever was
picked last and the two panes disagreed about what was being read — and the list is where you look
to answer *"where am I?"*. Selection is now one fact:

- **Expanding a message in the pane selects it**; the matching list row highlights.
- **Collapsing the selected message clears the selection**, handing the highlight back to the
  conversation row.
- It deliberately does **not** expand the conversation in the list. If you collapsed it there to
  save room, having it spring open on every click in the pane is the client arguing with you.
- The **whole header strip** is now the click target, not just the 14px "Email from: X" link — a
  small link inside a 60px row is something you have to aim at. The handler skips clicks that
  landed on a real control, so the sender link and the Reply/Forward buttons keep their own
  meaning; verified in the app that the link fires exactly one toggle (`false → true`, not a
  double-fire back to `false`).

#### Follow-up: sort order, and the arrow that did nothing — *(v1.5.5)*

| Reported | What was actually true |
|---|---|
| "Left pane is oldest to newest" | **True for the messages inside a conversation** — I had matched the reading pane's chronological order, and that was wrong for a list |
| "Conversation with the newest mail should be on top" | **Already the case.** `buildThreads` sorts by most recent activity. What can look wrong is the *grouping*: Unread comes before Earlier, so an older unread conversation sits above a newer read one |
| "Can't figure out if the 'Earlier' with an arrow is the sort order" | **Neither.** The chevron in `GroupHeader` had no click handler at all — not a sort control, not a collapse. It read as an affordance and had none |

So: child rows now render **newest first**, `thread.messages` stays chronological (the reading pane
stacks that same array, and reversing in place would have flipped it silently — there is a test for
that), and `position` stays chronological so *"Message 5 of 5"* means the fifth message sent, not
the fifth row down.

The decorative chevron is **removed**. A group label is not an expander, and the first person to
look at the list asked what it was for — which is the whole argument against it. If collapsible
groups are wanted later, make the entire header a real button rather than putting the arrow back.

**A latent keyboard bug fell out of looking at this.** `moveFocus` did
`querySelectorAll('[data-list-row]')[next]`, indexing the DOM by the row's index in the flat array —
but group headers *are* rows in that array and carry no `data-list-row`, so every index past the
first header pointed at the wrong element and scrolled somewhere arbitrary. Rows are now addressed
by `data-row-id`, which cannot drift out of step with the array the way two parallel orders can.

Verified live once the case had two conversations (it had only one before, so conversation ordering
had never actually been observable): *Test af ny mail tråd* (22-09 14:07) above *Forespørgsel på
ordrestatus* (11-06 14:58), children 14:07 above 14:04, and the `Earlier | 2` header containing
zero SVGs.

Also matched the child rows' separator to the reading pane's: both were already using `T.stroke3`,
but the new message rows had **no** `border-top` at all, so they ran together into a block while
the pane's messages were cleanly divided. All three row types now compute to the identical
`1px solid rgb(240, 240, 240)`.

Two things the build caught on the way: the **"Unread" group header was silently dropped** when the
three `.map()` calls were replaced (the tests I had just written encoded my mistake rather than the
existing UI, and had to be corrected to match it); and `dotnet build -c Debug` **did not rebuild the
PCF bundle** — it packaged the previous version while reporting success, so the first "deployment"
shipped nothing. `npm run build` in `pcf/` then `dotnet build -t:Rebuild` is the reliable pair, and
the packaged `ControlManifest.xml` version is worth checking before believing an import.

**Dark theme found 13 bugs that light theme cannot show.** Thirteen hardcoded hex colours across
five components — `#fffbe6`, `#faf9f8`, `#f2c811`, `#3b3a39`, `#c8c6c4`, `#fdf6f6`, `#eec7c8`,
`#a4262c` — each of which looks perfect in light theme and cannot follow the variables. Three were
caught by applying the dark palette in the browser and scanning computed backgrounds; the other ten
were in elements that scan never rendered (the error notice, the empty states, the borrowed-thread
edge) and needed a source grep. Two new tokens came out of it — `warnBg2` for large warn surfaces
and `parentEdge` for the borrowed-thread edge — and there is now a **test that greps the components
for hex literals**, because this class of bug is invisible in the theme you develop in.


### S13 — editor bundle cost (Phase 2.0 gate) — *(2026-09-23)*

The last open technical item from research. The platform's own editor is not reusable from a PCF
(S10), so one must be bundled; React 16.14 rules out every React binding, leaving three
framework-agnostic cores. Bundle cost was unmeasured.

**Method.** Measured in the **real PCF build**, not a synthetic harness: same webpack 5.110.3, same
Babel, same minifier, same shared dependencies. A throwaway probe exercised what R11/R12 actually
need — mount into a div, a real schema (bold/italic/lists), **HTML in and HTML out** — because a
bare `import` measures nothing once tree-shaking runs. Each candidate was built with
`pcf-scripts build --buildMode production`, then gzipped at `-9`. The probe and the installs were
removed afterwards; the tree is back to its committed state.

**First correction: the baseline was not what it looked like.** `dotnet build -c Debug` — the
command this project has used all along — produces a **development** bundle: eval devtool,
unminified, 410 KB raw / 102 KiB gzipped. The production bundle is **111,688 raw / 33,568 gzipped
(32.8 KiB)**. Every deploy to the demo environment this far has shipped the dev bundle. Fine for a
dev environment, but any performance claim must use the production number.

**The numbers**, gzipped, baseline 33,593 (identical under both tsconfigs tested, so the comparison
is clean):

| Candidate | Version | Bundle gz | **Delta** | Plus CSS |
|---|---|---:|---:|---:|
| *(baseline, no editor)* | — | 33,593 | — | — |
| **Quill** | 2.0.3 | 93,322 | **+58.3 KiB** | +3.7 KiB (`quill.snow.css`, required) |
| **Lexical** | 0.50.0 | 103,052 | **+67.8 KiB** | none — styling is ours |
| **TipTap / ProseMirror** | 2.27.3 | 124,237 | **+88.5 KiB** | none — styling is ours |

For scale: the cheapest option **nearly triples** the control's shipping size, and the dearest
**almost quadruples** it.

**Second finding, and it is not about size: two of the three do not build in a stock PCF.**

- **TipTap 3.31.3 fails outright.** Its extension packages carry an `@jsxImportSource` pragma and
  pcf-scripts' Babel runs JSX in `classic` runtime: *"importSource cannot be set when runtime is
  classic"*, on `extension-blockquote` and `extension-bold`. **TipTap 2.27.3 builds on the stock
  config unchanged**, which is why it is the version measured — but it pins us to a major version
  behind.
- **Lexical needs a build-config change.** Its types sit behind an `exports` map, and the PCF build
  tsconfig inherits `moduleResolution: "node"` from `pcf-scripts/tsconfig_base.json`, which cannot
  read one. Every Lexical symbol resolves to an error type and the lint step fails with 16
  `no-unsafe-*` errors. Bundling itself is fine; switching the control build to
  `moduleResolution: "bundler"` fixes it, but that changes resolution for the whole control.
- **Quill 2.0.3 built clean, first try, on the stock config.**

**Third: size is not the only axis, and the cheapest is the weakest where it matters.** R12 depends
on *controlled HTML output* — we must be able to predict and constrain what the editor emits,
because the inherited quote is concatenated verbatim and the result has to survive re-splitting.
TipTap and Lexical are schema-based: the document is a tree we define and serialise. Quill is
Delta-based and `root.innerHTML` returns whatever the DOM happens to hold, which is looser exactly
where R12 is strictest.

So the trade is real rather than a ranking:

| | Size | Builds stock | Controlled output (R12) |
|---|---|---|---|
| Quill | **best** (+58 KiB, +CSS) | **yes** | weakest |
| Lexical | middle (+68 KiB) | no — needs `moduleResolution` change | good |
| TipTap 2 | worst (+88 KiB) | **yes**, but a major version behind | **best** |

**Decided: TipTap 2** (2026-09-23). The extra ~30 KiB over Quill buys R12's controlled output — the
requirement most likely to generate bugs — and TipTap 2 is the only schema-based option that builds
on the stock config. The v3 block is a known forward cost, accepted: `@tiptap/core`, `@tiptap/pm`
and `@tiptap/starter-kit` are pinned `^2` and must not be moved to 3 without first solving the
Babel `classic` runtime conflict.

Installed as real dependencies the same day, followed immediately by R12's invariant in
`domain/compose.ts` — written and tested **before any compose UI exists**, which is the order the
plan demands for the build's largest functional risk.

### Phase 2.1 — the compose surface — *(2026-09-23, v1.6.1)*

R9 (recipients), R10 (docked, in place) and R11 (the editor) built and verified in the published
app. R14 (templates) and R15 (signature) are still to come; the toolbar renders **disabled**
rather than present-and-inert, the same standard applied to the compose `+` in the thread list.

**TipTap 2 mounts and edits inside a PCF.** That was the open risk after S13 — measuring a bundle
is not the same as the thing working in the host. Verified live: `.ProseMirror` present,
`contenteditable="true"`, real text typed and read back. Mounted imperatively into a ref'd div and
destroyed on unmount; `@tiptap/react` is unusable on the platform's React 16.14.

| Verified live | Result |
|---|---|
| Compose opens docked | 222px exactly, reading pane still visible above it |
| Recipients (R9) | To = the incoming sender; **Care (us) excluded** |
| Subject | `Re: Test af ny mail tråd` — prefix not stacked, tracking token stripped |
| Growth (R10) | 222 → 326px as text was typed, under the 380 ceiling |
| **Never shrinks** | Deleted every character: stayed at **326px** |
| Quote | Folded, read-only, header + original body, below the editor |
| Send | Blocked **with its reason**, not a mystery grey button |

#### The bundle cost more than S13 predicted, and the gap is explained

Production gzipped: **145.4 KiB** against a predicted 124.2 KiB. Investigated rather than
shrugged at, because the editor was chosen partly on size:

- **`@tiptap/extension-link` costs 17 KiB gzipped** (it pulls `linkifyjs`). Measured by building
  with and without: 145,419 → 128,344.
- **`autolink: false` saves nothing** — 4 bytes, noise. linkifyjs is imported at module scope, so
  it bundles whatever the configuration says. The choice is binary: Link or no Link.
- The remaining ~4 KiB is the compose code itself, which means **S13's 88.5 KiB figure for TipTap
  held**; the overage is entirely the extension the probe did not include.

Link is **kept**: a URL that arrives as dead text in a support reply looks broken to the customer,
and receiving clients cannot be relied on to linkify. Worth revisiting if size becomes a gate —
it is half the size of the entire reading slice.

#### Two bugs, one from the tests and one only the app could show

- **`stripQuoteMarkers` renamed the marker to `divRplyFwdMsg-quoted`**, which still *contains*
  the marker — the splitter matches on substring, so it still cut in the wrong place. The unit
  test caught it on first run. The assertions were then rewritten to check the *behaviour* (the
  splitter no longer matches) rather than the replacement string, because the string assertion
  would have passed the broken version.
- **The reply subject carried the tracking token forward** — `Re: Test af ny mail tråd
  CRM:0100012` — and the platform appends a *fresh* one on send, so the sent subject would have
  carried two. Only visible in the app, because the token is added by the platform and never
  appears in a fixture. `stripTrackingToken` is now exported from `threading.ts`: token only,
  preserving case and prefix, where `normaliseSubject` lower-cases and strips prefixes too and is
  therefore wrong for anything an agent reads.
  **REVERSED 2026-09-29:** the product owner requires that the client never remove a tracking
  token from a subject. `composeSubject` now carries the token forward verbatim and
  `stripTrackingToken` was deleted. The premise was wrong as well: per the product owner, when the
  subject already carries a token the organisation knows, the platform leaves it and appends none.
  A subject with two tokens is mail that passed through another Dynamics system — each system's
  token is its own correlation, and neither is ours to remove.

#### Interim, and now replaced — 2026-09-24

`ourAddresses` — the set that keeps us out of To and Cc — **was** derived from the senders of
outgoing mail already on the case. It cost no query and was right in practice, but it was empty on
a case nobody had replied to and wrong on one where an earlier reply went out from a different
queue.

It is now `selfAddresses(senderState.candidates)` — the resolved sending identities themselves,
which pre-flight was already fetching. Every candidate counts, not just the chosen one, so an
agent who switches the From picker does not find themselves in their own To line.

#### What the sender work found — 2026-09-24

Measured read-only against the demo environment while building 2.4b:

| Fact | Detail |
|---|---|
| `queue.emailsignature` | A real Lookup (SchemaName `EmailSignature`, target `emailsignature`). This is how a queue signature is stored. `systemuser` has **no** equivalent lookup — a user's is an `emailsignature` row they own |
| Care queue | `23b1c48e-1ff2-f011-8406-7ced8d2e4880`, approval **1**, mailbox outgoing **1** (Success) |
| The agent's own mailbox | `outgoingemailstatus` **0** (Not Run) → pre-flight genuinely blocks "send as me" here, which makes the Gate 2 block-Send decision testable rather than hypothetical |
| Org | `requireapprovalforqueueemail` and `requireapprovalforuseremail` both **true** |
| `queueitem.objecttypecode` | **`Edm.Int32`.** A string comparison fails with *"A binary operator with incompatible types was detected"* |
| `jhrb_queuesetting` | Exists (a separate customisation) with one active row whose `jhrb_queue` points at a queue that is **not** Care, so only its default-row fallback fires. Read by nothing in this product |

**The one that cost a release.** The environment contains **exactly one `emailsignature` row**,
and it is simultaneously the row the agent owns and the row the Care queue points at. R15 was
verified on v1.7.0 by seeing the right signature appear — which proved nothing, because both code
paths returned the same record. The client was in fact fetching the *agent's* signature and would
have signed queue mail as the individual the moment a second signature existed. Anyone re-testing
signature behaviour must create a second signature first.

#### How the fix was actually proved — 2026-09-24, v1.8.1 in the published app

Because one record served both paths, "the right signature appeared" could not distinguish them.
So the paths were forced apart:

1. A throwaway `emailsignature` was created owned by the agent, body `PROBE-USER-PATH-SIGNATURE`,
   and set `isdefault = true`. The **user** path orders `isdefault desc`, so it would now return
   the probe; the **queue** path follows `queue.emailsignature`, which still pointed at Care.
2. Reply was opened on a Case in the Care queue.
3. Compose showed **"Venlig hilsen / Simon / Customer Care"** — the Care signature — *not* the
   probe. The queue path ran.
4. The probe was deleted. Verified afterwards: one signature remains, `isdefault = false`, as
   before.

Also confirmed in the same pass: `From` read
`Care <care@example.invalid>`, resolved from `queueitem` and the settings row;
and the picker listed the agent as a second candidate flagged **"— cannot send"**, because their
mailbox has `outgoingemailstatus = 0`. That is R18 blocking on real environment state rather than
on a contrived one.

**One design change came out of this.** Blocked candidates were first rendered as `disabled`
`<option>`s — and a disabled option cannot be selected, hovered or read out, so the *reason*, which
Gate 2 exists to surface, was unreachable. They are now selectable: choosing one puts the full
reason on the Send row, and Send stays blocked throughout.

**And a correction to an earlier note.** v1.7.1 was recorded as "does not mount in the published
app". It mounts. The control simply takes longer to load than the observation allowed — the same
misreading that had already been flagged once in this project. Nothing was wrong with 1.7.1.

### S9 — Template and signature instantiation

Call `InstantiateTemplate` for a Case-scoped template and resolve the user's default `emailsignature`.

**Confirms / breaks:** RQ9 / R14 / R15 — that tokens resolve correctly against the Case and contact
outside the OOB email form.

## Recommended order

1. **S1** — cheapest, most informative, and holds the one genuinely undocumented question.
2. **S6, S7** — highest risk of nasty surprise; both gate the decision.
3. S8, S9, S2, S5 — confirm the rest of the design.
4. S3, S4 — only if the MUST set is relaxed.

## Results

*(Empty — no spike has run. Each spike gets an outcome line here, including dead ends. A dead end is a
finding and must be recorded, not discarded.)*

| Spike | Date | Outcome | Notes |
|---|---|---|---|
| S1 | 2026-09-10 | **PASSED** — `setControlState` survives a real two-session teardown; no bleed | RQ1 corrected: a subgrid cell is content-sized, height must be claimed. `regardingobjecttypecode` is not queryable in OData. See [result](#s1-result--2026-09-10-passed-observed-in-the-live-app) |
| S2 | 2026-09-10 | **PASSED** — `setControlState` survives inside a custom page too; `caseId` param binding works | Registration needs the app designer (not automatable). Side pane renders but has no record context. See [result](#s2-result--2026-09-10-passed-both-halves) |
| S3 | — | **Not run** — P7 unverified; also deprioritised | |
| S4 | — | **Not run** — deprioritised, candidate eliminated on documented facts | |
| S5 | — | **Not run** — P1–P2 unverified | |
| S6 | 2026-09-10 | **PASSED** — inline capped at 5 MB (clean 400); chunked ignores the cap (40 MB OK) | Corrects `04`. Also: `context.webAPI` has no `execute`, so chunked upload needs `Xrm.WebApi.online.execute`. 90 MB of test data cleaned up. See [result](#s6-result--2026-09-10-passed-and-it-corrects-the-data-model-doc) |
| S7 | 2026-09-10 | **PASSED** — real send from the Care queue, receipt confirmed | Broke 2 assumptions: platform overwrites the conversation hash on send, and appends the tracking token to the subject (`normaliseSubject` fixed). R18 approval guard still untested. See [result](#s7-result--2026-09-10-sent-successfully-and-it-broke-two-of-my-own-assumptions) |
| S8 | 2026-09-09 | **Partial — grouping half validated; nesting half permanently needs synced mail** | Read-only measurement, then seed data created. 3 corrections to `04`. See [result](#s8-result-partial--2026-09-09) and [follow-up](#s8-follow-up--seed-data-created-2026-09-09) |
| S9 | — | **Not run** | |
| S10 | 2026-09-10 | **Answered — NEGATIVE.** Platform RTE not reusable from a PCF | `factory.createComponent`/`bindDOMComponent` exist at runtime (untyped) and mount the control, but it stays inert — 0 `contenteditable`. R11 needs a bundled editor. See [result](#s10-result--2026-09-10-no--do-not-depend-on-it-mechanism-works-editor-does-not) |
| S11 | 2026-09-10 | **PASSED — architecture simplified.** An `Entity record` tab hosts the PCF; the custom page is unnecessary | Route C: same record twice in one session OK, Case id via `contextInfo`, `setControlState` survives teardown. Route B (`Control`) renders but **cannot receive the Case id** — eliminated on function. See [result](#s11-result--2026-09-10-passed-route-c-works-the-custom-page-is-unnecessary) |
| S12 | 2026-09-11 | **Answered — NEGATIVE.** Dataverse stores email HTML verbatim; it sanitises nothing | 1442 bytes in, 1442 out, 17/17 hostile blocks intact. Real inbound bodies are whole HTML documents and **8/12 carry an unscoped `<style>` tag**, so forbidding that tag is required by existing data. See [result](#s12-result--2026-09-11-no-the-platform-does-not-sanitise-anything) |

### Draft persistence (R16) — measured 2026-09-25

Probed by creating a real draft on a test Case, reading it back, updating it, then deleting it.
Environment verified clean afterwards (0 rows matching the probe subject).

| Question | Answer |
|---|---|
| Create payload | `statecode` 0 + `statuscode` 1 + `directioncode: true` + `regardingobjectid_incident@odata.bind` + an `email_activity_parties` array. Accepted, HTTP 204 |
| Recipients with no matching record | A bare `addressused` string with **no** `partyid` works, and reads back with `partyid: null`. This is the *normal* case on a Case — customers are frequently not Contacts |
| Queue as sender | `partyid_queue@odata.bind` works, and **the platform fills that party's `addressused` itself** from the queue's address |
| `torecipients` | **Derived by the platform** from the To parties. Further confirmation it is output, never input |
| Updating parties | `email_activity_parties` on a **PATCH replaces** the sender/To/Cc set, and leaves the platform's own owner (mask 9) and regarding (mask 8) rows untouched. So a recipient change is one request, not delete-then-recreate |
| `parentactivityid` | `IsValidForCreate: **true**`, `IsValidForUpdate: **false**`. Navigation property is the lowercase **`parentactivityid`** (read off `ReferencingEntityNavigationPropertyName`; the SchemaName spelling `ParentActivityId` is the one that fails) |

**Duplicate drafts are a real failure mode, not a hypothetical — the standard email form has it.**
Case `CAS-01031` carries **three** drafts created in June 2026, identical subject, all three
pointing at the same `parentactivityid`. So reopening a reply without first looking for an
existing draft is how a Case accumulates copies of one unsent message. The client now links each
draft to the message it answers and adopts an existing one instead of creating another.

**Two consequences of sharing a draft pool with the OOB form**, both handled:

- The client will **adopt** a draft the standard form left behind. That is the right behaviour —
  it is the same agent's unsent reply to the same message — but it means our writes can land on
  rows we did not create.
- Therefore discard-on-close is gated on `draftCreatedHere`. Emptying the editor and closing
  deletes only a row **this** client created in **this** sitting. Without that gate, opening
  someone's existing draft and clearing it would delete their work.

#### Two defects that only live verification found — 2026-09-25

Both were caught by opening the client on CAS-01020, not by any test, and both had passed review.

**1. `queueitem.statecode eq 0` is the wrong filter.** A queue item goes Inactive when the item is
**worked**, not when the Case leaves the queue. CAS-01020 sits in Care with a `statecode 1` queue
item, so an active-only filter resolved **no queue at all**: the client fell back to sending as the
agent — whose mailbox cannot send — and offered a blocked Send on a Case with a perfectly good
queue. Now ordered `statecode asc,createdon desc` with no state filter, so an Active item wins and
otherwise the most recent worked item still says where the Case lives.

The queue-sender script on the standard email form filters to active only. It gets away with it
because its fallback names a queue explicitly; ours resolves the *Case's* queue, so it has to read
this correctly rather than lean on a fallback.

**2. Replacing the derived `ourAddresses` with the resolved senders LOST information.** The
research note above said the derivation was "interim, to be replaced rather than kept". That was
wrong, and the cost was visible on the first case that exercised it: with no queue resolved, Care
was not a candidate, so it was not excluded, so replying put **the service queue itself in To** —
the mail loop the exclusion exists to prevent.

The two sets disagree in **both** directions:

| Set | Knows | Misses |
|---|---|---|
| Resolved candidates | Who we are about to send *as*, including on a Case never replied to | A queue we cannot resolve today |
| Senders of outgoing mail on the Case | Every address this Case has actually sent *from* | A Case with no outgoing mail yet |

So the answer is the **union**, not a replacement. Recorded here because "replace X with the
authoritative Y" is a tempting shape of cleanup, and this is a case where it silently removed a
safeguard.

#### A third defect: the field nothing passed — 2026-09-25

`parentactivityid` is what makes draft resume possible, and the first autosaved draft in the
published app came back with **`parent: null`**.

`domain/draft.ts` supported `inReplyToId`, `buildDraftPayload` bound it correctly, four unit tests
asserted the binding — and the shell never passed it. Every test passed, lint passed, typecheck
passed, the build passed, and the feature was inert. Only reading the created row showed it.

**No test at this project's layering could have caught it**, because the defect was in the seam
between a tested pure function and its caller, and the caller is a React component. So the fix is
structural rather than another test: `inReplyToId` is now **required** on `DraftArgs` — typed
`string | undefined` rather than optional — which makes the compiler demand that every caller
decide. A forward passes `undefined` explicitly, because a forward has nothing to link to.

Worth generalising: an optional field on a payload type is a silent-omission hazard whenever the
thing it enables is not visible in the UI. Prefer a required key with a nullable value.

### R13 attachments — built 2026-09-25

Built on S6's measurements. Two implementation findings worth carrying.

**1. The client's size limit is about DELIVERY, not storage.** S6 proved Dataverse stores 40 MB
happily via chunked upload against a 5 MB org cap — so neither `MaxUploadFileSize` nor the chunked
ceiling tells an agent anything about whether the customer will receive the file. The client caps
the **message total** at 25 MB (the near-universal Exchange Online maximum) and warns from 18 MB,
because base64 inflates a message by roughly a third in transit. Using the Dataverse limit as the
rule would let an agent spend two minutes uploading something that can never leave.

**2. Slice the BYTES, not the encoded string.** The tempting implementation — base64 the whole
file once, then cut the string into blocks — is wrong twice over:

- A boundary at anything other than a multiple of 4 characters shifts every byte after it.
- Sizing the block count from the byte size while slicing by characters does not divide evenly.
  At a 4 MB block a 40 MB file plans 10 blocks but needs 5,592,404 characters each, and ten of
  those fall **16 characters short** of the encoded string. Those characters are never sent, the
  commit still succeeds, and the customer receives a **silently truncated file**.

Slicing the bytes and encoding each block on its own has neither problem — and it is what S6
actually measured, which is why 40 MB is 10 blocks and not the 11 that string-slicing produces.
That discrepancy is the cheapest way to tell the two schemes apart, and it is now a test.

Related: `String.fromCharCode(...bytes)` throws `RangeError: Maximum call stack size exceeded`
somewhere around 100 KB, so encoding runs in 32 KB windows. On a 4 MB block the naive spread is a
certainty, and the error reads like a browser bug rather than an encoding mistake.

**Ordering constraint R16 unblocked.** An `activitymimeattachment` hangs off an email row, so a
file dropped into an empty reply forces the draft to be created first — `flushDraft(force)`
bypasses the "is this worth saving?" rule, because an attachment *is* content even when nothing
has been typed.

**Two places the tray must not lie:**

- **Resuming a draft rehydrates its attachments.** They are already rows on that email and *will*
  be sent; an empty tray would mean the agent sees no attachments while the customer receives
  them, and cannot remove one they cannot see.
- **Forward carries the original's attachments** as `reusedAttachmentId` — the same stored blob,
  so the row costs nothing — materialised the moment the draft first saves. Dropping them
  silently would defeat the point of forwarding.

#### R13 verified in the published app — 2026-09-25, v1.10.0

Two files attached through the real UI on CAS-01020, then read back and hashed against source.

| File | Size | Path | Stored | SHA-256 |
|---|---|---|---|---|
| `cec-small.bin` | 51,200 | inline (`context.webAPI.createRecord`) | 51,200 | **match** |
| `cec-big.bin` | 7,340,032 | **chunked** (`Xrm.WebApi.online.execute`) | 7,340,032 | **match** |

The 7 MB file is the one that matters: it crosses the 5 MB org cap, so it went through
Initialize → UploadBlock → Commit, which is where a block-arithmetic error truncates silently.
Byte-identical, so the byte-slicing scheme and the hand-built `getMetadata()` shapes are both
correct against the live platform. Files were deterministic pseudo-random, not repetitive, so a
shifted or dropped block could not hide.

##### The finding nobody predicted: the platform adds attachments of its own

The draft came back with **three** rows, not two. The third was `image001.png`, 3,988,820 bytes —
never uploaded by the client.

Cause: the draft body quotes a message containing `<img src="cid:image001.png@01DC8A0D.FBB037B0">`,
and **Dataverse materialises `cid:`-referenced inline images as `activitymimeattachment` rows when
the description is saved.** It is not a copy — the row's `attachmentid` is the *same blob* as the
original message's (`9e5bf9e6-…`), so it costs no storage. Deleting the draft afterwards left the
original's image intact, so the sharing is safe in both directions.

This behaviour is *desirable*: without it the quoted image would arrive broken. But it broke two
assumptions in the client, both now fixed:

1. **It must not appear in the attachment tray.** Resuming that draft would have listed
   `image001.png` as a removable file — inviting an agent to delete part of the quoted message
   and break the image for the customer.
2. **It must count toward the message size.** 3.9 MB entirely invisible to the size rule, so a
   message accepted at 24 MB could really be 28 MB and be rejected by the recipient.

**`attachmentcontentid` is the discriminator** — null on a file the agent attached, the Content-ID
on an inline image. Cheap, exact, and the reason this is a two-line filter rather than a heuristic
over the body HTML.

General point worth keeping: *the set of attachments on a saved email is not the set the client
uploaded.* Anything that reasons about attachment count or total size has to read them back rather
than trust its own tally.

### R17 send — built 2026-09-25

**`SendEmail` is a BOUND action**, unlike every other action in this project. Through
`Xrm.WebApi.online.execute` that means `boundParameter: 'entity'` (not `null`), with the instance
passed under that same key carrying `entityType`, `id` and `@odata.type`. Verified live:

```
boundParameter: 'entity'
parameterTypes: {
  entity:    { typeName: 'mscrm.email',  structuralProperty: 5 },  // EntityType
  IssueSend: { typeName: 'Edm.Boolean',  structuralProperty: 1 },
}
```

Probe returned **HTTP 200** and the row moved to `statuscode` 3 (Sent), `statecode` 1.

**Status codes, read from live metadata** (not from memory — worth re-reading before trusting):
1 Draft (state 0), 2 Completed, 3 Sent, 4 Received, 5 Canceled, 6 Pending Send, 7 Sending,
**8 Failed — `statecode` 0, the same Open state as a Draft.** Inferring "still in progress" from
the state rather than the status would poll a dead send forever.

#### `IssueSend: false` is NOT a rehearsal of a real send

Measured on the probe. With `IssueSend: false` the platform:

- appended the tracking token **to the subject** (`… CRM:0100013`) — confirming why
  `composeSubject` must strip inherited tokens, or a reply carries two;
- assigned `trackingtoken`;
- went **straight to `Sent` (3)** — it never passed through `Pending Send`;
- did **not** assign `messageid`, and did **not** assign `conversationindex`.

Two consequences. First, the safe mode validates the action shape and the subject rewrite but
**does not exercise the `Pending Send` → `Sent` transition the polling code exists for** — only a
real send reaches that state. Second, anything depending on `conversationindex` nesting still
cannot be tested without a genuine send, which is the same limitation seeded data has.

#### Why there is no "don't really send" switch in the product

`IssueSend: false` marks a message sent without sending it — precisely the silent non-delivery
this feature exists to prevent. A product that could be *configured* into that state would be
worse than one that cannot, so the flag stays a probe tool and the UI always issues a real send.

#### The send path, and why each step is there

1. **Save first** — the editor holds the message; sending a stale draft row sends yesterday's text.
2. **Re-run pre-flight against the live platform** — approval can change while an agent types, and
   Gate 2 decided a pre-flight that cannot answer counts as *not safe*.
3. **Issue, then poll** — the 200 means accepted. Polling backs off over ~30s and then **gives up
   and says so**, because a message stranded by an unapproved sender never settles and a spinner
   that runs forever reads as "this is fine".
4. **Only a confirmed `Sent` closes compose.** On "still sending" the agent's text stays in front
   of them, which is where it belongs if it never goes.

#### Real send verified — 2026-09-25, v1.11.0, and it changed the design

One real send through the UI, to `simon.jehrbo@example.com` from the **Care** queue on CAS-01020.

| | |
|---|---|
| Recipients as sent | `from: caredemo@…`, `to: simon.jehrbo@example.com` — one, correct |
| Accepted | 10:11:49, `statuscode` **6 Pending Send** |
| Settled | ~10:14:27, `statuscode` **3 Sent** |
| Assigned on a REAL send | `messageid`, `conversationindex` (44 chars), `trackingtoken` `CRM:0100014` |

Confirms the whole path: save → live pre-flight → issue → poll → report. It also confirms the
`IssueSend: false` difference recorded above: the safe mode assigns neither `messageid` nor
`conversationindex`, and never passes through Pending Send.

##### **The poll window was far too short, and the measurement said so**

The client polled for ~30 seconds. The actual server-side sync latency was **~2.5 minutes**,
matching the Care mailbox's `lastSuccessfulSyncCompletedOn`. So on a *perfectly healthy* send the
UI ended at "Still sending" and never showed success.

That is honest but self-defeating: an agent who never sees "Sent" learns to ignore the status
line, which is the line R18 depends on. Lengthening the poll was the wrong fix — nobody watches a
panel for two and a half minutes.

**Compose now closes as soon as the platform ACCEPTS the message.** Safe, because acceptance means
the message is already a real row on the case: nothing the agent wrote can be lost by closing. The
status moved to where it can survive navigation and a reload — a **`Sending` badge on the
thread-list row** (and `Failed` for status 8), with a shell notice that says accepted, not sent.
Polling continues in the background and corrects the notice to whatever actually happened.

The principle held: **nothing claims delivery the platform has not confirmed.** What changed is
*where* the still-pending state is shown, not whether it is admitted to.

##### A second inert guard, same shape as `inReplyToId`

`blockingReasonBeforeSend` has always refused an already-sent message, and has always been tested
for it — but the shell never passed `statusCode`, so the guard did nothing. The rule existed, the
caller omitted the input, and every test passed. That is now the **second** defect of exactly this
shape in this project; both were invisible to unit tests because the seam is between a tested pure
function and a React caller.

It now re-reads the row immediately before issuing, which also catches a message sent from another
tab in the seconds since compose opened.

### Recipients must name a record — 2026-09-25

**The defect.** `recipientParty` wrote every To/Cc party as a bare `addressused` with no
`partyid`. Dataverse calls that an **unresolved party** and only delivers to one when
`Organization.allowunresolvedpartiesonemailsend` is true. **That setting is `false` here.**

Confirmed on the message sent earlier that day: the sender party was bound to the Care queue,
the To party had `partyid: NULL` — and a `contact` with exactly that `emailaddress1` already
existed. The client sent unresolved to an address it could have resolved.

**Two corrections to the R17 write-up above, both mine:**

1. The mail arrived, but after **~17 minutes**, while Dataverse reported `statuscode` 3 (Sent)
   after ~2.5 minutes. **"Sent" means handed to Exchange, not delivered.** I reported status 3 as
   delivery; that was wrong, and no status available to the client proves arrival.
2. Delivery succeeded *despite* `allowunresolvedpartiesonemailsend = false`, so that flag is not
   a hard gate on this path. The fix still stands — depending on a tolerance we are not entitled
   to is the defect — but this is a **portability problem, not a live outage here.**

#### What the platform hands over for free

The identity was already on the wire and was being discarded. With annotations enabled — which
`context.webAPI` does by default, as `groupParties` reading `FormattedValue` already proved —
each party carries:

| Annotation | Value |
|---|---|
| `_partyid_value@Microsoft.Dynamics.CRM.lookuplogicalname` | `"queue"` |
| `_partyid_value@Microsoft.Dynamics.CRM.associatednavigationproperty` | `"partyid_queue"` |

The second is the platform **stating the `@odata.bind` property outright**, so composing
`partyid_${entity}` by hand is an unnecessary guess. An unresolved party has `_partyid_value:
null` and no annotations — an unambiguous signal. `openCompose` was throwing all of this away in
a `.map()` that kept only name and address.

#### `Xrm.Utility.lookupObjects` — spiked before building on it

Verified live inside the PCF in CSW: the native **Lookup Records** panel opens over the control,
searches Contacts and Users together, shows each record's email address inline, and resolves with

```json
[{ "id": "{B5E30418-23F2-F011-8406-0022489CF5DD}", "entityType": "contact", "name": "Simon Jehrbo" }]
```

Three things that shape the code:

- **`id` is braced AND upper-cased.** Passing it straight into an `@odata.bind` is the obvious
  mistake; `bareId` exists for exactly this.
- **Cancelling resolves with `[]`, it does not reject.** Treating "no rejection" as "something
  was picked" would add an undefined recipient.
- **No email address is returned**, and every table names its column differently —
  `internalemailaddress` on `systemuser`, `emailaddress` on `queue`, `emailaddress1` on the
  rest. One read per pick, and a record with no address is refused at the moment of picking.

#### `npm run typecheck` covers far less than I previously recorded

CLAUDE.md said it "does not cover `index.ts`". It is broader than that: `tsconfig.test.json`
includes **only `CaseEmailClient/**/*.test.ts`**, so source files are type-checked only insofar as
a test imports them. `ui/EmailClientRoot.tsx` is imported by no test and is therefore **never
type-checked by `npm run typecheck` at all** — only by `npm run build`. Both call sites of the
widened `blockingReasonBeforeSend` passed typecheck and failed the build.

**`npm run build` is the type gate. `npm run typecheck` is a test-file gate.**

#### Opening a record from the PCF without leaving the case — 2026-09-29 (v1.25.0)

`Xrm.Navigation.navigateTo({ pageType: "entityrecord", entityName: "email", entityId }, { target: 2, position: 1, width: 80%, height: 85% })` works from inside the PCF in CSW: the standard email form opens as a dialog over the Case, read-only for a completed email, with From/To/Cc/**Bcc**, attachments and the platform's own command bar. Closing it with its ✕ resolves the promise (no rejection on close), and the control underneath is untouched — no teardown, no lost compose. `openForm` was rejected unmeasured: navigating the tab away would destroy the control. Used by the reading pane's "Open in email form" (`data/navigation.ts`).

Mark as unread was verified in the same run: deleting the agent's `jhrb_emailreadstate` row made the message unread in the list and the pane, it stayed unread past the 1.5 s dwell (the message is collapsed, so the dwell cannot re-arm), and it was still unread after a full reload.

#### Bcc (issue #11) — 2026-09-29 (v1.26.0)

- **A party PATCH replaces Bcc too.** Probe draft created with sender + To + Bcc (mask 4); a PATCH of `email_activity_parties` shaped like the client's save (sender + To) left 1, 2, 8, 9 — the Bcc party was deleted. Since the first save after resuming any draft rewrites parties, Continue draft silently removed Bcc. Fixed by writing mask 4 on every party save and rehydrating Bcc on resume.
- **Verified in the published app:** a Bcc added in compose saved as mask 4; after Continue draft the chip came back in the Bcc row and the party-rewriting save kept mask 4; removing the chip removed it.
- **A Bcc-only send works.** Forward from the test case with no To/Cc and Bcc = the contact simon.jehrbo@example.com (the approved test address): accepted, **status 3 (Sent) within a minute**, parties 1 (Care) + **4 bound to the contact** + 8 + 9 and no To party; `torecipients` stays null; the platform appended a fresh token (`CRM:0100019`). The reading pane shows "Bcc: Simon Jehrbo" on it. Status 3 is hand-off to Exchange, not delivery — arrival is confirmed separately.
