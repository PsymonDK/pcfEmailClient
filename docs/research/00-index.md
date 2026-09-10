# 00 — Index & decision status

## The decision being made

Select the hosting architecture for a **Case-scoped email client** in Dynamics 365 Customer Service,
running inside the **Copilot Service Workspace (CSW)** app — an experience that reads and writes email
more like a native mail client than the out-of-box Timeline, while staying scoped to a single Case.

Candidates under evaluation:

| ID | Candidate |
|---|---|
| **A** | React (virtual) PCF code component |
| **B** | Custom page (canvas-in-MDA) |
| **C** | Generative page |
| **D** | Power Apps code app, surfaced via iframe web resource / external website |
| **E** | Classic HTML + JS web resource |
| **A+B** | *Hybrid:* one React PCF, placed directly on the Case form tab **and** hosted inside a custom page for the session tab |

## Frozen requirements

| Dimension | Decision |
|---|---|
| Placement | Both (a) a tab/section on the **Case form**, and (b) its own **session/application tab**, opened via a CSW session template on Case open |
| Functional scope | **Full client** — threaded read + reply / reply-all / forward, rich-text body, attachments, templates, signatures, drafts |
| Data source | **Dataverse email records only** — no Microsoft Graph |
| Risk appetite | **GA preferred, preview acceptable** where it clearly wins and a fallback is documented |

## Headline finding

Desk research produced a clear front-runner, eliminated one candidate on hard platform facts, and
rejected three more on a MUST-requirement failure:

1. **Candidate C (generative page) cannot occupy either target placement.** Opening a generative page
   in a side pane is explicitly unsupported, there is no `generative` page type in CSW application tab
   templates, and generative pages connect only to Dataverse tables with a fixed list of supported
   data types that cannot express `activityparty` recipients or `activitymimeattachment` binaries.
2. **Multi-session state loss is the discriminator, not UI capability.** In CSW, web resources,
   external sites and custom pages all lose their in-memory state when the agent switches session or
   tab. For a mail client holding an unsent draft, that is a data-loss defect. **PCF is the only
   candidate with a state-preservation contract for exactly this destroy/reload cycle — and S1 has now
   verified it live** on the Case form tab placement (`state RESTORED`, `init #2`, no cross-session
   bleed). Note the teardown only fires between *concurrent record sessions*, not on every switch.
3. **The A+B hybrid resolves the two-placement requirement with one codebase.** Code components in
   custom pages are GA, so the same React PCF serves the Case form tab natively and the CSW session
   tab through a thin custom page wrapper. **Both placements are now spike-validated** (S1, S2), and
   the hybrid scores 81/84.

See [`07-decision.md`](07-decision.md) for the recommendation and its reversal conditions.

## Reading order

| File | Contents |
|---|---|
| [`01-requirements.md`](01-requirements.md) | What "native email experience" means, as a testable requirement catalogue |
| [`02-hosting-and-placement.md`](02-hosting-and-placement.md) | Placement × host support matrix, CSW configuration, multi-session behaviour |
| [`03-candidates.md`](03-candidates.md) | Per-candidate deep dive: build, deploy, APIs, ALM, licensing, limits |
| [`04-data-model.md`](04-data-model.md) | Dataverse email data model mapped against every MUST requirement |
| [`05-capability-matrix.md`](05-capability-matrix.md) | Weighted scorecard |
| [`06-spikes.md`](06-spikes.md) | Hands-on spike definitions and results |
| [`07-decision.md`](07-decision.md) | ADR: recommendation, runner-up, reversal conditions, carried risks |

## Research question status

Status values: **Answered** (desk research conclusive) · **Provisional** (desk research answered it,
but a spike should confirm) · **Spike required** (cannot be answered from documentation) · **Deferred**.

| RQ | Question | Status | Where |
|---|---|---|---|
| RQ1 | Can a PCF occupy a full Case form tab with mail-client real estate? Which flavour? | **Answered (measured)** — yes, but height must be claimed, not inherited | [02](02-hosting-and-placement.md), [06](06-spikes.md) |
| RQ2 | Which app tab template type hosts each candidate? Can a session template auto-open it with Case id? | **Answered (measured)** — `Custom` page type works; `caseId` needs an explicit input property | [02](02-hosting-and-placement.md), [06](06-spikes.md) |
| RQ3 | Can a generative page be reached from the Case form at all? | Answered — **no, for our placements** | [02](02-hosting-and-placement.md) |
| RQ4 | Code app behind an iframe: what breaks? | Answered (desk) | [03](03-candidates.md) |
| RQ5 | Does each candidate survive CSW multi-session? | **Answered (measured for PCF on a form tab)** — the discriminator | [02](02-hosting-and-placement.md), [06](06-spikes.md) |
| RQ6 | Rich-text compose and quoted-history handling per host | Provisional | [03](03-candidates.md), [04](04-data-model.md) |
| RQ7 | Attachments: create/read `activitymimeattachment`, real size ceilings | Answered (desk) | [04](04-data-model.md) |
| RQ8 | Sending: `SendEmail` vs statecode, server-side sync, draft and error handling | Answered | [04](04-data-model.md) |
| RQ9 | Templates & signatures instantiation from code | Answered | [04](04-data-model.md) |
| RQ10 | Threading fidelity available in Dataverse | Answered — **better than assumed**, and now **measured** (S8 partial) | [04](04-data-model.md), [06](06-spikes.md) |
| RQ11 | Copilot "draft with AI" parity | Answered | [03](03-candidates.md) |
| RQ12 | ALM / solution-awareness | Answered | [03](03-candidates.md) |
| RQ13 | Licensing per host | Answered | [03](03-candidates.md) |
| RQ14 | Dev loop quality and AI-codegen fit | Answered | [03](03-candidates.md) |
| RQ15 | Support posture and upgrade risk | Answered | [03](03-candidates.md) |

## Status of this pass

Phase 1 (desk research) is **complete**. Phase 2 (spikes) is **under way**:

- **S1 PASSED** live on 2026-09-10. `setControlState` survives a genuine two-Case-session
  destroy/reload with no cross-session bleed — the single assumption the recommendation rested on. It
  also **corrected** two claims: a subgrid cell on a form tab is content-sized (`height: 100%` yields
  nothing), and `regardingobjecttypecode` is not a queryable OData property.
- **S2 PASSED** live on 2026-09-10. `setControlState` **also survives teardown inside a custom page**
  (`state RESTORED`, `init #2`), the `caseId = Param("recordId")` binding delivers the Case id, and
  `context.webAPI` works at runtime there. The side-pane route renders too — correcting a
  treat-as-unsupported note — but gets **no record context**.
- **S8 partially run** (read-only), validating the threading strategy and correcting three claims.

The recommendation in [`07-decision.md`](07-decision.md) is now **measured on both target placements**
— form tab (S1) and custom page (S2) — so the hosting decision is settled. **S6** (attachment ceiling)
and **S7** (send round-trip, which also closes S8's `conversationindex` half) are the remaining gates,
and they test *functional* feasibility rather than hosting. S2 also surfaced a deployment cost: wiring
a custom page into the managed CSW app needs the app designer, per environment.
