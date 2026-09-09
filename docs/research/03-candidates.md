# 03 — Candidate architectures

One section per candidate. Placement conclusions live in [`02-hosting-and-placement.md`](02-hosting-and-placement.md);
this file covers how each is built and deployed, what APIs it gets, and its ALM, licensing, dev-loop
and support posture (**RQ4, RQ6, RQ11–RQ15**).

---

## A — React (virtual) PCF code component

**Build.** `pac pcf init` with a React/virtual control template; TypeScript + React + Fluent UI. A
virtual control shares the host's React and Fluent instances rather than bundling its own, cutting
bundle size and avoiding duplicate-React problems.

**Deploy.** Bundled into a solution as a single file and imported dev → test → prod. Fully
solution-aware, first-class in Power Platform Git integration.

**APIs available.** This is PCF's strongest suit for our use case:

| Need | API |
|---|---|
| Read/write email, activityparty, attachments | `context.webAPI` |
| Open forms, dialogs, files | `context.navigation` |
| Formatting, lookups, `openConfirmDialog` | `context.utils`, `context.factory` |
| Device features | `context.device` |
| **State across destroy/reload** | `context.mode.setControlState` — the documented survival contract |
| Layout | `context.mode.trackContainerResize`, `allocatedWidth/Height` |
| Copilot (RQ11) | `context.Copilot` — the Agent PCF API, sibling of `Xrm.Copilot` |
| Escape hatch | `window.Xrm` is reachable for anything not surfaced on `context` |

