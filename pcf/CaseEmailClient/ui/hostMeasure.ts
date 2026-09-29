/**
 * What `resolveLayout` needs to know about where the host put the control (N11, 2026-09-29).
 *
 * The claim used to be `viewport − rootTop − 24`, with `rootTop` read once before first paint.
 * Two things were wrong with that, both measured in the published app:
 *
 *  - **The 24 px guess.** The form wraps the control in containers with 26.8 px and 21 px of
 *    bottom padding, so the tab section overflowed by 24 px and became scrollable. The inset is
 *    now summed from the real computed styles.
 *  - **Measured once.** Form chrome (Summary, the process bar) arrives after the control, pushing
 *    it down — one reading overflowed by 151 px. The shell re-measures whenever the section
 *    resizes, via `observeHost`.
 *
 * A scrollable section is what lets UCI draw its header over the control, so the goal is a claim
 * that fits the section EXACTLY: nothing to scroll, nothing to overlay.
 */

export interface HostMeasurement {
  /** The root's top as if the section were unscrolled. */
  rootTop: number;
  viewportHeight: number;
  /** Visible bottom of the scrolling form section, when one was found. */
  containerBottom?: number;
  /** Padding, borders and margins between the root's bottom and the section's content bottom. */
  bottomInset?: number;
}

const px = (v: string): number => parseFloat(v) || 0;

/**
 * The form section that scrolls the control.
 *
 * The NEAREST `overflow-y: scroll`, deliberately not the nearest `auto`: measured 2026-09-29, the
 * control sits inside a content-sized `overflow: auto` wrapper, and measuring against that would
 * make the claim chase its own height and never grow. UCI's tab section is `scroll`.
 */
export function scrollingSection(root: HTMLElement): HTMLElement | undefined {
  for (let e = root.parentElement; e; e = e.parentElement) {
    if (getComputedStyle(e).overflowY === 'scroll') return e;
  }
  return undefined;
}

export function measureHost(root: HTMLElement): HostMeasurement {
  const r = root.getBoundingClientRect();
  const section = scrollingSection(root);
  if (!section) return { rootTop: Math.round(r.top), viewportHeight: window.innerHeight };

  let inset = px(getComputedStyle(root).marginBottom);
  for (let e = root.parentElement; e && e !== section; e = e.parentElement) {
    const cs = getComputedStyle(e);
    inset += px(cs.paddingBottom) + px(cs.borderBottomWidth) + px(cs.marginBottom);
  }
  inset += px(getComputedStyle(section).paddingBottom);

  const s = section.getBoundingClientRect();
  return {
    rootTop: Math.round(r.top + section.scrollTop),
    viewportHeight: window.innerHeight,
    containerBottom: Math.floor(s.top + section.clientTop + section.clientHeight),
    // Rounded UP: margins can collapse, so this may over-count by a pixel or two, and a hair of
    // empty space is harmless where a pixel of overflow is not.
    bottomInset: Math.ceil(inset),
  };
}

/**
 * Re-measure when anything that moves the control changes: the window, the section's own size
 * (form chrome above it loading late), and the section's content (something above the control
 * inside it). Converges: the inset does not depend on the claim, so a re-measure after our own
 * resize reproduces the same numbers and React skips the update.
 */
export function observeHost(root: HTMLElement, onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  const section = scrollingSection(root);
  const ro = section && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onChange) : undefined;
  if (ro && section) {
    ro.observe(section);
    if (section.firstElementChild) ro.observe(section.firstElementChild);
  }
  return () => {
    window.removeEventListener('resize', onChange);
    ro?.disconnect();
  };
}
