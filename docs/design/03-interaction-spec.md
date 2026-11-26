# 03 — Interaction spec

Everything on the canvas that is behaviour rather than appearance. Where a number appears here it is
binding: these are the values the build implements, and several were measured rather than chosen.

---

## 1. The height budget — binding

Measured live on 2026-09-10, and **corrected on 2026-09-11** after deploying the real control.

The original reading was 1600 × 536 on the Case form tab and 1627 × 536 on the session tab. Those
numbers were right for the chrome that happened to be on screen at the time. Three readings from the
same form on 2026-09-11 gave:

| Chrome showing | `allocatedWidth` | Top edge | Height claimed |
|---|---:|---:|---:|
| Copilot pane open, process bar | 1354 | 455px | **531px** |
| Copilot pane open, process bar collapsed | 1354 | 325px | **661px** |
| Customer Details pane open, process bar | 1414 | 515px | **471px** |

So the budget is a **range of roughly 471–661px**, not a constant, and width is commonly **1354–1414**
rather than 1600 because agents run with a side pane open.

**Design to the floor: 471px, and 1354px wide.** That is ~190px less height than the original figure
and ~250px less width. The layout must not assume more. Everything below still holds — the fixed
regions are unchanged, so what flexes is the scroll region:

| At | Scroll region left |
|---|---:|
| 661px (best case) | 493px |
| 536px (original sample) | 368px |
| **471px (measured floor)** | **303px** |

**These figures are corrected.** An earlier version of this table listed the 36px list footer as a
fixed cost and then failed to subtract it, giving 404px at 536px. Including it — as the code does —
the honest numbers are above: **303px at the floor, about four collapsed thread rows, not five.**

The arithmetic now lives in `domain/layout.ts` as `budgetFor()`, with tests that reproduce all three
measured height readings, so the table and the build cannot drift apart again.

`allocatedHeight` is **−1 on both placements**, so height is **claimed from the viewport**
(`window.innerHeight − rootTop − gutter`), never inherited. One code path, no per-placement branch.

**Width must be claimed too — measured 2026-09-11.** Setting height alone produced a control
**588px wide inside a full-width tab**, because the host cell's ancestors content-size their
child. It is the identical trap, on the identical hosts. The rule is therefore: **claim both
dimensions, inherit neither.** `width: 100%` on the root is enough for width; height needs the
viewport calculation.

| Region | Height | Grows? |
|---|---:|---|
| Card padding (8 top + 8 bottom) | 16 | no |
| Card header | 44 | **no** |
| Search field + filter chips | 72 | no — left card only; first to collapse under pressure |
| List footer (parent-case link) | 36 | no — left card only |
| **Scroll region** | **≥ 303** | **yes — everything that grows lives here** |
| Compose, when docked | 222 → ~380 ceiling | yes, taken from the reading pane |

### Three rules that follow, and they are not negotiable

1. **Exactly one scroll region per card.** A scrollbar inside a scrollbar is the failure this budget
   exists to prevent.
2. **Nothing above the scroll region may grow.** Header, search and chips are fixed heights. A toolbar
   that wraps to a second line silently eats the reading area and nobody notices until it ships.
3. **Compose is docked, not overlaid.** At 222px it leaves 189px of the reading pane visible at the
   floor, which is the point of composing in place — you can still see what you are answering.

### Breakpoint

| Width | Layout |
|---|---|
| ≥ 900px | Two-pane. Left list fixed at 424px |
| < 900px | One column. Selecting a thread swaps the column and offers `← Back to N threads` |

900 is not a guess: the list needs 424px to keep subject and snippet legible, and a body needs ~420px
before Outlook tables and quoted headers wrap badly. Below their sum, showing both costs more than it
gives. Reachable in practice (half-screen browser, 1280px second monitor); not a phone case — Copilot
Service Workspace is not used on phones.

Handle `"layout"` in `context.updatedProperties` and call
`context.mode.trackContainerResize(true)` in `init`.

---

## 2. Keyboard

### Tab stops — 9, not 60

