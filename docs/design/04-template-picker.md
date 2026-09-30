# R22 — the template picker · design proposal for review

Issue [#8](https://github.com/PsymonDK/modeldriven-emailclient/issues/8). **Status: APPROVED 2026-09-30 and built (branch `r22-template-picker`, v1.28.0).** Decisions below. R22 supersedes R14: *Case templates in the agent's
language by default, an explicit way to switch language, and two clicks or fewer from compose to an
inserted template.*

---

## What the environment actually holds (measured 2026-09-30)

The issue listed these as open questions. Answers, from the demo environment:

| Question | Answer |
|---|---|
| How many Case (`incident`) templates? | **5**, all the out-of-the-box ones: *Case Auto Response*, *Case Escalation*, *Case resolution survey invite*, *Closed Case Acknowledgement*, *New Case Acknowledgement* |
| How is `template.languagecode` populated? | **1033 (English) on all 49 templates**, every type |
| What languages exist at all? | **Only 1033 is provisioned** (`RetrieveProvisionedLanguages`); the org base language is 1033 |
| The agent's own language? | `usersettings.uilanguageid` = **1033**; `localeid` = **1030 (Danish)** — an English UI with Danish formats |
| Personal templates (`ispersonal`)? | **None** exist here |

**The consequence that shapes the design:** in this environment a language filter has nothing to
filter. The language control must therefore **appear only when the Case templates span more than
one language**, or it is a control that does nothing — the exact thing the code base's own
`IconButton` comment warns against.

**The question the numbers raise, for the review to decide:** *whose* language? R22 says "the
agent's own language", which is the UI language (1033 here). But an agent with an English UI
answering Danish customers needs **Danish** templates. Options are listed under *Decisions needed*.

## How the standard email form does it (observed 2026-09-30)

*Insert Template* on the standard form first opens a **Select Record** dialog — *To* (the contact)
or *Regarding* (the Case) — because the template type follows the record chosen. Only then does it
list templates. That is an extra step our client does not need: a reply on a Case always uses
`incident` templates, which is also the only type `InstantiateTemplate` can resolve against a Case.

(Side finding while looking: opening a client draft in the standard form **autosaves it** even when
nothing is edited — the form marks the body dirty on load. The quote marker survived, so resume
still works; recorded in `06-spikes.md`.)

## A defect to fix first — templates overwrite the reply's subject

`TemplatePicker.apply` calls `onSubject(preview.subject)` whenever the template has a subject — and
every Case template here does. So inserting **any** template into a reply replaces
`RE: Test: kodegennemgang CRM:0100017` with the template's own subject: the **tracking token is
removed** (a product requirement says the client never does that), the `RE:` goes, and threading
loses its subject fallback. This predates R22 and should be fixed before it, on its own:
**a template never changes the subject of a reply or forward.**

---

## The proposal

### One click to open, one click to insert

```
Compose toolbar:  B  I  U  ·  📎  ·  [ Template ▾ ]                    ← click 1
                                   ┌──────────────────────────────────────────┐
                                   │ 🔍 Search templates                      │
                                   │ ──────────────────────────────────────── │
                                   │ Case Auto Response                        │  ← hover / ↓ shows
                                   │   Autoresponse to customers who…          │    the resolved
                                   │ Case Escalation                    ←──────┼──  preview on the
                                   │   Inform a customer that you have…        │    right (no click)
                                   │ Closed Case Acknowledgement               │
                                   │   …                                       │  ← click 2 inserts
                                   └──────────────────────────────────────────┘
```

- **Click 1** opens a popover anchored to the toolbar button — not a dialog, so the reply stays
  visible. Focus lands in the search box; typing filters instantly (5 templates today, but a real
  org has dozens).
- Each row is **title + the template's description** (the admin already wrote one for every
  out-of-the-box template), which is what makes the list scannable — today's `<select>` shows the
  title alone.
- **Hovering or arrowing onto a row shows the resolved preview** in a side panel — no click. It is
  resolved server-side on first sight and cached, exactly as today, so unfillable placeholders
  (`{!Case:Title;}`) are visible *before* anything is inserted.
- **Click 2 (or Enter) inserts** and closes the popover.

