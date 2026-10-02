// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import { Editor, READY_TIMEOUT_MS, type UnavailableReason } from '../Editor';
import { installFakeFormComponent, type FakeFormComponent } from './fakeFormComponent';

/**
 * The editor's readiness timeout counts VISIBLE time only (1.43.1).
 *
 * Measured 2026-10-02: a draft continued while the CSW tab was in the background fell back to
 * "couldn't load" after 20s — the browser throttles a hidden tab and the form does not finish
 * there — and the same draft loaded in 1.8s with the tab in front.
 */
describe('Editor readiness timeout', () => {
  let host: HTMLDivElement;
  let form: FakeFormComponent;
  let visibility: DocumentVisibilityState;

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    // A form whose editor never becomes editable: only the timeout can end the wait.
    form = installFakeFormComponent({ bodyFor: () => '<p>x</p>', readOnly: true });
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(host);
    host.remove();
    form.uninstall();
    vi.useRealTimers();
    delete (document as { visibilityState?: unknown }).visibilityState;
  });

  const mount = (onUnavailable: (r: UnavailableReason) => void) => act(() => {
    ReactDOM.render(
      <Editor
        emailId="c0ffee00-0000-0000-0000-000000000001"
        context={{ caseId: 'case', to: [], subject: 's' }}
        ariaLabel="Body"
        onUnavailable={onUnavailable}
      />,
      host,
    );
  });

  it('does not give up while the tab is hidden, and does once it has waited that long in front', async () => {
    const unavailable = vi.fn();
    visibility = 'hidden';
    mount(unavailable);
    await act(async () => { await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS * 3); });
    expect(unavailable).not.toHaveBeenCalled();

    visibility = 'visible';
    await act(async () => { await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS - 1000); });
    expect(unavailable).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(unavailable).toHaveBeenCalledWith('read-only');
  });

  it('still gives up in a visible tab', async () => {
    const unavailable = vi.fn();
    mount(unavailable);
    await act(async () => { await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS + 500); });
    expect(unavailable).toHaveBeenCalledWith('read-only');
  });
});
