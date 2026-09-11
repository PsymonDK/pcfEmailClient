# 02 — Component inventory

Every element on the canvas, mapped to what builds it. This is the document that turns the design into
estimable work: if something is not in this table, it is not in the design.

**Fluent UI v9 at `9.46.2`** — the exact platform library version this environment loads. Pin the build
dependency to it; do not compile against a newer one, because the types will promise components the
runtime does not have and the failure only appears in the published app.

Column meanings:

- **Fluent** — the v9 component to use, or **CUSTOM** where none fits.
- **Risk** — 🟢 comes free · 🟡 Fluent gets us most of the way · 🔴 hand-built, and where the effort and
  the accessibility work actually is.

---

## Shell and layout

| Element | Artboard | Fluent | Req | States | Risk | Notes |
|---|---|---|---|---|---|---|
| Card container | all | `Card` | N7 | — | 🟢 | White, 1px `colorNeutralStroke2` border, 6px radius, **no elevation**. Page behind is `colorNeutralBackground2` |
| Card header | Main, 4.0 | `CardHeader` | N7 | — | 🟢 | Fixed **44px**. Title left, unread pill, icon row right |
| Two-pane split | Main | CUSTOM | N2 | ≥900px two-pane · <900px one column | 🟡 | Flex, `424px` fixed left. Fluent has no splitter we need; the panes are not user-resizable in v1 |
| Group header (`Unread ────`) | Main, 3.6, 5.3 | CUSTOM | R1, R6, R8 | collapsed · expanded | 🟡 | Chevron + label + `flex-grow` 1px rule. Trivial, but it is the form's idiom so it must match exactly |
| Scroll region | Main | CUSTOM | N5 | — | 🟡 | **Exactly one per card.** Everything above it is fixed height |
| Command icon row | Main, 4.0 | `Toolbar` + `ToolbarButton` | — | rest · hover · pressed · disabled | 🟢 | 18px icons, `colorNeutralForeground2` |
| Overflow menu | Main, 4.0 | `Menu` + `MenuPopover` | — | — | 🟢 | Everything that does not fit one toolbar row |

## Thread list

| Element | Artboard | Fluent | Req | States | Risk | Notes |
|---|---|---|---|---|---|---|
| Thread row | Main, 3.1 | CUSTOM | R1, R6 | read · unread · selected · selected+unread · hover · focus | 🔴 | Three-line row, 44px+. **One tab stop for the whole list**, arrows inside — see [`03`](03-interaction-spec.md) |
| Sender avatar | everywhere | `Avatar` | R2 | — | 🟢 | 32px in lists, 24px in collapsed rows. Two-letter initials, muted fill |
| Unread indicator | Main, 3.1 | CUSTOM | R6 | — | 🟡 | **Three signals together**: 8px dot + bold weight + 3px left edge bar. Never colour alone (N6) |
| Unread count pill | Main | `Badge` | R6 | — | 🟢 | `colorBrandBackground2` / `colorBrandForeground1` |
| Draft badge | 4.5 | `Badge appearance="outline"` | R16 | `Draft` · `Writing…` | 🟢 | Yellow. `Writing…` carries a pulsing dot while compose is open on that thread |
| Attachment indicator | Main, 3.1 | `Icon` | R5 | — | 🟢 | Paperclip, `colorNeutralForeground3` |
| Parent-case marker | 3.6 | `Badge` + CUSTOM | R8 | — | 🟡 | **Marked three ways**: group header, yellow left edge, case-number badge per row. One marker is not enough — see [`01`](01-design-decisions.md) |
| Search field | Main, 3.5 | `Input` (`appearance="filled-darker"`) | R7 | empty · typing · has value | 🟢 | Grey fill, borderless until focus — the form's field treatment |
| Filter chips | Main, 3.5 | CUSTOM | R7 | rest · active · dismissible | 🟡 | Fluent has no filter-chip. `Badge` is not interactive and `Button` is the wrong shape |
| Filter panel | 3.5 | `Popover` + `Checkbox` + `Radio` | R7 | — | 🟢 | Participants use `Persona`-style rows |
| List footer | Main | CUSTOM | R8 | — | 🟢 | 36px, parent-case link, the `View more ⌄` idiom |

## Reading a thread

