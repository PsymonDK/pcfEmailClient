# 04 — Dataverse email data model vs. full-client needs

Answers **RQ6–RQ10**. Confirmed source of truth: **Dataverse email records only**, no Microsoft Graph.

Primary references: [Email table reference](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/reference/entities/email),
[Email activity tables](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/email-activity-entities),
[ActivityParty table](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/activityparty-entity),
[Use file data with Attachment and Note records](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/attachment-annotation-files).

## Tables in play

| Table | Role |
|---|---|
| `email` | The message. Child of `activitypointer`. |
| `activityparty` | Every participant. One row per person per role per activity. |
| `activitymimeattachment` | Email attachments (distinct from `annotation` notes attachments). |
| `template` | Email templates. |
| `incident` | The Case — our scope boundary via `regardingobjectid`. |
| `mailbox` / `systemuser` / `queue` | Send eligibility and approval state. |

## RQ10 — Threading: better than assumed

My initial assumption that Dataverse "has no true MIME threading fidelity" was **wrong**. The `email`
table carries genuine Exchange-grade correlation columns:

| Column | Type | Notes |
|---|---|---|
| `conversationtrackingid` | Uniqueidentifier | Conversation Tracking Id. `IsValidForForm: False`, readable. **Measured 0% populated — do not use.** See [measured population](#measured-population-customer-service-demo-dk-2026-09-09). |
| `conversationindex` | String (2048) | "Identifier for all the email responses for this conversation." The Exchange **ConversationIndex** — hierarchical, append-on-reply. True parent/child ordering, not just grouping. **Hard read-only: `IsValidForCreate: false`, `IsValidForUpdate: false`.** Only server-side sync populates it. |
| `baseconversationindexhash` | Integer | "Hash of base of conversation index." A cheap, indexable grouping key. **Writable on create *and* update** — so it is not a platform-guaranteed value; treat it as advisory, not as an integrity guarantee. |
| `correlatedactivityid` | Lookup → `email` | Platform's own correlation result. |
| `correlationmethod` | Picklist | "Shows how an email is correlated to an existing email… **For system use only.**" Read for diagnostics; do not write. |
| `parentactivityid` | Lookup → `email` | "Select the activity that the email is associated with." |
| `messageid` | String (320) | Internet Message-ID — "**Used only for email that is received.**" |
| `internetmessageheaders` | String (**500**) | "Contains a set of internet headers associated to the email message in json format." |
| `trackingtoken` | String (50) | The `CRM:xxxx` token used to auto-track replies. |

**Recommended threading strategy**, in precedence order:

1. `baseconversationindexhash` as the primary grouping key — cheap, indexable, stable across a chain,
   and **measured at 100% population**.
2. `conversationindex` for **ordering and parent/child nesting** inside a group. Falls back to
   `createdon` for drafts, which never have it (see below).
3. `correlatedactivityid` / `parentactivityid` to stitch records the above misses.
4. Normalised-subject fallback (strip `RE:`/`FW:`/localised variants) for records with none of the above
   — typically manually created or imported email.

`conversationtrackingid` was originally listed first here. **Measurement demoted it** — it is entirely
unpopulated in the target environment.

Scope every query by `regardingobjectid eq <caseId>`; `_regardingobjecttypecode` guards against
same-GUID collisions across tables.

### Measured population (the demo environment, 2026-09-09)

Read-only `pac org fetch` aggregates over all 48 `email` rows in the target environment. This is
**partial S8 evidence** — see [`06-spikes.md`](06-spikes.md#s8-result-partial--2026-09-09) for the caveat about
dataset depth.

| Column | Populated | Rate |
|---|---:|---|
| `baseconversationindexhash` | 48 / 48 | **100%** |
| `conversationindex` | 40 / 48 | 83% |
| `messageid` | 40 / 48 | 83% |
| `trackingtoken` | 12 / 48 | 25% |
| `conversationtrackingid` | **0 / 48** | **0%** |

**The 17% gap in `conversationindex` is exactly the drafts.** All 8 rows with a null
`conversationindex` are `statuscode` = 1 (Draft), and zero drafts have one — a clean 8/8 correlation.
Drafts *do* carry `baseconversationindexhash`, so they group into the right thread but cannot be
ordered by conversation index. **Order by `conversationindex` where present, `createdon` otherwise.**
This matters directly for R16: a draft reply must appear in the right thread, at the end.

Also worth noting: `messageid` is populated on **outgoing** rows here, not just received ones as the
documentation states ("Used only for email that is received"). Don't rely on either reading — treat it
as best-effort.

### Writability of the correlation columns (metadata, 2026-09-09)

Queried from `EntityDefinitions(LogicalName='email')/Attributes`. This settles what can and cannot be
constructed in test data, and explains the drafts result above:

| Column | Create | Update |
|---|:--:|:--:|
| `baseconversationindexhash` | ✅ | ✅ |
| `conversationindex` | **❌** | **❌** |
| `conversationtrackingid` | ✅ | ❌ |
| `parentactivityid` | ✅ | ❌ |
| `messageid` | ✅ | ✅ |
| `trackingtoken` | ✅ | ✅ |
| `description`, `subject` | ✅ | ✅ |

**`conversationindex` cannot be written at all.** This has two consequences:

1. It explains the 8/8 draft correlation — the hash is writable and gets inherited when the UI creates
   a reply, but `conversationindex` is platform-only and is set solely by server-side sync.
2. **API-created or seeded email can never carry it.** So ordering and nesting by `conversationindex`
   is *only* testable against mail that has genuinely round-tripped through a synced mailbox. Grouping,
   and the `createdon` ordering fallback, are testable with seeded data.

Corollary worth carrying into implementation: because `baseconversationindexhash` is writable by any
caller with write access, it is **advisory**. The client should degrade gracefully if two unrelated
threads collide on a hash rather than assuming platform-guaranteed uniqueness.

**Remaining gap:** `internetmessageheaders` is capped at **500 characters**. Real `References:` chains
routinely exceed that, so full RFC-5322 reconstruction is not available. Do not design around it.

## Reading requirements

| Req | Mapping | Status |
|---|---|---|
| R1, R2 | `email` filtered by `regardingobjectid`; group per strategy above; expand `email_activity_parties` | ✅ |
| R2 recipients | `activityparty` rows filtered by `participationtypemask`: **1** Sender, **2** ToRecipient, **3** CCRecipient, **4** BccRecipient | ✅ |
| R3 body | `description` — Memo, `Format: Email`, `MaxLength: 1073741823` | ✅ with caveat below |
| R4 quoted history | No structural marker exists | ⚠️ heuristic, see below |
| R5 attachments | `activitymimeattachment` filtered by `objectid` = the email; `filename`, `mimetype`, `filesize`, `body` (base64) | ✅ |
| R6 read state | No first-class per-agent read flag on `email`. `lastopenedtime`, `opencount`, `attachmentopencount` are **recipient-side tracking**, not agent-side | ❌ **needs a custom column** |
| R7 filter/search | See platform constraint below | ⚠️ **capped by platform** |
| R8 parent Case | Walk `incident.parentcaseid`, union the queries. Prior art: [CustomTimelineControl](https://github.com/matteo-campana/CustomTimelineControl) does exactly this | ✅ |

### Platform constraint on R3 and R7 — email bodies are in blob storage

`Email.Description` has been **relocated from the relational store to Azure Blob storage**. Consequences,
quoted from the docs:

- "Filtering on email descriptions **isn't supported**."
- "FetchXML — You can't search in email bodies by using FetchXML."
- "Quick Find and Advanced Find — You can't filter email descriptions by using these methods."
- Body text *can* be **returned as a column** ("you can add the email body as a returned column"), and
  **Dataverse search** can be enabled over descriptions.

**Design implications, independent of chosen architecture:**
- Body-text search (part of R7) must go through **Dataverse search**, not the Web API `$filter`.
- Retrieving bodies is a blob read. Do **not** fetch `description` in the thread-list query; fetch it
  lazily per message on expand. This is a hard performance requirement for N5, not an optimisation.

### R4/R12 — quoted history

There is no column, marker or API that separates new text from quoted history. Dataverse stores one
HTML blob. This must be solved with a **client-side heuristic** in the reading layer:

- Detect common quote containers: `blockquote`, Outlook's `div#divRplyFwdMsg`, `<hr>` + "From:" header
  blocks, Gmail's `gmail_quote`, and the `-----Original Message-----` text delimiter.
- Localisation matters — "From:/Sent:/To:/Subject:" header blocks appear in the sender's language.
- On **compose** (R12), control the structure you emit so your own replies are always cleanly
  detectable downstream, and never re-serialise the inherited quote — append to it verbatim.

**This is the single largest functional risk in the build.** It is host-independent, so it does not
affect architecture selection, but it should be prototyped early (spike S7).

## Compose and send requirements

| Req | Mapping | Notes |
|---|---|---|
| R9 recipients | Create `activityparty` rows with the right `participationtypemask`. Reply-all = prior To + Cc minus the current user; Reply = prior Sender | `torecipients` (String, 500) is a **read-only display convenience** — `IsValidForForm: False`. Write parties, not this. |
| R10, R11 | Host concern, not data-model. See [`03-candidates.md`](03-candidates.md) | |
| R13 attachments | Create `activitymimeattachment` with `objectid` = email, `objecttypecode` = `email`, `body` = base64, `filename` | See size ceilings below |
| R14 templates | `template` table. Messages available on `email`: **`SendEmailFromTemplate`**, `SendTemplate`, plus `InstantiateTemplate` to resolve token-filled content **without sending** — the right call for "insert template into the editor" | `email.templateid` is documented **"For internal use only"** — do not write it |
| R15 signature | Not on `email`. Signatures live in the `emailsignature` table, tied to the user | Resolve the agent's default signature and prepend on compose |
| R16 drafts | `statecode` = **0 (Open)**, `statuscode` = **1 (Draft)**. Note `Email.StatusCode` **cannot be null** | A draft is a real, queryable Dataverse row — so durable drafts are cheap, which is the mitigation for the multi-session state problem |
| R17 send | `POST /api/data/v9.x/emails(<id>)/Microsoft.Dynamics.CRM.SendEmail` with body `{ "IssueSend": true }` | `IssueSend: false` marks it sent **without actually sending** — useful for logging, dangerous by accident. Test both in S7. |
| R18 errors | Guarded by `Organization.RequireApprovalForUserEmail` / `RequireApprovalForQueueEmail`; when set, mail is sent only if the user's or queue's address is approved (`SystemUser.EmailRouterAccessApproval` = 1) | **Pre-flight this** and warn the agent up front rather than failing at send |
| R20 regarding | Set `regardingobjectid` to the Case on create | Trivial; also what scopes it back into our own view |
| R19 Copilot | `context.Copilot` in PCF / `Xrm.Copilot` in MDA script | See [`03-candidates.md`](03-candidates.md) |

### RQ7 — attachment size ceilings

- Governed by **`Organization.MaxUploadFileSize`**, set in System Settings → Email. "The default setting
  is 5 MB." This limit covers email attachments, notes and web resources together.
- Raisable to **131,072,000 bytes (125 MB)**.
- Above the inline-payload comfort zone, use the **chunked upload** messages rather than a single
  base64 `body` write. `BlocksDownloadRequest` is the counterpart for large downloads.
- **Attachment reuse is free**: creating an `activitymimeattachment` that references an existing
  `attachmentid` points at the same file BLOB without duplicating storage — relevant for forwarding a
  message with attachments (R9 forward), which should reuse rather than re-upload.

Spike S6 must establish the **actual** configured ceiling in the target environment and confirm the
failure mode above it is a catchable error, not a hang.

## Requirement traceability summary

Every MUST maps to a concrete table, column or message, with two exceptions to carry into implementation:

| Gap | Requirement | Resolution |
|---|---|---|
| No per-agent read state on `email` | R6 | Add a custom column (e.g. `new_readbyowneron`) or a small custom table keyed by email + user. Decide in implementation planning. |
| No quote boundary in the body | R4, R12 | Client-side heuristic + controlled emission on compose. Prototype in S7. |

One further platform cap, not a gap in our design: **body-text filtering is unavailable** (R7 partial),
mitigated by Dataverse search.
