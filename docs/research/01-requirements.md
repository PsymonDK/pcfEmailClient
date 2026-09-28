# 01 — Requirements: what "a more native email experience" means

Decomposes the goal into testable requirements. Each has an **acceptance sentence** a tester can
execute, and names the **Timeline gap** it closes. Traceability to the Dataverse data model is in
[`04-data-model.md`](04-data-model.md).

Priority: **M** = MUST (in scope, blocking) · **S** = SHOULD (in scope, non-blocking) · **W** = WON'T (explicitly out of scope this phase).

## Reading

| # | Pri | Requirement | Acceptance | Timeline gap closed |
|---|---|---|---|---|
| R1 | M | Messages for the Case are grouped into **conversation threads**, newest activity first | Open a Case with a 6-message chain; see one thread, not six flat rows | Timeline lists every email as an independent row |
| R2 | M | A thread expands to show each message in order, with sender, recipients, timestamp and direction | Expand the thread; all 6 messages readable in sequence with To/Cc visible | Timeline shows a truncated snippet and hides recipients |
| R3 | M | Full HTML body renders faithfully, including inline images and tables | Open a message with a table and an inline logo; both render as the sender intended | Timeline truncates and strips |
| R4 | M | **Quoted history is collapsed by default** with a one-click expand | A reply shows only the new text plus a "show trimmed content" affordance | Timeline shows the entire quoted chain inline, every time |
| R5 | M | Attachments are listed per message with filename, type and size, and are downloadable | Click an attachment; the correct file downloads | Timeline surfaces attachments poorly |
| R6 | M | Unread / read state is visible and actionable | An unopened incoming email is visually distinct; opening it marks it read | Timeline has no first-class read state |
| R7 | S | Filter and search within the Case's mail (by participant, date, has-attachment) | Filter to "has attachment"; only matching threads remain | Timeline filtering is coarse and not mail-shaped |
| R8 | S | Emails on **parent/ancestor Cases** can optionally be included | Toggle "include parent case"; the parent's chain appears, marked as such | Not available |
| **R21** | **S** | **Strip or collapse content injected by transport and tenant policy** — Defender external-sender banners (`ZjQcmQRYFpfptBanner…` markers), Outlook's "You don't often get email from…" tip, classification lines (`Classification: Public`), and trailing signature blocks | Open a message that carries a Defender banner; the banner is hidden or collapsed and the sender's actual text is what the agent reads | Timeline renders all of it verbatim on every message. **Added after S7** — all four were observed in a single real round-trip; see [`06-spikes.md`](06-spikes.md#new-finding-transport-and-tenant-policy-inject-content-into-the-body) |
| R8b | W | Cross-Case inbox, queue triage, mail rules | — | Out of scope: that is the OOB Inbox's job |

## Compose

