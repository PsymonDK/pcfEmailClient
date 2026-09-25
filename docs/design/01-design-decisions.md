# 01 — Design decisions (ADR)

| | |
|---|---|
| **Status** | **Accepted 2026-09-11.** Gate 1, Gate 2 and Gate 3 all cleared. The canvas is frozen; changes from here are recorded amendments. |
| **Decision** | **Candidate 1E** — a two-pane layout built out of the vocabulary the real Case form uses, with compose **docked** to the bottom of the reading pane |
| **Runner-up** | 1D — the same structure in new Outlook's styling |
| **Eliminated** | 1A, 1B (Fluent, drawn before the real form was examined); 1C (new Outlook, single column) |
| **Canvas** | The design canvas, 14 artboards across three pages: Reading, Compose & send, Foundations |

## Context

The requirement catalogue ([`../research/01-requirements.md`](../research/01-requirements.md)) names 20
MUSTs, and 18 of them have a visible consequence. Research had settled *what to build it with* — a
React PCF on two form placements — but not what it should look like or feel like to use, and that is
not a question research can answer.

So the design phase ran as a bake-off: four candidates on two axes (visual language × layout), drawn
on identical fake data at the real measured host size of **1600 × 536 px**, then one winner developed
in depth. The four are recorded below rather than deleted from history, because the reason each lost
is a constraint the build still has to respect.

---

## Gate 1 — layout and visual language

**Chosen: 1E.** A late fifth candidate, produced after the requester supplied a screenshot of the real
Copilot Service Workspace Case form. It takes **1D's structure** — two-pane, list left, reading right —
and rebuilds the surface from what the actual form does.

### Why the screenshot changed the answer

The original four split visual language into "Fluent/native D365" versus "new Outlook", on the
assumption those were meaningfully different. The requester's observation was that current Fluent v9
and new Outlook have largely converged — the pills, circular avatars and rounded surfaces drawn in 1C
and 1D are all present in the real form too. That was correct, and it dissolved the axis.

What remains different is **density, radius and surface treatment**, not palette:

| | Fluent as D365 renders it (1E) | New Outlook (1C/1D) |
|---|---|---|
| Surface | White cards, 1px hairline border, on a near-white page | White cards with elevation, floating on a tinted canvas |
| Radius | 6px | 8px, pill controls throughout |
| List row | 44px | 56px |
| Colour tokens | **identical** | **identical** |

1E wins on the 536px height budget — 44px rows against 56px is roughly a third more content — and on
sitting comfortably beneath a command bar and a process bar without reading as a foreign object.

### What 1E lifts from the real form, and why it matters

Every pattern below is taken from the screenshot rather than invented. The payoff is not stylistic
consistency for its own sake; it is that **agents already know what these controls do**.

| Pattern in the real form | Used in 1E for |
|---|---|
| Timeline card header — title left, icon row right | The email card headers |
| Grey-filled search field, borderless until focus | Search within the case's mail |
| `Recent ────` group header with a trailing rule | `Unread ────` / `Earlier ────` grouping |
| 32px circular two-letter avatars in muted fills | Thread and message senders |
| `Email from: Care` + an `Active` badge | `Email from: Kim Petersen` + a status badge |
| Blue attachment chip (`image001.png`) | Per-message attachments |
| **`View more ⌄` expander** | **Both the quoted-history fold and the injected-notices fold** |

That last row is the most valuable single decision on the canvas. R4 (collapsed quoted history) and
R21 (collapsed policy-injected content) are the two features hardest to explain to an agent who has
never seen them. Expressing both with the platform's own expander means they arrive looking like
behaviour the agent has already used elsewhere in Dynamics, rather than like our invention.

A second payoff: the `Email from: X` + badge idiom gives us **Received / Sent / Queued** for free, in
a form agents already read — which is exactly what R17 needs (see Gate 2, decision 3).

### Why the others lost

| Candidate | Reason |
|---|---|
| **1D** — new Outlook, two-pane | The structure that won, and the basis for 1E. Lost on density: pill-and-card padding plus the split leaves ~400px of usable reading height, and it reads as a foreign object next to the Dynamics chrome |
| **1C** — new Outlook, conversation | Airy density costs about a third of the visible rows on a host only 536px tall |
| **1B** — Fluent, two-pane | Drawn before the real form was examined; its chrome is thinner and flatter than Customer Service actually is. Superseded by 1E |
| **1A** — Fluent, conversation | Best fit for the height budget, and the cheapest to build, but a single column wastes 1600px of width: the body caps at ~880px and the rest is air. Scanning many threads means scrolling rather than glancing |

