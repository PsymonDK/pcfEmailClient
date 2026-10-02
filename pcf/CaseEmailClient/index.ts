import { IInputs, IOutputs } from './generated/ManifestTypes';
import * as React from 'react';
import { resolveCaseId } from './host/caseId';
import { EmailClientRoot, type RestorableState } from './ui/EmailClientRoot';
import type { DraftApiLike } from './data/draft';

/**
 * Case Email Client — PCF entry point.
 *
 * Lifecycle only. Data loading and rendering live in ui/EmailClientRoot; the pure logic is in
 * domain/ and is the part with real test coverage.
 *
 * NOTE: PCF allows exactly ONE export from the control source. Helpers live in host/, data/ and
 * domain/, not beside the class — `pcf-scripts build` fails with pcf-1023 otherwise.
 *
 * Measured facts this file exists to respect (S1 / S11, 2026-09-10; deploy check 2026-09-11):
 *   - `allocatedHeight` is -1 on BOTH chosen placements, and width behaves the same way. Claim
 *     both dimensions, inherit neither. The rules live in domain/layout.ts.
 *   - CSW destroys and re-creates the control when the agent switches between concurrent case
 *     sessions. `setControlState` survives that, which is the mechanism behind R16/N1 —
 *     verified in the published app with `init #2` / `state RESTORED`.
 */

interface PreservedState extends RestorableState {
  /**
   * The case this state belongs to. N1 requires no cross-session bleed, and the platform can hand
   * back state from another session — so restored state whose caseId does not match the current
   * record is DISCARDED rather than trusted. Without this check, case Y shows case X's state.
   */
  caseId?: string;
}

export class CaseEmailClient
  implements ComponentFramework.ReactControl<IInputs, IOutputs>
{
  private persistState?: (state: PreservedState) => void;
  private state: PreservedState = {};
  private caseId?: string;

  /**
   * Created ONCE, in `init`, and handed to React unchanged on every render.
   *
   * Building this inline in `updateView` gives the component a new function identity each time,
   * and because the callback calls `setControlState` — which makes the platform call `updateView`
   * again — that closes an infinite loop that hangs the app. Found in the published app on
   * 2026-09-11. The component also guards its own side with a ref; this is the other half.
   */
  private readonly handleStateChange = (next: RestorableState): void => {
    this.state = { ...next, caseId: this.caseId };
    this.persistState?.(this.state);
  };

  public init(
    context: ComponentFramework.Context<IInputs>,
    _notifyOutputChanged: () => void,
    state?: ComponentFramework.Dictionary,
  ): void {
    this.persistState = (next) => context.mode.setControlState(next);

    // Width changes arrive as "layout" in updatedProperties; height is claimed, not given.
    context.mode.trackContainerResize(true);

    this.state = acceptRestoredState(context, state) ?? {};
  }

  public updateView(
    context: ComponentFramework.Context<IInputs>,
  ): React.ReactElement {
    const { id, source } = resolveCaseId(context);
    this.caseId = id;

    return React.createElement(EmailClientRoot, {
      caseId: id,
      caseIdSource: source,
      // `context.webAPI` rather than raw fetch, so Dataverse security trimming applies (N4).
      webApi: context.webAPI as unknown as DraftApiLike,
      // N7. `fluentDesignLanguage` is not in @types/powerapps-component-framework ^1.3.16, so it
      // is read through a narrow shim rather than by widening the platform types.
      themeSignals: { tokenTheme: readTokenTheme(context) },
      // Arrives wrapped in braces — `{4F2D39F5-…}`. readState.ts strips them; an unstripped id
      // makes every read-state filter return nothing rather than fail, which looks like the
      // feature is broken rather than the id.
      userId: context.userSettings.userId,
      // The agent's interface language (LCID) — the template picker's default language (R22).
      languageId: context.userSettings.languageId,
      allocatedHeight: context.mode.allocatedHeight,
      allocatedWidth: context.mode.allocatedWidth,
      restored: this.state,
      // Stable identity — see handleStateChange. Never inline a closure here.
      onStateChange: this.handleStateChange,
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

/**
 * Reads the host's Fluent theme, if it is offering one (N7).
 *
 * `fluentDesignLanguage` is **not** in `@types/powerapps-component-framework` ^1.3.16 — the same
 * gap as `contextInfo`, handled the same way: a narrow local shim rather than widening the
 * platform types, so exactly one place knows this is undocumented. Returns null when absent, and
 * `resolveThemeMode` then falls back to the OS preference.
 */
function readTokenTheme(
  context: ComponentFramework.Context<IInputs>,
): { colorNeutralBackground1?: unknown } | null {
  // `unknown` then narrowed, rather than a cast to a shape we are guessing at: the runtime object
  // has more on it than the types admit, and asserting a shape would make every field below look
  // guaranteed when none of them is.
  const design: unknown = (context as unknown as Record<string, unknown>).fluentDesignLanguage;
  if (typeof design !== 'object' || design === null) return null;
  const theme: unknown = (design as Record<string, unknown>).tokenTheme;
  if (typeof theme !== 'object' || theme === null) return null;
  return { colorNeutralBackground1: (theme as Record<string, unknown>).colorNeutralBackground1 };
}
