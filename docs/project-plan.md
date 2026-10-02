# Project plan — Case email client

What has shipped, and what is left. **This file is the single place phases are tracked.**
`CLAUDE.md` describes how to work in the repo and what the platform does; it deliberately does
not carry a plan, because the two drift apart the moment they are kept in two places.

Requirement ids (R1–R22, N1–N7) refer to
[`docs/research/01-requirements.md`](research/01-requirements.md). M = Must, S = Should.

---

## Phase 1 — the reading slice · **COMPLETE**, deployed as v1.5.5

Delivered **R1–R8, R21, N1–N4, N7**, plus issue #4 (conversations expand in the list, Outlook-style).

Verified end to end in the published app on 2026-09-22. The load-bearing part was **R6's durable
per-agent read state** on the `jhrb_emailreadstate` table: it survives a full page reload, which
`setControlState` never could.

The architecture was spike-validated on **both** target placements before any of it was built —
S1 (Case form tab) and S11 (session tab, via an `Entity record` app tab template) each confirmed
live that `setControlState` survives a CSW two-session teardown. S2 confirmed the same inside a
custom page, which S11 then made unnecessary. S6 (attachments), S7 (real send, receipt confirmed)
and S8 (grouping, `conversationindex` ordering, the depth formula) all passed. **No research gate
remains open.**

## Phase 2 — compose and send · **COMPLETE**, merged to `main` 2026-09-25

