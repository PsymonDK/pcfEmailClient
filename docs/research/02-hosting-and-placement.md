# 02 — Hosting & placement

Answers **RQ1, RQ2, RQ3, RQ5**. This is the file that eliminates candidates.

## Placement 1 — a tab/section on the Case form

Only two things can be embedded into a model-driven **form** tab or section:

| Host | Can sit on a Case form tab? | Evidence |
|---|---|---|
| **A** React/virtual PCF | **Yes** — this is PCF's primary purpose | [PCF overview](https://learn.microsoft.com/en-us/power-apps/developer/component-framework/overview) |
| **B** Custom page | **No** | Custom pages are documented for full page, centre dialog, side dialog and app side pane — not form tabs. The form-embeddable canvas variant is the older, less-integrated *embedded canvas app*, which Microsoft advises against: "In most cases, use custom pages instead of embedded canvas apps." [Custom page overview](https://learn.microsoft.com/en-us/power-apps/maker/model-driven-apps/model-app-page-overview) |
| **C** Generative page | **No** | No form-designer embedding; `navigateTo` supports inline (`target:1`) and dialogs (`target:2`) only. [Navigate to a generative page](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/navigate-to-generative-page-examples) |
| **D** Code app via iframe web resource | **Yes**, indirectly — the web resource is on the form, the code app is inside it | [PowerAppsCodeApps #112](https://github.com/microsoft/PowerAppsCodeApps/discussions/112) |
| **E** Classic HTML/JS web resource | **Yes** | Long-standing capability |

### RQ1 — can a PCF really fill a tab?

Yes, but it must be built for it. Relevant mechanics:

- Model-driven apps **do not constrain** a component's height and width. Components "can grow to use
  either 100% of the space for grid components, or to a specific height required by the contents when
  rendering a field component."
- For grid-style components `allocatedHeight` returns **-1**, and the component "must use a CSS style
  to fill 100% of the available space."
- `trackContainerResize(true)` opts into receiving `allocatedWidth` / `allocatedHeight`, and layout
  changes arrive as an `updateView` with `"layout"` in `context.updatedProperties`.

Source: [TrackContainerResize](https://learn.microsoft.com/en-us/power-apps/developer/component-framework/reference/mode/trackcontainerresize),
[Code components best practices](https://learn.microsoft.com/en-us/power-apps/developer/component-framework/code-components-best-practices).

**Recommended flavour: a virtual (React) *dataset* component** bound to a subgrid of `email` records
regarding the Case, on its own single-column form tab. Rationale: the platform supplies paging and
security-trimmed data, and the React-virtual variant shares the host's React and Fluent instance
instead of shipping its own (measured: a 39.2 KiB bundle).

### CORRECTED by S1, 2026-09-10 — a subgrid cell is content-sized

The claim above originally read "dataset components get the 100%-of-space growth behaviour". **That is
wrong for this placement.** Measured live on the enhanced Case form in CSW:

- `allocatedHeight` = **-1**, as documented.
- **Every ancestor sized itself to the component's own `min-height`** — four levels of
  `pa-cu flexbox` parents all reported `cssHeight: 320px`, which was the component's `min-height`.

So the parent flexes to the child, not the reverse, and `height: 100%` resolves to nothing. The docs'
"grow to use either 100% of the space for grid components" applies to a **main grid or
related-records grid page**, not a subgrid cell on a form tab.

**A mail client must claim its height from the viewport**: `window.innerHeight - rootTop - gutter`,
recomputed on resize. Measured 658px and 552px at two window sizes. Width is fine unaided — it filled
1857–2262px.

This does not change the architecture choice (PCF is still the only host that can occupy a form tab),
but it does mean the layout is the component's responsibility, not the host's.
See [`06-spikes.md`](06-spikes.md#s1-result--2026-09-10-passed-observed-in-the-live-app).

## Placement 2 — a CSW session / application tab

Configured with an **application tab template** (Copilot Service admin center → Workspaces →
Application tab templates), then attached to a **session template** so it opens on Case open. The
available **page types** are a fixed list:

| Page type | Hosts our client? | Key parameters | Notes |
|---|---|---|---|
| Dashboard | No | `dashboardId` | |
| Entity list | No | `entityName`, `viewId` | |
| Entity record | No | `entityName`, `entityId`, `formId`, `data` | This is how the Case itself opens as the anchor tab |
| Search | No | `searchType`, `searchText` | |
| Third-party website | **Yes** — for D | `url`, `data` | iframe-hosted: "you can use this type to host only those websites that are compatible with iframe hosting" |
| Web resource | **Yes** — for D, E | `webresourceName`, `data` | |
| **Control** | **Not supportable** | — | Documented **"(for internal use only)"** |
| Custom | **Yes** — for B, and A via B | `name`, `entityName`, `recordId` | Hosts a custom page available in the app |

Source: [Manage application tab templates](https://learn.microsoft.com/en-us/dynamics365/customer-service/administer/application-tab-templates).

### RQ2 — passing the Case id into the tab

Solved, and solved well: tab template parameters accept **slugs** and **OData expressions** evaluated
against the anchor tab. For a Case-anchored session:

- `{anchor.incidentid}` — the Case GUID
- `{anchor.ticketnumber}` — the Case number
- `{anchor.entityName}` — resolves to `incident`
- An OData form of the shape `{$odata.incident.title.?$filter=...&$select=title}` — any column

So a `Custom` tab template pointing at our custom page receives `recordId` = the anchor Case GUID and
`entityName` = the anchor entity name. Every session has a non-closable **anchor tab**; the anchor tab
option in a template only appears when the type is `generic`.

### RQ3 — generative pages: eliminated

Three independent blockers, any one of which is fatal for our placements:

1. **No side pane.** Documented as *Unsupported*: opening a generative page with
   `Xrm.App.sidePanes.createPane()` "isn't currently supported" — "page content doesn't render."
2. **No CSW app tab type.** There is no `generative` page type in the application tab template list,
   so a session template cannot open one. A `Third-party website` tab aimed at the documented
   `main.aspx?pagetype=genux&...` URL is theoretically possible, but that URL form is labelled
   "external callers only" and would inherit every iframe and state problem listed below.
3. **Data-type ceiling.** Generative pages "can only connect to Dataverse tables and perform CRUD
   operations", restricted to: Choice, Currency, Customer, Date and Time, Date Only, Decimal Number,
   Floating Point Number, Image, Lookup, Multiline Text, Status, Status Reason, Text, Whole Number,
   Yes/No, Unique Identifier. That list cannot express `activityparty` recipient collections (R9) or
   `activitymimeattachment` binary bodies (R5, R13), and offers no route to the `SendEmail` action (R17).

Generative pages remain a strong fit for *read-oriented, table-shaped* pages reached from a command
bar. They are the wrong tool for a full mail client. **Candidate C is eliminated.**

## RQ5 — CSW multi-session behaviour: the discriminator

CSW deliberately tears down inactive tabs to manage memory. What survives differs sharply by host,
and it is documented per host:

| Host | Documented multi-session behaviour | Verdict for R16/N1 |
|---|---|---|
| **A** PCF | PCF advertises the "ability to handle being destroyed and reloaded for performance reasons **while preserving state**" — an explicit contract for this exact lifecycle. **Verified live 2026-09-10**: after switching between two Case sessions the control re-initialised and `setControlState` restored the draft text, with no cross-session bleed | **Survives** — measured, not just documented |
| **B** Custom page | "State is also not persisted when switching between multi-session tabs in multi-session apps." Also: the canvas hosting session can time out after 8 hours, and third-party cookies are required | **Loses state** |
| **D / E** Web resource or third-party website tab | "When a representative switches from the web resource type of tab template to another tab, and then switches back… the page is refreshed to the initial state." Corroborated in the side-pane docs: "when an external site or web resource is opened, the state isn't restored" | **Loses state** |

Sources: [Custom page known issues](https://learn.microsoft.com/en-us/power-apps/maker/model-driven-apps/model-app-page-issues),
[Manage application tab templates](https://learn.microsoft.com/en-us/dynamics365/customer-service/administer/application-tab-templates),
[Create app side panes](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/create-app-side-panes).

**A nuance from S1, worth not over-reading.** The teardown is **not** triggered by every switch. A
Home ↔ Case session switch and an in-session tab switch both left the control mounted (`init #1`, React
state simply never lost). Only switching between **two concurrent record sessions** produced a real
destroy/reload. So "CSW tears controls down on every switch" is too strong — the eviction is driven by
memory pressure across concurrent sessions, which is precisely the situation where an agent has a
half-written reply open.

**Why this decides the architecture.** An agent working three Cases will switch sessions mid-reply.
Under B, D or E the half-written reply is gone with no warning — a data-loss defect against R16 and
N1, not a polish issue. Mitigations exist (persist the draft to Dataverse or `localStorage` on blur
and on an interval) but they are workarounds layered over a host that fights the requirement, whereas
PCF offers a first-class state contract.

## Side panes — a bonus placement, worth noting

Not a stated requirement, but relevant to future flexibility. `Xrm.App.sidePanes.createPane` is
documented for `entitylist`, `entityrecord`, `webresource` and custom pages, with `alwaysRender` to
keep pane content across tab switches, a 300px minimum width, and browser-only support (no native
players). PCF in a side pane via `pageType: "control"` plus `controlName` is **community-documented
only** ([Aric Levin](https://www.ariclevin.com/powerapps/post/pcf-control-in-side-pane/)) and does not
appear in the official article. Generative pages are explicitly excluded.

**CORRECTED by S2, 2026-09-10 — the side-pane route works, but has no record context.**
`createPane` + `pane.navigate({pageType:'control', controlName:'jhrb_JHRB.CaseEmailClient'})` **rendered
the control**, with `allocatedWidth` equal to the requested pane width. So "treat as unsupported" was
too pessimistic — it functions, it is just undocumented.

The real limitation is different and worse: **`context.mode.contextInfo` is empty in a side pane**, and
`Xrm.Utility.getPageContext()` yields nothing usable. `pageType: "control"` has no documented parameter
mechanism, so a Case-scoped component would need its record id delivered out of band. That makes the
side pane the weakest of the three placements for this project, despite rendering correctly.
See [`06-spikes.md`](06-spikes.md#s2-result--2026-09-10-passed-both-halves).

## Summary matrix

✅ supported · ⚠️ works but with a documented defect · ❌ not possible

| | A — React PCF | B — Custom page | C — Generative page | D — Code app (iframe) | E — HTML web resource |
|---|---|---|---|---|---|
| Case form tab | ✅ | ❌ | ❌ | ⚠️ | ⚠️ |
| CSW session tab | ❌ direct (`Control` is internal-use-only) · ✅ **via a custom page wrapper** | ✅ | ❌ | ⚠️ | ⚠️ |
| Case id passed in | ✅ | ✅ | ✅ (but placement fails) | ⚠️ query-string plumbing | ⚠️ `data` param |
| Multi-session state | ✅ documented contract | ❌ | n/a | ❌ | ❌ |

**The only way to satisfy both placements with one codebase and keep multi-session state is the
A+B hybrid: a React PCF on the Case form tab, and the same PCF hosted inside a thin custom page for
the session tab.** Code components in custom pages are GA. Note that the wrapper inherits the custom
page's state-loss behaviour, so draft durability must be solved inside the component regardless — see
[`07-decision.md`](07-decision.md).
