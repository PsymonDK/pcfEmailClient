// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { measureHost, scrollingSection } from '../hostMeasure';

/**
 * The shape measured in CSW on 2026-09-29, reduced: UCI's tab section (`overflow-y: scroll`),
 * padded containers between it and the control, and a content-sized `overflow: auto` wrapper
 * directly around the control — the one that must NOT be taken for the section.
 */
function build(): { section: HTMLElement; root: HTMLElement } {
  const section = document.createElement('div');
  section.style.overflowY = 'scroll';
  section.style.paddingBottom = '3px';
  const padded = document.createElement('div');
  padded.style.paddingBottom = '21px';
  const padded2 = document.createElement('div');
  padded2.style.paddingBottom = '26.8px';
  const autoWrapper = document.createElement('div');
  autoWrapper.style.overflow = 'auto';
  const root = document.createElement('div');
  root.style.marginBottom = '1px';
  autoWrapper.appendChild(root);
  padded2.appendChild(autoWrapper);
  padded.appendChild(padded2);
  section.appendChild(padded);
  document.body.appendChild(section);
  return { section, root };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('measureHost (N11)', () => {
  it('takes the nearest overflow-y: SCROLL ancestor, not the content-sized auto wrapper', () => {
    const { section, root } = build();
    expect(scrollingSection(root)).toBe(section);
  });

  it('sums every bottom padding, border and margin between the control and the section', () => {
    const { root } = build();
    // 1 (root margin) + 26.8 + 21 + 3 (section padding) = 51.8 → rounded up.
    expect(measureHost(root).bottomInset).toBe(52);
  });

  it('falls back to the viewport rule when no scrolling section exists', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const m = measureHost(root);
    expect(m.containerBottom).toBeUndefined();
    expect(m.bottomInset).toBeUndefined();
  });
});