| # | Stop | Inside it |
|---|---|---|
| 1 | Search field | — |
| 2 | Card header icon row | `←` `→` between icons |
| 3 | Filter chips | `←` `→`, `Delete` removes |
| 4 | **Thread list — one stop** | `↑` `↓` move · `Enter` open · `Ctrl+U` toggle read |
| 5 | `Reply all` | — |
| 6 | `Forward` | — |
| 7 | **Message stack — one stop** | `↑` `↓` between messages · `Space` expand/collapse · `→` into attachments |
| 8 | Injected-notices fold | `Enter` / `Space` |
| 9 | Quoted-history fold | `Enter` / `Space` |

**Lists and message stacks are one tab stop each, with arrow keys inside.** Tabbing through 50 rows to
reach a button is technically accessible and practically unusable; it is also the most common
accessibility failure in a custom mail list. Focus within a region is **remembered** when you leave and
return.

When compose opens, focus moves **into the editor** and the compose surface becomes stops 10–14
(recipients, toolbar, editor, quote fold, Send). `Esc` in compose returns focus to the message being
replied to without discarding the draft.

### Shortcuts

| Keys | Action |
|---|---|
| `↑` `↓` | Move within a list or message stack |
| `Enter` | Open the focused thread |
| `Space` | Expand / collapse the focused message |
| `Esc` | Back out one level (compose → thread → list) |
| `Ctrl+R` | Reply |
| `Ctrl+Shift+R` | Reply all |
| `Ctrl+Shift+F` | Forward |
| `Ctrl+Enter` | Send |
| `Ctrl+U` | Toggle read / unread |
| `/` | Jump to search |

**Check every one of these for collisions before shipping.** Dynamics claims shortcuts, the browser
claims shortcuts, and the editor core will claim more. Any collision is resolved in the platform's
favour — we are the guest here. `Ctrl+R` in particular is browser reload and must be captured only
while focus is inside the component.

### Focus appearance

2px `colorStrokeFocus2` ring, offset outward, on every interactive element including the hand-built
rows and drop zone. Visible on a light and a dark background. Never removed, never replaced by a
background-colour change alone.

---

## 3. Reading behaviour

### Mark read — on dwell

A message is marked read when **both** hold continuously for **~1.5 seconds**:

- it is **expanded**, and
- it is **on screen** (intersecting the scroll region).

Explicitly not read: scrolling past a collapsed row; expanding then immediately collapsing; a thread
opened and closed inside the dwell window. `Ctrl+U` toggles manually and always wins. Keyboard-expanded
messages follow the same rule, so the experience does not depend on using a mouse.

Why: agents open a thread and skim. Mark-on-expand marks messages read that were never read, and the
cost is a message the agent believes they have dealt with.

### Expand / collapse

- Clicking a collapsed message expands it **in place** and lazily fetches its body.
- A thread opens with the **newest unread** message expanded; if all are read, the newest.
- Earlier messages collapse into one `N earlier messages ⌄` row rather than listing every one.
- Expansion state, scroll position and the active compose target all persist across a session switch.

### Body loading

Bodies are fetched **one at a time, on expand** — never in the list query. Email bodies now live in
blob storage, so pulling a whole thread's bodies up front is what makes a 50-message case slow.

| State | Shown |
|---|---|
| Loading | Inline shimmer inside that message only |
| Loaded | Sanitised, contained, `cid:` images resolved |
| Failed | Inline `Message text couldn't be loaded. Retry` — **scoped to that message**, never blanking the thread |

Bodies are cached per message for the component's lifetime, and **not** written into the preserved
state (size, and they are re-fetchable).

### Folds

| Fold | Default | Control |
|---|---|---|
| Injected notices (R21) | **Collapsed** | `3 notices added by your organisation · View more ⌄` |
| Quoted history (R4) | **Collapsed** | `Trimmed content — N earlier messages · View more ⌄` |
| Signature | **Never folded** | De-emphasised grey below a hairline rule |

Fold state persists **per agent**. Nothing is ever deleted, and expanded quotes render **as received** —
indented by nesting depth, never re-serialised.

