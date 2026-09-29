import { describe, it, expect } from 'vitest';
import {
  budgetFor, COMPOSE, composeHeight, LIST_WIDTH, MIN_HEIGHT, resolveLayout, TWO_PANE_MIN_WIDTH,
} from '../layout';

// Every number here came from the published app, not from documentation. The three readings below
// are the actual measurements taken on 2026-09-11 with different chrome on screen.

const reading = (over: Partial<Parameters<typeof resolveLayout>[0]> = {}) => resolveLayout({
  allocatedHeight: -1,
  allocatedWidth: 1354,
  viewportHeight: 1010,
  rootTop: 325,
  ...over,
});

describe('resolveLayout — the form-tab case, which is both real placements', () => {
  it('claims height from the viewport when allocatedHeight is -1', () => {
    const r = reading();
    expect(r.hostProvidedHeight).toBe(false);
    expect(r.claimedHeight).toBe(661); // 1010 - 325 - 24
    expect(r.height).toBe('661px');
  });

  it('reproduces all three measured readings exactly', () => {
    // Copilot pane open, process bar showing.
    expect(reading({ rootTop: 455 }).claimedHeight).toBe(531);
    // Copilot pane open, process bar collapsed.
    expect(reading({ rootTop: 325 }).claimedHeight).toBe(661);
    // Customer Details pane open, process bar showing — the floor.
    expect(reading({ rootTop: 515, allocatedWidth: 1414 }).claimedHeight).toBe(471);
  });

  it('ALWAYS claims width, never inherits it', () => {
    // The 588px lesson: with width left to inherit, the control rendered 588px wide inside a
    // full-width tab because the subgrid cell's ancestors content-size their child.
    expect(reading().width).toBe('100%');
    expect(reading({ allocatedWidth: 400 }).width).toBe('100%');
    expect(reading({ allocatedHeight: 600 }).width).toBe('100%');
  });

  it('never claims less than the floor, however cramped the host', () => {
    expect(reading({ viewportHeight: 400, rootTop: 380 }).claimedHeight).toBe(MIN_HEIGHT);
    expect(reading({ viewportHeight: 100, rootTop: 90 }).claimedHeight).toBe(MIN_HEIGHT);
  });

  it('claims the FLOOR, not the viewport, before the root has been measured (N4)', () => {
    // Measured in CSW 2026-09-28: a first frame claiming nearly the whole viewport made the tab
    // taller than the form, UCI scrolled it into view, and the sticky header then covered the
    // control's top — the list's first rows, the Reply buttons and "Show pictures".
    expect(reading({ viewportHeight: 995, rootTop: undefined }).claimedHeight).toBe(MIN_HEIGHT);
  });

  it('fits the measured section exactly, so it cannot scroll (N11)', () => {
    // Measured in CSW 2026-09-29: viewport 999, root at 452, section bottom 999, and 48 px of the
    // form's own padding below the control. The 24 px gutter claimed 523 and the section
    // overflowed by 24 — scrollable, and a scroll brings the header down over the control.
    expect(reading({ viewportHeight: 999, rootTop: 452 }).claimedHeight).toBe(523);
    expect(reading({ viewportHeight: 999, rootTop: 452, containerBottom: 999, bottomInset: 48 }).claimedHeight)
      .toBe(499);
  });

  it('runs to the section bottom, not the viewport, when the section ends higher', () => {
    expect(reading({ viewportHeight: 999, rootTop: 400, containerBottom: 950, bottomInset: 10 }).claimedHeight)
      .toBe(540);
  });
});

describe('resolveLayout — the custom-page fallback', () => {
  it('honours a real allocatedHeight rather than claiming over it', () => {
    // In a custom page allocatedHeight is a real number, and claiming from the viewport there
    // over-claims and overflows. Measured in S2.
    const r = reading({ allocatedHeight: 600 });
    expect(r.hostProvidedHeight).toBe(true);
    expect(r.height).toBe('100%');
    expect(r.claimedHeight).toBe(600);
  });
});

