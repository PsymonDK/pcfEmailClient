fixed ||# Code review — 2026-09-28

Whole-repository review for security issues and refactoring, done in four passes (HTML/XSS
surface, Dataverse data layer, React UI, scripts/config). Every Critical and High finding was
re-checked against the code before it was listed here. Baseline at the start: 586 tests pass,
lint and build clean.

Work happens on branch `code-review-fixes`. Fixes go in severity order, Critical → Low. Where a
refactor removes an issue at its root, the refactor **is** the fix and is recorded against the
finding; the remaining refactors follow once the security items are done.

**Status:** `open` · `fixed` · `partial` (what remains is said in the log) · `refactor (Rn)`
(fixed by the refactor named) · `accepted` (risk recorded, not changed) · `deferred` (needs the
environment or a product decision — reason given)

Paths are relative to `pcf/CaseEmailClient/` unless they start with `scripts/` or `solution/`.

## Critical

| ID | Finding | Where | Status |
|---|---|---|---|
| C1 | **Stored XSS through the compose quote.** The raw inbound `description` was embedded in `buildQuotedBlock` unsanitised and rendered with `dangerouslySetInnerHTML` in the Host document (there is no iframe). Any external sender could run script as the agent on Reply → expand quote, and the raw HTML also went out in the reply under the queue's identity. | `ui/EmailClientRoot.tsx` `openCompose`, `domain/compose.ts` `buildQuotedBlock`, `ui/Compose.tsx` | fixed |

## High

| ID | Finding | Where | Status |
|---|---|---|---|
| H1 | **Send can go out from a different sender than From shows, and pre-flight checks the wrong one.** `changeSender` never marked parties dirty, so an existing draft row kept its old sender; pre-flight approved the new one. A resumed draft showed re-derived To/Cc while the row kept its stored parties, which are what is sent. | `ui/EmailClientRoot.tsx` `changeSender`, `flushDraft`, resume path | refactor (R2) |
| H2 | **Opening a second compose reuses the first editor.** `<Compose>` had no `key` and `Editor` reads `initialHtml` once, so Reply on B while A was open wrote A's text into B's draft or discarded A's unsaved text. | `ui/EmailClientRoot.tsx`, `ui/Editor.tsx` | refactor (R2) |
| H3 | **Overlapping saves.** `flushDraft` returned immediately while a save was in flight, so Send could send a stale body, or report "could not be saved" when the in-flight save was the create. `addFiles` had the same gap. | `ui/EmailClientRoot.tsx` `flushDraft` | refactor (R2) |
| H4 | **Forward → Send could drop the forwarded attachments.** Reused attachments were created by an effect racing `issueSend`, and counted as `done` before their rows existed. | `ui/EmailClientRoot.tsx` | refactor (R2) |
| H5 | **No environment guard in scripts.** Every script trusted `DV_ORG`; a shell left pointed at another environment would run reverts (which delete by name) there. | `scripts/**` | refactor (R6) |
| H6 | **Spike reverts target the shipped product.** `revert-s1` / `revert-s11` delete solution `JHRBCaseEmailClient` and control `jhrb_JHRB.CaseEmailClient` as "leftovers" — now the live product's names. | `scripts/seed/revert-s1.mjs`, `revert-s11.mjs` | fixed |
| H7 | **`s7-send.mjs` sends real mail on launch** with no `--confirm`, to any address in `DV_TO`. | `scripts/spikes/s7-send.mjs` | refactor (R6) |

## Medium