**Reversal condition:** if the two placements ever end up much narrower than 1600px in practice, 1A's
single column becomes the right answer again. The breakpoint rule on the Placements artboard already
collapses 1E to one column below 900px, so the transition exists.

---

## Gate 2 — four interaction decisions

### 1. Policy-injected content: **folded, not hidden**

Defender external-sender banners, Outlook's first-contact tip and tenant classification lines collapse
behind one `View more ⌄` control labelled *"3 notices added by your organisation"*. Nothing is deleted;
the fold state is remembered per agent.

**Why:** the sender's actual words become the first thing read instead of the fourth. Hiding outright
would be tidier and is wrong — an agent occasionally needs to know a message was flagged as external,
and silent removal of body content in a case-handling tool is a support liability.

**The asymmetry that governs the whole feature:** *when detection confidence is low, show the content.*
A visible banner is clutter. A hidden paragraph is a mishandled case. Those are not equally bad, so the
default leans the same way the failure does. Four confidence tiers are recorded on artboard 3.4:

| Tier | Content | Treatment |
|---|---|---|
| Certain | Defender banner (`ZjQcmQRYFpfptBannerStart`/`End` markers), first-contact tip wrapper, classification line | Folded |
| Strong | Quoted history (`div#divRplyFwdMsg`, `.gmail_quote`, `-----Original Message-----` in 7 localisations, `<hr>` + bolded `Fra:`/`From:`/`Von:` block) | Folded |
| Weak | A bare `<blockquote>` — used for quoting, but also for emphasis | Folded **only** when it is the last block and longer than the text above it |
| Guess | Signature blocks | **Never folded.** De-emphasised to grey below a rule |

### 2. Read state: **marked on dwell**

A message is marked read once it has been **expanded and on screen for ~1.5 seconds continuously**.
Scrolling past a collapsed row does not count. Expanding and immediately collapsing does not count.
`Ctrl+U` toggles by hand. Keyboard-opened messages follow the same rule.

**Why dwell rather than on expand:** agents open a thread and skim it. Mark-on-expand would mark
messages read that were never read, and the cost of that is a message the agent believes they have
dealt with. The cost of dwell is one timer.

**Data consequence:** per-agent read state has no representation in Dataverse — `lastopenedtime` and
`opencount` are recipient-side tracking, not agent-side. This needs a small custom table keyed by
email + user, as decided in the build plan.

### 3. Unapproved sender: **block Send**

When the sending mailbox is not approved, Send is **disabled**, with the specific reason named and
details to copy for IT. No override. The draft is always safe.

**Why blocking rather than warn-and-confirm:** measured on 2026-09-10, sending from an
addressed-but-unapproved queue returns **HTTP 200**, parks the mail at `Pending Send` **forever**, and
records **no error anywhere** — not on the email, not on the mailbox. A warning dialog between an agent
and finishing their work gets clicked through; then the message is gone quietly, which is the exact
failure the check exists to prevent.

A fourth outcome is treated as blocking too: **if the pre-flight check itself fails, that is "not
safe", not "probably fine."** "Probably approved" is not good enough when the failure mode is a
customer never getting an answer.

One counter-intuitive detail to keep: a queue with **no** address fails loudly and synchronously; a
queue with an **unapproved** address fails silently and forever. The loud case is not evidence the
quiet one is covered.

### 3b. Who the mail comes from — decided 2026-09-24

Three answers, taken together, and they interact with decision 3 above.

| Question | Chosen | Why, and what it costs |
|---|---|---|
| How is it configured? | **One org-wide default row, plus optional per-queue override rows** (`jhrb_emailclientsetting`) | Works out of the box from a single row and only grows when a queue genuinely differs. Per-queue-only rows would mean a configuration step per queue and a silent no-op when one is forgotten; manifest properties could not vary per queue and would have to be set identically on *both* form placements |
| Can the agent change it? | **Yes — a From picker** | The From line is shown either way, because an agent who cannot tell whether a reply goes out as Care or as themselves cannot predict what the customer sees. The picker costs a pre-flight verdict per candidate, and a blocked candidate stays visible **with its reason** rather than disappearing |
| No queue on the Case? | **Fall back to the agent** | Mail still goes out; pre-flight says so if it cannot. Blocking would leave an agent on a queue-less Case unable to reply at all, and a configured fallback queue could send a Case's mail from a queue unrelated to it |

**The signature follows the sender, and there is deliberately no switch for it.** A separate
"which signature" setting would let the From line and the sign-off disagree — which is exactly the
defect this work was written to fix (see `06-spikes.md`, 2026-09-24).