describe('the breakpoint', () => {
  it('is two-pane at and above 900px', () => {
    expect(reading({ allocatedWidth: TWO_PANE_MIN_WIDTH }).layout).toBe('two-pane');
    expect(reading({ allocatedWidth: 1354 }).layout).toBe('two-pane');
    expect(reading({ allocatedWidth: 1600 }).layout).toBe('two-pane');
  });

  it('collapses to one column below 900px', () => {
    expect(reading({ allocatedWidth: 899 }).layout).toBe('single-column');
    expect(reading({ allocatedWidth: 600 }).layout).toBe('single-column');
  });

  it('is reachable in practice at the widths agents actually get', () => {
    // 1354 is what a Copilot pane leaves; the list is 424 of it, so the reading pane keeps 930.
    const r = reading({ allocatedWidth: 1354 });
    expect(r.layout).toBe('two-pane');
    expect(1354 - LIST_WIDTH).toBeGreaterThan(420); // the body's legibility floor
  });
});

describe('budgetFor', () => {
  it('leaves 303px of list scroll at the measured floor', () => {
    // The number designs get checked against: about FOUR collapsed thread rows.
    //
    // This corrects the spec's own arithmetic. 03-interaction-spec.md listed the 36px list footer
    // as a fixed cost and then did not subtract it, giving 404px at 536px height. Including it,
    // the honest figures are 368 at 536 and 303 at the 471 floor — a row less than advertised.
    const b = budgetFor(471);
    expect(b.listScroll).toBe(303); // 471 - 16 (padding) - 44 (header) - 72 (filters) - 36 (footer)
    expect(b.readingScroll).toBe(411); // the reading pane has no filters and no footer
  });

  it('leaves 368px at the height originally sampled', () => {
    expect(budgetFor(536).listScroll).toBe(368);
  });

  it('leaves 493px at the best case', () => {
    expect(budgetFor(661).listScroll).toBe(493);
  });

  it('shows what docking compose costs the reading pane', () => {
    const b = budgetFor(471);
    // 222px of compose out of 411px of reading pane leaves 189px of thread visible — which is the
    // whole argument for docking rather than overlaying: you can still see what you are answering.
    expect(b.readingScrollWithCompose).toBe(189);
    expect(b.readingScrollWithCompose).toBeGreaterThan(0);
  });

  it('never goes negative, however cramped', () => {
    const b = budgetFor(MIN_HEIGHT);
    expect(b.listScroll).toBeGreaterThanOrEqual(0);
    expect(b.readingScroll).toBeGreaterThanOrEqual(0);
    expect(b.readingScrollWithCompose).toBeGreaterThanOrEqual(0);
  });
});

describe('composeHeight — R10 growth', () => {
  it('opens at 222 however little has been typed', () => {
    expect(composeHeight(0)).toBe(COMPOSE.opensAt);
    expect(composeHeight(20)).toBe(COMPOSE.opensAt);
  });

  it('grows once the content outgrows the opening size', () => {
    const grown = composeHeight(200);
    expect(grown).toBeGreaterThan(COMPOSE.opensAt);
    expect(grown).toBe(COMPOSE.chrome + 200);
  });

  it('stops at the ceiling — compose never takes more than about half the pane', () => {
    expect(composeHeight(10_000)).toBe(COMPOSE.ceiling);
  });

  it('NEVER shrinks back below the high-water mark', () => {
    // Layout that jumps under the cursor — because a line was deleted, or an image finished
    // loading — is worse than layout that is slightly too small.
    const tall = composeHeight(300);
    expect(composeHeight(0, tall)).toBe(tall);
    expect(composeHeight(50, tall)).toBe(tall);
  });

  it('still honours the ceiling even if the high-water mark exceeds it', () => {
    expect(composeHeight(0, 9999)).toBe(COMPOSE.ceiling);
  });

  it('treats a negative content height as zero rather than collapsing', () => {
    expect(composeHeight(-50)).toBe(COMPOSE.opensAt);
  });

  it('leaves the reading pane visible at the measured floor', () => {
    // The point of docking rather than overlaying: you can still see what you are answering.
    const atFloor = budgetFor(471);
    expect(atFloor.readingScrollWithCompose).toBeGreaterThan(150);
  });
});
