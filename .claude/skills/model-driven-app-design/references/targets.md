# Delivery targets

The look is the same everywhere. What differs is what you may use to build it.

## Contents
- Web resource
- PCF control
- Code app
- Checking your work

## Web resource

Runs in an iframe inside the app, same origin, uploaded to Dataverse as plain files.

- No bundler, no framework, no new dependency, no Fluent library. Express Fluent's geometry as CSS custom properties from [tokens.md](tokens.md) defined once at the top of one stylesheet, with a dark override on `:root[data-theme="dark"]`.
- Build DOM with `createElement` and `textContent`; clear with `replaceChildren()`. Never `innerHTML`, `insertAdjacentHTML`, `eval` or `new Function`. Treat every Dataverse string (labels, names, values) as untrusted.
- Theme from the painted background, not the OS. Read the colour of the element the iframe sits on (`window.frameElement` and its ancestors) and the app body; set the page token inline from it so there is no seam at your edge. Fall back to light.
- Access to the host (`Xrm`) goes through one accessor that returns `undefined` rather than throwing. Do not assume `window.parent` is the app.
- Strings come from a string table resolved by the user's UI language.
- Draw a suppressed native affordance yourself. `appearance: none` on a select removes the arrow, so draw a chevron with `pointer-events: none`.

## PCF control

A code component the platform renders in a form, view or dashboard.

- Use Fluent UI React v9 as a platform library (declare it in the manifest's `resources`) and wrap the root in `FluentProvider`. Choose `webLightTheme`, or `webDarkTheme` when the host is dark. Do not bundle your own copy of React or Fluent.
- Prefer a Fluent component to a custom one: `DataGrid`, `TabList`, `Toolbar`, `Menu`, `Badge`, `Persona`. Override tokens only where the project has brand tokens.
- A PCF is sized by its container. Respect `context.mode.allocatedWidth`/`Height`, never set `100vh`, and tolerate a width of 0 before the first layout.
- Obey the platform's lifecycle: render from `updateView`, avoid timers that outlive `destroy`, and do not fetch what the context already gives you.

## Code app

A standalone React app (Vite) hosted by Power Apps. It is not inside the model-driven shell, so it must supply what the shell would.

- Use Fluent UI React v9 with `FluentProvider`. Offer light and dark and follow the user's choice; there is no host theme to read.
- Provide a minimal shell that reads like the app: a 48px top bar (title left, user right), an optional 48px collapsed left nav with icons, then the command bar and content from [patterns.md](patterns.md). Keep it plain; do not add a decorative hero or sidebar.
- Data: Dataverse through the generated services; respect the signed-in user's permissions, with no elevated access.
- If it is a configuration or builder tool, follow the same density and anatomy; a tool for administrators should still look like the app they administer.

## Checking your work

- Measure computed values (height, radius, colour, font) against a real view or form in the app when one is reachable.
- Test light and dark, keyboard only, 200% zoom and a narrow width.
- Check contrast in both themes: 4.5:1 text, 3:1 graphics and control edges.
- Confirm every control has default, hover, focus, pressed and disabled states, and an accessible name.
- For layout, assert from what a browser draws, not from a style string.
