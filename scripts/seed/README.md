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
az login                              # once; the token is fetched in-process, never stored
export DV_CASE=<existing case guid>   # or create one first; see git history
node scripts/seed/seed.mjs            # dry run: prints the plan
node scripts/seed/seed.mjs --confirm  # creates the rows
```

The environment guard and token handling are shared with every other script — see
[`../deploy/README.md`](../deploy/README.md). `DV_ORG`, if set, must name the demo org or the
script refuses to start.

`seed.mjs` writes `seeded-ids.json`, the manifest used for cleanup, after **every** row, so a run
that fails halfway still records what it created. It **refuses to run** while that manifest still
lists ids from an earlier run — overwriting it would orphan those rows. Run `cleanup.mjs --confirm`
first; a fully successful cleanup empties the manifest.

## Cleaning up

Dry run by default:

```bash
node scripts/seed/cleanup.mjs
```

Actually delete the 12 emails and the Case:

```bash
node scripts/seed/cleanup.mjs --confirm
```

It checks that the manifest was recorded against the same org before deleting anything, and
empties the manifest only when every delete succeeded (or found the row already gone).

This is a **shared demo environment**. Clean up when the spikes are done rather than leaving test
Cases lying around.

**Neither spike revert touches the product.** Until 2026-09-28 both also deleted solution
`JHRBCaseEmailClient` and control `jhrb_JHRB.CaseEmailClient` as "leftovers" — but since Phase 0
those are the live product's names, so a spike cleanup would have uninstalled the shipped email
client (review finding H6). They now remove only spike-only artefacts, plus the old spike-named
solution `JHRBCaseEmailClientSpike`. Removing the product is
[`../deploy/revert-deploy.mjs`](../deploy/revert-deploy.mjs)'s job, done deliberately.

**`revert-s1.mjs` order matters** (9 steps, dry-run by default). Removing a custom page from an app
needs three of them: `RemoveAppComponents`, then deleting the `appelement` rows that link page → app
(component type 10088), then a republish — only then will the `canvasapp` delete. Chain:
**app → appelement → page**.

**`revert-s11.mjs`** unwinds the S11 artefacts instead (6 steps, dry-run by default): the two
application tab templates, then the S11 form (unregister → republish → delete), then the spike
solution container, then a final republish. Two things it encodes:

- **Delete the template, not its parameters.** Parameters cascade with the template — and the platform
  creates parameter rows of its own on these templates, so filtering them by a `jhrb_s11` uniquename
  prefix over-deletes the platform's rows. That happened once during setup.
- There is **no custom page in the S11 chain**, which is the whole point of S11: the `appelement`
  tangle above simply does not arise.
