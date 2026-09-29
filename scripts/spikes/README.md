# Spike scripts

Reproducible probes used to answer research questions. Most of them write to the target
environment, so read the guardrails in [`../../CLAUDE.md`](../../CLAUDE.md) first.

**Every script here is dry-run unless you pass `--confirm`.** Without it, a script does at most
some reads and prints what it would create or send.

```bash
az login                          # once; the token is fetched in-process, never stored
export DV_CASE=<case guid>        # or put it in a .caseid file beside the script (gitignored)
node scripts/spikes/s6-attachments.mjs            # dry run
node scripts/spikes/s6-attachments.mjs --confirm  # does it
```

The environment guard and token handling are shared with every other script — see
[`../deploy/README.md`](../deploy/README.md). `DV_ORG`, if set, must name the demo org or the
script refuses to start. There is no `.tok` file any more.

Scripts that create rows record their ids in a `*-created.json` beside themselves (gitignored),
written as each row is created, so a run that fails halfway still says what to clean up.

## `s6-attachments.mjs`

Creates a draft email on `DV_CASE`, then probes attachment upload both inline (base64 into
`activitymimeattachment.body`) and chunked (`InitializeAttachmentBlocksUpload` → `UploadBlock` →
`CommitAttachmentBlocksUpload`), at sizes either side of `Organization.MaxUploadFileSize`. Downloads
each success back and compares SHA-256.

**It does not change `MaxUploadFileSize`** — it reads it and probes around it. The dry run reads it
and stops there.

Result (2026-09-10): inline is capped by the setting and fails at 6 MB with a clean HTTP 400; chunked
ignores the cap and succeeded at 40 MB. Full write-up in
[`../../docs/research/06-spikes.md`](../../docs/research/06-spikes.md).

**It leaves data behind.** Ids are written to `s6-created.json`; delete the attachments and the draft
email when done (the 2026-09-10 run created 90 MB and cleaned it up afterwards).

## `s7-send.mjs`

**SENDS REAL EMAIL** (`IssueSend: true`) — only with `--confirm`, and it prints the recipient first.

Creates a reply on `DV_CASE` from the approved **Care** queue, with rich text, two levels of Outlook
`divRplyFwdMsg` quoted history using Danish headers, and a 1 MB attachment uploaded via the chunked
API. Then sends it and reports the resulting `statuscode`, `messageid`, `conversationindex`,
`baseconversationindexhash` and `trackingtoken`.

The recipient is `DV_TO`, default `simon.jehrbo@example.com` — the one address approved for test sends.
`guardRecipient` refuses anything else except an RFC 2606 undeliverable address (`*.invalid`,
`example.com`), checked at start-up and again immediately before the send.

Result (2026-09-10): sent and received. Two findings — the platform **overwrites**
`baseconversationindexhash` on send, and **appends the tracking token to the subject**. Details in
[`../../docs/research/06-spikes.md`](../../docs/research/06-spikes.md).

Its second probe (send from the unapproved `<Care Agents>` queue) was **removed** on 2026-09-28: it
sent real mail from a queue nobody had approved, and did not test the approval guard anyway, because
that queue has no email address. `r18-approval-probe.mjs` is the probe for that question.

## `r18-approval-probe.mjs`

**ATTEMPTS A REAL SEND** — only with `--confirm`. Probes what happens when the sender is an
addressed but **unapproved** queue — the R18 approval guard. The recipient is
`anna.hansen@example.invalid` (RFC 2606, non-routable), checked by `guardRecipient`.

Result (2026-09-10, queue `Offensive Support` / `doesntexists@invalid.local`, approval = 2): there is
**no guard and no failure signal**. `SendEmail` returns HTTP 200, the email parks at `Pending Send`
indefinitely, and the mailbox records nothing (`outgoingemailstatus` = Not Run, `lastsyncerror` null).

**Consequence:** a client must pre-flight approval state rather than react to failure. See
[`../../docs/research/06-spikes.md`](../../docs/research/06-spikes.md).

Note it leaves a stranded `Pending Send` email on the Case (id in `r18-created.json`) — delete it
afterwards, as the 2026-09-10 run did.

## `s12-sanitise-probe.mjs`

Does Dataverse sanitise an email body? Half B (read-only) inspects recent real inbound bodies and
runs in a dry run; half A (`--confirm`) round-trips a hostile payload through one draft that is
never sent, then deletes it.

## `r8-parent-link.mjs`

Temporary R8 fixture (moved here from `scripts/deploy/` — it is not a deploy step). Sets or clears
`parentcaseid` on one verification case: `node scripts/spikes/r8-parent-link.mjs set|clear [--confirm]`.
Run `clear --confirm` as soon as the verification is done.
