# Component patterns

Recipes for the parts a model-driven app user already knows. Geometry and colours come from [tokens.md](tokens.md).

## Contents
- Command bar
- Grid / list
- Quick find, filter, sort
- Record form
- Tabs
- Cards and tiles
- Charts
- Badges and status
- Dialogs, menus, toasts
- Empty, loading, error
- Dashboard

## Command bar

A 44px row above the content on `--surface` with a bottom `--rule`. Buttons are 32px, transparent, 4px radius, icon (20px) plus label, hover `--hover`, pressed `--pressed`. Primary action first, destructive last, overflow in a `...` menu. A divider is a 1px `--rule` line 20px tall. Labels are verbs the app already uses: New, Delete, Refresh, Export to Excel, Run Report. Disabled buttons stay visible, in `--disabled`.

## Grid / list

- Header row: measured in the app at 12px semibold in the muted colour, 42px, bottom border `--border` (see "Measured in the live app" in tokens.md). Sort glyph appears beside the label; a filter glyph after it when a filter is active. Clicking a header opens a menu (A to Z, Z to A, Filter by) rather than sorting silently. The menu is what the native grid offers, so it is what readers reach for.
- Body rows: 42px (native measured), 12-14px text, `--rule` divider, hover `--hover`, selected `--selected` with a 3px leading `--link` edge. Zebra striping is not used.
- First column is the record link: `--link`, underlined on hover and focus, and underlined at rest where colour is the only cue.
- Cell text truncates with an ellipsis and a `title` tooltip. Numbers and money right-align; dates are formatted in the reader's locale.
- A widened column makes the table wider and the wrapper scrolls; it does not steal width from neighbours.
- Footer: `Rows: 1 - 25 of 140` left, pager right (first, previous, `Page 1`, next). Selected count appears as `1 selected`.
- A checkbox column appears only when selection does something.

## Quick find, filter, sort

Quick find is a 32px search box labelled `Search this view` at the right of the command bar, with a search glyph and clear button. Filters are menus off the column header, not a row of inputs under it: the menu costs nothing at rest, while a filter row costs 44px of vertical space.

## Record form

Single column on narrow widths, up to three columns wide. Label above the field in `--text` 14px regular (not semibold), field below as a filled 32px, 4px-radius box with a 2px brand underline on focus. Required fields carry a red `*` (`#bc2f32`) after the label. Section headings are 14px semibold inside a white 8px card on the grey page. Section headers are 16px semibold with a 1px `--rule` underline, no card around each section. Read-only values render as plain text, not as disabled inputs. Show the record header (title 20px semibold, a few key fields) above the tabs.

## Tabs

Fluent tab list: 14px text, 32-40px tall, selected tab semibold with a 2px `--link` bar under it, unselected `--muted`. No boxes, no pill backgrounds. Keyboard: arrow keys move, Home/End jump, panels use `role="tabpanel"`.

## Cards and tiles

White `--surface`, 8px radius, shadow4 and no border on a form (measured); a list card in a dashboard may use 4px with a 1px `--border` where the project already does. The AI summary card (20px radius, blue border) is the only exception and is not for ordinary content. Heading 16px semibold inside, 12-16px padding. A KPI tile is the big number (28-32px semibold), a 12px `--muted` caption, and optionally a small delta. A tile in a warning or alert state keeps its colour and gains a thick edge in the status colour plus a warning glyph and the word in its accessible name.

## Charts

One series is one accent colour (slot 1). Multiple series use the eight slots in order, never a rainbow. Gridlines are `--rule`, axis labels 12px `--muted`, no axis titles when the heading already says what is plotted. Bars have 2px top radius at most. Direct-label or add a legend; every value is also available as text (tooltip or table). A pressed band is marked with a leading 3px `--link` bar or an outline in `--text`, not by fill alone.

## Badges and status

A choice value is a small pill: 12px text, 2-8px padding, 4px radius, fill from the option's own colour when Dataverse provides one, else `--hover`, with a dot or the words beside it. Pale administrator fills (`#CAEAD8`) are fine on a badge but invisible as a lone dot on white, so darken dots on light and lighten them on dark.

## Dialogs, menus, toasts

Dialog: centred, 8px radius, dialog shadow, 24px padding, title 20px semibold, primary button right-most and filled `--link` with white text, secondary outlined. Menus: `--surface`, 4px radius, menu shadow, 32px items, hover `--hover`. A toast or message bar sits at the top of the content, not floating, with a 4px leading edge in the status colour, a glyph and a word.

## Empty, loading, error

- Empty: one line, 14px `--muted`, centred in the area, e.g. `We didn't find anything to show here`.
- Loading: a thin determinate or indeterminate progress bar under the command bar, or a 20px spinner in place. Not a skeleton that reshapes the page. On refresh keep the old rows until the new ones arrive.
- Error: say what failed and what the reader can do, in `--error` text with a glyph. Keep the stale content visible.

## Dashboard

A grid of cards on `--page`, 16px gaps, each with its own heading. Cards of lists and charts share the same card chrome as the grid. One view, one chart, one number per card; do not stack three stories into one. A dashboard must not make the reader press Refresh.
