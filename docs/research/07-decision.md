# 07 — Decision (ADR)

| | |
|---|---|
| **Status** | **Proposed — final shape.** All spikes passed (S1, S2, S6, S7, S11; S8 closed). **S11 removed the custom page**: reversal condition 3 fired and the decision was simplified accordingly on 2026-09-10. No open gate. Awaiting sign-off. |
| **Date** | 2026-09-09 |
| **Decision** | Build the Case-scoped email client as a **React (virtual) PCF code component** on **two form placements**: a tab on the Case form, and a dedicated Case form opened as a CSW session tab by an `Entity record` application tab template. **No custom page.** |
| **Runner-up** | The same PCF hosted in a **thin custom page** for the session tab (the A+B hybrid, tested and working in S2) — kept as a documented fallback, not the plan |
| **Eliminated** | Generative page (platform facts); custom page alone, code app via iframe, HTML web resource (MUST-requirement failure); the `Control` application tab template (S11 — renders the PCF but cannot pass it the Case id) |
| **Confidence** | **High for both placements, and both are now the same host type.** S1 (Case form tab) and S11 (session tab via `Entity record` + `formId`) both passed live on 2026-09-10, each confirming `setControlState` survival across a real two-session teardown. S6 (attachments) and S7 (real send, receipt confirmed) also passed. **No gate remains open on the hosting decision.** |

## Context

Agents working a Case in Copilot Service Workspace read and write email through the Timeline, which is
an activity feed rather than a mail client: it flattens threads, truncates bodies, shows quoted history
badly, and hands compose off to a separate form. The OOB Inbox is a better mail experience but is
scoped to the agent's queue, not to one Case. We want a native-feeling, Case-scoped mail client.

Five hosting models were plausible. The purpose of this research was to pick between them before
committing to a build.

## Decision

**A single React PCF codebase, registered in two places.**

| Placement | Mechanism | Status |
|---|---|---|
| Case form tab | The PCF directly — a virtual/React **dataset** component on a single-column tab, bound to a subgrid of `email` where `regardingobjectid` = the Case | GA. Measured in S1 |
| CSW session tab | The **same PCF on a dedicated Case form**, opened by an `Entity record` application tab template (`entityName={anchor.entityName}`, `entityId={anchor.incidentid}`, `formId=<the email form>`), attached to the Case session template | GA page type. Measured in S11 |

Both placements are therefore **the same host** — a form tab — which is why the component needs one
sizing strategy, one context path (`contextInfo`) and one state-preservation mechanism rather than
per-host branches. The `caseId` input property becomes optional: it is only needed if a custom page or
side pane is ever reintroduced.

Data access is `context.webAPI` against `email`, `activityparty`, `activitymimeattachment`, `template`
and `emailsignature`. Sending is the `SendEmail` action. AI drafting uses `context.Copilot`.

## Why

Three findings drove this, in order of weight.

**1. Multi-session state is the real discriminator — not UI capability. Now measured, not assumed.**
S1 confirmed live on 2026-09-10: switching between two concurrent Case sessions really does destroy and
re-initialise the control (`init #2`), and `setControlState` really does restore the in-progress draft
(`state RESTORED`), with no cross-session bleed. That was the single assumption the whole
recommendation rested on, and it holds. **S11 then confirmed the same on the chosen session-tab host**
(an `Entity record` app tab template opening a dedicated Case form) — `state RESTORED`, `init #2`, the
probe value intact, with the control verifiably torn down rather than hidden while the other session
held focus. S2 had already shown it inside a custom page as well. The claim is therefore measured on
both target placements, and on the discarded third host too.