| # | Pri | Requirement | Acceptance | Timeline gap closed |
|---|---|---|---|---|
| R9 | M | **Reply / Reply all / Forward** from a message, with recipients pre-populated correctly | Reply-all on a message with 2 To + 1 Cc; recipients match mail-client semantics, sender excluded | Timeline hands off to the full email form, losing context |
| R10 | M | Compose happens **in place** — no navigation away from the Case | Start a reply; the Case context and thread stay visible | OOB compose opens a separate email form/tab |
| R11 | M | **Rich-text editor**: bold/italic, lists, links, inline images, paste-from-Word cleanup | Compose a formatted reply; the recipient's Outlook renders it correctly | The OOB editor is limited and inconsistently available |
| R12 | M | Quoted history is **appended correctly** on reply/forward and survives round-trip | Reply to a 3-deep chain; sent message contains the intact prior chain, not mangled HTML | — |
| R13 | M | Attach files, incl. drag-and-drop, with per-file progress and clear failure on oversize | Attach a 1 KB and a 10 MB file; both succeed or the limit is stated explicitly | Attaching from Timeline is a multi-step detour |
| R14 | M | **Email templates** can be picked and instantiated with Case/contact tokens resolved | Insert a template referencing the Case number; the token is filled | Available but buried |
| R15 | M | The agent's **signature** is inserted automatically on new compose | Start a reply; the default signature is present and editable | Inconsistent |
| R16 | M | **Drafts persist** — an unsent reply survives navigating away and coming back | Type a reply, switch session, return; the draft text is still there | No draft concept in Timeline |
| R17 | M | **Send** delivers the mail and reflects success/failure to the agent | Send a reply; it arrives, and the record shows as Sent | — |
| R18 | M | A failed send surfaces an actionable message. **CORRECTED by measurement (2026-09-10):** the platform gives **no** failure signal for an unapproved sender — `SendEmail` returns 200 and the email is stranded at `Pending Send` with no error recorded. So this MUST be met by **pre-flighting** the sender's `emailrouteraccessapproval` and the mailbox's `outgoingemailstatus` **before** offering Send, not by reacting to a failure | Block Send (or warn) when the sending queue/user is unapproved, naming the reason; never present a send that will silently vanish | Errors are opaque — and for this case, absent entirely |
| R19 | S | Copilot "draft a reply for me" is reachable from within the client | Invoke AI draft; generated text lands in the editor | Exists but in a separate pane |
| R20 | S | Sent mail is auto-associated to the Case (`regardingobjectid`) without the agent doing anything | Send a reply; the new email row is regarding the Case | Manual in some flows |
| **R22** | **S** | **Templates resolved by regarding object AND language, in two clicks or fewer.** Replying on a Case shows `incident` templates in the agent's own language by default, with an explicit way to switch language and see the others. Supersedes R14, which ships a flat alphabetical dropdown with no language filter at all | From compose, insert a template in ≤2 clicks; the list shows only Case templates in the agent's language, and switching language changes the list. A language with no templates says so rather than silently falling back | D365 already resolves templates this way; the client does not. **Added 2026-09-28 — needs design review before implementation** |

## Non-functional

| # | Pri | Requirement | Acceptance |
|---|---|---|---|
| N1 | M | **Survives CSW multi-session**: state, scroll position and in-progress draft persist across session/tab switches, with no cross-session bleed | Open Cases X and Y, start a draft in X, switch to Y and back; X's draft is intact and Y never shows it |
| N2 | M | Occupies **both** placements: Case form tab and CSW session/application tab | Both are configured and working in one environment |
| N3 | M | Ships as a **solution**, dev → test → prod, with no manual per-environment steps | Import the managed solution into a clean environment; the client works |
| N4 | M | Respects Dataverse security — an agent sees only email they are permitted to read | A user without read on an email does not see it in the thread |
| N5 | S | Thread list for a 50-email Case renders in under 2 seconds on a warm session | Measured against a seeded Case |
| N6 | S | Accessible: keyboard navigable, screen-reader labelled, WCAG 2.1 AA contrast | Audit with Accessibility Insights |
| N7 | S | Visually consistent with the surrounding app (Fluent, honours theme) | Side-by-side against OOB CSW pages |

## Notes on requirement risk

- **R16 + N1 together are the hardest non-obvious requirement.** They are also the ones that
  eliminate most hosts — see the multi-session analysis in [`02-hosting-and-placement.md`](02-hosting-and-placement.md).
- **R4 and R12 are the hardest functional requirements.** Splitting new text from quoted history is a
  heuristic problem, not an API call; Dataverse stores a single HTML body with no structural marker
  for the quote boundary. See [`04-data-model.md`](04-data-model.md#r4r12--quoted-history).
- **R7 is constrained by platform, not by host**: email bodies have been relocated to Azure Blob
  storage and **filtering on `description` is not supported** in FetchXML/Advanced Find. Body search
  requires Dataverse search. This caps R7 regardless of the architecture chosen.
