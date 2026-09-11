/**
 * What the thread list should be showing.
 *
 * Extracted as a pure function because the distinction it encodes is the one most easily got
 * wrong, and getting it wrong is not cosmetic:
 *
 *   > "No results" and "this customer has never emailed" look identical unless you say which.
 *   > — docs/design/03-interaction-spec.md
 *
 * The first version of the UI got this wrong in the worst direction. `listError` was passed only to
 * the reading pane, so a failed load left the thread list with zero rows and nothing loading — and
 * it rendered **"No email on this case yet"**. A load failure presented as a customer who had never
 * written in. Found on 2026-09-11 while investigating a blank panel.
 *
 * There is no React test harness in this project yet, so the decision lives here where it can be
 * asserted directly rather than inferred from a screenshot.
 */

export type ListView =
  /** First load, or a refresh with nothing to show yet. Skeleton rows. */
  | 'loading'
  /** The load failed. MUST take precedence over every empty state. */
  | 'error'
  /** Loaded, no mail on this case at all. The only state that may say "yet". */
  | 'empty'
  /** Loaded, mail exists, but the filters hide all of it. Must state the real total. */
  | 'empty-filtered'
  /** Rows to render. */
  | 'rows';

export interface ListStateInput {
  loading: boolean;
  /** Anything truthy means the load failed. */
  error: unknown;
  /** Threads that survived filtering. */
  visibleCount: number;
  /** Threads on the case, before filtering. */
  totalCount: number;
  filterActive: boolean;
}

export function listView(input: ListStateInput): ListView {
  // Error first, and before `loading`, because a retry sets loading true again while the previous
  // failure is still the thing the agent needs to see. Silently swapping the message for a
  // skeleton on every retry is how a failure becomes invisible.
  if (input.error) return 'error';
  if (input.loading) return 'loading';
  if (input.visibleCount > 0) return 'rows';
  // Nothing visible. Which of the two empties is it? The filter decides, not the count — a case
  // with mail and an active filter is "filtered", even if the total happens to be 0 because the
  // load returned nothing.
  if (input.filterActive && input.totalCount > 0) return 'empty-filtered';
  return 'empty';
}
