---
name: model-driven-app-design
description: Design guidance for making a web resource, PCF control or Power Apps code app look and feel like a Power Apps model-driven app (Fluent 2, Dataverse command bar, grid, form, tabs, badges). Use ONLY when the instructions explicitly ask for it - e.g. "make it look native", "match the model-driven app", "Fluent / Dataverse look and feel", or "use the Model Driven App Design skill". Do NOT apply it to ordinary web, React or Power Platform work that has no such request, and do not restyle existing UI with it unasked.
---

# Model Driven App Design

Make a surface that sits inside, or next to, a model-driven app read as part of it. The test is whether a user who works in the app all day can tell where the platform ends and your surface begins. If they can, the design has failed, however pretty it is.

This skill is opt-in. If the instructions did not ask for a native look, stop and follow the project's own design direction instead.

## In this repository

This project (a PCF on a Case form and a Copilot Service Workspace session tab) already has its own
design, so **its tokens win over every value below**:

- Colours, spacing and radii come from `pcf/CaseEmailClient/ui/theme.ts` and are used as `T.*`. They resolve through CSS custom properties so dark theme follows. **Never write a colour literal in a component (N7)** — a test greps for hex. The hex values in this skill are for reading what the platform does, not for pasting.
- A sender's HTML stays on a white card in dark theme too (`BODY_SURFACE`).
- The signed-off design is in `docs/design/`; the interaction spec is `docs/design/03-interaction-spec.md`. Design to the floor of the size budget in `CLAUDE.md` (471 × 1354).
- PCF rules: platform Fluent v9 (`@fluentui/react-components`, version pinned to what the platform injects — see `CLAUDE.md`), no bundled copy, claim both width and height.
- Delivery target is **PCF**; read that section of `references/targets.md` and skip the other two.

## Before you design anything

1. **Read the project first.** If the repo already has tokens, a stylesheet or a design doc about looking native, those win over everything below. Reuse its tokens; do not invent a second palette.
2. **Pick the delivery target** and read the matching section of [references/targets.md](references/targets.md): web resource, PCF control, or code app. They share one look but have different constraints (no libraries, platform-provided Fluent, or a full standalone shell).
3. **Measure the real app when you can.** Specs and memory drift; the running app is the authority. Open a table's view and form, then read computed styles (`getComputedStyle`) for height, radius, colour and font. Where the app and this skill disagree, follow the app and say so.
4. Read [references/tokens.md](references/tokens.md) for exact colours, type, spacing and control geometry, and [references/patterns.md](references/patterns.md) for the component recipes.

## The look in one paragraph

Fluent 2, light, dense and flat. Segoe UI at 14px, text `#242424`, one accent blue `#0f6cbd` used for links, selection and focus and nowhere decorative. The page is light grey (`#f0f0f0` on a form). Form cards are white with an **8px radius, no border and a soft two-layer shadow**; controls and buttons inside are 32px with **4px** radius. A 1px border marks content nested inside a card, not the card. Form fields are filled (`#f5f5f5`), not outlined, and show focus as a 2px blue underline. Everything sits on a 4px grid. There is no gradient, no large radius, no drop-shadow drama, no hero imagery.

## Rules that carry the most weight

- **One accent.** Blue marks interaction and selection. Status uses the fixed Fluent status colours (below), never the accent, and never colour alone: pair it with a word or glyph.
- **Density over air.** Grid rows are 42px, controls 32px, body 14px, grid cells and column headers 12px (measured in the live app). Whitespace you would add on a marketing page makes this look like a different product.
- **Familiar anatomy.** Command bar above content, column header with sort and filter menus, `Rows: 1 - 25 of 140` footer, tabs under a record header, a left-aligned view title (28px bold in the app's view header; 20px semibold for a title inside a card or dialog). Reuse the vocabulary of the app (New, Delete, Refresh, Search this view) rather than inventing labels.
- **Links are blue, rows are not.** The primary column of a grid is the link; the rest is plain text.
- **Focus is a 2px brand underline** drawn with inset `box-shadow`, replacing the outline, never a second indicator beside it. Growing a border on focus shifts neighbours by a pixel.
- **Respect the host's theme, do not guess it.** Paint the page the colour of what it sits on. Do not use `prefers-color-scheme`: it reports the OS, not the app, and produces a dark panel inside a light app. Light is the default.
- **Accessibility is part of looking native.** The platform meets WCAG 2.1 AA: 4.5:1 text, 3:1 for graphics and control edges, full keyboard operation, visible focus, names on every control. Do not trade any of it for style.
- **Icons are Fluent icons**, regular weight, 16px in dense chrome and 20px in the command bar, in `currentColor`. Do not mix icon families.
- **No chrome the app already has.** Inside a model-driven app do not draw your own app header, nav or user menu. Only a code app that runs standalone needs a shell (see targets).

## Constraints that come from the target, not the look

- **Web resource:** plain HTML/CSS/JS uploaded as-is. No framework, no bundler. Re-express Fluent as CSS custom properties. Build DOM with `createElement` and `textContent`, never `innerHTML`.
- **PCF:** use the platform's Fluent UI React v9 (`@fluentui/react-components`) as a platform library and wrap in `FluentProvider` with the theme; do not bundle a copy. Fluent v8 is legacy, so prefer v9 unless the project is already on v8.
- **Code app:** React + Vite with Fluent UI v9 is fine. You are outside the host, so you supply the shell and must handle light and dark yourself.

## Process

1. Confirm the target and any project tokens. State the assumption if unsure; do not stall on it.
2. Build the structure with the real anatomy first (command bar, header, content, footer) in grey and white only.
3. Apply tokens, then states: hover `#f3f2f1`, selected `#e5f1fb`, pressed `#edebe9`, disabled, focus, error, empty, loading.
4. Check both themes, keyboard-only use, 200% zoom and a narrow width.
5. Compare against a real view or form in the app if one is reachable. List any differences you chose to keep.

## Do not

- Add rounded-2xl cards, gradients, glassmorphism, emoji as icons, or a second brand colour.
- Use Inter, system-ui stacks or webfonts. The app is Segoe UI; the stack falls back through the platform fonts and that is enough.
- Draw a shadow heavier than the tokens give you.
- Hard-code hex values below the token block. A new colour is a new token with a dark value.
- Ship a control without all of: default, hover, focus, pressed, disabled.