| ID | Finding | Where | Status |
|---|---|---|---|
| M1 | Recipient `$filter` literal not URL-encoded: `+` addresses never resolve, `&`/`#` break the query, `%27` could rewrite the filter. | `data/recipients.ts` `addressFilter` | fixed |
| M2 | `findExistingDraft` has no owner filter — a second agent silently resumes and sends a colleague's draft. | `data/draft.ts` | fixed |
| M3 | Double-send guard fails open: an unreadable status counts as "not sent". | `data/send.ts`, `domain/send.ts` | refactor (R2) |
| M4 | Remote images load automatically (tracking pixels, agent IP/read time); the CSS `url(` filter is a substring check bypassed by `u\rl(`, `\75 rl(`, `image-set()`. | `domain/sanitise.ts`, `ui/BodyFrame.tsx` | fixed |
| M5 | Sanitised HTML is cut with regex/`indexOf` (quote split, notice strip) and the pieces rendered without re-sanitising — a cut inside an attribute value yields live markup on engines that do not escape `<` in attributes. | `ui/BodyFrame.tsx`, `domain/quoting.ts`, `domain/noise.ts` | refactor (R2) |
| M6 | Bearer token kept on disk in `.tok` (gitignored; no secrets in history). | `scripts/**` | refactor (R6) |
| M7 | `npm audit`: 22 moderate, all GHSA-cp6q-959q-f8rh in `@tiptap/core` < 3.30.4 (fix only in v3, which does not build here). `dompurify` 3.4.16 available. | `pcf/package.json` | accepted |
| M8 | A removed attachment can still be sent: delete result ignored; removing mid-upload or mid-reuse deletes nothing and the row appears afterwards. | `ui/EmailClientRoot.tsx` | fixed |
| M9 | Compose locked ~30 s after a send (`setSending(false)` in `finally` after the poll); the double-click guard is state, not a ref. | `ui/EmailClientRoot.tsx` `sendDraft` | refactor (R2) |
| M10 | Reply can quote an empty body: `ensureBody` returns early while a fetch is in flight, and a failed fetch silently quotes `''`. | `ui/EmailClientRoot.tsx` `ensureBody`, `openCompose` | fixed |
| M11 | Session teardown loses the last ~2 s of typing (debounce cleared without saving); `destroy()` does nothing; restored expanded messages are never used. | `ui/EmailClientRoot.tsx`, `index.ts` | fixed |
| M12 | Loads can land out of order (no sequence guard), and the first landing runs before read state arrives. | `ui/EmailClientRoot.tsx` `load` | fixed |
| M13 | Dwell timer restarts on every parent render (inline callback in effect deps), so steady re-rendering stops R6 marking read. | `ui/ReadingPane.tsx` | fixed |
| M14 | Index-based row lookup (`querySelectorAll(...)[i]`, focus stored as an index) against the CLAUDE.md rule; a stale `focusIndex` makes Space throw. | `ui/ReadingPane.tsx`, `ui/ThreadList.tsx` | fixed |
| M15 | TipTap `setContent` does not emit `update`: "Replace all" template never autosaves and a later signature reseed can overwrite it; `empty` starts `true` so a resumed draft keeps Send disabled. | `ui/Editor.tsx`, `ui/Compose.tsx` | fixed |
| M16 | Script safety: `revert-deploy` deletes its ids file even after failed steps; `create-case-form` has no exists check and no solution header; `.catch(() => null)` turns a 401 into "nothing to do"; non-spike seed/spike scripts write to the environment without `--confirm`. | `scripts/**` | fixed |

## Low