| Element | Artboard | Fluent | Req | States | Risk | Notes |
|---|---|---|---|---|---|---|
| Message row, collapsed | Main | CUSTOM | R2, R6 | read · unread · hover · focus | 🟡 | 30px. `Email from: X` + badge, snippet, timestamp |
| Message, expanded | Main, 3.2 | CUSTOM | R2, R3 | — | 🔴 | Header + notices fold + body + signature + quote fold |
| `Email from: X` + badge | Main, 3.2 | `Link` + `Badge` | R2, R17 | Received · Sent · **Queued** · Draft · External | 🟢 | The platform's own idiom. Carries the send-status ladder for free |
| Direction indicator | Main, Tokens | `Icon` | R2 | incoming · outgoing | 🟢 | Green in-arrow / blue out-arrow. Colour **and** shape (N6) |
| Recipient summary | Main, 3.2 | CUSTOM | R2 | ≤3 shown · `+n` overflow | 🟡 | `To: … · Cc: …` inline, 12px. Overflow opens a `Popover` |
| **Body renderer** | 3.3 | **CUSTOM** | R3 | loading · loaded · failed · permission-trimmed | 🔴 | **The highest-risk component in the build.** Sanitise → contain → resolve inline images → render. See below |
| Inline image | 3.3 | CUSTOM | R3 | resolved · unresolvable | 🔴 | `cid:` must be matched to its stored attachment and swapped for something renderable. Unresolvable → labelled placeholder, never a broken-image icon |
| Attachment chip | Main, 3.3, 4.4 | CUSTOM | R5 | rest · hover · downloading · failed | 🟡 | Icon + blue filename + size. `Button appearance="subtle"` is close but the two-line variant is not |
| **Quoted-history fold** | 3.4 | `Button appearance="subtle"` | **R4** | collapsed · expanded | 🟡 | The `View more ⌄` idiom. The *control* is easy; the *detection* behind it is the risk |
| **Injected-notices fold** | 3.4 | `Button appearance="subtle"` | **R21** | collapsed · expanded · absent | 🟡 | Same control, yellow surface. Absent entirely when nothing was detected |
| Signature treatment | 3.4 | CUSTOM | R21 | — | 🟡 | Grey, below a hairline rule. **Never folded** — detection is a guess |
| Nested quote rendering | 3.4 | CUSTOM | R4 | depth 1..n | 🟡 | Indented by depth, left border per level. Rendered **as received**, never re-serialised |

## Compose

| Element | Artboard | Fluent | Req | States | Risk | Notes |
|---|---|---|---|---|---|---|
| Docked surface | **4.0** | CUSTOM | R10 | closed · open 222px · grown · at ceiling | 🔴 | Grows with content to ~half the pane, never shrinks while typing |
| Context bar | 4.0 | CUSTOM | R9, R18 | approved · **blocked** · unknown | 🟡 | Which message, which mailbox, and the pre-flight result — *before* Send is pressed |
| Sending-mailbox picker | 4.0 | `Menu` | R17 | — | 🟢 | Defaults to the case's queue, not the agent |
| Recipient chips | 4.0 | CUSTOM | R9 | rest · hover · removable · overflow | 🔴 | `TagPicker` is not in 9.46.2. Hand-built from `Avatar` + dismissible chip + an `Input` that resolves people |
| Subject field | 4.0 | `Input` | R9 | hidden (inherited) · revealed | 🟢 | **Hidden behind a link by default** — editing it breaks threading |
| **Rich-text editor** | 4.0 | **NOT FLUENT** | **R11** | empty · typing · at ceiling · disabled while sending | 🔴 | A bundled editor core mounted by hand. See the open decision below |
| Editor toolbar | 4.0 | `Toolbar` | R11 | — | 🟡 | Fluent gives the chrome; each button is wired to the editor core by hand. **One fixed row**, overflow to a menu |
| Signature | 4.0 | — | R15 | — | 🟢 | Inserted on open from the agent's default, editable, rendered grey so it reads as boilerplate |
| **Quote strip** | 4.0 | `Button appearance="subtle"` | **R12** | collapsed · expanded | 🟡 | Read-only, **outside the editor**. The single most important compose decision |
| Send row | 4.0 | `Button` ×3 | R17 | ready · sending · **blocked** | 🟢 | Primary Send, default Save draft, subtle Discard. Never scrolls away |
| Pop-out window | 4.0 | `Dialog` | R10 | — | 🟢 | 820 × 460. Same draft row — closing it keeps everything |
| Drop zone | 4.4 | **CUSTOM** | R13 | idle · drag-over · uploading · complete · failed | 🔴 | **Fluent v9 has no file uploader.** The whole compose surface is the target, plus a paperclip button for keyboard reach (N6) |
| Per-file progress | 4.4 | `ProgressBar` | R13 | — | 🟢 | Real chunk progress, not a spinner. Per-file cancel |
| Oversize failure | 4.4 | `MessageBar` | R13 | — | 🟢 | Names an approximate limit honestly — see the open item below |
| Template picker | 4.3 | `Dialog` + `List` | R14 | — | 🟡 | Split list/preview. **Tokens resolved before insert**, highlighted in the preview |
| Insert vs Replace | 4.3 | `Button` ×2 | R14 | — | 🟢 | Two separate buttons. A template that silently overwrites a half-written reply is unforgivable once |
| Copilot draft panel | 4.3 | `Card` + `MessageBar` | R19 | prompting · generating · result · error · **absent** | 🟡 | Bordered and badged, with `Use this draft` as a deliberate act. Hidden entirely if the platform surface is unavailable |

