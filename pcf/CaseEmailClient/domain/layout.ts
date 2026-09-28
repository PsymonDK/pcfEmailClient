/**
 * The sizing rules, as pure functions so the measured numbers are asserted rather than hoped for.
 *
 * Two traps are encoded here, both found by deploying to the published app rather than by reading
 * documentation:
 *
 *  1. **`allocatedHeight` is −1 on both placements**, so height is claimed from the viewport. The
 *     host does not give it to us. (S1, 2026-09-10.)
 *  2. **Width behaves the same way.** Setting height alone produced a control 588px wide inside a
 *     full-width tab, because the subgrid cell's ancestors content-size their child. (2026-09-11.)
 *     Hence: claim both dimensions, inherit neither.
 *
 * And one correction: the budget is a **range**, not a constant. Three readings on the same form
 * gave 531 / 661 / 471px depending on whether a side pane and the process bar were showing, with
 * width 1354–1414 rather than the 1600 every artboard is drawn at. We design to the floor.
 */

/** Measured floor, 2026-09-11. Below this the layout is not expected to hold together. */
export const MIN_HEIGHT = 320;

/** Gap left below the control so it does not collide with the form's own bottom edge. */
export const BOTTOM_GUTTER = 24;

/**
 * Below this width the two-pane layout collapses to one column.
 *
 * Not a guess: the thread list needs 424px to keep a subject and a snippet legible, and a message
 * body needs ~420px before Outlook tables and quoted headers wrap badly. Below their sum, showing
 * both costs more than it gives.
 */
export const TWO_PANE_MIN_WIDTH = 900;

/** Fixed width of the thread list in the two-pane layout. */
export const LIST_WIDTH = 424;

export interface HostSize {
  /** `context.mode.allocatedHeight` — expected to be −1 on both real placements. */
  allocatedHeight: number;
  /** `context.mode.allocatedWidth`. */
  allocatedWidth: number;
  /** `window.innerHeight`. */
  viewportHeight: number;
  /**
   * The control root's distance from the top of the viewport — or `undefined` before it has been
   * measured, in which case the claim is the floor (see `resolveLayout`).
   */
  rootTop: number | undefined;
}

export interface ResolvedLayout {
  /** What to put in `style.height`. */
  height: string;
  /** Always `100%` — width is claimed, never inherited. */
  width: string;
  /** The pixel height actually claimed, for diagnostics and for the budget checks below. */
  claimedHeight: number;
  /** Whether the host gave us a real height, i.e. we are NOT on a form tab. */
  hostProvidedHeight: boolean;
  layout: 'two-pane' | 'single-column';
}

/**
 * Resolves the host's measurements into the styles to apply.
 *
 * `allocatedHeight > 0` means a host that sizes us — the custom-page fallback. Honour it, because
 * claiming from the viewport there over-claims and overflows. `−1` is the form-tab case, which is
 * both real placements.
 */
export function resolveLayout(size: HostSize): ResolvedLayout {
  const hostProvidedHeight = size.allocatedHeight > 0;

  // Before the root has been measured, claim the FLOOR, never the viewport (N4, 2026-09-28). The
  // first render used to claim with rootTop = 0 — nearly the whole viewport — and in CSW that made
  // the freshly shown tab taller than the form, so UCI scrolled it into view and switched the
  // header into its sticky overlay, which then sat on top of the control's first ~240px for good.
  const claimedHeight = hostProvidedHeight
    ? size.allocatedHeight
    : size.rootTop === undefined
      ? MIN_HEIGHT
      : Math.max(MIN_HEIGHT, Math.floor(size.viewportHeight - size.rootTop - BOTTOM_GUTTER));

  return {
    height: hostProvidedHeight ? '100%' : `${claimedHeight}px`,
    // Never inherited. This is the 588px lesson.
    width: '100%',
    claimedHeight,
    hostProvidedHeight,
    layout: size.allocatedWidth >= TWO_PANE_MIN_WIDTH ? 'two-pane' : 'single-column',
  };
}

/**
 * How the claimed height is spent, so the build can assert that the scroll region survives.
 *
 * Everything above the scroll region is a FIXED height — that is rule 2 of three from
 * docs/design/03-interaction-spec.md, and a toolbar that wraps to a second line is how it gets
 * broken silently.
 */
export const CHROME = {
  /** 8px top + 8px bottom of page padding around the cards. */
  pagePadding: 16,
  /** Card header: title, unread count, icon row. */
  cardHeader: 44,
  /** Search field plus filter chips. Left card only. */
  listFilters: 72,
  /** Parent-case link. Left card only. */
  listFooter: 36,
  /** Compose, when docked. Taken from the reading pane, not from the page. */
  composeDocked: 222,
} as const;

/**
 * How tall the docked compose surface is, given how much the agent has written (R10).
 *
 * From the frozen spec: opens at 222, grows past three lines to ~300, ceiling ~380 — about half
 * the pane. Beyond that the editor scrolls inside itself.
 *
 * **It never shrinks back while compose is open.** `highWaterMark` is the tallest it has been this
 * session, and the result never goes below it. Layout that jumps *under the cursor* — because a
 * line was deleted, or an image finished loading — is worse than layout that is slightly too
 * small, and it is the kind of thing that makes an editor feel cheap.
 */
export const COMPOSE = {
  opensAt: 222,
  ceiling: 380,
  /**
   * Chrome inside the compose surface: context bar, From row, recipients, toolbar, quote fold,
   * Send row.
   *
   * 176, not 150: the From row (R17) added 26px. It is not optional furniture — an agent who
   * cannot see whether a reply goes out as the queue or as themselves cannot tell what the
   * customer will see.
   */
  chrome: 176,
} as const;

export function composeHeight(contentHeight: number, highWaterMark = 0): number {
  const wanted = COMPOSE.chrome + Math.max(0, contentHeight);
  const clamped = Math.min(COMPOSE.ceiling, Math.max(COMPOSE.opensAt, wanted));
  return Math.max(clamped, Math.min(highWaterMark, COMPOSE.ceiling));
}

export interface Budget {
  /** Scrollable pixels in the thread list. */
  listScroll: number;
  /** Scrollable pixels in the reading pane. */
  readingScroll: number;
  /** Scrollable pixels left in the reading pane once compose is docked. */
  readingScrollWithCompose: number;
}

/**
 * Works out what is left to scroll in, given a claimed height.
 *
 * At the measured floor of 471px this leaves 339px in the list — about five collapsed thread rows.
 * That is the number designs are checked against, not the 536px sample that was measured first.
 */
export function budgetFor(claimedHeight: number): Budget {
  const usable = claimedHeight - CHROME.pagePadding;
  const listScroll = usable - CHROME.cardHeader - CHROME.listFilters - CHROME.listFooter;
  const readingScroll = usable - CHROME.cardHeader;
  return {
    listScroll: Math.max(0, listScroll),
    readingScroll: Math.max(0, readingScroll),
    readingScrollWithCompose: Math.max(0, readingScroll - CHROME.composeDocked),
  };
}