| ID | Finding | Where | Status |
|---|---|---|---|
| L1 | A Failed (8) send cannot be retried although the report says it can. | `domain/send.ts` | refactor (R2) |
| L2 | Duplicate settings rows resolve arbitrarily; the header promises "ambiguous → agent". | `domain/sender.ts`, `data/settings.ts` | fixed |
| L3 | `mailboxstatus` fetched but ignored by pre-flight. | `data/preflight.ts` | deferred — needs a live reading |
| L4 | `assertGuid` loose (`{guid` passes) and ~12 hand-rolled brace strips; some ids reach URLs unvalidated. | `data/**` | refactor (R4) |
| L5 | Signature HTML and `xsl:value-of` values are not sanitised/escaped (safe today only via TipTap's schema); `Editor` comment on `protocols` is wrong. | `domain/signature.ts`, `ui/Editor.tsx` | fixed |
| L6 | `resolveAddress`: transient failure on one table falls through to the next; "ambiguous" reported as "not a known record"; a picked own queue not checked against `ourAddresses`. | `data/recipients.ts` | partial |
| L7 | Downloads trust the sender's MIME type. | `data/attachments.ts` | fixed |
| L8 | `isDuplicateKey` treats any message containing "duplicate" as success. | `data/readState.ts` | fixed |
| L9 | Two quick `addFiles` calls can together exceed the 25 MB cap. | `ui/EmailClientRoot.tsx` | fixed |
| L10 | Sender `id`/`name` kept in the host document (DOM clobbering); `ALLOW_ARIA_ATTR`; senders can spoof the "added by your organisation" fold. | `domain/sanitise.ts`, `domain/noise.ts` | fixed |
| L11 | Smaller UI defects: body-error Retry collapses instead of retrying; success notices use danger styling + `role="alert"`; `openCompose` has no error handling; `ensureBody` fails the body when only attachments fail; colliding React keys; no error boundary. | `ui/**` | fixed |
| L12 | Colour literal `rgba(...)` in `BodyFrame`; the guard test only matches 6-digit hex. | `ui/BodyFrame.tsx`, `ui/__tests__/theme.test.ts` | fixed |
| L13 | Inline `statuscode === n` checks instead of `EMAIL_STATUS`; hard-coded `'Care'` / `'Us'` fallback names. | `ui/ThreadList.tsx`, `ui/ReadingPane.tsx` | fixed |
| L14 | Dead code / stale comments: `recipientEntity`/`recipientLookup` unused, `fetchUserFacts` unused, `issueSend` default comment, `readState.ts` header, `firstFocusable`, `sendableAttachmentIds`, `ComposeDraft.senderId`. | various | fixed |
| L15 | Test fixtures use real registrable domains (`metalservice.dk`, `nordbyg.dk`). | `domain/__tests__/**` | fixed |
| L16 | Scripts hygiene: absolute local path in `settings-role-ids.json`; `.gitignore` misses `.caseid` / `*-created.json`; inconsistent `.tok` paths. | `scripts/**`, `.gitignore` | fixed |
| L17 | `README.md` still says "no product implementation yet". | `README.md` | fixed |

## Refactors

| ID | Refactor | Status |
|---|---|---|
| R1 | Tooling gates: `eslint-plugin-react-hooks`, `typecheck` over all source (`tsconfig.json` + test config), `no-unused-vars` back on, coverage over `data/` too. | fixed |
| R2 | Extract untested logic from `EmailClientRoot.tsx` into tested modules: `ourAddresses`, `toSummary`, draft-args assembly, send orchestration (`data/sendFlow.ts`). | fixed |
| R3 | Split `EmailClientRoot.tsx` into hooks (`useCaseMail`, `useReadState`, `useComposeDraft`, `useSend`, …). | partial |
| R4 | One `toGuid()` for brace-stripping + validation; shared string/paging/party-role helpers in `data/`. | fixed |
| R5 | Shared UI parts: `ErrorPanel`, `RemovableChip`, button styles, icons. | partial |
| R6 | `scripts/lib/dv.mjs`: env guard, in-process token, fetch wrapper, `withSettle`, recipient allowlist — instead of 18 copies. | fixed |
| R7 | Solution packaging: tables, role and form exist only in the environment, `Customizations.xml` is empty. | fixed |

## Log

Newest last. One line per change, naming the IDs it closes.
- **C1** — `buildQuotedBlock` sanitises the original body itself, so no caller can build a raw quote; `Compose` re-sanitises at render for drafts saved before the fix (display only — the sent string is unchanged, R12 still byte-exact). New guard test `ui/__tests__/htmlSinks.test.ts` fails if any `dangerouslySetInnerHTML` renders an expression not on its allowlist.
- **H1–H4, M3, M9, L1** — refactor R2 (first half). Send orchestration moved out of the untested component into `data/sendFlow.ts` (`runSend`, 12 tests asserting the order save → re-read → pre-flight → issue). Pre-send save always writes parties, as the sender being pre-flighted (H1); `changeSender` and resume mark parties dirty, and a resumed draft shows its STORED To/Cc. Saves go through `domain/serialQueue.ts` and snapshot at call time, so a forced save waits for and follows an in-flight one (H3). `<Compose key={session}>` and `closeCompose` settle the open compose before another replaces it (H2). Forward carry-over runs inside the save, and `blockingReasonAfterSave` refuses a forwarded file without a row (H4). Double-send guard fails closed (M3); `sendingRef` + release on acceptance, poll detached (M9); Failed (8) is retryable (L1). `draftArgsFrom` moved to `domain/draft.ts` with tests.
- **M2** — `findExistingDraft` filters `_ownerid_value` to the agent; no agent id, no resume.
- **M8, L9** — the attachments ref is authoritative and state mirrors it (`updateAttachments`), so the size cap and removals see current data; a failed delete puts the file back as `failed` (which blocks Send); a file removed mid-upload/mid-carry-over has its row deleted when it lands. Files map back to their own `File` by identity, not name+size.
- **M10** — `ensureBody` shares the in-flight promise and resolves to the body; Reply refuses to open (with a notice) rather than quote nothing. `openCompose` now reports failures instead of silently doing nothing (part of L11) and ignores superseded opens.
- **M11 (partial)** — pending debounce is saved on unmount; `latestHtml` covers a save after the editor has gone. Still open: restoring an open compose and expanded messages after a teardown.
- **H5, H6, H7, M6, M16, L16, R6** — `scripts/lib/dv.mjs` (env guard exits unless the org is the demo org; token from `DV_TOKEN` or `az`, no `.tok` fallback; one fetch wrapper where only an explicit 404 means absent; `runSteps` dry-run by default; `guardRecipient`). All 18 scripts migrated. `revert-s1`/`revert-s11` no longer touch the product's solution or control. `s7-send` and `r18-approval-probe` need `--confirm` and a guarded recipient; Test B removed. `revert-deploy`/`cleanup` keep their ids file unless every step succeeded; `create-case-form` refuses a duplicate form and uses the solution header; `seed`/`s6` dry-run by default. `.gitignore` covers `.caseid` and spike outputs; absolute path removed from `settings-role-ids.json`. `r8-parent-link.mjs` moved to `spikes/`. Verified offline only (`node --check`, pure-helper checks) — no script was run against the environment.
- **M5** — the body pipeline moved out of `BodyFrame` into `domain/bodyPipeline.ts` (`prepareBody`) and now re-sanitises every piece after the split and the notice strip. Tests parse each piece as `innerHTML` would and assert nothing executable — both attribute-smuggling payloads from the review are covered.
- **M4** — remote (`http(s)`) images are held back by default, with a per-message "Show pictures" offer; every image gets `referrerpolicy="no-referrer"`. CSS values are an allow-list: any backslash, or any function other than `rgb/rgba/hsl/hsla`, drops the declaration (`u\rl(`, `\75 rl(`, `image-set()` covered). The OUTGOING quote keeps remote images — it is the customer's own message going back to them; only the compose preview blocks them.
- **M1** — recipient filter literal is URL-encoded after OData quote-doubling; non-address input never queries. New `data/__tests__/recipients.test.ts` checks what the server sees after one URL decode (`+`, `&`, `#`, `'`, `%27`).
- **M7 (accepted)** — `dompurify` bumped to 3.4.16. GHSA-cp6q-959q-f8rh (`@tiptap/core` < 3.30.4) stays: the only fix is TipTap 3, which does not build under pcf-scripts (CLAUDE.md, S13). Exposure is low — `parseHTML` maps only declared attributes and the inherited quote never enters the editor. Revisit if a 2.x backport ships. The remaining dev-only findings (vitest mocker) need vitest 5, a breaking upgrade.
- **M11** — the open compose is persisted through `setControlState` as `{mode, activityId, emailId}` and reopened after a teardown; the draft is re-read with `fetchDraftById`, which re-checks it is still an open draft owned by the agent. Restored expanded messages are re-expanded and their bodies fetched.
- **M12** — loads carry a sequence number and only the latest may write; the first landing waits for `loaded` (read state included); `threads` is derived with `useMemo`. A change of case resets per-case state and settles the open compose against the case it carries (`ComposeDraft.caseId`), never the new one.
- **M13** — the dwell timer reads its callback from a ref; the observer is no longer rebuilt on every parent render.
- **M14** — `ReadingPane` and `ThreadList` store focus as an id and look elements up by `data-message-id` / `data-row-id`; Space on an empty thread no longer throws.
- **M15** — "Replace all" from a template counts as an edit (`setContent(html, true)`), so it autosaves and a signature reseed cannot overwrite it; a resumed draft opens with Send enabled. The `Editor` comment that claimed `protocols` narrows TipTap's defaults is corrected (part of L5).
- **L12** — the `rgba(...)` in `BodyFrame` is now `BODY_SURFACE_FG_MUTED` in `tokens.ts`; the guard test matches any hex length and `rgb/rgba/hsl/hsla(`.
- **L2** — `pickSetting` treats two rows for one queue, or two default rows, as no configuration (send as the agent), as the module header always promised.
- **L3 (deferred)** — `mailboxstatus` is still read and not enforced. It reflects the mailbox as a whole, incoming included, so gating Send on it without a live reading of the Care mailbox risks blocking the one sender that works. Needs a measurement, then a decision.
- **L4** — refactor R4 (first part): `domain/guid.ts` (`bareId`, `isGuid`, `toGuid`) replaces all 23 hand-rolled `/^\{|\}$/g` strips; `assertGuid` delegates to it, so `{guid` no longer passes. Every id that goes into a URL or `@odata.bind` is validated (`readSendStatus`, `fetchOutgoingStatus`, `fetchSignatureFor`, `senderParty`, `caseId`/`inReplyToId` binds, template ids, queue lookups). `updateDraft` builds its payload inside the `try`, so a bad id is a failed save rather than a throw. A platform-stated `partyNav` must look like a party navigation property (`partyid_*`) before it becomes a property name.
- **L5** — `xsl:value-of` values are HTML-escaped; fetched signature HTML is sanitised (pictures and ids kept — it is our own outgoing sign-off).
- **L6 (partial)** — only a privilege failure (403 / `0x80040220`) lets the address search move to the next table; anything else stops at "unresolved" rather than binding a later table's record. Not changed: a picked queue is not checked against `ourAddresses` — CLAUDE.md records that picking a queue deliberately is allowed by design. Still open: an ambiguous match is reported to the agent as "not a known record"; saying "matches several records" needs the outcome carried to the chip.
- **L7** — downloads are always `application/octet-stream`.
- **L8** — `isDuplicateKey` matches the key's own wording only, not any message containing "duplicate".
- **L10** — displayed HTML has sender `id`/`name` prefixed (`SANITIZE_NAMED_PROPS`, `isolateIds`); outgoing HTML is left verbatim. `ALLOW_ARIA_ATTR` is off. The notice fold says what it holds ("security banners and mail tips") instead of vouching that the organisation added it.
- **L11** — body-error Retry refetches (it collapsed the message); an attachment-list failure no longer fails the body; success notices are neutral with `role="status"`; list keys cannot collide; `ErrorBoundary` around the reading pane and compose. `openCompose` error handling was done under M10.
- **L13** — status badges use `EMAIL_STATUS` / `isInFlight`; the reading pane's badge tone comes from the status code, not a substring of the localised label; the hard-coded `'Care'` fallback is `'Us'`, as in the list.
- **L14** — removed `fetchUserFacts`, `sendableAttachmentIds`, `ComposeDraft.senderId`/`draftCreatedHere`, the unused `firstFocusable` import; corrected the `issueSend` comment. Kept `recipientEntity`/`recipientLookup`: documented configuration awaiting its feature. The `readState.ts` header turned out to be accurate.
- **L15** — fixtures use `*.example.invalid`.
- **L17** — README rewritten for the product as it is.
- **R1** — `eslint-plugin-react-hooks` (rules-of-hooks + exhaustive-deps), `no-unused-vars` on (`_` prefix exempts), `npm run typecheck` now `tsc -p tsconfig.json && tsc -p tsconfig.test.json`, coverage over `data/`, `@types/node` explicit. The full typecheck caught a real crash on its first run: a hook dependency array reading `closeCompose` before its declaration. Lint is clean with zero warnings; deliberate omissions are commented where they are.
- **R2** — also extracted, with tests: `ourAddresses` (the union rule) into `domain/sender.ts`, `toSummary`/`ThreadSummary` into `domain/threadSummary.ts`, `buildParticipantIndex` into `domain/filter.ts`. (Send orchestration and `draftArgsFrom` were done under H1–H4.)
- **R3 (partial)** — `EmailClientRoot.tsx` is 1,725 → ~950 lines: the compose surface (draft, save queue, attachments, recipients, send) is `ui/useCompose.ts`, and sender/signature/templates resolution is `ui/useSender.ts`. The root now reads load → sender → reading → filter → compose → persistence → render. Not done: the further `useCaseMail` / `useReadState` / `useReadingSelection` split the review proposed — lower value now that the risky, stateful part is isolated, and each move is untested UI code.
- **R4** — `domain/guid.ts` (see L4); `data/coerce.ts` `asString` replaces four identical helpers; one `fetchAllPages` pager for the list and read state; one `toCaseQueue` mapping for both queue routes; one `PARTY_ROLE` table (`domain/draft.ts`, re-exported by `data/`). A raw NUL byte in `domain/filter.ts` (a join separator) is now the equivalent `\u0000` escape, so tools stop treating the file as binary.
- **R5 (partial)** — `ErrorPanel` in `parts.tsx` replaces `ListError` and `PaneError`; `ErrorBoundary` added (L11). Not done: a shared chip / link-button / icon set — cosmetic duplication, no defect behind it.
- **R7 (deferred)** — the tables, role and form exist only in the environment; bringing them into `solution/src` needs `pac solution sync` against the demo org, which is an environment action to run with you.
- **CLAUDE.md** — test count, the typecheck paragraph (it now covers all source), the display-vs-send sanitising rule, and the scripts' environment guard updated to match.

## Verification

Final state, run from `pcf/`: `npm test` **650 passed** (586 at the start), `npm run typecheck` clean over all source, `npm run lint` clean with no warnings, `npm run build` succeeded, production build succeeded (bundle 159 KiB gzipped). Nothing was deployed and no script was run against the environment — every behaviour change here is verified by unit tests and the type gate only. The flows most worth checking in the published app before merging: Reply → expand quote on a hostile message (C1); change From on a saved draft, then Send (H1); Reply on B while A is open (H2); Forward → Send immediately (H4); a session switch with compose open (M11).

## Published-app test run — 2026-09-28

Run in CSW through Claude in Chrome on a dedicated case, **CAS-01131-N6S2T3** ("[TEST] … safe to
delete"), whose only parties are the approved test contact and the Care queue. Its inbound email
was created over the API with a script-bait body, a remote image and a small attachment. Two real
sends went out, both from Care to simon.jehrbo@example.com, each announced before sending.

| Check | Version | Result |
|---|---|---|
| C1 compose-quote XSS | 1.14.0 | ✅ Marker never set; no handlers or `javascript:` links anywhere in the page with the quote expanded; quote ids prefixed, images `no-referrer` |
| M4 remote images | 1.14.0 | ✅ "Show pictures" bar; image held back |
| H1 sender change | 1.14.0 | ✅ Changing From rewrote the draft row's sender (read over the API); own-mailbox sender blocked with its reason; sent as Care after switching back |
| Send guard, no recipients | 1.14.0 | ✅ "Not sent — Add at least one recipient first"; nothing sent |
| M9 / L11 notice | 1.14.0 | ✅ Compose closed on acceptance; neutral notice, corrected to "Sent" when the platform reported status 3 |
| H4 forward → Send immediately | 1.15.0 | ✅ Sent with testbilag.txt, reusing the original's blob — after fixing N2 below |
| H2 second compose over the first | 1.15.0 | ✅ A's last words saved on the switch (before its debounce); B opened with its own editor; no stray draft |
| Threading merge (N1) on CAS-01130-T1M1W1 | 1.14.0 | ✅ "Hjælp til selvhjælp" is one thread of 3; the auto-acknowledgement stays apart |
| M11 two-session teardown | 1.15.0 | ❌ Selection restored, compose and expanded messages lost — N3 |
| M11 two-session teardown, re-test | 1.16.0 | ✅ Compose reopened with its text ("M11 sessionsskift test 1.16"), message re-expanded, thread selected |
| "Show pictures" clickable | 1.16.0 | ❌ Covered by the form header on a fresh load (elementFromPoint = header) — N4 |
| Fresh load layout + "Show pictures", re-test | 1.17.0 | ✅ Control settles at y=455 below the tab strip and stays there; "Show pictures", the list search, first row and Reply are each the top element at their position; a real click loaded the remote image (`no-referrer` kept) |

### Found by the test run

| ID | Finding | Status |
|---|---|---|
| N1 | A customer reply that arrives with a new conversation hash was a separate thread (reported on CAS-01130-T1M1W1). Threads now merge on `correlatedactivityid` — not `parentactivityid`, which the auto-acknowledgement carries. | fixed (1.14.0) |
| N2 | **Forward dropped every attachment.** `$select=attachmentid` (a lookup's logical name) is silently ignored by the Web API; the field never arrived. Pre-dates this review; the unit test's fixture used the assumed shape. Now `_attachmentid_value`; all other selects audited. | fixed (1.15.0) |
| N3 | M11 as first written did not restore: the mount-time persist came back as `restored` before the landing ran. The landing now reads the state as it was at mount. New shell smoke test fails without the fix. | fixed (1.16.0), verified live |
| N4 | On a fresh load the form header is drawn over the top ~240 px of the control — the list's first rows, the Reply/Forward buttons, and "Show pictures", which cannot be clicked (reported by the user). Measured: after a session restore the control sits at y=480 claiming 491 px and is fine; on a fresh load it sits at y=128 under UCI's sticky-header overlay. Not caused by tab switching or `scrollIntoView`. The first render claimed height with `rootTop = 0` (nearly the whole viewport), so the new tab was taller than the form and UCI scrolled it into view, engaging the overlay. `rootTop` is now measured in a layout effect before first paint, and the unmeasured claim is `MIN_HEIGHT`. Pre-dates this review. | fixed (1.17.0), verified live |
| N5 | "Signature still belongs to the previous sender" stayed after switching From back. | fixed (1.16.0) |
| N6 | **Inline images never displayed.** Dataverse extracts every inline image (a signature logo, a pasted screenshot) into an `activitymimeattachment` whose `attachmentcontentid` is the body's `cid:` reference; the sanitiser kept `cid:` for "resolution afterwards" and nothing resolved it, so they rendered broken — and correctly offered no "Show pictures", since nothing was remote. Reported by the user on CAS-01130-T1M1W1. Now resolved to raster `data:` URLs from the message's own rows (`domain/inlineImages.ts`), fetched after the body shows; inline images the body shows are no longer listed as attachments. Pre-dates this review. | fixed (1.18.0), verified live by the user |
| N7 | The reading pane offers Reply / Reply all / Forward on the agent's own **unsent draft**, and labels it "Sent on". Found forwarding draft 0360338d on CAS-01131 during the 1.20.0 run. A draft should offer resume, not answer; Outlook offers no reply on a draft. Pre-dates this review. Now a draft shows "Draft saved: <time>" and, when it is the agent's own and answers a message on the case, a **Continue draft** button that reopens compose on the same row (`draftContinuation` in `domain/draft.ts`; the list query now carries `_ownerid_value`). Another agent's draft says so and offers nothing; if the draft was sent or discarded since the list loaded, continuing says so instead of silently starting a new reply. Shell smoke test covers the seam. | fixed (1.21.0) |
| N8 | Forwarding a reply keeps its subject as "RE: X": `composeSubject` returns the base unchanged whenever it already carries *any* prefix, so Forward never adds "FW:". Outlook gives "FW: RE: X" — only the *same* prefix should not stack. Pre-dates this review. The prefixes are now split into reply (`RE SV AW ANTW RIF ANG`) and forward (`FW FWD VS VB VL`) — VS is the Danish/Norwegian forward prefix. Replying to a forward likewise gives "RE: FW: X". | fixed (1.21.0) |
| N9 | The compose header reads "Forward **to** Care" when forwarding Care's own sent reply: `Compose.tsx` renders `to {answeringLabel}` for every mode, and `answeringLabel` is the ORIGINAL sender — right for a reply, wrong for a forward, which has no recipient yet. Found in the 1.21.0 run. Pre-dates this review. A forward now reads "Forward message from Care"; replies keep "Reply to …". | fixed (1.22.0) |
| N10 | **Requirement (product owner, 2026-09-29): the client must never remove a tracking token from a subject.** `composeSubject` stripped the inherited token (`CRM:0100017`) from every reply and forward, on the grounds that the platform appends a fresh one on send. It now carries the subject forward verbatim — only the RE:/FW: prefix is added — and `stripTrackingToken` was deleted so it cannot return. `normaliseSubject` (grouping key, in memory) and the thread list's on-screen subject still hide the token; neither writes a subject. Drafts saved before 1.22.0 (84708d7c, 0360338d on CAS-01131) keep the token-less subject they were saved with. The premise for stripping was also wrong (product owner): when the subject already carries a token this organisation knows, the platform leaves it and appends none; two tokens mean the mail passed through another Dynamics system, whose token must survive too. | fixed (1.22.0) |
| N11 | **The form header is drawn over the top of the control after selecting a thread** — the list title bar and the reading pane subject disappear under it (reported by the user with a screenshot, 2026-09-29). Reproduced on 1.22.0: clicking a thread moved the control up ~57 px under the Email/Related bar. Both the reading pane (scroll to the selected message) and the thread list (keyboard focus) used `scrollIntoView`, which scrolls **every** scrollable ancestor — including the form tab section, which overflows by 23 px — and UCI answers a scrolled section with its header overlay (the same overlay as N4). Now `revealWithin` (`ui/scroll.ts`) scrolls only the list or the stack; a test fails if `scrollIntoView(` reappears in the UI. The 23 px overflow itself (claim = viewport − rootTop − 24) is a separate, smaller issue, to be measured. | fixed (1.23.0), live check pending |
| — | An apparent hang (renderer frozen, script injection timing out) turned out to be Chrome throttling and freezing a hidden tab — `visibilityState: hidden`, and the window was confirmed minimised; no long tasks once visible. Not a control defect. | not a bug |
| — | One forward send was triggered without the test script's click; the script found Send already disabled. A controlled repro (20 s, recipient added, Send untouched) sent nothing, and the only path to `sendDraft` is the button's click handler. Cause not determined. | watch |
| — | The reply to the API-seeded message got its own thread: seeded rows have no `conversationindex`, so the platform gave the reply a new root. Seed-data artefact (CLAUDE.md), not a product defect. | not a bug |
- **L6 (completed)** — an address matching two records is kept unresolved but marked `ambiguousMatches`; the send guard takes a required `ambiguousAddresses` and says it "matches more than one record" instead of "not a known record"; the chip tooltip says so too.
- **L3 (closed by measurement)** — read live 2026-09-28: the agent's mailbox reports `mailboxstatus` = Success with outgoing = Not Run and cannot send; Care reports Success for both. `mailboxstatus` carries no sending signal, so it is no longer fetched and CLAUDE.md no longer lists it. `outgoingemailstatus` stays the gate.
- **R7 (in progress)** — the environment's `JHRBCaseEmailClient` holds the two custom tables (all subcomponents), the read-state role, the control, and `incident`/`email`/`queue`/`systemuser` as shells (no subcomponents — nothing of those tables ships). The **Case - Email Client form was in no solution**; it has been added (AddSolutionComponent, form only, no required components).
- **R5 (closed as partial)** — the remaining link-button / chip / icon duplication differs in colour, size and weight at almost every site; merging it is style churn with no defect behind it and no visual test to catch a regression. Left as is.
- **R7 (partial)** — `solution/src` is now `pac solution sync --packagetype Both` of the environment's solution: both custom tables, their relationships, the role, the four standard tables as shells, and the Email Client form. Verified: Debug builds unmanaged, Release `-p:SolutionPackageType=Managed` builds managed (unmanaged-only source is refused: "Solution package type did not match requested type"). **Remaining blocker:** the form was created as a copy of this environment's customised main Case form and declares **88 missing dependencies** on other projects' components — the Feriegaranti BPF, `team_fg_*` columns, `team_fg_krav_Case_incident`. A managed release would fail to import into a clean environment until the form is reduced to a self-contained one (the Email tab plus standard Case header fields). That changes what agents see on this form, so it waits for a decision.
- **R7 (completed)** — the "Case - Email Client" form is now self-contained: the Email tab, the standard Case header (title, case number, status, priority, owner) and the original display conditions; the copied tabs, the other project's script libraries and events, footer and navigation are gone (68 KB → 3.7 KB of form XML). Verified in the published app: header intact, tabs Email + Related, control laid out correctly. `solution/src` re-synced: missing dependencies **88 → 10**, all standard Customer Service components (the Case table and five of its columns, and the three out-of-the-box roles the form's display conditions name). Debug builds unmanaged, Release builds managed. `create-case-form.mjs` now builds the same minimal form. (The "DA Feriegaranti" process bar still shows — a BPF belongs to the Case table, not the form, and is not a dependency.)
- **Type-ahead in To/Cc (user request, 1.19.0)** — verified in the published app: "sim" offered the contact first, then users, each labelled; a mouse pick and a keyboard pick (↓, Enter) each added a bound chip; the list left out someone already on the message; a typed address with no match offered "Press Enter to add the address as typed" and added a flagged chip. Closing without sending saved nothing.
- **Leads in the lookup and resolving flagged chips (user request, 1.20.0)** — verified in the published app 2026-09-29. Type-ahead "sim" now queries `leads` alongside contacts, accounts, users and queues (five requests, no error); the environment has no open lead with an email address, so a lead could not be shown as a suggestion. A typed unknown address became a flagged chip whose label is a button ("Resolve … to a record", tooltip names leads); clicking it opened the platform lookup pre-filled with the address; picking the Simon Jehrbo contact replaced the chip **in place** with a bound, unflagged chip, and the resolve button went. Closing without sending saved nothing (no new rows on the case). The first attempt found 1.19.0 still live: the 1.20.0 build had not been imported — packaged version checked, imported, published, re-tested.
- **N7 and N8 (1.21.0)** — verified in the published app 2026-09-29. Both drafts on CAS-01131 show "Draft saved: <time>" and **Continue draft**, with no Reply / Reply all / Forward; the sent reply beside them keeps its normal actions. Continue draft on 0360338d re-read the row (status and owner), then opened "Reply to Simon Jehrbo" with the draft's own text, its stored To and subject, and saved to the same row — no new row on the case. Forward on the sent reply "RE: Test: kodegennemgang CRM:0100017" composed **"FW: RE: Test: kodegennemgang"** (token stripped). Closed without sending. The first click appeared to do nothing: the Chrome window was hidden and the page was frozen (a 20 s timer did not fire in 45 s); the queued resume completed the moment the window was visible. Not a control defect.
- **N9 and N10 (1.22.0)** — verified in the published app 2026-09-29. Forward on the sent reply "RE: Test: kodegennemgang CRM:0100017" opened with the header **"Forward message from Care"** and the subject **"FW: RE: Test: kodegennemgang CRM:0100017"** — the tracking token carried forward verbatim. Closed without sending; no new rows on the case.
