# 00 — The shared fixture

One fake Case, used by **every** design artboard, **every** unit test, and the Dataverse seed script.
Its whole purpose is that the four competing designs are judged on identical content, so the
comparison is about design and not about who got the nicer example.

It is deliberately awkward. Every difficult thing the requirement catalogue names appears here at
least once: a deep quoted chain, a wide table, an inline image, a tracking token welded onto a
subject, transport-injected banners, an unsent draft, a parent Case, and a file too big to attach.
A fixture of three tidy messages would let a bad design look good.

Grounded on the real conversation captured during the spikes
([`../research/evidence/s7-s8-conversation.json`](../research/evidence/s7-s8-conversation.json)) —
same customer, same Danish B2B construction setting, same `conversationindex` shapes.

## Warning: what cannot be seeded

`conversationindex` is `IsValidForCreate: false` **and** `IsValidForUpdate: false` — hard read-only,
written only by server-side sync. So seeded rows always have a null `conversationindex`.

**Consequence for anyone using this fixture:** seed data validates thread **grouping** and the
`createdon` **ordering fallback**. It cannot validate ordering or nesting *by* `conversationindex`.
That half needs mail that genuinely round-tripped through a synced mailbox — which is what the
captured evidence file is for, and why it must not be deleted.

In the **design** artboards, draw the world as it is after real mail has arrived:
`conversationindex` populated, nesting real. In **tests**, use the evidence file for nesting and this
fixture for everything else.

---

## The Case

| Field | Value |
|---|---|
| Case number | `CAS-01042` |
| Title | Reklamation: utætte samlinger efter montage |
| Customer | Jensen VVS A/S |
| Primary contact | Morten Bach Jensen |
| Priority / status | Normal · In Progress |
| Owner | Lene Sørensen |
| Parent Case | `CAS-01038` — Etape 3, Nordhavn — rammeaftale |

## Participants

| Who | Address | Role |
|---|---|---|
| **Care queue** | `care@example.invalid` | The mailbox we send **from**. Approved, server-side synced |
| **Lene Sørensen** | `lene.sorensen@example.invalid` | The agent using the client — "me" in every artboard |
| **Morten Bach Jensen** | `mbj@jensenvvs.example.invalid` | Jensen VVS, projektleder. The main correspondent |
| **Anne Holm** | `bogholderi@jensenvvs.example.invalid` | Jensen VVS, accounts. On Cc throughout |
| **Kim Petersen** | `kp@ingenior-petersen.example.invalid` | External consulting engineer. Joins on Cc from message 4 |

All customer addresses use `.invalid`, which RFC 2606 reserves and no mail server will route — so
seeded mail physically cannot escape. Keep it that way.

---

## Thread A — the main chain (6 messages)

Hash `100487241`. Alternating direction, three levels of quoted history by the end.
**This is the thread the bake-off artboards expand.**

| # | When | Direction | From → To (Cc) | Subject | Notes |
|---|---|---|---|---|---|
| A1 | 08 Sep 09:14 | Incoming | Morten → Care (Anne) | Reklamation: utætte samlinger efter montage | Read. Plain text, 2 short paragraphs. The opener |
| A2 | 08 Sep 11:02 | Outgoing | Care → Morten (Anne) | RE: Reklamation: utætte samlinger efter montage | Read. Signature present. Quote depth 1 |
| A3 | 09 Sep 08:41 | Incoming | Morten → Care (Anne) | Re: Reklamation: utætte samlinger efter montage | Read. **2 attachments**, **inline site photo**. Quote depth 2 |
| A4 | 09 Sep 15:20 | Outgoing | Care → Morten (Anne, **Kim**) | RE: Reklamation: utætte samlinger efter montage | Read. **The wide price table.** Kim added to Cc. Quote depth 2 |
| A5 | 10 Sep 07:55 | Incoming | Kim → Care (Morten, Anne) | Re: Reklamation: utætte samlinger efter montage | **UNREAD.** **Carries all the injected noise** — see below. Quote depth 3 |
| A6 | 10 Sep 10:33 | Incoming | Morten → Care (Anne, Kim) | Re: Reklamation: utætte samlinger efter montage | **UNREAD.** One line. Quote depth 3 |