### Insert vs Replace without a third click

The distinction stays; it stops costing a click in the common case:

- **Editor holds only the signature** (nothing typed yet) → the template **fills the message above
  the signature**. That is the whole-letter case, and there is nothing to lose.
- **The agent has typed** → the template is **inserted at the cursor**. Nothing is ever destroyed by
  a single click.
- Either way a one-line bar follows in compose:
  *Inserted "Case Escalation" · **Undo** · **Replace the whole message instead***
  — so Replace is still one deliberate click away, and a wrong pick is one click to undo.

### Language

- **Default:** the agent's language (see *Decisions needed* for which one), and every row shows its
  language as a tag **only when** the list is mixed.
- **The control:** a language chip in the popover header (`English ▾`), rendered **only when Case
  templates exist in more than one language**. In this environment it would not appear at all.
- **Empty state, never a silent fallback:** *"No Case templates in Danish. [Show English templates]"*
  — the switch is explicit, because an agent who misses a silent language switch sends the customer
  a reply in the wrong language.

### Personal templates

Listed, under their own heading **My templates** above the organisation's, if the review agrees
(none exist here, so it costs nothing to support and cannot be seen yet).

### Keyboard and accessibility (N6)

Same menu-button pattern as the reading pane's "More actions": the button opens with Enter/↓,
focus goes to the search box, ↑/↓ move through results, Enter inserts, Escape closes and returns
focus. Rows are `role="option"` in a `listbox`; the preview panel is `aria-live="polite"`.

### What is deliberately NOT in scope

- Templates of other types (contact, account…). `InstantiateTemplate` cannot resolve them against a
  Case, which is also why the standard form's *Select Record* step is not reproduced.
- A slash command in the editor (`/` → template). A good follow-up for power users; not needed for
  ≤2 clicks.
- Editing templates. That stays in the platform.

---

## Decisions — taken 2026-09-30

1. **Default language: the agent's interface language** (`context.userSettings.languageId`).
2. **Personal templates: listed**, under *My templates*, above the organisation's.
3. **Click model: approved** — fill an empty message from the top, insert at the cursor once text is typed, Undo / Replace on the bar afterwards.
4. **Subject defect: fixed first**, on its own ([PR #16](https://github.com/PsymonDK/modeldriven-emailclient/pull/16)).

One refinement made while building: the language control also appears when every template is in **one language that is not the agent's** — otherwise that list would be shown with no control, which is the silent fallback R22 forbids (`domain/templatePicker.ts`, `showLanguageControl`).

## The questions as they were put at review

1. **Whose language is the default?**
   - (a) the agent's **UI language** (`uilanguageid`) — what R22 literally says;
   - (b) the agent's **locale** (`localeid`, Danish here) — closer to who the agent writes to;
   - (c) the **customer's** language — not modelled out of the box (no language on contact/Case),
     so it would need a field or a convention.
   *Recommendation:* (a) with the explicit switcher, and revisit (c) if templates in more than one
   language actually appear — today there is only English, so the choice changes nothing yet.
2. **Personal templates:** include under *My templates*? *Recommendation:* yes.
3. **The click model above** (fill-if-empty, insert-at-cursor otherwise, Undo/Replace bar after)?
4. **Fix the subject defect now**, as its own small change ahead of R22? *Recommendation:* yes — it
   breaks a product requirement today.

## Verified in the published app — 2026-09-30

- **1.28.0:** the list showed all five Case templates with their descriptions and **no language control** (all English, English UI). The preview resolved on sight. Click and keyboard (↓, Enter) both inserted; an empty message was filled above the signature; **Undo** restored the editor HTML exactly; **Replace** left only the template. The subject kept `CRM:0100017`. Closing left no draft.
- **1.29.0, the formatting note (#17):** *Case Auto Response* → "fonts and sizes"; *Case resolution survey invite* → "tables, fonts and sizes, colours and alignment"; the three plain templates → no note. The bar repeats it after inserting.
- **1.30.0:** the note ran on one line and was clipped (the compose chrome inherits `nowrap`); the popover now resets `white-space`. **Verified live:** the note wraps to three lines in its 260 px column with no overflow; Escape closes the picker.
