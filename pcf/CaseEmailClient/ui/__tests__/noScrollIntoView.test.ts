import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { revealWithin } from '../scroll';

/**
 * N11 (2026-09-29): selecting a thread scrolled the reading pane to the chosen message with
 * `scrollIntoView`, which also scrolled the form's own tab section — and UCI answers that by
 * drawing the form header over the top of the control. `revealWithin` scrolls one container and
 * nothing else; this file keeps the platform call from coming back.
 */
describe('no scrollIntoView in the UI', () => {
  it('is never called by a component', () => {
    const dir = new URL('../', import.meta.url);
    const offenders = readdirSync(dir)
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => /\.scrollIntoView\s*\(/.test(readFileSync(new URL(f, dir), 'utf8')));
    expect(offenders).toEqual([]);
  });
});

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) };
}

function setup(containerTop: number, containerHeight: number, elTop: number, elHeight: number, scrollTop = 100) {
  // Plain stubs: the helper reads two rects and writes one number, so no DOM is needed — and the
  // source scan above cannot run under jsdom, where import.meta.url is not a file URL.
  const container = { scrollTop, getBoundingClientRect: () => rect(containerTop, containerHeight) } as unknown as HTMLElement;
  const el = { getBoundingClientRect: () => rect(elTop, elHeight) } as unknown as Element;
  return { container, el };
}

describe('revealWithin — block: nearest, on one container only', () => {
  it('leaves a fully visible element where it is', () => {
    const { container, el } = setup(0, 400, 100, 50);
    revealWithin(container, el);
    expect(container.scrollTop).toBe(100);
  });

  it('scrolls up to an element above the fold by exactly the overlap', () => {
    const { container, el } = setup(200, 400, 150, 50);
    revealWithin(container, el);
    expect(container.scrollTop).toBe(50);
  });

  it('scrolls down to align the bottom of an element below the fold', () => {
    const { container, el } = setup(0, 400, 380, 50);
    revealWithin(container, el);
    expect(container.scrollTop).toBe(130);
  });

  it('aligns the TOP of an element taller than the container', () => {
    const { container, el } = setup(0, 400, 300, 900);
    revealWithin(container, el);
    expect(container.scrollTop).toBe(400);
  });
});