Every candidate can be made to look like a mail client. Only one survives CSW's tab lifecycle. Microsoft documents state loss on
session/tab switch for custom pages ("state is also not persisted when switching between multi-session
tabs"), for web resource app tabs ("the page is refreshed to the initial state"), and for external sites
in panes ("the state isn't restored"). PCF, by contrast, advertises the "ability to handle being
destroyed and reloaded for performance reasons **while preserving state**" via `setControlState`. An
agent juggling three Cases will switch sessions mid-reply; under any other host the draft is silently
gone. That is R16 and N1 — both MUST — failing, not a polish gap.

**2. Only PCF can occupy the Case form tab.** Custom pages and generative pages have no form-designer
embedding path. Web resources can, but as an iframe with visible seams and no `context` API.

**3. Generative pages cannot do this job, for reasons that are not going to be worked around.** Not
supported in side panes; no `generative` page type in CSW application tab templates; and restricted to
Dataverse tables with a fixed data-type list that cannot express `activityparty` recipient collections
or `activitymimeattachment` binaries, with no route to the `SendEmail` action. This is the candidate
most worth a second look if requirements change, and the one most conclusively ruled out under the
current ones.

The rest then falls out: PCF is mandatory for placement 1, and S11 showed placement 2 is **the same
host again** — a form tab, opened by an `Entity record` application tab template with a `formId`. So
placement 2 costs a second *form*, not a second technology and not a wrapper. The custom-page hybrid
(A+B) was the plan until 2026-09-10 and remains the runner-up; it works, it just buys nothing.

Full scoring in [`05-capability-matrix.md`](05-capability-matrix.md) (A+A 84/84; hybrid 77; PCF as
originally scored, before the `Entity record` route was found, 71).

## Consequences

**Accepted.**
- No low-code surface. Everything is TypeScript/React; handover to low-code makers is not possible.
- **We own the rich-text editor — now confirmed, not assumed.** S10 established that the platform RTE
  **cannot** be reused from a PCF in any supportable way, so R11 needs a bundled editor. The pick is a
  design decision, not just a size one: a headless/schema editor (TipTap/ProseMirror, Lexical) gives
  *controlled HTML output* which directly serves R12's "never re-serialise an inherited quote" rule,
  whereas TinyMCE gives better paste-from-Word cleanup but looser output and a licensing question.
  Bundle cost is still unmeasured — the benchmark did not complete (see S10).
- Two registrations to maintain: a tab on the Case form, and a second form plus its application tab
  template. Both are ordinary solution components, but they are two places to keep in step — a change
  to the email-client tab has to be made on both forms. *(Previously this cost read "the custom page
  wrapper drags in the canvas host's baggage: 8-hour session timeout, third-party-cookie requirement,
  app-wide connector consent dialogs." S11 removed all of that.)*
- Body-text search must go via Dataverse search, because `Email.Description` now lives in Azure Blob
  storage and **filtering on it is unsupported** in FetchXML/Advanced Find. Platform-wide, not our choice.

**Carried risks into implementation.**

| Risk | Severity | Mitigation |
|---|---|---|
| ~~`setControlState` survival is undocumented for the session-tab host~~ | **RESOLVED TWICE** | **S2, 2026-09-10:** it survives inside a custom page. **S11, 2026-09-10:** it also survives on the chosen `Entity record` route — `state RESTORED` / `init #2`, probe value intact, after the control was genuinely torn down (`cecRoots` 0 while the other session held focus). Durable drafts in Dataverse (`statecode` 0 / `statuscode` 1) remain recommended as defence in depth, but are no longer load-bearing. |
| **R11 needs a bundled rich-text editor, and React 16 constrains the choice** (S10) | Medium | The platform RTE mounts inside a PCF via undocumented `factory.createComponent`/`bindDOMComponent` but never initialises into a usable editor. Do not depend on it. And because a virtual PCF shares the platform's **React 16.14**, the React bindings of modern editors are unusable (`@tiptap/react` needs 17+, `@lexical/react` needs 18+) — use their **framework-agnostic cores** (`@tiptap/core`, `lexical`, `quill` declare no React peer) mounted imperatively into a ref'd div. Severity reduced from Medium-high: the path is now clear. Bundle cost still unmeasured. |
| ~~A PCF update may not reach hosting custom pages automatically~~ (S2 observation) | **NO LONGER APPLIES** | The observation was real — a custom page rendered a stale control bundle — but there is no custom page in the chosen architecture. Form-hosted controls picked up new versions correctly across S1 and S11. Re-read this row only if the custom-page fallback is ever taken. |
| **Layout is the component's job** (S1 + S11) | Low | On a form tab `allocatedHeight` is **-1** and the host is content-sized, so height must be claimed from the viewport. That holds on both chosen placements — S11 measured `allocatedHeight -1` on the session tab too — so one strategy covers both. Severity reduced from Medium: the host-aware branch written for the custom page is now dead weight rather than a live risk. |
| **The Case id arrives from `contextInfo` — and only from a form** (S2 + S11) | Low | `contextInfo` is form-only. It is populated on **both** chosen placements (S11: `via contextInfo` on the session tab), so no property binding is needed. It is **empty** in a side pane, in a custom page, and under a `Control` tab template — and there the `data` parameter does not substitute for it (S11: tested with a slug, a JSON object and a literal GUID). Keep the `caseId` input property in the manifest as cheap insurance, but nothing depends on it. |
| ~~Wiring the custom page into CSW is manual, per environment~~ (S2) | **RESOLVED — the cost is gone** | **S11, 2026-09-10: there is no custom page.** The session tab is an `Entity record` app tab template pointing at an ordinary form, and forms, tab templates and session templates are all solution-aware components that ship dev → test → prod normally. The non-automatable app-designer step and the `appelement` (type 10088) cleanup tangle both disappear. Residual: the *form* still has to be registered with the managed CSW app — one app-designer action per environment rather than a page-plus-registration dance. |
| ~~Quoted-history splitting (R4/R12) has no API~~ | **Largely RESOLVED** | **S7:** the heuristic scored **10/10 against the delivered `.msg`** and correctly split a real Outlook-generated reply (depth 3), handling **English and Danish** header blocks. Risk downgraded from High. Residual: signature blocks and transport-injected banners land in the new-text region — tracked as **R21**. |
| **No per-agent read state on `email`** (R6) — `lastopenedtime`/`opencount` are recipient-side tracking | Medium | Custom column or a small join table keyed by email + user. Decide in implementation planning. |
| **Send failures are SILENT for an unapproved sender** (R18, measured 2026-09-10) | **High** | `SendEmail` returns **HTTP 200**, the email parks at `Pending Send` **indefinitely**, and **no error is recorded** on the email or the mailbox (`outgoingemailstatus` = Not Run, `lastsyncerror` null). The client **must pre-flight**: org `requireapprovalfor*email`, sender `emailrouteraccessapproval` = 1, mailbox `outgoingemailstatus` = Success. Non-negotiable — without it agents will believe mail was sent that never leaves. |
| ~~Threading columns may be sparsely populated~~ | **RESOLVED** | **S8:** `baseconversationindexhash` 100% populated across 48 real rows; grouping, cIdx ordering and the depth formula all verified on a genuine conversation. Fallbacks verified separately. Residual: hash grouping takes precedence over subject, so groups with differing hashes never merge. |
| ~~Attachment ceiling defaults to 5 MB~~ | **RESOLVED** | **S6, 2026-09-10:** `MaxUploadFileSize` caps only the *inline* path (6 MB → clean HTTP 400); the **chunked path ignores it** (40 MB OK). Use chunked upload; no admin change needed. Requires `Xrm.WebApi.online.execute` — `context.webAPI` has no `execute`. Reuse `attachmentid` on forward. Open question: whether large attachments *send* (S7). |
| **Full-tab real estate on the enhanced Case form is unverified** | Low | S1. Dataset components get 100%-of-space growth with `allocatedHeight` = -1 and CSS filling; the unknown is surrounding form chrome, not the PCF. |

## What would reverse this decision

Named up front so the decision is falsifiable:

1. **S1 shows a PCF cannot get workable full-tab real estate on the enhanced Case form.** Then the form
   tab placement is impossible for every candidate, N2 must be renegotiated, and the field reopens —
   most likely toward a custom page or generative page in a full-page placement.
2. **R16/N1 are relaxed** — the business accepts that agents lose in-progress drafts on session switch.
   That single change readmits candidates D and E and, given code apps' far better dev loop and higher
   UI ceiling, D becomes genuinely competitive (subject to the Power Apps Premium licensing question).
3. ~~**The custom page turns out to be unnecessary.**~~ **FIRED, 2026-09-10 — S11 confirmed it, and
   the decision above has been simplified rather than reversed.** An `Entity record` app tab template
   accepts a **`formId`**, so the session tab opens the same Case on a *dedicated form* hosting the
   PCF — the S1 placement reused, with no canvas layer. Measured: CSW shows the same record twice in
   one session without complaint, the Case id arrives via `contextInfo`, and `setControlState` survives
   a two-session teardown. This retired the manual per-environment app-designer registration, the
   `appelement` cleanup tangle, and the canvas host's 8-hour timeout / third-party-cookie /
   connector-consent baggage. The related `Control` page type turned out **not** to be a fallback: it
   renders the PCF but never binds its input properties, so the component cannot learn which Case it is
   on — eliminated on function, not on support status. A **web resource** hosting the PCF was never an
   option: no `ComponentFramework` runtime in a web resource iframe, and such tabs lose state on
   switch, which is the defect that decided the architecture. Detail in
   [`02-hosting-and-placement.md`](02-hosting-and-placement.md#resolved-2026-09-10-by-s11--the-custom-page-was-an-unnecessary-layer)
   and [`06-spikes.md`](06-spikes.md#s11-result--2026-09-10-passed-route-c-works-the-custom-page-is-unnecessary).
4. **Microsoft ships form-tab embedding for generative pages** *and* lifts the data-type ceiling. Both
   would be needed; the placement fix alone is not sufficient.
5. **The Power Apps licensing position changes** such that code components in an MDA require licensing
   the agent population doesn't have. This is not expected — D365 Customer Service Enterprise confers
   the needed use rights within the app — but it should be confirmed with procurement before build.

## Next steps

Every research question is answered and every gating spike has run. What remains is not research:

1. **Carry two hard-won constraints into the build, on day one.**
   - **Pre-flight the sender's approval state before offering Send** (R18). There is no failure signal
     of any kind, so this is the difference between a working client and one that silently loses mail.
   - **Bundle a rich-text editor, and use its framework-agnostic core** (S10) — `@tiptap/core`,
     `lexical` or `quill`, mounted imperatively. A virtual PCF shares the platform's React 16.14, so
     the React bindings of modern editors are unusable.
2. **Two non-gating measurements, worth doing early in the build.** Whether a **large** attachment
   actually *sends* (S6 proved 40 MB stores; S7 sent 1 MB), and the **bundle cost** of the chosen
   editor core.
3. **Decide the per-agent read-state mechanism** (R6) — a custom column on `email` or a small join
   table keyed by email + user. This is the one requirement Dataverse does not already serve.
4. **Confirm weights** in [`05-capability-matrix.md`](05-capability-matrix.md) with the stakeholder, and
   re-check reversal condition 5 (licensing) with procurement before build starts.
5. On sign-off, move to an implementation plan. Nothing from the spikes is expected to survive into it —
   they were throwaway, and the environment has been returned to its pre-spike state.

## Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| Requester | — | — | ☐ Approved ☐ Changes requested |