Delivered **R9–R18 and R20**. Merged as
[PR #6](https://github.com/PsymonDK/modeldriven-emailclient/pull/6) and
[PR #7](https://github.com/PsymonDK/modeldriven-emailclient/pull/7).

| Requirement | What shipped |
|---|---|
| R9, R10 | Reply / Reply all / Forward, in place — no navigation away from the Case |
| R11 | Rich-text editor. **The compose body is the draft's own email form inside compose** (S16, 2026-10-02): the Dynamics editor on a genuine email form, toolbar from our customisable config. TipTap (S13) was replaced on 2026-09-30 and removed |
| R12 | Quoted history appended and round-trip safe. **The quote never enters the editor** — the invariant was written and tested in `domain/compose.ts` before any compose UI existed |
| R13 | Attachments, inline and chunked. 50 KB and 7 MB both round-tripped SHA-256 identical |
| R14 | Email templates, listed per Case and instantiated. **Superseded in Phase 3 — see R22** |
| R15 | Signature, and it **follows the sender** rather than always being the agent's |
| R16 | Drafts autosave, resume and do not duplicate |
| R17 | Send. Real delivery confirmed by the user |
| R18 | Pre-flight: an unapproved sender is refused before Send is offered, not after it silently vanishes |
| R20 | Sent mail is regarding the Case automatically |
| — | Recipients bind to a **real record** (`partyid_<entity>@odata.bind`), with `Xrm.Utility.lookupObjects` as the picker, rather than relying on unresolved parties |

### Carried into Phase 3 — built but not verified end to end

Both are UI paths that unit tests cannot reach, and neither has been exercised in the published app:

- Send **refusing a genuinely unknown address** in the UI. The flagged chip for an unknown address
  has been shown live (1.19.0/1.20.0), but Send has never been pressed on one.
- The **`Sending` → `Sent` badge transition** on the thread-list row. The Bcc test send on
  2026-09-29 reached Sent within a minute, before the badge could be observed.

---

## Phase 3 — make it shippable · **IN PROGRESS**

Phase 1 made it readable and Phase 2 made it usable. Phase 3 is what stands between this and
installing it somewhere that is not the demo environment.

### Done so far in Phase 3

| When | What | PR |
|---|---|---|
| 2026-09-28/29 | **Code review, security and refactor** — sanitising for display vs send, CSS and `cid:` image handling, a serial draft-save queue, the send flow extracted and ordered, draft ownership checks, a scripts environment guard, and N1–N11 found by testing in the published app (among them: forward dropping attachments, inline images never showing, tracking tokens stripped from subjects, the form header drawn over the control). Tracked in [`docs/review/2026-09-28-code-review.md`](review/2026-09-28-code-review.md) | [#10](https://github.com/PsymonDK/modeldriven-emailclient/pull/10) |
| 2026-09-29 | **Reading-pane "More actions" menu** — open in email form (as a dialog), mark as unread, expand/collapse all | [#12](https://github.com/PsymonDK/modeldriven-emailclient/pull/12) |
| 2026-09-29 | **Bcc** ([#11](https://github.com/PsymonDK/modeldriven-emailclient/issues/11)) — compose, drafts and outgoing display, plus a **data-loss fix**: a party save replaces Bcc too, so resuming a draft used to delete its Bcc. Real Bcc-only delivery confirmed | [#13](https://github.com/PsymonDK/modeldriven-emailclient/pull/13) |

Also settled along the way: **the client never removes a tracking token from a subject** (a
product requirement), recipient type-ahead in To/Cc/Bcc, leads in the lookup, and flagged chips
that resolve in place.

Ordered by what blocks what. **N3 is the only outstanding MUST** and comes first.

### 3.1 N3 (M) — ships as a solution, with no manual per-environment steps

The requirement is that a managed solution imports into a clean environment and the client works.
Today it does not: two steps are manual, and the managed path has never been imported anywhere.

- **Assigning the security role.** A new custom table grants privileges to nobody but System
  Administrator and System Customizer, so read state and settings are silently refused for every
  agent until the purpose-built role is assigned. Currently a per-environment human action.
- **Registering the email-client form with the CSW app**, and publishing the app. One app-designer
  action per environment.
- **The managed build now builds, but has never been imported.** Done in the code review (R7):
  `solution/src` is a `pac solution sync --packagetype Both` of the environment's solution — the
  two custom tables, the role, the control and the form — so Debug builds unmanaged and
  `dotnet build -c Release -p:SolutionPackageType=Managed` builds managed. The Email Client form
  was rebuilt self-contained, taking its missing dependencies from **88 to 10**, all standard
  Customer Service components. What is missing is an import into a clean environment, which
  needs an environment other than the shared demo one.
- **Configuration is data, not solution content.** The default `jhrb_emailclientsetting` row
  (`seed-settings.mjs`) does not travel with the solution, and an empty settings table silently
  means "send as the agent".
- **The deployment scripts are locked to the demo org** by design (`scripts/lib/dv.mjs`), so
  none of them can be run against a downstream environment as they stand.

Decide per item whether it can be automated into the solution or has to become a documented
runbook step. A runbook step is an acceptable answer; an *undocumented* one is not.

**Progress (2026-09-30, branch `n3-shippable`):**

- **Runbook written** — [`docs/deploy/install.md`](deploy/install.md): what the solution contains (verified from the managed build), prerequisites, build, import, post-import, the remaining manual steps, verification, upgrade and uninstall.
- **Post-import script** — [`scripts/install/post-import.mjs`](../scripts/install/post-import.mjs): checks the import, registers the form with the CSW app, seeds the default settings row, and (with `--team`) assigns the role. Additive only, dry run unless `--confirm`, and the target must be named with `--org` every time. **Dry-run verified against the demo environment** (2026-09-30): every check passed and it reported nothing to do; the `--team` path found the team, the role's copy in its business unit, and would assign it.
- **Solution version** now tracks the control version (it had stayed at `1.0`), enforced by a test.
- **Still manual, by nature:** role assignment to individual users (or `--team`), mailbox approval, and the optional session-tab template.
- **Still open:** an import of the managed package into a clean environment — needs one that is not the shared demo.

### 3.2 R22 (S) — email template handling that an agent will actually use

**Tracked as [issue #8](https://github.com/PsymonDK/modeldriven-emailclient/issues/8). Requires design
review before implementation.**

D365 Customer Service already resolves templates by **regarding object type** and **language**.
Replying on a Case should therefore show `incident` templates in the user's own language by
default, with a way to switch language and see the others.

What exists today falls short on both counts: `data/templates.ts` filters to
`templatetypecode eq 'incident'` and orders by title, with **no language filter at all**, and the
picker is a button, then a `<select>`, then an Insert or Replace button — three clicks, and the
list is a flat alphabetical dropdown.

**The UX target is two clicks or fewer from compose to an inserted template**, with a list that is
genuinely easy to scan. That is a design problem before it is a coding one, which is why this
needs a review rather than an implementation ticket.

To confirm at design review — the data-model detail is **not yet verified against the environment**
(the cached token expired before it could be checked):

- how `template.languagecode` is populated here, and what the agent's own UI language resolves to
- whether personal templates (`ispersonal`) belong in the list
- what the empty state says when the user's language has no templates — falling back silently to
  another language would be worse than saying so

### 3.3 N6 (S) — accessibility

Keyboard navigable, screen-reader labelled, WCAG 2.1 AA contrast, audited with Accessibility
Insights. The compose surface, the recipient chips and the template picker are all new since the
last time anything was checked.

### 3.4 N5 (S) — performance, measured on a production bundle

A 50-email Case must render in under 2 seconds on a warm session, measured against a seeded Case.

**No performance or size claim can be made from what is currently deployed.** Every deploy so far
has carried a `dotnet build -c Debug` bundle — eval devtool, unminified — and the editor has since
been added. Production is the only honest baseline: the reading slice measured **32.8 KiB**
gzipped; TipTap 2 took it to roughly **145 KiB**, and TipTap has since been removed — the editor
is now the platform's own, loaded by Dynamics — so the bundle should be back near the reading
slice. Measure from `pcf-scripts build --buildMode production`, not from the dev bundle.

### 3.5 R19 (S) — Copilot "draft a reply for me" · **delivered 2026-10-02**

Draft with Copilot runs inside compose: the body is the draft's own email form (S16), where the
editor loads Copilot drafting, Translate and Adjust, with the case as context
(`window.OpenEmailInfo`). Verified live end to end — generate, *Keep it*, saved, sent.

---

## Out of scope

- **R8b** — cross-Case inbox, queue triage, mail rules. That is the OOB Inbox's job.
- Changing `Organization.allowunresolvedpartiesonemailsend` — a shared-environment org setting.
- Chasing the ~17-minute delivery latency; it is a tenant/Exchange characteristic, not client code.