**Where decision 3 bites:** in this environment the agent's own mailbox has
`outgoingemailstatus = 0`, so choosing "send as me" is genuinely blocked. That is the block-Send
decision working as intended, not a bug — and it is the first time it has been observable.

### 4. Compose: **docked**

Docked to the bottom of the reading pane at **222px**, growing as the agent types to a ceiling of about
half the pane, with **pop out** to an 820 × 460 window for a long reply. No overlay.

**Why:** at 222px the thread above stays visible — 184px of it — and seeing what you are answering
while you answer it is the entire point of composing in place (R10). An overlay gives roughly twice the
typing room and covers the message being replied to, plus the thread list, so nothing else on the case
can be consulted mid-reply.

**This was initially reviewed and rejected as un-judgeable**, correctly: compose had only been drawn as
a 222px strip inside a full-size mock, too small to assess. Artboard 4.0 redraws it at actual size with
the docked surface, the popped-out window and the overlay alternative side by side; the decision was
taken from that.

**The honest cost, stated rather than hidden:** the editor opens at three visible lines. That is what
222px leaves after the context bar, recipients, one toolbar row, the quote strip and the send row take
their fixed share. For most replies that is plenty; for a careful explanation it is not, and the answer
is pop out rather than pretending.

---

## The load-bearing decision that is not on any single artboard

**The inherited quote never enters the editor.** The agent edits only their own new text. The quoted
chain sits below the editor as a folded, read-only strip and is appended **verbatim** at send.

This is the most important compose decision in the build. R12 requires the prior chain to survive a
round-trip intact, and any rich-text editor that ingests arbitrary Outlook HTML will rewrite it —
reindenting, dropping styles, mangling tables. Keeping the quote out of the editor turns *"must
round-trip anybody's HTML"*, which no editor does well, into *"must handle what the agent types"*,
which they all do.

It also has a testable form: splitting our own emitted message must return the new text and the
inherited quote byte-for-byte unchanged.

---

## Decisions inherited from research, reaffirmed here

- **A sender's HTML body stays on a white card, in dark theme too** (artboard 5.1). Inverting it alters
  a business document — an invoice, a test report — and automatic inversion cannot tell a deliberate
  colour from an incidental one. This is what Outlook and Gmail both do. A per-agent "show messages on
  a dark background" toggle is the escape hatch if anyone objects; not worth building before they do.
- **Every body is sanitised before it reaches the screen** (artboard 3.3), and the allow-list must keep
  `id` and `class` — the quote and notice detection matches on `divRplyFwdMsg`, `gmail_quote` and the
  Defender markers. Stripping those attributes disables R4, R12 and R21 at once, silently.
- **Containment is separate from sanitising and also required.** Sanitising stops script; it does
  nothing about a 1400px-wide Outlook table. Wide content scrolls inside the message, never moving the
  app layout.
- **Three binding layout rules** from the height budget (artboard 2): one scroll region per card;
  nothing above the scroll region may grow; compose is docked, not overlaid.
- **Never colour alone.** Unread is a dot *and* bold weight *and* an edge bar; direction is a coloured
  arrow *and* its shape. Both survive greyscale and colour blindness.

## What would reverse any of this

1. **The placements turn out much narrower than 1600px** → 1A's single column returns; the 900px
   breakpoint rule already describes the transition.
2. **Agents report the docked editor is too small in practice** → the overlay is drawn, argued and
   ready on artboard 4.0. Note the lever is *not* a taller dock: that removes the thread, which is the
   reason for composing in place.
3. **Dwell-to-read proves annoying in use** → mark-on-expand is a one-line change; the data model does
   not care which rule fires.
4. **An administrator wants the unapproved-sender block to be overridable** → the warn-and-confirm
   variant is drawn on artboard 4.6. It should be argued against, but it exists.
5. **Microsoft changes the Case form's visual language** → 1E is deliberately built from the platform's
   vocabulary, so it would need to follow. That is the cost of belonging rather than standing apart,
   and it was accepted knowingly.

## Sign-off

| Gate | What was decided | Date |
|---|---|---|
| Gate 1 | Layout and visual language — **1E** | 2026-09-11 |
| Gate 2 | Folded notices · dwell-to-read · blocking pre-flight · docked compose | 2026-09-11 |
| Gate 3 | Canvas frozen, handoff written | 2026-09-11 |

Handoff: [`02-component-inventory.md`](02-component-inventory.md),
[`03-interaction-spec.md`](03-interaction-spec.md), [`00-fixture.md`](00-fixture.md).
