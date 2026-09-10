# 06 — Spikes

## Status: S1, S2, S6 PASSED; S8 partially run

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

**S8** ran in read-only form (`pac org fetch` aggregates): [S8 (partial)](#s8-result-partial--2026-09-09).

The remaining spikes are **unblocked** as of 2026-09-09: `pac` CLI 2.11.2 is authenticated against
**the demo environment** (`https://your-org.crm4.dynamics.com/`), with Node
v24.13.0 and npm 11.6.2 present, and the requester has confirmed this is the right environment with
CSW installed. What remains unverified is whether the account holds **System Administrator**, and the
approved-mailbox prerequisite for S7.

Note that this is a **shared demo environment** — see the environment guardrails in
[`CLAUDE.md`](../../CLAUDE.md) before running anything that writes, sends email, or changes
System Settings.

[`03`](03-candidates.md) remains desk research from Microsoft documentation and community prior art.
[`02`](02-hosting-and-placement.md) and [`04`](04-data-model.md) have both now been **corrected by
measurement** (RQ1 real estate, side-pane support, and the `regardingobjecttypecode` / threading
findings). The recommendation in [`07-decision.md`](07-decision.md) now has its load-bearing claim
**confirmed for BOTH placements** — form tab (S1) and custom page (S2). S6 has since passed and
corrected `04`. **S7 is the last open gate** on full-client feasibility.

### Prerequisites before any spike can run

| # | Prerequisite | Confirmed? |
|---|---|---|
| P1 | Dataverse environment with **Dynamics 365 Customer Service** and the **Copilot Service Workspace** app | ✅ **Confirmed by the requester**, 2026-09-09 — the demo environment is the right environment and CSW is present |
| P2 | System Administrator (or System Customizer + admin center access) on that environment | ❓ Not verified |
| P3 | `pac` CLI installed and authenticated against it (`pac auth create`) | ✅ pac 2.11.2, profile `[3]` active |
| P4 | Node.js LTS + npm | ✅ Node v24.13.0, npm 11.6.2 |
| P5 | A Case with a **real, long email chain** — required to close S8 | ⚠️ **Depth solved, fidelity not.** A 7-message seed chain now exists (see [follow-up](#s8-follow-up--seed-data-created-2026-09-09)), but seeded mail can never carry `conversationindex`. Closing the nesting half needs a genuine synced round-trip. |
| P6 | An approved mailbox for the test user — required for S7 | ❓ Not verified |
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

### S8 — Threading fidelity against real data

Run the [`04`](04-data-model.md) threading strategy against a real Case with a long chain. Score how
correctly it groups and orders.

**Confirms / breaks:** RQ10. Specifically, how often `baseconversationindexhash` and `conversationindex`
are actually **populated** — they depend on server-side sync having created the records, and manually
created, imported or Flow-created email may have none of them. Record the measured fallback rate; it
determines how much effort the subject-normalisation fallback deserves.

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
| S7 | — | **Not run** — P6 unverified | Gates the decision |
| S8 | 2026-09-09 | **Partial — grouping half validated; nesting half permanently needs synced mail** | Read-only measurement, then seed data created. 3 corrections to `04`. See [result](#s8-result-partial--2026-09-09) and [follow-up](#s8-follow-up--seed-data-created-2026-09-09) |
| S9 | — | **Not run** — P1–P2 unverified | |
