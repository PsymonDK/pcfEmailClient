# 06 — Spikes

## Status: NOT RUN — but no longer blocked

**No spike in this file has been executed.** They are, however, **largely unblocked** as of 2026-09-09:
`pac` CLI 2.11.2 is installed and authenticated against **the demo environment**
(`https://your-org.crm4.dynamics.com/`), with Node v24.13.0 and npm 11.6.2 present.

What remains unverified is whether that environment has the **Copilot Service Workspace app** installed,
whether the account holds **System Administrator**, and the data/mailbox prerequisites for S6–S8. See
the prerequisite table below.

Note that this is a **shared demo environment** — see the environment guardrails in
[`CLAUDE.md`](../../CLAUDE.md) before running anything that writes, sends email, or changes
System Settings.

Everything in [`02`](02-hosting-and-placement.md), [`03`](03-candidates.md) and
[`04`](04-data-model.md) is **desk research from Microsoft documentation and community prior art**. The
recommendation in [`07-decision.md`](07-decision.md) is correspondingly a desk-research recommendation.

### Prerequisites before any spike can run

| # | Prerequisite | Confirmed? |
|---|---|---|
| P1 | Dataverse environment with **Dynamics 365 Customer Service** and the **Copilot Service Workspace** app | ⚠️ Environment "the demo environment" is authenticated and named for CS; **CSW app presence not yet verified** |
| P2 | System Administrator (or System Customizer + admin center access) on that environment | ❓ Not verified |
| P3 | `pac` CLI installed and authenticated against it (`pac auth create`) | ✅ pac 2.11.2, profile `[3]` active |
| P4 | Node.js LTS + npm | ✅ Node v24.13.0, npm 11.6.2 |
| P5 | A Case with a **real, long email chain** created by server-side sync — required for S8; synthetic data will not exercise the correlation columns | ❓ Not verified — a demo environment may have no server-side-synced mail at all, which would itself be a finding for S8 |
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
| S1 | — | **Not run** — P1–P2 unverified (P3, P4 ✅) | Highest-value spike; run first |
| S2 | — | **Not run** — P1–P2 unverified | |
| S3 | — | **Not run** — P7 unverified; also deprioritised | |
| S4 | — | **Not run** — deprioritised, candidate eliminated on documented facts | |
| S5 | — | **Not run** — P1–P2 unverified | |
| S6 | — | **Not run** — P1–P2 unverified | Gates the decision |
| S7 | — | **Not run** — P6 unverified | Gates the decision |
| S8 | — | **Not run** — P5 unverified | |
| S9 | — | **Not run** — P1–P2 unverified | |
