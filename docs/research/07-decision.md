# 07 — Decision (ADR)

| | |
|---|---|
| **Status** | **Proposed** — desk research complete, awaiting spike confirmation and stakeholder sign-off |
| **Date** | 2026-09-09 |
| **Decision** | Build the Case-scoped email client as a **React (virtual) PCF code component**, placed directly on a Case form tab, and hosted inside a **thin custom page** for the CSW session tab |
| **Runner-up** | PCF alone, form-tab placement only |
| **Eliminated** | Generative page (platform facts); custom page alone, code app via iframe, HTML web resource (MUST-requirement failure) |
| **Confidence** | **High for the Case form tab placement** — S1 passed live on 2026-09-10, confirming the load-bearing claim. Medium for the CSW session-tab half, which still rests on documentation until S2 runs. |

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
| Case form tab | The PCF directly — a virtual/React **dataset** component on a single-column tab, bound to a subgrid of `email` where `regardingobjectid` = the Case | GA |
| CSW session tab | The same PCF hosted inside a **custom page**, opened by a `Custom` application tab template with `recordId` = `{anchor.incidentid}`, attached to the Case session template | GA (code components in custom pages) |

Data access is `context.webAPI` against `email`, `activityparty`, `activitymimeattachment`, `template`
and `emailsignature`. Sending is the `SendEmail` action. AI drafting uses `context.Copilot`.

## Why

Three findings drove this, in order of weight.

**1. Multi-session state is the real discriminator — not UI capability. Now measured, not assumed.**
S1 confirmed live on 2026-09-10: switching between two concurrent Case sessions really does destroy and
re-initialise the control (`init #2`), and `setControlState` really does restore the in-progress draft
(`state RESTORED`), with no cross-session bleed. That was the single assumption the whole
recommendation rested on, and it holds.

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

The hybrid then falls out naturally: PCF is mandatory for placement 1 and code components in custom
pages are GA, so placement 2 costs a wrapper rather than a second codebase.

Full scoring in [`05-capability-matrix.md`](05-capability-matrix.md) (hybrid 77/84; next viable 71).

## Consequences

**Accepted.**
- No low-code surface. Everything is TypeScript/React; handover to low-code makers is not possible.
- We own the rich-text editor. Prior art is good (TinyMCE-based rich text PCFs are in production), but
  bundle size needs code-splitting discipline and TinyMCE's commercial licensing is a procurement item.
- Two registrations to maintain, and the custom page wrapper drags in the canvas host's baggage:
  8-hour session timeout, third-party-cookie requirement, and app-wide connector consent dialogs.
- Body-text search must go via Dataverse search, because `Email.Description` now lives in Azure Blob
  storage and **filtering on it is unsupported** in FetchXML/Advanced Find. Platform-wide, not our choice.

**Carried risks into implementation.**

| Risk | Severity | Mitigation |
|---|---|---|
| **`setControlState` behaviour inside a custom page is undocumented.** If it does not survive custom-page teardown, the session-tab placement loses draft state | **High** | **Still open — now owned by S2.** S1 proved it works on the *form tab*; the custom-page host is untested. Mitigation regardless: write drafts as real Dataverse rows (`statecode` 0 / `statuscode` 1 Draft) on blur and on an interval, so recovery never depends on in-memory state. Do this from day one. |
| **Layout is the component's job, and differs per host** (S1 + S2) | Medium | On a form tab `allocatedHeight` is -1 and the host is content-sized, so height must be claimed from the viewport. In a custom page `allocatedHeight` is a real number and claiming over-claims. The control is now host-aware; keep that. |
| **The Case id arrives differently per host** (S2) | Medium | `contextInfo` is form-only — empty in a side pane, and a custom page passes `recordId` as a *page* input the component cannot read. The component needs an explicit `caseId` input property that the custom page binds to `Param("recordId")`. Implemented. |
| **Wiring the custom page into CSW is manual, per environment** (S2) | Medium-high | CSW is a managed Microsoft app; adding a page to it is not automatable via `AddAppComponents` or `appmodulecomponent`, and CSW is absent from the maker apps list. Budget app-designer work per environment, and re-check the `Control` app tab template reversal condition below — it would remove this cost entirely. |
| **Quoted-history splitting (R4/R12) has no API** — one HTML blob, no quote marker | **High** | Client-side heuristic over `blockquote`, `divRplyFwdMsg`, `gmail_quote`, `-----Original Message-----`; localisation-aware. Control our own emitted structure on compose; never re-serialise an inherited quote. Prototype in S7 before committing estimates. |
| **No per-agent read state on `email`** (R6) — `lastopenedtime`/`opencount` are recipient-side tracking | Medium | Custom column or a small join table keyed by email + user. Decide in implementation planning. |
| **Threading columns may be sparsely populated** on manually created, imported or Flow-created email | Medium | S8 measures the real fallback rate against production-like data; subject-normalisation fallback sized to that number. |
| **Attachment ceiling defaults to 5 MB** (`Organization.MaxUploadFileSize`), raisable to 125 MB, with chunked upload needed above the inline comfort zone | Medium | S6 establishes the real configured ceiling and confirms oversize failures are catchable. Reuse `attachmentid` on forward rather than re-uploading. |
| **Full-tab real estate on the enhanced Case form is unverified** | Low | S1. Dataset components get 100%-of-space growth with `allocatedHeight` = -1 and CSS filling; the unknown is surrounding form chrome, not the PCF. |

## What would reverse this decision

Named up front so the decision is falsifiable:

1. **S1 shows a PCF cannot get workable full-tab real estate on the enhanced Case form.** Then the form
   tab placement is impossible for every candidate, N2 must be renegotiated, and the field reopens —
   most likely toward a custom page or generative page in a full-page placement.
2. **R16/N1 are relaxed** — the business accepts that agents lose in-progress drafts on session switch.
   That single change readmits candidates D and E and, given code apps' far better dev loop and higher
   UI ceiling, D becomes genuinely competitive (subject to the Power Apps Premium licensing question).
3. **Microsoft ships supported PCF hosting in CSW application tabs** (the `Control` page type stops
   being "for internal use only"). Then the custom page wrapper is unnecessary and the architecture
   simplifies to PCF alone — a strict improvement, so this is worth re-checking before build starts.
4. **Microsoft ships form-tab embedding for generative pages** *and* lifts the data-type ceiling. Both
   would be needed; the placement fix alone is not sufficient.
5. **The Power Apps licensing position changes** such that code components in an MDA require licensing
   the agent population doesn't have. This is not expected — D365 Customer Service Enterprise confers
   the needed use rights within the app — but it should be confirmed with procurement before build.

## Next steps

1. **Verify the remaining environment prerequisites.** `pac` is already authenticated against
   *the demo environment*; what's left is confirming the CSW app is installed, that we hold
   System Administrator, and the mail/mailbox prerequisites for S6–S8 (P1, P2, P5, P6 in
   [`06-spikes.md`](06-spikes.md)).
2. **Run S1**, and specifically test `setControlState` survival inside a custom page — the one
   undocumented question that the scorecard had to discount for.
3. **Run S6 and S7.** Both gate this decision; S7 also sizes the quoted-history risk.
4. **Confirm weights** in [`05-capability-matrix.md`](05-capability-matrix.md) with the stakeholder, and
   re-check items 3 and 5 above against current documentation before build starts.
5. On green, move to an implementation plan. Nothing from S1–S9 is expected to survive into it — they
   are throwaway spikes.

## Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| Requester | — | — | ☐ Approved ☐ Changes requested |
