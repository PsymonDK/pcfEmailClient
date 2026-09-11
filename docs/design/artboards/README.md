# Design canvas sources

The design lives at **https://claude.ai/code/artifact/97efa07d-8354-4443-8513-9312cef49354** —
14 screens on a pan/zoom canvas across three pages (Reading · Compose & send · Foundations).

**These files are the source.** Each `.dc.html` is one screen; `canvas.json` places them, names them,
groups them into pages and carries the sticky notes. The published page is *generated* from them and is
gitignored, because it is ~2.7 MB of editor payload that regenerates in a second.

| File | Screen |
|---|---|
| `Main.dc.html` | The design — reading, default state, at the real 1600 × 536 |
| `QuoteAndNoise.dc.html` | 3.4 — quoted history and injected notices, three states |
| `BodyFidelity.dc.html` | 3.3 — the sender's HTML, sanitising and containment |
| `FilterAndParent.dc.html` | 3.5 / 3.6 — filter panel, zero results, parent case |
| `States.dc.html` | 5.3 — empty, loading, broken, 50-message case |
| `Compose.dc.html` | 4.0 — **compose at actual size**, docked / popped out / overlay |
| `ComposeOpen.dc.html` | 4.1 / 4.2 — compose in context at the real host size |
| `ComposeInserts.dc.html` | 4.3 — templates and Copilot |
| `Attachments.dc.html` | 4.4 — drag, progress, complete, oversize |
| `DraftAndSend.dc.html` | 4.5 / 4.6 — drafts, the send ladder, pre-flight |
| `Tokens.dc.html` | 00 — tokens and the state vocabulary |
| `Placements.dc.html` | 2 — both placements and the 536px height budget |
| `Dark.dc.html` | 5.1 — dark theme |
| `Accessibility.dc.html` | 5.2 — keyboard, screen reader, contrast |

## Regenerating and republishing

The canvas is produced by the `design` skill's helper, which seeds a fresh copy of its payload with
these files. From this directory:

```bash
node "<design skill dir>/seed-canvas.mjs" \
  --template "<design skill dir>/payload.template.html" \
  --out case-email-client-bakeoff.html \
  --title "Case Email Client — Design" \
  --artboard Main.dc.html --artboard QuoteAndNoise.dc.html --artboard BodyFidelity.dc.html \
  --artboard FilterAndParent.dc.html --artboard States.dc.html --artboard Compose.dc.html \
  --artboard ComposeOpen.dc.html --artboard ComposeInserts.dc.html --artboard Attachments.dc.html \
  --artboard DraftAndSend.dc.html --artboard Tokens.dc.html --artboard Placements.dc.html \
  --artboard Dark.dc.html --artboard Accessibility.dc.html \
  --canvas canvas.json
```

Then publish that file to the **same artifact URL** so the link keeps working. Publishing it as a new
file claims a new URL and orphans the one above.

Two things to know:

- **Edits made in the canvas itself do not come back here.** If someone adjusts a screen in the editor
  and saves, these source files are then behind. Read the published page back before editing it from
  the repo, or their change is lost on the next regenerate.
- **The out filename is historical.** It says "bakeoff" because the canvas started as a four-candidate
  comparison; the filename is now just the artifact's identity and changing it would break the URL.

## Status

**Frozen at Gate 3, 2026-09-11.** The design is signed off and the handoff written:

- [`../01-design-decisions.md`](../01-design-decisions.md) — what was chosen, what lost, what would reverse it
- [`../02-component-inventory.md`](../02-component-inventory.md) — every element → Fluent component → requirement
- [`../03-interaction-spec.md`](../03-interaction-spec.md) — keyboard, focus, timings, the height budget
- [`../00-fixture.md`](../00-fixture.md) — the shared fake case, also the source for test and seed data

Changes from here are recorded amendments to those documents, not silent edits to these files.