## Send, drafts, states

| Element | Artboard | Fluent | Req | States | Risk | Notes |
|---|---|---|---|---|---|---|
| **Send ladder** | 4.5 | `Badge` + `Spinner` | **R17** | Sending · **Queued** · Sent · **stuck** | 🟡 | Queued is a *distinct, visibly-not-done* state. Announced to screen readers via a live region |
| **Pre-flight block** | 4.6 | `MessageBar intent="error"` | **R18** | healthy (invisible) · blocked · unknown | 🟡 | Disables Send, names the reason, offers details for IT. `unknown` blocks too |
| Draft badge, in thread | 4.5 | CUSTOM | R16 | — | 🟡 | Yellow left edge + "Unsent draft — saved 14:58" + `Continue writing` |
| Return-to-case reassurance | 4.5 | `MessageBar intent="info"` | R16, N1 | — | 🟢 | "Your unsent reply … is still here" |
| Loading skeleton | 5.3 | `Skeleton` | N5 | — | 🟢 | **Three rows, always.** In the shape of real rows so nothing jumps |
| Empty state | 5.3 | CUSTOM | — | — | 🟡 | Says "yet", and offers the pre-addressed first email |
| Load failure | 5.3 | `MessageBar intent="error"` | — | whole list · single message | 🟢 | Scoped: one bad message must not blank the thread. Always says whether drafts are safe |
| Zero filter results | 3.5 | CUSTOM | R7 | — | 🟡 | **States the real total** — "this case has 3 threads and 9 messages" — so "no results" is never read as "no email" |
| Permission-trimmed | 5.3 | **nothing** | N4 | — | 🟢 | Deliberately **no component.** Absent from the list and the counts. A placeholder hinting at hidden content is itself a disclosure |

---

## What Fluent 9.46.2 does not give us

The five 🔴 rows, in the order they should worry you:

1. **The body renderer** (R3) — sanitise, contain, resolve `cid:` images, render hostile third-party
   HTML. No component exists for this anywhere; it is the security surface of the whole product and it
   must be built and tested before any real email body is displayed.
2. **The rich-text editor** (R11) — the platform's own editor was tested and **cannot be reused from a
   PCF**. A bundled core must be mounted imperatively, and because a virtual PCF shares the platform's
   React 16.14, only framework-agnostic cores are usable at all.
3. **The drop zone** (R13) — Fluent v9 has no file uploader. Hand-built, and the place accessibility is
   most likely to be missing, since drag-and-drop is unreachable by keyboard.
4. **Recipient chips** (R9) — `TagPicker` is not in 9.46.2. Built from `Avatar` plus dismissible chips
   plus a people-resolving input.
5. **Thread and message rows** (R1, R2) — not hard individually, but they carry the composite states
   (read × selected × focused × has-draft) and the one-tab-stop keyboard model, and that is where row
   components usually go wrong.

## Open decisions this inventory cannot settle

| # | Decision | Whose | Blocks |
|---|---|---|---|
| 1 | **Which editor core**, and the bundle budget it must fit | Measure three candidates, then the requester approves the size | All of compose |
| 2 | **Transport size limit** for the oversize message | One real send measures it | The exact wording on 4.4 — currently, and deliberately, approximate |
| 3 | **Whether the Copilot surface works here** | One spike | Whether 4.3's panel ships or the entry point is hidden |

Nothing else in this table is blocked. Reading (🟢/🟡 rows plus the body renderer) can be built now.

## Conventions for every row above

- **Griffel `makeStyles`**, no inline styles, no media queries as top-level keys.
- **Fluent tokens only** — never a literal hex. The canvas shows resolved values so the design is
  reviewable; the code must use the token so dark theme follows the agent's own setting for free.
- **Every icon-only control carries a real accessible name.** No "button button".
- **Composite state is explicit**, not implied by CSS ordering: read × selected × focused × has-draft
  is four dimensions, and a row must be correct in all sixteen combinations.
- Sizes on this canvas are **fixed heights above the scroll region and flexible below it** — the height
  budget on artboard 2 is binding.