Two unread messages at the end of an otherwise-read thread is the common real shape, and it is what
makes the R6 unread treatment worth designing rather than guessing.

### A1 — the opener (incoming, read)

```
Hej

Vi har konstateret utætheder ved tre af samlingerne på etape 3 efter montagen
i sidste uge. Det drejer sig om samlingerne ved stigestreng 4, 7 og 11.

Kan I bekræfte, hvornår I kan sende en montør ud? Vi har lukket for vandet på
den pågældende streng indtil videre.

Med venlig hilsen
Morten Bach Jensen
Projektleder, Jensen VVS A/S
```

### A3 — attachments and an inline image (incoming, read)

Body: two paragraphs, then `[inline image: site photo, 1200 × 800]` showing the leaking joint, then
the quoted A2 and A1 beneath a Danish `divRplyFwdMsg` header block.

| Attachment | Type | Size |
|---|---|---|
| `Fotodokumentation_etape3.pdf` | `application/pdf` | 2.4 MB |
| `Maalerapport_KS.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 118 KB |

The inline photo is the R3 test that matters: it arrives as a `cid:` reference and is **also** an
`activitymimeattachment` row. It must render in the body, and it must not also appear as a
downloadable attachment chip — that double-listing is a real bug this fixture is designed to catch.

### A4 — the wide table (outgoing, read)

The message that breaks naive layouts: a 4-column costing table roughly 1400px wide as Outlook
serialises it, inside a 1600px-wide control that also has to show the rest of the page.

| Position | Mængde | Enhedspris | Total |
|---|---:|---:|---:|
| Udskiftning af presfitting, stigestreng 4 | 3 stk | 485,00 | 1.455,00 |
| Udskiftning af presfitting, stigestreng 7 | 2 stk | 485,00 | 970,00 |
| Udskiftning af presfitting, stigestreng 11 | 4 stk | 485,00 | 1.940,00 |
| Montage og trykprøvning | 6,5 timer | 625,00 | 4.062,50 |
| Kørsel, Nordhavn | 2 gange | 350,00 | 700,00 |
| **I alt ekskl. moms** | | | **9.127,50** |

### A5 — the noise message (incoming, UNREAD) — the R21 scene

The most important single message in the fixture. As delivered, the agent's actual content is the
**fourth** thing on screen. All four contaminants below were observed together in one real
round-trip on 2026-09-10 — this is not a contrived worst case.

In delivery order:

1. **Microsoft Defender external-sender banner**, wrapped in markers
   `ZjQcmQRYFpfptBannerStart` … `ZjQcmQRYFpfptBannerEnd`:
   *"You don't often get email from kp@ingenior-petersen.example.invalid. Learn why this is
   important"* — a yellow-bordered block roughly 3 lines tall.
2. **Outlook first-contact tip** — a second, similar-looking caution block.
3. **Tenant classification line**: `Classification: Public`.
4. **The actual message** — five lines of Danish about pressure-test results.
5. **A 5-line signature block**: name, title, company, phone, a legal disclaimer.
6. **Three levels of quoted history** beneath a `divRplyFwdMsg` header block.

The agent wants item 4. Today's Timeline shows all six, in that order, on every message. The gap
between those two sentences is the entire reason this product exists, which is why
`3.4-quote-and-noise` is the artboard to spend the most time on.

Note the asymmetry the design must respect: items 1–3 are **deterministic** (stable markers, safe to
collapse confidently); item 5 is a **heuristic** (a signature looks a lot like a short sign-off, and
over-eager detection hides content the sender meant to send). Collapse, never delete, and when
detection is uncertain **show the content**.

---

## Thread B — one unread message with a mangled subject (1 message)

Hash `100487299`.

| # | When | Direction | From → To | Subject as stored |
|---|---|---|---|---|
| B1 | 10 Sep 13:07 | Incoming | Anne → Care | `Re: Faktura 2026-4417 — etape 3 CRM:0100042` |

Unread. The subject carries `CRM:0100042` because the platform **appends its tracking token to the
subject on send** and the customer's reply carried it back. Every thread title in the client must
show `Faktura 2026-4417 — etape 3`, not the raw stored string.

The trap worth knowing: the token-stripping rule requires at least four digits, so that a subject
containing a clock time like `10:30` survives untouched. Both cases belong in the tests.

---

## Thread C — the draft (2 messages + 1 unsent draft)

Hash `100487301`. The R16 scene.

| # | When | Direction | State | Notes |
|---|---|---|---|---|
| C1 | 07 Sep 14:12 | Incoming | Received, read | Morten asks about the guarantee period |
| C2 | 07 Sep 16:45 | Outgoing | Sent, read | Care answers partially |
| C3 | 10 Sep 14:58 | Outgoing | **Draft** (`statecode` 0 / `statuscode` 1) | Two sentences typed, unsent, signature present, quote appended |

A draft has a null `conversationindex` even in real data — it has never been through transport — so
it orders by `createdon` and lands last in its thread. The design has to say what a draft looks like
both in the thread list and inside the thread, and how an agent gets back to it.

---

## Thread D — on the parent Case (3 messages)

Hash `100486004`. Regarding `CAS-01038`, **not** `CAS-01042`.

| # | When | Direction | Subject |
|---|---|---|---|
| D1 | 21 Aug 10:00 | Incoming | Rammeaftale etape 3 — tidsplan |
| D2 | 21 Aug 15:30 | Outgoing | RE: Rammeaftale etape 3 — tidsplan |
| D3 | 25 Aug 09:12 | Incoming | Re: Rammeaftale etape 3 — tidsplan |

Hidden unless "include parent case" is on (R8). When shown, it must be unmistakable that these
belong to another Case — an agent quoting a parent-Case commitment while believing it was made on
this one is a real support failure, not a cosmetic one.

---

## The oversize file — the R13 failure scene

| File | Type | Size |
|---|---|---|
| `Drone_gennemgang_raw.mp4` | `video/mp4` | 180 MB |

Used only in `4.4-attachments`, to design the failure. What makes this honest is that there are
**two** different limits and they are not the same number:

- **Storage**: the chunked upload path is uncapped in practice — 40 MB was measured going in fine.
- **Transport**: what Exchange will actually deliver. **Not yet measured.**

So the failure message must not claim a limit we have not verified. Design it to state a real,
measured number once we have one, and until then to fail honestly rather than precisely.

---

## Totals

| | Count |
|---|---|
| Threads on this Case | 3 (A, B, C) + 1 on the parent (D) |
| Messages on this Case | 9, of which 1 is an unsent draft |
| Messages including the parent | 12 |
| Unread | 3 — A5, A6, B1 |
| With attachments | 1 (A3, two files) |
| With an inline image | 1 (A3) |
| With injected noise | 1 (A5, four kinds) |
| Deepest quote | 3 levels (A5, A6) |

## Who consumes this

| Consumer | Uses it for |
|---|---|
| Design artboards | Identical content across all four bake-off candidates |
| `domain/` unit tests | Threading, subject normalisation, quote splitting, noise stripping |
| `scripts/seed/` | Dataverse seed data — **minus `conversationindex`**, which cannot be written |
| Verification | The acceptance sentences in [`../research/01-requirements.md`](../research/01-requirements.md) name counts ("a 6-message chain") that this fixture is built to satisfy |

Keep the four in step. If a design artboard needs a message the fixture does not have, add it *here*
first, then everywhere else.
