import { IInputs, IOutputs } from './generated/ManifestTypes';
import * as React from 'react';
import { EmailClient, EmailClientProps } from './EmailClient';

/**
 * S1 spike control. See docs/research/06-spikes.md.
 *
 * It exists to answer three things, and it reports all three on screen:
 *   RQ1  - how much vertical real estate a dataset PCF actually gets on a full
 *          Case form tab (allocatedHeight is expected to be -1; CSS fills 100%).
 *   RQ5  - whether context.mode.setControlState survives CSW's destroy/reload
 *          when the agent switches session tabs.
 *   The undocumented one - whether that same state survives when this control is
 *          hosted inside a custom page rather than directly on a form.
 */
export class CaseEmailClient implements ComponentFramework.ReactControl<IInputs, IOutputs> {
  private notifyOutputChanged: () => void;
  private setControlState: (state: ComponentFramework.Dictionary) => boolean;

  /** State handed back by the platform on init. Null here means state did NOT survive. */
  private restoredState: ComponentFramework.Dictionary | null = null;
  /** Wall-clock of this init, so a re-init is visible on screen. */
  private initAt = '';
  private initCount = 0;

  public init(
    context: ComponentFramework.Context<IInputs>,
    notifyOutputChanged: () => void,
    state: ComponentFramework.Dictionary,
  ): void {
    this.notifyOutputChanged = notifyOutputChanged;
    this.initAt = new Date().toISOString();

    // THE measurement: did the platform hand us back what we last persisted?
    this.restoredState = state ?? null;
    this.initCount = Number(state?.initCount ?? 0) + 1;

    // Opt in to allocatedWidth/allocatedHeight and "layout" in updatedProperties.
    context.mode.trackContainerResize(true);

    this.setControlState = (s: ComponentFramework.Dictionary) => context.mode.setControlState(s);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    const props: EmailClientProps = {
      context,
      restoredState: this.restoredState,
      initAt: this.initAt,
      initCount: this.initCount,
      persistState: (scratch: string) =>
        this.setControlState({
          scratch,
          initCount: this.initCount,
          savedAt: new Date().toISOString(),
        }),
    };
    return React.createElement(EmailClient, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // Nothing to clean up: no timers, no listeners, no outstanding subscriptions.
  }
}
