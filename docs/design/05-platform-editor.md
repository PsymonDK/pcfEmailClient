# Hosting the Dynamics editor in compose · recommendation and build plan

Issue [#17](https://github.com/PsymonDK/modeldriven-emailclient/issues/17), spike **S14**
([`docs/research/06-spikes.md`](../research/06-spikes.md) → S14). **Status: DECIDED 2026-09-30 — building** (branch `platform-editor`). The decisions below override parts of the recommendation that follows.

## Decisions — 2026-09-30 (product owner)

1. **Go.** Host the platform editor in compose.
2. **No kill switch.**
3. **Full toolbar** — Microsoft's email toolbar. Our config file must stay **editable in a managed solution**, so the web resource ships with *Can be customized* = true and admins can change the toolbar later without a release.
4. **No TipTap — not even as a fallback.** Nothing has shipped yet, and an unused second editor is wasted bundle, wasted resources and a worse experience. **When the platform editor cannot load, the fallback is the standard email form**: compose says so and offers *Open in the email form*, which saves the draft and opens it there (the dialog the reading pane already uses).

Consequences for the plan below: phase A's seam shrinks to replacing `ui/Editor.tsx` in place behind the existing `EditorHandle`; phase D becomes "mount or offer the standard form"; the R22 formatting note goes away (nothing is simplified any more); TipTap and its link extension leave `package.json`.

---

## Recommendation (as written before the decisions)

**Build it, behind an automatic fallback.** Replace TipTap as the compose editor with the Dynamics
rich text editor (`MscrmControls.RichTextEditorV2.RichTextEditorControlV2`), hosted inside our
control through `context.factory`, configured by **our own** copy of the email editor's
configuration shipped in the solution. Keep TipTap, and fall back to it automatically whenever the
platform editor cannot be mounted — so a platform change degrades formatting, never compose.

**Why:**

- **Fidelity.** Templates, signatures and pasted Outlook/Word content keep their formatting. Measured:
  *Case resolution survey invite* round-trips with its tables, colours, backgrounds, fonts and link
  intact; TipTap keeps none of that. It also retires R22's "formatting will be simplified" note on
  the normal path.
- **One editor for agents.** The same toolbar, shortcuts, paste handling and accessibility help
  they already use in the standard email form — instead of a second, weaker editor whose B/I/U
  buttons have never been wired.
- **Proven in the published app** (S14, 2026-09-30): it mounts, is editable, reads and writes HTML,
  signals every change, leaves the Case record untouched, survives a CSW session switch by
  re-mounting, fits the compose area once we size it, and is ready in ~0.8 s.

**The risk, stated plainly:** `createComponent` / `bindDOMComponent` and the parameter shape they
need are **undocumented** (the typings expose 2 of the factory's 11 members). Microsoft can change
them in any release, and Microsoft Support will not help with problems caused by using them. The
configuration route (`configUrl` and its format) **is** documented. The fallback, an admin kill
switch and a live check each release are how that risk is carried — see below.

## What S14 measured

| Question | Answer |
|---|---|
| What is the shipped editor? | A commercially licensed **CKEditor 5** build, 210 plugins, incl. `GeneralHtmlSupport` (arbitrary HTML), tables, fonts, colours, alignment, images; plus Microsoft's Copilot, Email Assist and Translate |
| Can we use the engine directly? | **No — licensing.** The build and its licence key are Microsoft's. We host Microsoft's control in Microsoft's platform; we do not redistribute CKEditor |
| Does it mount inside our control? | **Yes**, with a static `value`, `configUrl` and `isReadOnly: false` (S10 lacked the last two) |
| Editable, readable? | Typing lands; `getData()`/`setData()` work; `change:data` fires |
| Template formatting? | Tables 3→3, colours 7→7, backgrounds 3→3, fonts kept, links kept, alignment 3→2 (`align=`, documented unsupported) |
| Side effects on the Case? | None — the form stays not dirty |
| Can we tailor it? | **Yes, with our own config copy:** toolbar, default font and height all honoured. **Copilot, Email Assist and Translate buttons cannot be removed by config** — they are admin-governed |
| Fit in compose? | Toolbar fits one row (overflow → *More items*); **height must come from our config** + our own measurement |
| CSW session switch? | Removed with our control; **re-mounting with the new context and same id works**, text restored via `setData` |
| Load cost? | ~0.8 s to editable (warm), 0.35 s second mount; ~1.5–2 s once per browser when cold (4.9 MB bundle) |
| Dark mode? | Not verified; **deprioritised** by the product owner |

## How each risk is carried

| Risk | Handling |
|---|---|
| **The factory API changes** | Mount is attempted when compose opens and must reach *editable* within a timeout (8 s); any error, a read-only instance, a missing factory member or the timeout → **TipTap, silently**, remembered for the rest of the session so an agent never waits twice. Compose never depends on the platform editor being there |
| **It breaks in production before we notice** | An **admin kill switch** — a new `jhrb_useplatformeditor` column on `jhrb_emailclientsetting` (default *yes*) — forces TipTap without a release. Plus a line in the release checklist: verify the platform editor live after each Microsoft release wave |
| **Microsoft Support** | Documented in the runbook: the platform editor is hosted through an undocumented API; problems are ours, and the kill switch is the first response |
| **Copilot / Email Assist / Translate buttons** | They come with the editor and are governed by the tenant's Copilot settings, not by us. Accepted. (Side effect worth checking: Copilot drafting in compose may cover R19 without any work of ours) |
| **Load time** | Mount lazily when compose opens, with the existing editor skeleton meanwhile; the timeout above bounds the worst case |
| **Height** | Our config sets a small starting height; a `ResizeObserver` on the editor feeds compose's existing growth rule (`composeHeight`), exactly as TipTap's height does today |
| **Arbitrary HTML in, arbitrary HTML out** | `GeneralHtmlSupport` keeps whatever is pasted. Our sanitiser stays the gate: `getData()` goes through `sanitiseEmailBody` (outgoing rules) before save and send, and `stripQuoteMarkers` still applies |
| **Pasted images** | Not yet measured. By default the editor uploads pasted images to `msdyn_richtextfiles`; in an email they must end up as inline attachments the recipient can see. **Build-plan item E6 measures this with a real send before shipping** |

**Unchanged invariants.** R12 — *the inherited quote never enters the editor* — holds: the platform
editor edits only the new text; the quote stays opaque beneath it and is appended verbatim at send.
The tracking token is never touched. Selection, drafts, send order and pre-flight are unaffected.

## Build plan

Each phase ends green (tests, lint, typecheck, build) and is deployable on its own.

**A — An editor seam, no behaviour change.** Extract a `ComposeEditor` interface from today's
`EditorHandle` — `getHTML`, `setHTML`, `insertHTML`, `insertHTMLAtStart`, `undo`, `focus`, plus
`onChange` / `onHeightChange` / `destroy` — and make `ui/Editor.tsx` (TipTap) implement it. Compose,
templates, signature, drafts and send talk only to the interface.
*Done when:* every existing test passes unchanged.

**B — `ui/PlatformEditor.tsx`.** Implements `ComposeEditor` by mounting the platform editor:
`index.ts` passes `context.factory` down; mount with a static `value` (the initial HTML), our
`configUrl` and `isReadOnly: false`, under a component id unique to the compose session; readiness
= an editable CKEditor instance; `change:data` → `onChange`; `ResizeObserver` → `onHeightChange`;
`unbindDOMComponent` on destroy. CKEditor calls are confined to this file.
*Done when:* unit tests with a fake factory cover mount, ready, change, height, destroy.

**C — Our editor configuration in the solution.** `jhrb_/CaseEmailClient/EmailRTEconfig.js`,
derived from `msdyn_EmailRTEconfig.js`: toolbar agreed with the product owner, a starting height
that suits compose, the default font, and the image policy from E6. Shipped in the solution,
versioned with it, and listed in [`docs/deploy/install.md`](../deploy/install.md).

**D — Choosing the editor, and the fallback.** At compose open: kill switch off → TipTap; otherwise
try `PlatformEditor`, and on error / read-only / missing factory / timeout → TipTap, remembered per
session. The `jhrb_useplatformeditor` column is added to the settings table (solution) and read with
the existing settings.
*Done when:* shell tests show each failure mode landing on TipTap with compose fully usable.

**E — Integrations, through the seam.**
1. Signature seeding and draft resume via `setHTML`; M11 restore re-mounts after a session switch.
2. Templates: insert at cursor / fill above the signature / Undo / Replace, via CKEditor's own
   commands behind `ComposeEditor`. R22's formatting note shows **only** when TipTap is active.
3. Save and send: `getHTML()` → `sanitiseEmailBody` (outgoing) → `buildOutgoingBody`; `stripQuoteMarkers` unchanged.
4. Our disabled B/I/U row disappears when the platform editor is active (its own toolbar replaces it).
5. Keyboard: Tab order through compose still reaches Send.
6. **Pasted images:** paste an image, save, send to the approved test address, and confirm it arrives
   visible; fix the config's image policy if not.

**F — Verification in the published app** (the checklist that decides shipping): a template with
tables inserts with formatting; a formatted reply sent to the approved test address **arrives
formatted**; a pasted image arrives; draft resume and *Continue draft* keep formatting; a CSW
session switch restores the text; the kill switch forces TipTap; a forced mount failure falls back
without the agent noticing more than the simpler toolbar.

**G — Close-out.** Delete the spike config web resource and retire the spike build; update
CLAUDE.md (S10's "do not build on it" is superseded by S14 — with the fallback rule), `06-spikes.md`
(S14 conclusion) and the project plan.

**Rough size:** A ½ day · B 1–1½ · C ½ · D ½ · E 1½–2 · F 1 · G ½ — **about 5–7 working days**.

## Decisions needed

1. **Go / no-go** on hosting the platform editor behind the fallback.
2. **The kill switch** — add `jhrb_useplatformeditor` to the settings table? *Recommended: yes* — it
   is the only way to react to a breaking platform change without a release.
3. **The toolbar** agents get: Microsoft's full email toolbar, or a trimmed set? (Copilot, Email
   Assist and Translate appear either way.)
4. **TipTap's future:** keep it as the permanent fallback (recommended while the API is
   undocumented), or plan to remove it once the platform editor has run a few release waves
   without a fallback.
