import { IInputs, IOutputs } from './generated/ManifestTypes';
import * as React from 'react';
import { resolveCaseId } from './host/caseId';
import { DeployCheck } from './host/DeployCheck';

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
  initCount?: number;
  scrollTop?: number;
  expandedThreadKey?: string;
  expandedMessageIds?: string[];
  composeTargetId?: string;
  draftHtml?: string;
}

export class CaseEmailClient
  implements ComponentFramework.ReactControl<IInputs, IOutputs>
{
  private persistState?: (state: PreservedState) => void;
  private state: PreservedState = {};
  private stateRestored = false;
  private initCount = 1;
  private initAt = '';

  public init(
    context: ComponentFramework.Context<IInputs>,
    _notifyOutputChanged: () => void,
    state?: ComponentFramework.Dictionary,
  ): void {
    this.persistState = (next) => context.mode.setControlState(next);
    this.initAt = new Date().toISOString();

    // Width changes arrive as "layout" in updatedProperties; height is claimed, not given.
    context.mode.trackContainerResize(true);

    const accepted = acceptRestoredState(context, state);
    this.stateRestored = accepted !== undefined;
    this.state = accepted ?? {};
    this.initCount = (this.state.initCount ?? 0) + 1;
    this.state.initCount = this.initCount;
    this.state.caseId = resolveCaseId(context).id;
    this.persistState(this.state);
  }

  public updateView(
    context: ComponentFramework.Context<IInputs>,
  ): React.ReactElement {
    return React.createElement(DeployCheck, {
      context,
      initCount: this.initCount,
      initAt: this.initAt,
      stateRestored: this.stateRestored,
      restoredProbe: this.state.draftHtml,
      onProbeChange: (value: string) => {
        this.state.draftHtml = value;
        this.persistState?.(this.state);
      },
    });
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // Phase 2 flushes any pending draft write here before the host tears us down.
    this.persistState = undefined;
  }
}

/**
 * Guards N1: returns restored state only when it belongs to the case now on screen, and
 * `undefined` when there was nothing to restore or it belonged to another case.
 *
 * Not exported — see the one-export rule above.
 */
function acceptRestoredState(
  context: ComponentFramework.Context<IInputs>,
  state?: ComponentFramework.Dictionary,
): PreservedState | undefined {
  if (!state) return undefined;
  const candidate = state as PreservedState;
  const current = resolveCaseId(context).id;
  if (!current || !candidate.caseId || candidate.caseId !== current) return undefined;
  return candidate;
}
