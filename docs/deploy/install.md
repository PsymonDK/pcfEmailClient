# Installing the Case email client in an environment

N3's runbook: how the client gets from this repository into a Dynamics 365 Customer Service
environment that is **not** the demo environment, and what is still a human step.

Everything below is either done by the solution import, done by
[`scripts/install/post-import.mjs`](../../scripts/install/post-import.mjs), or written here as a
manual step. **There are no undocumented steps** — if you find one, it is a bug in this file.

---

## What the solution contains

Verified from the managed build on 2026-09-30 (`solution/bin/Release/solution.zip`,
`<Managed>1</Managed>`):

| Component | Notes |
|---|---|
| Control `jhrb_JHRB.CaseEmailClient` | The PCF itself, production bundle |
| Form **Case - Email Client** (`729d9197-cdad-f111-aaac-000d3ab163fb`) | Self-contained: the Email tab and the standard Case header. The only Case form in the package — no other Case form is touched |
| Table `jhrb_emailreadstate` | Per-agent read state (R6). UserOwned |
| Table `jhrb_emailclientsetting` | Sender and recipient configuration. OrganizationOwned |
| Role **Case Email Client — Read State** | User-level Create/Read/Write/Delete + Append/AppendTo on read state, Global Read on settings |
| `incident`, `email`, `queue`, `systemuser` | **Shells only** — no subcomponents ship, nothing on those tables is changed |

**Declared dependencies** (they must already exist in the target — all standard Customer Service):
the Case table and five of its columns (`title`, `ticketnumber`, `statuscode`, `prioritycode`,
`ownerid`), and the three out-of-the-box roles the form's display conditions name
(*Customer Service Representative*, *CSR Manager*, *Customer service app access*).

**What the solution cannot contain**, and why each item below exists:

- the default settings row — configuration is **data**, and an empty settings table silently means
  "send as the agent";
- the form's registration with the **Copilot Service workspace** app — that app is Microsoft's;
- who holds the role — role **assignment** is data about users;
- mailbox approval and server-side sync — tenant and mailbox configuration.

---

## Prerequisites in the target environment

- Dynamics 365 Customer Service with the **Copilot Service workspace** app.
- **Server-side synchronisation** configured for outgoing email.
- The queue agents will send from (the equivalent of *Care* in the demo) has an email address,
  its **mailbox is approved** (`emailrouteraccessapproval` = Approved) and its **outgoing email
  status is Success**. The client checks all of this before offering Send (R18), and refuses when it
  fails — a mailbox that is addressed but not approved otherwise parks mail at *Pending Send*
  forever, with no error anywhere.
- Case records are in a queue (queue items) — that is how the client finds which queue to send as.

---

## 1. Build the managed solution

```bash
cd pcf && npm ci && npm test && npm run build
cd ../solution && dotnet build -c Release -p:SolutionPackageType=Managed -t:Rebuild
```

Verify **what you built** before importing it anywhere:

```bash
unzip -p solution/bin/Release/solution.zip solution.xml | grep -o '<Managed>[01]</Managed>\|<Version>[^<]*</Version>'
```

Expect `<Managed>1</Managed>`, and the solution `<Version>` equal to the control version in
`ControlManifest.Input.xml` — a test (`host/__tests__/release.test.ts`) fails if they drift, because a
managed solution upgrades by **its** version, not the control's.

## 2. Import it

Into the target environment, with a pac profile pointed **at that environment** (check with
`pac auth list` — never import from the demo profile by accident):

```bash
pac solution import --path solution/bin/Release/solution.zip --async
```

or through **make.powerapps.com → Solutions → Import**. Then **publish all customizations** in
the target (a managed import publishes its own components; this is belt and braces for the form).

## 3. Run the post-import script

Dry run first — it checks what arrived and prints what it would do:

```bash
node scripts/install/post-import.mjs --org https://<target>.crm4.dynamics.com
node scripts/install/post-import.mjs --org https://<target>.crm4.dynamics.com --confirm
```

It needs `az login` against the target's tenant (or a `DV_TOKEN`). It **only adds**:

1. checks the solution, form, control and role are present;
2. registers the Email Client form with the *Copilot Service workspace* app and publishes that app;
3. creates the default settings row if there is none (and refuses if there are several — ambiguous
   settings resolve to "send as the agent");
4. with `--team "<team name>"`, assigns the role to that team in the team's business unit.

Re-running it is safe: every step checks first and reports "already in place".

## 4. The manual steps

These are what is left after the script, every time:

| Step | Why | How |
|---|---|---|
| **Assign the role** to every agent who uses the client (unless done with `--team`) | A new custom table grants privileges to nobody but System Administrator / System Customizer. Without the role, read state and settings are refused — the client tells the agent read state is not being saved, and falls back to sending as the agent | Power Platform admin center → Users (or a team) → Manage security roles → **Case Email Client — Read State** |
| **Approve the sending queue's mailbox** and enable server-side sync | Pre-flight refuses Send otherwise | Admin center → Email → Mailboxes → the queue's mailbox → Approve email, Test & enable |
| *Optional:* a **session tab** for the client | Opens the client as its own CSW tab next to the Case | Customer Service admin center → Workspaces → Application tab templates → new, *Page type* **Entity record**, `entityName` = `{anchor.entityName}`, `entityId` = `{anchor.incidentid}`, `formId` = `729d9197-cdad-f111-aaac-000d3ab163fb` |

## 5. Configure (optional)

The default settings row sends as the Case's queue, lets the agent override the sender, and takes a
new message's default recipient from the Case's `customerid`. To change that, edit the row in
**Email client setting** (advanced find / the table in make.powerapps.com). A **queue-specific** row
(its `jhrb_queue` lookup set) overrides the default for Cases in that queue. Keep exactly **one** default row.

## 6. Verify

In the Copilot Service workspace, as an agent who holds the role:

- [ ] Open a Case and switch to the **Case - Email Client** form — the thread list loads.
- [ ] Open an unread incoming message, wait two seconds, **reload** — it stays read (R6 works: the role is assigned).
- [ ] **Reply** — compose shows *From: <queue>* with no "cannot send" warning (pre-flight passes).
- [ ] Type a line and close compose — a draft appears on the Case; *Continue draft* reopens it.
- [ ] Send one reply to an address you own, and confirm it **arrives** (status *Sent* only means handed to Exchange).

## Upgrading

Bump the control version **and** the solution version together (the release test enforces it),
build managed, import over the existing solution, and re-run the post-import script — it is
idempotent and will only report.

## Uninstalling

Deleting the **managed** solution removes its components — **including both custom tables and every
row in them** (all agents' read state, and the settings). The form's registration with the CSW app
goes with the form. Emails are untouched: they are standard `email` rows regarding the Case.