**RQ11 — Copilot parity: yes.** The Agent PCF API `context.Copilot` executes Copilot Studio agent
topics from inside a code component, mirroring `Xrm.Copilot` for MDA scripting. So R19 ("draft a reply
for me") is reachable in-component. ([Agent Xrm and PCF APIs](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/bring-intelligence-using-agent-apis))

**RQ6 — rich text.** No OOB editor is exposed to PCF; bring your own. Prior art is strong: several
TinyMCE-based rich-text PCF controls exist and ship in production
([PCF Gallery](https://pcf.gallery/model-driven-controls)). TinyMCE is the pragmatic choice given
paste-from-Word cleanup (R11) is a solved problem there. Note the licensing question for TinyMCE
commercial use is a procurement item, not a technical one; alternatives are ProseMirror/TipTap or
Lexical. **Bundling a third-party editor is the single largest bundle-size risk** for this candidate.

**ALM (RQ12).** ✅ Solution component, Git-integration supported.

**Licensing (RQ13).** Code components in a model-driven app connected to Dataverse mean **end users
need Power Apps licenses** — but D365 Customer Service Enterprise already confers the needed Power
Apps use rights within the app context. A component only becomes *premium by declaration* if it calls
external services directly, declared via `<external-service-usage>` in the manifest. Our Dataverse-only
scope avoids that.

**Dev loop (RQ14).** Good: `pac pcf push` for fast iteration, `npm start watch` gives a local test
harness with mocked context, standard React tooling and Jest for unit tests. Debugging is real browser
debugging with source maps. AI-codegen fit is fine but there is no Microsoft-blessed AI skill for PCF
the way there is for generative pages.

**Support posture (RQ15).** GA for years, documented API surface, not on-premises. Lowest upgrade risk
of any candidate.

**Limits.**
- Cannot be a CSW session tab directly (`Control` app tab type is internal-use-only) — needs the
  custom page wrapper.
- Must hand-roll the rich-text editor and the whole mail UI; no low-code shortcuts.
- Bundle size discipline matters; a heavy editor plus a mail UI in one control needs code-splitting.
- No Power Fx; everything is code (a plus for this team, a cost if handover is to low-code makers).

---

## B — Custom page (canvas-in-MDA)

**Build.** Power Apps Studio, Power Fx, responsive containers, optional embedded code components.

**Deploy.** Solution-aware, GA for runtime and ALM.

**Fit for our requirement.** Serves the session tab well (`Custom` app tab type with `recordId` and
`entityName` slugs) and cannot serve the Case form tab at all. Its real disqualifier is behavioural,
not positional:

- **State is not persisted across multi-session tab switches** — fatal for R16/N1 on its own.
- Canvas hosting session **times out after 8 hours** with a refresh prompt.
- **Third-party cookies required** — a real risk in locked-down enterprise browser policies.
- Connector consent dialogs are app-wide: "the consent dialog asks for data permissions for all of
  the connectors in all the custom pages even if they haven't yet been opened."
- Soft ceilings: don't exceed 25 custom pages per app, 10 connectors, 20 connection references.
- Users with no Power Apps privileges get an entitlement error.

**Where it still earns its place.** As the **thin wrapper hosting the PCF** for the session tab
placement — code components in custom pages are GA. In that role the page contributes almost no logic,
so most of the limitations above (Power Fx complexity, connector consent, page count) don't bite; the
state-loss and cookie issues still do, and must be mitigated in the component.

**Sources.** [Custom page overview](https://learn.microsoft.com/en-us/power-apps/maker/model-driven-apps/model-app-page-overview),
[Custom page known issues](https://learn.microsoft.com/en-us/power-apps/maker/model-driven-apps/model-app-page-issues).

---

## C — Generative page — ELIMINATED

Kept in the record for traceability. Eliminated on placement and on data-type ceiling; full reasoning
in [`02-hosting-and-placement.md`](02-hosting-and-placement.md#rq3--generative-pages-eliminated).

Worth noting what is genuinely attractive here, so the decision is not mistaken for dismissal:

- Generates **TypeScript and React** — the output is real code you can hand-edit, with `package.json`
  and `genpage.d.ts` for IntelliSense.
- The **recommended** authoring path is an AI codegen tool (GitHub Copilot CLI or **Claude Code**) via
  the `model-apps` plugin and `/genpage`; a single PAC CLI command transpiles, bundles, publishes and
  registers in the sitemap.
- Accepts `recordId`, `entityName` and `data` input parameters, and localization is handled
  automatically across environment languages.
- GA April 2026, worldwide in public clouds.

If the placement requirement ever relaxed to "a full page reached from a Case command bar button", this
candidate would return to contention for the *reading* half of the client — but not the compose half,
because of the data-type ceiling.

**Sources.** [Create and edit generative pages with AI code generation tools](https://learn.microsoft.com/en-us/power-apps/maker/model-driven-apps/generative-page-external-tools),
[FAQ about generative pages](https://learn.microsoft.com/en-us/power-apps/maker/common/faq-generative-pages-model-driven),
[Navigate to a generative page](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/navigate-to-generative-page-examples).

---

## D — Power Apps code app, surfaced via iframe

**Build.** Any SPA framework (React, Vue) in a code-first IDE, plus the `@microsoft/power-apps` client
library ("Power Apps SDK") and `power.config.json`. `pa app push` compiles and publishes into the
environment. Requires the **Power Apps code apps** environment feature to be enabled by an admin.

**RQ4 — what breaks when you embed it.** Embedding in an MDA is **officially answered as supported via
iframe**, with real friction:

1. Get the code app's **play URL** from Power Apps.
2. Add an **iframe HTML web resource** in the MDA pointing at that URL.
3. Update the **CSP `frame-ancestors`** directive in the Power Platform admin center to allow the MDA
   host. *Without this the frame is blocked.*
4. **Context is not automatic** — "passing MDA entity context (record ID, entity type) into the Code
   App isn't automatic"; pass them as query parameters on the iframe `src`, then read them via the code
   app's `getContext()` → `ctx.app.queryParams`.
5. Community finding: using an **External website** component instead of an HTML web resource creates
   **fewer nested iframes**, making parameter passing simpler, at the cost of customisation
   flexibility. In CSW this maps onto the `Third-party website` app tab type.

Source: [PowerAppsCodeApps #112](https://github.com/microsoft/PowerAppsCodeApps/discussions/112).

**Additional problems for our scenario.**
- **Loses state on CSW tab switch** (web resource / external site behaviour) — fatal for R16/N1.
- **No `Xrm` inside the frame** — the code app is a different origin, so form context, `Xrm.Copilot`
  (R19), notifications and navigation all require `postMessage` plumbing you write and maintain.
- **ALM (RQ12): weakest of all candidates.** Code apps "don't support Power Platform Git integration",
  and the app is deployed by CLI push rather than travelling in the solution with the web resource
  that hosts it — so the artefact and its host move through environments by different mechanisms.
- **Licensing (RQ13): end users need a Power Apps Premium license.** For a D365 Customer Service
  agent population this is a direct, per-seat cost question and may be the hard blocker regardless of
  the technical merits.
- Assets are served "from a publicly accessible endpoint that doesn't support IP-based restrictions";
  no SAS IP binding, and Secure Implicit Connections are not yet supported.
- Nested-iframe sizing, scroll and focus management inside a CSW tab is genuine, unglamorous work.

**Where it wins.** Best-in-class dev loop — plain Vite/React with hot reload, full npm ecosystem, no
PCF harness quirks — and the highest UI ceiling. If this were a standalone app rather than an
embedded, Case-scoped one, D would likely be the answer.

**Sources.** [Code apps overview](https://learn.microsoft.com/en-us/power-apps/developer/code-apps/overview)
(limitations list current as of 2026-09-04), [Code apps architecture](https://learn.microsoft.com/en-us/power-apps/developer/code-apps/architecture).

---

## E — Classic HTML + JS web resource

**Build.** Hand-rolled HTML/JS/CSS files as web resources. Free choice of framework, bundled yourself.

**Fit.** Can occupy both placements — a form tab and a `Web resource` app tab. Solution-aware, no
extra licensing beyond the app itself, no admin feature flags, no CSP changes.

**Why it still loses.**
- **Loses state on CSW tab switch** — same fatal R16/N1 problem as D.
- Microsoft's own framing: unlike HTML web resources, "code components render as part of the same
  context and load at the same time as any other components", giving "a seamless experience". A web
  resource is an iframe, and it looks and behaves like one — a direct hit on N7.
- No `context` API. You reach `Xrm` via `parent`/`window.top`, which is fragile and is exactly the
  kind of undocumented coupling that breaks on platform updates (RQ15).
- Nothing to reuse: no dataset binding, no security-trimmed paging, no theming, no state contract.

**Verdict.** Strictly dominated by A on every axis that matters here. Kept as the "if PCF is somehow
impossible" fallback.

---

## The recommended hybrid: A + B

One React PCF codebase, two host registrations:

| Placement | Host | Mechanism |
|---|---|---|
| Case form tab | The PCF, directly | Single-column form tab, dataset control bound to a subgrid of `email` regarding the Case |
| CSW session tab | The PCF inside a custom page | `Custom` app tab template → custom page → code component, with `recordId` = `{anchor.incidentid}` |

Both mechanisms are GA. Both placements ship in one solution. Multi-session state is handled once, in
the component, using `setControlState` plus a durable draft write — which the custom page wrapper needs
anyway. Full reasoning and residual risks in [`07-decision.md`](07-decision.md).
