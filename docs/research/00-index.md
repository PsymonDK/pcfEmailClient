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
   candidate with a documented state-preservation contract for exactly this destroy/reload cycle.**
3. **The A+B hybrid resolves the two-placement requirement with one codebase.** Code components in
   custom pages are GA, so the same React PCF serves the Case form tab natively and the CSW session
   tab through a thin custom page wrapper.

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
| RQ1 | Can a PCF occupy a full Case form tab with mail-client real estate? Which flavour? | Provisional | [02](02-hosting-and-placement.md), [03](03-candidates.md) |
| RQ2 | Which app tab template type hosts each candidate? Can a session template auto-open it with Case id? | Answered | [02](02-hosting-and-placement.md) |
| RQ3 | Can a generative page be reached from the Case form at all? | Answered — **no, for our placements** | [02](02-hosting-and-placement.md) |
| RQ4 | Code app behind an iframe: what breaks? | Answered (desk) | [03](03-candidates.md) |
| RQ5 | Does each candidate survive CSW multi-session? | Answered — **the discriminator** | [02](02-hosting-and-placement.md) |
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

Phase 1 (desk research) is **complete**. Phase 2 (spikes) has **started**: the target environment is
confirmed (the demo environment, with CSW present) and **S8 has run in read-only form**, validating
the threading strategy and correcting two claims in [`04-data-model.md`](04-data-model.md). Every other
spike is recorded as not run, with the specific claim it would confirm.

The recommendation in [`07-decision.md`](07-decision.md) remains a **desk-research recommendation**,
still gated on **S1, S6 and S7** — S1 in particular, because it holds the one genuinely undocumented
question (whether `setControlState` survives teardown inside a custom page).
