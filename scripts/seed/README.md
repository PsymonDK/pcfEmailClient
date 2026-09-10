# Seed data for the research spikes

> **Status: nothing is deployed.** All spike artefacts and seed data were removed on 2026-09-10 and the
> removal verified (org email count back to its pre-spike 48). These scripts recreate everything if the
> spikes need re-running. Every cleanup script here is dry-run unless you pass `--confirm`.

Creates a Case with a deliberately deep email chain so spikes **S1** (render), **S7** (quoted history)
and **S8** (threading) have realistic data. The target environment's own email is too shallow — 26 of
34 threads were single messages, deepest chain 5.

## What it creates

One Case, `TEST - Email client threading seed (deep chain)`, on account *Jensen VVS ApS* with primary
contact *Anna Hansen*, plus **12 email activities**:

| Group | Messages | `baseconversationindexhash` | Purpose |
|---|---:|---|---|
| Thread A | 7 | `111000001` | Deepest chain in the environment. Alternating in/out, 6 levels of nested quoted history. |
| Thread B | 3 | `111000002` | A second, shorter thread to prove grouping separates them. |
| Orphans | 2 | *null* | **No hash** — forces the subject-normalisation fallback (precedence step 4), which was otherwise untested. |

Bodies use real Outlook `<div id="divRplyFwdMsg">` + `<hr>` structure with **Danish** header blocks
(`Fra:` / `Sendt:` / `Til:` / `Emne:`) — deliberately exercising the localisation concern flagged for
R4/R12 in [`../../docs/research/04-data-model.md`](../../docs/research/04-data-model.md).

All addresses are `@example.invalid` / the demo tenant. `.invalid` is reserved by RFC 2606 and
non-routable, so **no mail can escape**. Nothing is sent — rows are created directly and then patched
to Sent/Received.

## What it cannot create

`conversationindex` is **`IsValidForCreate: false` and `IsValidForUpdate: false`** — hard read-only,
populated only by server-side sync. Every seeded row therefore has a null `conversationindex`.

Consequence: seeded data can validate **grouping** and the **`createdon` ordering fallback**, but
cannot validate **ordering or nesting by `conversationindex`**. That half of S8 needs mail that has
genuinely round-tripped through a synced mailbox.

## Running it

```bash
export DV_ORG=https://your-org.crm4.dynamics.com
export DV_TOKEN=$(az account get-access-token --resource $DV_ORG --query accessToken -o tsv)
export DV_CASE=<existing case guid>   # or create one first; see git history
node scripts/seed/seed.mjs
```

`seed.mjs` writes `seeded-ids.json`, the manifest used for cleanup.

## Cleaning up

Dry run by default:

```bash
node scripts/seed/cleanup.mjs
```

Actually delete the 12 emails and the Case:

```bash
node scripts/seed/cleanup.mjs --confirm
```

This is a **shared demo environment**. Clean up when the spikes are done rather than leaving test
Cases lying around.

**`revert-s1.mjs` order matters** (10 steps, dry-run by default). Removing a custom page from an app
needs three of them: `RemoveAppComponents`, then deleting the `appelement` rows that link page → app
(component type 10088), then a republish — only then will the `canvasapp` delete. The custom control
can only go after the page. Chain: **app → appelement → page → control**.

**`revert-s11.mjs`** unwinds the S11 artefacts instead (7 steps, dry-run by default): the two
application tab templates, then the S11 form (unregister → republish → delete), then the unmanaged
solution container and the custom control, then a final republish. Two things it encodes:

- **Delete the template, not its parameters.** Parameters cascade with the template — and the platform
  creates parameter rows of its own on these templates, so filtering them by a `jhrb_s11` uniquename
  prefix over-deletes the platform's rows. That happened once during setup.
- There is **no custom page in the S11 chain**, which is the whole point of S11: the `appelement`
  tangle above simply does not arise.