**The governing rule: when detection confidence is low, show the content.** Confidence tiers are in
[`01-design-decisions.md`](01-design-decisions.md#1-policy-injected-content-folded-not-hidden).

---

## 4. Compose behaviour

### Opening

Three entry points, one surface: per-message icons at the right of a message row; the thread-level
`Reply all` in the card header; `Ctrl+R` / `Ctrl+Shift+R` / `Ctrl+Shift+F`.

The context bar always names **which message is being answered** — in a six-message thread that is
genuinely ambiguous, and getting it wrong sends an answer to the wrong person.

### Growth

| Content | Height |
|---|---|
| Opens at | 222px — editor ≈ 3 lines |
| Past line 3 | grows to ~300px |
| Ceiling | ~380px, half the pane |
| Beyond | the editor scrolls internally, or pop out |

**It never shrinks back while the agent is typing.** Layout that jumps under the cursor is worse than
layout that is slightly too small.

### Recipients — reply-all resolution

Given a message where Kim wrote to Care with Morten and Anne on Cc:

| Field | Contents |
|---|---|
| To | prior **sender** (Kim), plus prior To promoted (Morten, the customer) |
| Cc | prior Cc (Anne) |
| Excluded | **our own sending mailbox** (Care) · **the agent's own address** · **every Bcc** |

Bcc never propagates — carrying it forward discloses a hidden recipient. Duplicates are removed
**case-insensitively on the address**, not the display name; the same person routinely appears under
two spellings across a chain.

Subject is **inherited and hidden** behind an `Edit subject` link. Editing it breaks threading.

### The quote

**The inherited quote never enters the editor.** Read-only, folded, below the editor; appended
**verbatim** at send. Test the closed loop: splitting our own emitted message must return the new text
and the inherited quote byte-for-byte unchanged.

### Templates and Copilot

- Tokens are **resolved before insert**, and the preview highlights what was filled, so an unfillable
  token is visible to the agent rather than posted to a customer as `{!Case:Title;}`.
- **`Insert` and `Replace` are two separate buttons.** A template that silently overwrites a
  half-written reply is unforgivable once.
- A Copilot draft arrives in a **bordered, badged panel** with `Use this draft` as a deliberate act —
  never typed straight into the editor, where it would be indistinguishable from the agent's own words
  and get sent unread under their name. Accepted text becomes ordinary editable text with no residual
  marking.
- Both insert into the **new-text region only**, never the quote.

### Attachments

- The **whole compose surface** is the drop target, not a strip. Plus a toolbar paperclip, because
  drag-and-drop is unreachable by keyboard.
- **Per-file** progress and **per-file** cancel: a 40 MB file and a 118 KB file in one batch behave
  nothing alike.
- **Send is disabled while any upload is in flight.**
- Chunked upload always, not just for large files — one code path, and no tenant setting to change.
- On **forward**, the existing attachment is **reused**, not re-uploaded: same stored file, no extra
  storage, no wait.
- Oversize failure states an **approximate** limit until one real send measures the transport limit.
  Storing and sending are two different limits and the UI must not conflate them.

### Drafts

Saved **twice over**, deliberately:

| Mechanism | Survives |
|---|---|
| `setControlState` | switching between concurrent case sessions |
| A real draft email row in Dataverse (`statecode` 0 / `statuscode` 1), written **on blur and on a ~15s timer** | closing the browser, a crash, picking the case up tomorrow on another machine |

Visible in three places: a `Draft` badge in the thread list, an `Unsent draft — saved HH:MM` block at
the end of the thread, and a `Your unsent reply … is still here` bar on returning to the case.

**Cross-session bleed is an active requirement, not a freebie.** Stamp the case id into the preserved
state and **discard restored state whose case id does not match** the current one on `init`. Without
that check, the platform handing back another session's state is exactly the "case Y shows case X's
draft" failure.

---

## 5. Sending

### The ladder

| State | Means | Shown as |
|---|---|---|
| Sending | request in flight | spinner; compose locked but **not closed** |
| **Queued** | accepted by Dynamics, **not sent** | distinct yellow state, polling |
| Sent | the mail server has taken it | green, timestamped |
| Stuck | still queued minutes later | `Queued — not sent yet` with a way to check or resend |

**The send call returns success long before anything leaves.** Never upgrade to "Sent" on the response;
wait for the platform to say so, and if polling times out keep saying queued. The ladder is announced
through an ARIA live region, because it changes on its own and a sighted agent sees it while a
screen-reader user would not.

### Pre-flight — blocking

Checked once per case and cached, in order:

1. Does this organisation require sending mailboxes to be approved at all?
2. Is **this case's queue** approved? (We send as the queue, not the agent — as the standard form does.)
3. Is its mailbox connected and last-tested successfully?

| Result | Behaviour |
|---|---|
| Eligible | nothing visible except `from Care · approved` in the context bar |
| Blocked | **Send disabled**, reason named, `Copy details for IT`. Draft still saveable |
| **Unknown** | **treated as blocked.** If the check itself failed, we do not know the mail will leave |

An unapproved sender returns HTTP 200, parks the mail at `Pending Send` forever, and records **no error
anywhere**. There is nothing to react to, so this must be pre-flighted. No override.

---

## 6. Announcements and labels

| Element | Spoken |
|---|---|
| Thread row | "Unread. Reklamation: utætte samlinger efter montage. 6 messages, 2 unread. Latest from Morten Bach Jensen, 10 September 10:33. Has attachments. 1 of 3." |
| Message | "Received from Kim Petersen, external sender, 10 September 07:55. To Care, copy Morten Bach Jensen and Anne Holm. Unread. Collapsed." |
| Fold | "Show trimmed content, 3 earlier messages quoted. Collapsed. Button." |
| Live region | "Queued. Not sent yet." … then … "Sent." |

Direction, read state and external-sender are **spoken**, not only coloured. Every icon-only control
carries a real name.

---

## 7. Contrast

Computed pairs; the build **re-measures with Accessibility Insights** on the rendered control, in both
themes.

| Pair | Ratio | |
|---|---:|---|
| Body text on card (`#242424` on `#ffffff`) | 14.6 : 1 | ✓ |
| Metadata grey (`#616161`) | 5.9 : 1 | ✓ |
| Placeholder grey (`#707070`) | 4.6 : 1 | text only — never a control label |
| Link blue on selected row (`#115ea3` on `#ebf3fc`) | 6.3 : 1 | ✓ |
| Notice text on yellow (`#8a6300` on `#fff4ce`) | 5.2 : 1 | ✓ |
| Send button (`#ffffff` on `#0f6cbd`) | 4.8 : 1 | ✓ |

**Never colour alone.** Unread = dot + bold + edge bar. Direction = coloured arrow + shape. Both
survive greyscale and colour blindness.

A sender's own HTML is out of scope — we cannot fix their contrast, but the containment rules must not
make it worse (e.g. never place their text on a background we chose).

---

## 8. Dark theme

Every colour is the dark resolution of the same token, so the theme follows the agent's own Dynamics
setting with no second design to maintain.

**The one real decision: a sender's HTML body stays on a white card.** They authored it for a white
page — dark text, coloured table headers, a logo with a white background. Inverting alters a business
document, and automatic inversion cannot tell a deliberate colour from an incidental one. Outlook and
Gmail both do this, so it will not surprise anyone.

Two places the dark palette does real work and need measuring rather than a glance: **avatar fills**
and the **yellow notice strip**.

---

## 9. Performance

- Thread list for a **50-message case under 2 seconds** on a warm session.
- Threading is what makes that survivable: 50 messages become ~13 rows.
- Measure the list query, the recipients join and first paint **separately**, so it is clear what to fix.
- **Virtualise only if the measurement says so.** Rows render as you scroll in the design; whether that
  is needed at all is a measured question, not an assumed one.
- Never fetch bodies in a list query. Never `retrieveMultipleRecords` without an explicit `$select`.

---

## 10. The states that are easy to skip

| State | Rule |
|---|---|
| First load | **Three** skeleton rows, always, in the shape of real rows. Guessing the count and being wrong is worse than a fixed placeholder |
| No email on the case | Says **"yet"**, and offers the first email pre-addressed to the case contact |
| Load failure | Says what failed, **whether drafts are safe**, and what to do next. Scoped — one bad message never blanks the thread |
| Zero filter results | **States the real total.** "No results" and "this customer has never emailed" look identical unless you say which |
| Permission-trimmed | **Nothing at all.** Absent from the list and the counts. No greyed row, no padlock, no error — a placeholder hinting at hidden content is itself a disclosure |

**Never the word "error" alone, and never a raw platform message.** The spike currently renders
"Unknown error" — that is the bar to clear, and it is a low one.
