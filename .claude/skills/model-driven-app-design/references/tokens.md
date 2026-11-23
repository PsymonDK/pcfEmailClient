# Tokens

Values below are Fluent 2 as the Dataverse model-driven app uses it. If the project has its own tokens, use those and ignore this file.

## Contents
- Colour (light and dark)
- Status colours
- Series colours for charts
- Type
- Spacing, size and shape
- Elevation
- Motion

## Measured in the live app

Read from computed styles in the Customer Service workspace (a model-driven app, "My Active Cases" view, 2026-11-13). Where this table disagrees with the generic Fluent values elsewhere in this file, this table wins for grids and view chrome.

| Part | Measured |
| --- | --- |
| Top app bar | 48px, dark navy, white 14px text, Segoe UI |
| Page / view title | 28px, weight 700, `#242424` |
| Command bar button | 32px tall, 4px radius, 14px text, transparent |
| Tabs (session tabs) | 32px, 4px radius, `#f0f0f0` fill, 14px |
| Search input | 32px, 14px, bottom stroke `#767676` |
| Grid column header | 12px, weight 600, `rgba(0,0,0,.54)` (muted), 42px, white |
| Grid row | 42px; cell text 12px; no heavy row border |
| Grid record link | 14px, `#115ea3`, underlined |
| Footer | `Rows: 129`, 12px |
| Font | `SegoeUI, "Segoe UI"` then Segoe UI Web, system fonts |

Notes: the grid is denser and quieter than a generic Fluent table. Header text is small and muted, not 14px semibold dark; the link blue is `#115ea3`, a step darker than Fluent 2's `#0f6cbd` (use `#115ea3` for grid links when matching the grid exactly). Re-measure if the app updates.

### A list on a native dashboard (not the same as a form)

Measured on the "Customer Service Representative Dashboard" in the same app (2026-11-13). **A list card on a dashboard is not shaped like a card on a form**, so do not carry the form's 8px over to a dashboard.

| Part | Measured |
| --- | --- |
| List card | **4px radius**, 1px transparent border, `0 0 2px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.14)` |
| Header cell | 42px, 12px, weight 600, `rgba(0,0,0,.54)` |
| Body row | 42px, cell text 12px |
| Record link | 14px, `#115ea3` |

An earlier reading of "native dashboards" at 52px rows and a 48px header was taken from a screenshot and did not hold up against the running app; 42px is what both the dashboard list and the grid view draw.

### Corners and shadows, measured on a record form

Same app, a Case form (2026-11-13). Shadows are Fluent 2's own stepped shadows, each a 2px ambient layer plus one directional layer:

| Level | Value | Where it was measured |
| --- | --- | --- |
| shadow4 | `0 0 2px rgba(0,0,0,.12), 0 2px 4px rgba(0,0,0,.14)` | Form command bar island, record header card, form section card, session tab strip, an active session tab |
| shadow8 | `0 0 2px rgba(0,0,0,.12), 0 4px 8px rgba(0,0,0,.14)` | Side-pane rail, AI summary card |
| shadow16 | `0 0 2px rgba(0,0,0,.12), 0 8px 16px rgba(0,0,0,.14)` | Workspace tab flyout and popups |
| Account menu | `0 24px 54px rgba(0,0,0,.15), 0 4.5px 13.5px rgba(0,0,0,.08)` | The Microsoft account card, which is not Fluent |

| Shape | Radius | Notes |
| --- | --- | --- |
| Form command bar island, record header card, form section card | **8px** | White on a grey `#f0f0f0` page, shadow4, no visible border |
| Session tab strip and active session tab | 8px (top corners only on a tab) | shadow4 |
| Buttons, tabs, menu buttons, Share button | **4px** | Command bar buttons 32px; compact buttons 24px |
| Inline email card in a timeline | 6px | 1px `#e0e0e0` border, no shadow |
| Badge / tag ("Sent") | 4px | 20px tall, `#f0f0f0` fill, 12px |
| Avatar, status dot, profile picture | full circle | |
| Global search box | 2px | 32px tall, a legacy Fluent v8 control |
| Side pane rail buttons | 2px | Fluent v8 |
| AI (Copilot) summary card | 20px, 1px blue border, `#f6f6ff` fill | Deliberately different so it reads as AI content. Do not use it for ordinary cards |
| AI "Form assist" button | `8px 0` (two opposite corners), 2px translucent border | Same exception |

What this means: a form is **grey page, white 8px cards, shadow4, no border**. Controls inside are 4px. A 1px border on a card is used only for content that sits inside a card (an email in a timeline), never for the card itself. The app mixes Fluent v8 pieces (2px) and v9 pieces (4px); copy v9.

Form chrome: the page behind the form is `#f0f0f0`, the record header sits in the first white card with a 40px avatar, a 28px bold title, a muted "Saved" suffix and the entity and form-selector under it. Form tabs are 16px, weight 600 when selected and 400 otherwise, 46px tall, with no box. The stage bar (process) is a 32-44px strip, the active stage is a `#0f6cbd` filled block with white text.

### Fields, measured on a new Contact form

A new, unsaved Contact form in the same app (2026-11-13). Fields are **filled, not outlined**:

| Part | Measured |
| --- | --- |
| Field box | 32px tall, `#f5f5f5` fill, **1px transparent border**, **4px radius**, **no bottom stroke at rest**. The box is a wrapper; the inner `input` has no border and `0 12px` padding |
| Field text | 14px, 400, `#242424`; empty value shows `---` |
| Focus | A 2px `#0f6cbd` underline (`::after`, 4px tall, sitting at `bottom: -1px`, radius `0 0 4px 4px`) so it follows the field's rounded corners. The fill stays `#f5f5f5`, the outline is transparent. No glow, no full border |
| Dropdown (choice) | Same 32px filled box, chevron at the right, 12px padding |
| Lookup | Same box with a search glyph at the right; its text is `#707070` until filled |
| Label | Above the field, 14px, weight **400**, `#242424`, 20px line. Not semibold |
| Required marker | A `*` in `#bc2f32` after the label |
| Section heading | 14px, weight 600, `#242424`, set as an uppercase word (`GENERAL INFORMATION`) inside the card, 24px line |
| Section card | White, 8px radius, 1px transparent border, shadow4 (`0 0 2px .12, 0 2px 4px .14`) |
| Page behind the cards | `#f8f7f6` |
| Form tabs (Summary, Details) | 16px, 600 selected and 400 otherwise, 46px, no box and no underline drawn on the tab |
| Top bar | `#021838` (dark navy), 48px |

A two-tone border with a darker bottom stroke is Fluent's *outline* style, which a model-driven form does not use. The model-driven form uses Fluent's *filled* style. Use the filled style when matching a form, and keep the outline style for filters and search boxes in a dashboard where the project already does.

Not measured: dark mode, and the quick-create or dialog surfaces.

## Colour

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--page` | `#faf9f8` | `#1b1a19` | What sits behind cards. Match the host. |
| `--surface` | `#ffffff` | `#252423` | Cards, grids, forms, menus |
| `--text` | `#242424` | `#f3f2f1` | Primary text (Fluent neutralForeground1) |
| `--muted` | `#605e5c` | `#c8c6c4` | Secondary text, column captions |
| `--link` | `#0f6cbd` | `#6cb8f6` | The one accent: links, focus, selection edge |
| `--border` | `#e1dfdd` | `#3b3a39` | Card and control border |
| `--rule` | `#edebe9` | `#3b3a39` | Row dividers |
| `--control` | `#8a8886` | `#8a8886` | Accessible control stroke (bottom edge of inputs) |
| `--hover` | `#f3f2f1` | `#323130` | Row and button hover |
| `--selected` | `#e5f1fb` | `#004578` | Selected row, pressed chip |
| `--pressed` | `#edebe9` | `#3b3a39` | Active press |
| `--disabled` | `#a19f9d` | `#797775` | Disabled text and glyphs |
| `--error` | `#a4262c` | `#f1707b` | Error text |

Selected fill against a white card is only about 1.15:1, so never rely on it alone. Add the 3px leading `--link` indicator on a selected list item.

## Status colours

Fixed product colours. No colour scheme or customer palette should repaint them, or the signal is lost.

| Meaning | Light | Dark |
| --- | --- | --- |
| Warning | `#bc4b09` | `#faa06b` |
| Danger / alert | `#c50f1f` | `#dc626d` |
| Success | `#0e7c42` | `#5ec98a` |
| Highlight flash (row just changed) | `#fff4ce` | `#4a3c0a` |

Always pair a status colour with a word or glyph.

## Series colours for charts

Eight slots, in order: `#0f6cbd #d13438 #0e7c42 #8764b8 #c19c00 #00857e #c239b3 #7a7574`. A single-series chart uses slot 1 only. In dark, use the lightened variants `#6cb8f6 #f1707b #5ec98a #b4a0ff #e8c85a #4fc4bc #e58ddb #b3afac`. Label text on a fill is white where white reaches 4.5:1, otherwise `#242424`.

## Type

- Family: `"Segoe UI", "Segoe UI Web (West European)", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", sans-serif`
- Body 14px / 20px, weight 400. Captions and footers 12px / 16px.
- Column headers 14px semibold (600), `--text`.
- Section heading 16px semibold. Page title 20px semibold (28px line). Large KPI number 28-32px semibold.
- Never below 12px. No letter-spacing tricks, no all-caps labels.

## Spacing, size and shape

- 4px grid. Common gaps: 4, 8, 12, 16, 24.
- Control height: 24 (small), 32 (medium, default), 40 (large). Command bar buttons are 32.
- Control radius 4px. **Card radius 8px** on a form (measured; see "Corners and shadows"); a grid card is 4px in a typical dashboard stylesheet. Never 12px+ except the AI exception.
- Form fields: filled `#f5f5f5`, 32px, 4px radius, 1px transparent border, 2px `--link` underline on focus (see "Fields, measured"). Filter and search inputs in a dashboard: 1px `--border` on top, left and right, 1px `--control` along the bottom, focus replacing the bottom edge with a 2px `--link` underline via inset `box-shadow`.
- Grid rows 42px (measured); compact variant 32px.
- Page gutter 16px at narrow widths, 24px at wide.

## Elevation

- Card on a form: shadow4, `0 0 2px rgba(0,0,0,.12), 0 2px 4px rgba(0,0,0,.14)` (measured). A lighter shadow some dashboard stylesheets use is `0 1px 2px rgba(0,0,0,.09), 0 0 2px rgba(0,0,0,.06)`; prefer the measured one when matching a form, keep the project's when it already has one.
- Menu, popover: shadow8 or shadow16 (see the measured table). Dark mode: raise alphas to about `.4` and `.3`.
- Dialog: `0 32px 64px rgba(0,0,0,.24), 0 0 8px rgba(0,0,0,.20)` (Fluent spec, not measured).

## Motion

Short and functional. 100-200ms, `cubic-bezier(.33, 0, .67, 1)` in and out. Nothing bounces. Honour `prefers-reduced-motion`. Polling or refresh updates must never animate in a way that moves what the reader is looking at; a brief `--flash` background on a changed row is the convention.
