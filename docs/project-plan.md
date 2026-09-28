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
| R11 | Rich-text editor. The 2.0 gate closed on **TipTap 2** (S13, 2026-09-23); do not upgrade to 3 |
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

- Send **refusing a genuinely unknown address** in the UI. The test Case has no unresolvable
  address on it, so the path has never actually run.
- The **`Sending` → `Sent` badge transition** on the thread-list row.

---

## Phase 3 — make it shippable · **PLANNED**

Phase 1 made it readable and Phase 2 made it usable. Phase 3 is what stands between this and
installing it somewhere that is not the demo environment.

Ordered by what blocks what. **N3 is the only outstanding MUST** and comes first.

### 3.1 N3 (M) — ships as a solution, with no manual per-environment steps

The requirement is that a managed solution imports into a clean environment and the client works.
Today it does not: two steps are manual, and the managed path has never been built.

- **Assigning the security role.** A new custom table grants privileges to nobody but System
  Administrator and System Customizer, so read state and settings are silently refused for every
  agent until the purpose-built role is assigned. Currently a per-environment human action.
- **Registering the email-client form with the CSW app**, and publishing the app. One app-designer
  action per environment.
- **The managed build has never been run.** `dotnet build -c Release -p:SolutionPackageType=Managed`
  is documented but unexercised, and `<Managed>` in the built solution has never been verified for
  a release artefact.

Decide per item whether it can be automated into the solution or has to become a documented
runbook step. A runbook step is an acceptable answer; an *undocumented* one is not.

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
gzipped, and TipTap 2 with the link extension took it to roughly **145 KiB**. Measure from
`pcf-scripts build --buildMode production`, not from the dev bundle.

### 3.5 R19 (S) — Copilot "draft a reply for me" · *optional*

Reachable from inside the client, with the generated text landing in the editor. Lowest priority
of the five: it duplicates something that already exists in a separate pane, so it is convenience
rather than capability.

---

## Out of scope

- **R8b** — cross-Case inbox, queue triage, mail rules. That is the OOB Inbox's job.
- **Bcc** — no path exists anywhere in the client, and adding recipients did not imply it.
- Changing `Organization.allowunresolvedpartiesonemailsend` — a shared-environment org setting.
- Chasing the ~17-minute delivery latency; it is a tenant/Exchange characteristic, not client code.
