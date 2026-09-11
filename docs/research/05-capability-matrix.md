# 05 — Capability matrix (weighted scorecard)

> **Weights are proposed, not yet ratified.** The plan requires agreeing weights with the stakeholder
> before scoring, so the scorecard cannot be reverse-engineered from a favourite. These are the weights
> proposed in the plan, applied as-is. See [Sensitivity](#sensitivity-does-the-answer-survive-reweighting)
> for whether the outcome actually depends on them — it does not.

Scale per criterion: **0** cannot do it · **1** possible with significant compromise · **2** works with
known friction · **3** does it well.

## Criteria and weights

| # | Criterion | Weight | Rationale |
|---|---|---:|---|
| C1 | Can occupy both target placements | 5 | A host that cannot sit on the Case form fails half of N2 |
| C2 | Full-client functional ceiling | 5 | Rich text, attachments, send, templates — the whole point |
| C3 | Multi-session correctness in CSW | 4 | Agents run several Cases at once; state bleed or draft loss is unforgivable |
| C4 | ALM / solution-awareness | 4 | Must ship dev → test → prod |
| C5 | Support posture & upgrade risk | 3 | GA-preferred |
| C6 | Dev velocity & AI-codegen fit | 3 | Affects cost, not viability |
| C7 | Licensing impact | 2 | |
| C8 | UI freedom / design ceiling | 2 | All candidates are adequate; low discriminating power |

## Scores

Column **A+A** was added on 2026-09-10 after S11, and it is now the recommended candidate. It is the
same PCF as A, on **two form placements** — no custom page.

| | **A+A (chosen)** | A+B hybrid | A — PCF alone | B — Custom page | C — Generative page | D — Code app (iframe) | E — HTML web resource |
|---|---:|---:|---:|---:|---:|---:|---:|
| C1 Both placements (×5) | **3** | **3** | 1 | 1 | **0** | 2 | 2 |
| C2 Functional ceiling (×5) | **3** | **3** | 3 | 1 | **0** | 2 | 2 |
| C3 Multi-session (×4) | **3** | **3** | **3** | **0** | — | **0** | **0** |
| C4 ALM (×4) | **3** | 2 | **3** | **3** | — | 1 | **3** |
| C5 Support posture (×3) | **3** | **3** | **3** | 2 | — | 2 | 1 |
| C6 Dev velocity (×3) | **3** | 2 | 2 | 2 | — | **3** | 1 |
| C7 Licensing (×2) | **3** | **3** | **3** | **3** | — | 1 | **3** |
| C8 UI freedom (×2) | **3** | **3** | **3** | 2 | — | **3** | 2 |
| **Weighted total** | **84** | 77 | 71 | 44 | *eliminated* | 47 | 48 |
| *out of 84* | **100%** | 92% | 85% | 52% | — | 56% | 57% |

Two changes from the previous table, both measured rather than argued:

- **A+B's C4 is now 2, not 3.** The optimism flagged below was confirmed: wiring the custom page into
  the managed CSW app is per-environment app-designer work, not solution-driven. Total drops 81 → 77.
- **A+A takes 3 on C4 and C6** where A+B took 2. On C4 because a form, an app tab template and a
  session template are all ordinary solution components — nothing needs the app designer beyond
  registering the form. On C6 because there is one artefact type and one dev loop (`pac pcf push`)
  instead of a PCF plus a canvas page that must be republished to pick up a new control build.

A+A scoring a clean 84/84 is a signal to be suspicious of, not proud of, so it is worth stating what
it does *not* mean: it is a 3 on **UI freedom** because a React PCF can render anything, not because
the mail UI is designed; and a 3 on **functional ceiling** because S6/S7 proved attachments and real
sending work, not because R11's editor is solved — that one is a carried risk with a known-but-unbuilt
path. The scorecard measures *host suitability*. It says the host will not be what defeats this build.

## Score justifications

Only the non-obvious scores are justified here; the rest follow directly from
[`02`](02-hosting-and-placement.md) and [`03`](03-candidates.md).

**C1 — A+A = 3, A+B = 3, A alone = 1 (revised 2026-09-10, S11).** A alone was scored 1 on the belief
that a bare PCF had no supported route to a CSW session tab, the `Control` template being "for internal
use only". **That reasoning skipped the `Entity record` page type**, which takes a `formId` and so
opens the same Case on a dedicated form hosting the PCF — a fully supported route with no second
hosting technology. A+A therefore takes the 3 that A+B earned the expensive way. And `Control` turned
out to be worse than unsupported: S11 measured that it **cannot pass the control a Case id at all**, so
it was never the fallback this row assumed.

**C1 — D/E = 2, not 3.** Both reach both placements, but through iframes: CSP `frame-ancestors` must be
edited in the admin center for D, context arrives by query-string plumbing rather than natively, and
nested-iframe sizing and focus is real work.

**C2 — B = 1.** Power Fx and canvas controls cannot realistically deliver R11 (paste-from-Word rich
text), R13 (chunked attachment upload), and the R4/R12 quote heuristics. It could host a code component
that does — which is precisely the hybrid, scored separately.

**C2 — D = 2, not 3.** The SPA itself has no functional ceiling, but the frame has no `Xrm`, so R19
(Copilot draft), notifications and navigation all require `postMessage` plumbing you own and maintain.

**C3 — A+A = 3, A+B = 3 (re-scored up from 2 on 2026-09-10).** This was originally discounted because
`setControlState` survival across a teardown was undocumented for the session-tab host. **It is now
measured on three hosts:** S1 on the Case form tab, S2 inside the custom page, and S11 on the chosen
`Entity record` session tab — each showing `state RESTORED` / `init #2` after a genuine
two-Case-session destroy/reload, with no cross-session bleed. (In S11 the control was verifiably torn
down, not merely hidden: zero mounted roots while the other session held focus.) The custom page's
documented "state is not persisted when switching between multi-session tabs" behaviour applies to the
*page's own* canvas state — a code component hosted in it still gets its `setControlState` back. Draft
durability in Dataverse remains recommended as defence in depth, not as a required workaround.

**C3 — B/D/E = 0.** Documented state loss on tab switch. See
[`02`](02-hosting-and-placement.md#rq5--csw-multi-session-behaviour-the-discriminator).

**C4 — D = 1.** Code apps "don't support Power Platform Git integration", and the code app and the web
resource hosting it travel between environments by different mechanisms.

**C4 — A+B re-scored 3 → 2 (S2 flagged it, S11 confirmed the alternative).** The score assumed both placements ship in one
solution. The PCF and the custom page do; **wiring the page into Copilot Service workspace does not.**
CSW is a Microsoft *managed* app, adding a custom page to it is an unmanaged customisation layer over
it, and it proved **not automatable** — `AddAppComponents` refuses `canvasapp`, `appmodulecomponent`
cannot be created directly, and CSW is not listed in the maker portal apps list. On the evidence this
is a **2**: per-environment manual app-designer work, not solution-driven. It has now been re-scored,
because S11 found the supported route that avoids the cost entirely — **A+A needs no custom page**, and
a form, an app tab template and a session template are all ordinary solution components.
See [`06-spikes.md`](06-spikes.md#s2-result--2026-09-10-passed-both-halves) and
[S11](06-spikes.md#s11-result--2026-09-10-passed-route-c-works-the-custom-page-is-unnecessary).

**C5 — E = 1.** No `context` API; reaching `Xrm` through `parent`/`window.top` is undocumented coupling
of the kind that breaks on platform updates.

**C7 — D = 1.** Code app end users need a **Power Apps Premium** license. Across a service-agent
population this is a direct per-seat cost and may be a hard commercial blocker independent of merit.

## Elimination

The plan's rule: **a 0 on a weight-5 criterion is elimination, not down-ranking.**

- **C is eliminated** — 0 on C1 (cannot occupy either placement) and 0 on C2 (data-type ceiling).

**A more important disqualification than the arithmetic.** B, D and E score **0 on C3**, and C3 encodes
**R16 and N1, both MUST requirements**. A candidate that cannot persist an in-progress draft across a
session switch does not meet the requirement set — regardless of its weighted total. The scorecard
ranks them at 44–48; the requirement catalogue rejects them outright. Do not read their mid-range
scores as "viable but weaker".

That leaves **A+A (84)**, **A+B (77)** and **A alone (71)** as the only candidates meeting the MUST
set. A alone as originally scored fails N2 (both placements) — but note that A+A *is* A, reaching the
second placement through a route this matrix had missed rather than through a second technology. The
practical reading is that PCF was always the answer and the only open question was how its session tab
is opened.

## Sensitivity — does the answer survive reweighting?

Yes. The outcome is not weight-sensitive:

- **A+A beats A+B on C4 and C6 and ties it everywhere else**, so no weighting prefers the hybrid. The
  hybrid can only win if the `Entity record` route regresses — and being a GA page type opening an
  ordinary form, it is the least likely thing here to do so.
- **Both beat A alone on C1**, the former C3 discount having been retired by measurement. Any weighting
  in which "both placements" matters at all favours them; if placement genuinely did not matter, N2
  would not be a MUST.
- **B, D and E are excluded by a MUST failure, not by weighted score**, so no reweighting rescues them.
  Only relaxing R16/N1 — accepting that agents lose in-progress drafts on session switch — would put
  them back in contention.
- **C is excluded by two hard platform facts**, not by judgement.

The one weight worth genuinely arguing about is **C7 (licensing, ×2)**. If the Power Apps Premium
requirement for code apps is not a blocker in this tenant, D's total rises but its C3 zero still fails
the MUST set. Licensing is therefore not decision-relevant here.
