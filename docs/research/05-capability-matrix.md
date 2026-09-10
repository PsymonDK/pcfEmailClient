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

| | **A+B hybrid** | A — PCF alone | B — Custom page | C — Generative page | D — Code app (iframe) | E — HTML web resource |
|---|---:|---:|---:|---:|---:|---:|
| C1 Both placements (×5) | **3** | 1 | 1 | **0** | 2 | 2 |
| C2 Functional ceiling (×5) | **3** | 3 | 1 | **0** | 2 | 2 |
| C3 Multi-session (×4) | 2 | **3** | **0** | — | **0** | **0** |
| C4 ALM (×4) | **3** | **3** | **3** | — | 1 | **3** |
| C5 Support posture (×3) | **3** | **3** | 2 | — | 2 | 1 |
| C6 Dev velocity (×3) | 2 | 2 | 2 | — | **3** | 1 |
| C7 Licensing (×2) | **3** | **3** | **3** | — | 1 | **3** |
| C8 UI freedom (×2) | **3** | **3** | 2 | — | **3** | 2 |
| **Weighted total** | **77** | 71 | 44 | *eliminated* | 47 | 48 |
| *out of 84* | **92%** | 85% | 52% | — | 56% | 57% |

## Score justifications

Only the non-obvious scores are justified here; the rest follow directly from
[`02`](02-hosting-and-placement.md) and [`03`](03-candidates.md).

**C1 — A+B = 3, A alone = 1.** The hybrid gets both placements through GA mechanisms. PCF alone gets
the form tab natively but has no supported route to a CSW session tab, because the `Control`
application tab template type is documented "for internal use only".

**C1 — D/E = 2, not 3.** Both reach both placements, but through iframes: CSP `frame-ancestors` must be
edited in the admin center for D, context arrives by query-string plumbing rather than natively, and
nested-iframe sizing and focus is real work.

**C2 — B = 1.** Power Fx and canvas controls cannot realistically deliver R11 (paste-from-Word rich
text), R13 (chunked attachment upload), and the R4/R12 quote heuristics. It could host a code component
that does — which is precisely the hybrid, scored separately.

**C2 — D = 2, not 3.** The SPA itself has no functional ceiling, but the frame has no `Xrm`, so R19
(Copilot draft), notifications and navigation all require `postMessage` plumbing you own and maintain.

**C3 — A+B = 2, not 3.** Honest discount, and the discount is now **half retired**. S1 confirmed live
(2026-09-10) that `setControlState` genuinely survives a two-session destroy/reload on the **form tab**
placement, with no cross-session bleed — so candidate **A alone scores a measured 3**. The hybrid stays
at 2 only because the **custom page wrapper** half is still unverified: it carries the documented
"state is not persisted when switching between multi-session tabs" behaviour, and whether
`setControlState` survives a custom-page teardown remains undocumented. **S2 now owns that question.**
Draft durability must be solved in the component regardless.

**C3 — B/D/E = 0.** Documented state loss on tab switch. See
[`02`](02-hosting-and-placement.md#rq5--csw-multi-session-behaviour-the-discriminator).

**C4 — D = 1.** Code apps "don't support Power Platform Git integration", and the code app and the web
resource hosting it travel between environments by different mechanisms.

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

That leaves **A+B (77)** and **A alone (71)** as the only candidates meeting the MUST set, and A alone
fails N2 (both placements).

## Sensitivity — does the answer survive reweighting?

Yes. The outcome is not weight-sensitive:

- **A+B beats A alone on C1 and loses nothing except the C3 discount.** Any weighting in which "both
  placements" matters at all favours the hybrid; if placement genuinely did not matter, N2 would not be
  a MUST and the requirement would have been different.
- **B, D and E are excluded by a MUST failure, not by weighted score**, so no reweighting rescues them.
  Only relaxing R16/N1 — accepting that agents lose in-progress drafts on session switch — would put
  them back in contention.
- **C is excluded by two hard platform facts**, not by judgement.

The one weight worth genuinely arguing about is **C7 (licensing, ×2)**. If the Power Apps Premium
requirement for code apps is not a blocker in this tenant, D's total rises but its C3 zero still fails
the MUST set. Licensing is therefore not decision-relevant here.
