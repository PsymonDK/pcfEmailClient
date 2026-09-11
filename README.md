# Model-Driven Email Client — Architecture Research

A research pass to select the right architecture for a **Case-scoped email client** hosted inside
Dynamics 365 Customer Service (Copilot Service Workspace), giving agents a more native email
experience than the out-of-box Timeline while staying in the scope of a single Case.

**Outcome: a React (virtual) PCF code component on two form placements** — a tab on the Case form, and
a dedicated Case form opened as a CSW session tab by an `Entity record` application tab template. No
custom page, no canvas layer. Validated live on both placements, plus attachments, a real send and
threading against real conversation data.

**The repository contains research, a throwaway diagnostics PCF, and the scripts used to seed and then
remove the spike data — no product implementation yet.** The demo environment has been returned to its
pre-spike state.

Start here: [`docs/research/00-index.md`](docs/research/00-index.md), or the ADR at
[`docs/research/07-decision.md`](docs/research/07-decision.md).
