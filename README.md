# Model-Driven Email Client

A **Case-scoped email client** for Dynamics 365 Customer Service, hosted in the Copilot Service
Workspace. It gives agents a native mail experience — threading, in-place reply, rich text,
attachments, templates, signatures, drafts — scoped to a single Case, where the out-of-box Timeline
is an activity feed and the Inbox is queue-scoped.

**Architecture: a React (virtual) PCF code component on two form placements** — a tab on the Case
form, and a dedicated Case form opened as a CSW session tab by an `Entity record` application tab
template. No custom page, no canvas layer. The reasoning is in the ADR,
[`docs/research/07-decision.md`](docs/research/07-decision.md).

## What is here

| Path | What it is |
|---|---|
| [`pcf/`](pcf/) | The product: the PCF control. `domain/` is tested pure logic, `data/` talks to Dataverse, `ui/` renders. |
| [`solution/`](solution/) | The Dataverse solution project that packages the control (unmanaged for dev). |
| [`scripts/`](scripts/) | Environment scripts — deploy, seed, spikes. All dry-run unless `--confirm`, and locked to the demo environment. See [`scripts/deploy/README.md`](scripts/deploy/README.md). |
| [`docs/`](docs/) | Research, design and the plan. |

## Where to start

- What has shipped and what is next: [`docs/project-plan.md`](docs/project-plan.md)
- What to build: [`docs/design/01-design-decisions.md`](docs/design/01-design-decisions.md)
- Why it is built this way: [`docs/research/00-index.md`](docs/research/00-index.md)
- Working in this repo (read first): [`CLAUDE.md`](CLAUDE.md)

## Build and test

From `pcf/`:

```bash
npm test
```

```bash
npm run lint
```

```bash
npm run build
```

`npm run build` is the type gate for the whole control; see `CLAUDE.md` for why `dotnet build`
alone is not enough to package a fresh bundle.
