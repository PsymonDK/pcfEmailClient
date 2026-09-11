import { IInputs, IOutputs } from './generated/ManifestTypes';
import * as React from 'react';
import { resolveCaseId } from './host/caseId';

/**
 * Case Email Client — PCF entry point.
 *
 * Lifecycle only. No data access and no rendering logic lives here; see
 * docs/design/02-component-inventory.md for what gets built above it.
 *
 * NOTE: PCF allows exactly ONE export from the control source. Helpers live in host/ and domain/,
 * not beside the class — `pcf-scripts build` fails with pcf-1023 otherwise.
 *
 * Two measured facts shape this file, both from 2026-09-10 (S1 / S11):
 *   - `allocatedHeight` is -1 on BOTH chosen placements, so height is claimed from the viewport
 *     rather than inherited. One code path, no per-placement branch.
 *   - CSW destroys and re-creates the control when the agent switches between concurrent case
 *     sessions. `setControlState` survives that, and is the mechanism behind R16/N1.
 */

/** What survives a session-switch teardown. Deliberately small — bodies are re-fetchable. */
interface PreservedState {
  /**
   * The case this state belongs to. N1 requires no cross-session bleed, and the platform can hand
   * back state from another session — so restored state whose caseId does not match the current
   * record is DISCARDED rather than trusted. Without this check, case Y shows case X's draft.
   */
  caseId?: string;
  scrollTop?: number;
  expandedThreadKey?: string;
  expandedMessageIds?: string[];
  composeTargetId?: string;
  draftHtml?: string;
}

export class CaseEmailClient
  implements ComponentFramework.ReactControl<IInputs, IOutputs>
{
  private notifyOutputChanged?: () => void;
  private persistState?: (state: Record<string, unknown>) => void;
  private restored: PreservedState = {};

  public init(
    context: ComponentFramework.Context<IInputs>,
    notifyOutputChanged: () => void,
    state?: ComponentFramework.Dictionary,
  ): void {
    this.notifyOutputChanged = notifyOutputChanged;
    this.persistState = (next) => context.mode.setControlState(next);

    // Width changes arrive as "layout" in updatedProperties; height is claimed, not given.
    context.mode.trackContainerResize(true);

    this.restored = acceptRestoredState(context, state);
  }

  public updateView(
    context: ComponentFramework.Context<IInputs>,
  ): React.ReactElement {
    const { id, source } = resolveCaseId(context);

    // Placeholder until the UI lands (Phase 1). Deliberately inert: nothing here renders an
    // email body, because no body may reach the DOM before domain/sanitise.ts exists.
    return React.createElement(
      'div',
      { style: { fontFamily: 'Segoe UI, sans-serif', fontSize: '14px', padding: '12px' } },
      `Case Email Client — case ${id ?? '(unresolved)'} via ${source}`,
    );
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // Phase 2 flushes any pending draft write here before the host tears us down.
    this.persistState = undefined;
    this.notifyOutputChanged = undefined;
  }
}

/**
 * Guards N1: returns restored state only when it belongs to the case now on screen.
 * Not exported — see the one-export rule above. Its behaviour is covered indirectly by the
 * host/caseId tests and directly once Phase 1 gives it a home in a hook.
 */
function acceptRestoredState(
  context: ComponentFramework.Context<IInputs>,
  state?: ComponentFramework.Dictionary,
): PreservedState {
  if (!state) return {};
  const candidate = state as PreservedState;
  const current = resolveCaseId(context).id;
  if (!current || !candidate.caseId || candidate.caseId !== current) return {};
  return candidate;
}
