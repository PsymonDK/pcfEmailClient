/**
 * Bring `el` into view by scrolling `container` — and ONLY `container`.
 *
 * **Never `scrollIntoView` in this control.** It scrolls every scrollable ancestor, and one of
 * ours is the form's own tab section, which UCI watches: once it scrolls, the form header turns
 * into an overlay and is drawn over the top of the control — the list's title bar and the
 * reading pane's subject (N11, found 2026-09-29; the same overlay as N4). Selecting a thread
 * scrolled the pane to the chosen message, and that was enough to trigger it.
 *
 * Same alignment as `block: 'nearest'`: nothing moves if the element is already fully visible;
 * otherwise the nearer edge is aligned, and an element taller than the container aligns its top.
 * `ui/__tests__/noScrollIntoView.test.ts` keeps the platform call out of the components.
 */
export function revealWithin(container: HTMLElement, el: Element): void {
  const box = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.top < box.top) {
    container.scrollTop -= box.top - r.top;
  } else if (r.bottom > box.bottom) {
    container.scrollTop += Math.min(r.bottom - box.bottom, r.top - box.top);
  }
}
