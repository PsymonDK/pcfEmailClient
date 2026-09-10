# Spike scripts

Reproducible probes used to answer research questions. All of them write to the target environment,
so read the guardrails in [`../../CLAUDE.md`](../../CLAUDE.md) first.

```bash
export DV_ORG=https://your-org.crm4.dynamics.com
export DV_TOKEN=$(az account get-access-token --resource $DV_ORG --query accessToken -o tsv)
export DV_CASE=<case guid>
node scripts/spikes/s6-attachments.mjs
```

## `s6-attachments.mjs`

Creates a draft email on `DV_CASE`, then probes attachment upload both inline (base64 into
`activitymimeattachment.body`) and chunked (`InitializeAttachmentBlocksUpload` → `UploadBlock` →
`CommitAttachmentBlocksUpload`), at sizes either side of `Organization.MaxUploadFileSize`. Downloads
each success back and compares SHA-256.

**It does not change `MaxUploadFileSize`** — it reads it and probes around it.

Result (2026-09-10): inline is capped by the setting and fails at 6 MB with a clean HTTP 400; chunked
ignores the cap and succeeded at 40 MB. Full write-up in
[`../../docs/research/06-spikes.md`](../../docs/research/06-spikes.md).

**It leaves data behind.** Ids are written to `s6-created.json`; delete the attachments and the draft
email when done (the 2026-09-10 run created 90 MB and cleaned it up afterwards).

## `s7-send.mjs`

**SENDS REAL EMAIL** (`IssueSend: true`). Only run it with explicit authorisation, and set `DV_TO` to
an address you are allowed to mail.

Creates a reply on `DV_CASE` from the approved **Care** queue, with rich text, two levels of Outlook
`divRplyFwdMsg` quoted history using Danish headers, and a 1 MB attachment uploaded via the chunked
API. Then sends it and reports the resulting `statuscode`, `messageid`, `conversationindex`,
`baseconversationindexhash` and `trackingtoken`.

Result (2026-09-10): sent and received. Two findings — the platform **overwrites**
`baseconversationindexhash` on send, and **appends the tracking token to the subject**. Details in
[`../../docs/research/06-spikes.md`](../../docs/research/06-spikes.md).

Its second probe (send from an unapproved queue) did **not** test the approval guard, because the queue
it used has no email address at all. That path is still untested.
