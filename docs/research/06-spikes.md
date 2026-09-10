# 06 — Spikes

## Status: S1 deployed (observation outstanding); S8 partially run

**S1** is built, deployed and wired into Copilot Service workspace, but its three on-screen
measurements have not been read — no signed-in browser was drivable from this session. The control
self-reports, so finishing it is a ~1 minute manual read: see [S1 result](#s1-result--2026-09-09-built-and-deployed-observation-outstanding).
**S8** ran in read-only form (`pac org fetch` aggregates): [S8 (partial)](#s8-result-partial--2026-09-09).

The remaining spikes are **unblocked** as of 2026-09-09: `pac` CLI 2.11.2 is authenticated against
**the demo environment** (`https://your-org.crm4.dynamics.com/`), with Node
v24.13.0 and npm 11.6.2 present, and the requester has confirmed this is the right environment with
CSW installed. What remains unverified is whether the account holds **System Administrator**, and the
approved-mailbox prerequisite for S7.

Note that this is a **shared demo environment** — see the environment guardrails in
[`CLAUDE.md`](../../CLAUDE.md) before running anything that writes, sends email, or changes
System Settings.

Everything in [`02`](02-hosting-and-placement.md), [`03`](03-candidates.md) and
[`04`](04-data-model.md) is **desk research from Microsoft documentation and community prior art**. The
recommendation in [`07-decision.md`](07-decision.md) is correspondingly a desk-research recommendation.

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

#### S1 result — 2026-09-09: BUILT AND DEPLOYED, observation outstanding

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
| S1 | 2026-09-09 | **Built & deployed; on-screen measurements unread** | Control live in CSW on a spike form. Fluent-version + publisher-prefix findings recorded. See [result](#s1-result--2026-09-09-built-and-deployed-observation-outstanding) |
| S2 | — | **Not run** — P1–P2 unverified | |
| S3 | — | **Not run** — P7 unverified; also deprioritised | |
| S4 | — | **Not run** — deprioritised, candidate eliminated on documented facts | |
| S5 | — | **Not run** — P1–P2 unverified | |
| S6 | — | **Not run** — P1–P2 unverified | Gates the decision |
| S7 | — | **Not run** — P6 unverified | Gates the decision |
| S8 | 2026-09-09 | **Partial — grouping half validated; nesting half permanently needs synced mail** | Read-only measurement, then seed data created. 3 corrections to `04`. See [result](#s8-result-partial--2026-09-09) and [follow-up](#s8-follow-up--seed-data-created-2026-09-09) |
| S9 | — | **Not run** — P1–P2 unverified | |
