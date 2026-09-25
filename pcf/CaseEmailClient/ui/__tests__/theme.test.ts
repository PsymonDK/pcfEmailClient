import { describe, it, expect } from 'vitest';
import {
  cssVariables, DARK, LIGHT, relativeLuminance, resolveThemeMode, varName, type Palette,
} from '../theme';
import { readFileSync } from 'node:fs';
import { BODY_SURFACE, T } from '../tokens';

describe('resolveThemeMode', () => {
  it('follows the HOST theme when it offers one', () => {
    // N7 is "consistent with the surrounding app": an agent who set Dynamics to dark wants this
    // dark, whatever their OS says.
    expect(resolveThemeMode({ tokenTheme: { colorNeutralBackground1: '#292929' } })).toBe('dark');
    expect(resolveThemeMode({ tokenTheme: { colorNeutralBackground1: '#ffffff' } })).toBe('light');
  });

  it('prefers the host over the OS, in both directions', () => {
    expect(resolveThemeMode({
      tokenTheme: { colorNeutralBackground1: '#ffffff' }, prefersDark: true,
    })).toBe('light');
    expect(resolveThemeMode({
      tokenTheme: { colorNeutralBackground1: '#1f1f1f' }, prefersDark: false,
    })).toBe('dark');
  });

  it('falls back to the OS preference when the host says nothing', () => {
    expect(resolveThemeMode({ prefersDark: true })).toBe('dark');
    expect(resolveThemeMode({ prefersDark: false })).toBe('light');
    expect(resolveThemeMode({ tokenTheme: null, prefersDark: true })).toBe('dark');
  });

  it('defaults to LIGHT when nothing is known', () => {
    // The control has always rendered light. An unknown host keeps today's behaviour rather than
    // flipping to dark on a guess.
    expect(resolveThemeMode({})).toBe('light');
    expect(resolveThemeMode({ tokenTheme: {} })).toBe('light');
  });

  it('ignores a garbled theme value rather than throwing', () => {
    expect(resolveThemeMode({ tokenTheme: { colorNeutralBackground1: 'not a colour' } })).toBe('light');
    expect(resolveThemeMode({ tokenTheme: { colorNeutralBackground1: 42 } })).toBe('light');
    expect(resolveThemeMode({
      tokenTheme: { colorNeutralBackground1: 'not a colour' }, prefersDark: true,
    })).toBe('dark');
  });

  it('reads the theme by MEASURING the background, not by an isDark flag', () => {
    // There is no documented flag, and a custom Dynamics theme need not call itself dark. A
    // mid-dark custom neutral must still resolve dark.
    expect(resolveThemeMode({ tokenTheme: { colorNeutralBackground1: '#3a3a3a' } })).toBe('dark');
    expect(resolveThemeMode({ tokenTheme: { colorNeutralBackground1: '#f0ede6' } })).toBe('light');
  });
});

describe('relativeLuminance', () => {
  it('handles six-digit, three-digit and hash-less hex', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 2);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 2);
    expect(relativeLuminance('fff')).toBeCloseTo(1, 2);
    expect(relativeLuminance('#FFF')).toBeCloseTo(1, 2);
  });

  it('returns undefined for anything that is not a hex colour', () => {
    for (const bad of ['', 'rgb(0,0,0)', '#12345', 'white', '#gggggg']) {
      expect(relativeLuminance(bad)).toBeUndefined();
    }
  });

  it('weights green above red above blue, as perception does', () => {
    const g = relativeLuminance('#00ff00') ?? 0;
    const r = relativeLuminance('#ff0000') ?? 0;
    const b = relativeLuminance('#0000ff') ?? 0;
    expect(g).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(b);
  });
});

describe('the two palettes', () => {
  it('define exactly the same keys', () => {
    // A key present in one and missing from the other renders as an unset variable — which shows
    // up as transparent or inherited, not as an obvious error.
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
  });

  it('are all valid hex colours', () => {
    for (const palette of [LIGHT, DARK]) {
      for (const key of Object.keys(palette) as (keyof Palette)[]) {
        const value = palette[key];
        // The message names the offending token; without it a failure says only "undefined".
        expect(relativeLuminance(value), `${key} = ${value}`).not.toBeUndefined();
      }
    }
  });

  it('actually invert the surfaces and the text', () => {
    expect(relativeLuminance(LIGHT.bg1) ?? 0).toBeGreaterThan(0.8);
    expect(relativeLuminance(DARK.bg1) ?? 1).toBeLessThan(0.3);
    expect(relativeLuminance(LIGHT.fg1) ?? 1).toBeLessThan(0.3);
    expect(relativeLuminance(DARK.fg1) ?? 0).toBeGreaterThan(0.8);
  });

  it('keeps body text readable on its own surface in BOTH themes', () => {
    // Not a full WCAG ratio — that is the accessibility audit's job (N6). This is the cheap guard
    // that catches a token pasted into the wrong palette, which is the realistic mistake.
    for (const palette of [LIGHT, DARK]) {
      const bg = relativeLuminance(palette.bg1) ?? 0;
      const fg = relativeLuminance(palette.fg1) ?? 0;
      expect(Math.abs(bg - fg)).toBeGreaterThan(0.5);
    }
  });

  it('gives dark theme LIGHTER accents, not darkened light ones', () => {
    // A dark surface needs a lighter accent to hold contrast. Inverting the light values instead
    // is what produces the washed-out bolted-on look.
    expect(relativeLuminance(DARK.link) ?? 0).toBeGreaterThan(relativeLuminance(LIGHT.link) ?? 1);
    expect(relativeLuminance(DARK.incoming) ?? 0).toBeGreaterThan(relativeLuminance(LIGHT.incoming) ?? 1);
  });
});

describe('cssVariables', () => {
  it('emits one --cec-* variable per token', () => {
    const vars = cssVariables('dark');
    expect(Object.keys(vars)).toHaveLength(Object.keys(DARK).length);
    expect(vars[varName('bg1')]).toBe(DARK.bg1);
    expect(cssVariables('light')[varName('bg1')]).toBe(LIGHT.bg1);
  });

  it('names every key with the --cec- prefix', () => {
    for (const key of Object.keys(cssVariables('light'))) {
      expect(key.startsWith('--cec-')).toBe(true);
    }
  });
});

describe('tokens are wired to the variables', () => {
  it('exposes T values as var() references, not hex', () => {
    // This is what makes the theme swap a single change on the root rather than a refactor of
    // every inline style in the control.
    expect(T.bg1).toBe(`var(${varName('bg1')})`);
    expect(T.fg1).toBe(`var(${varName('fg1')})`);
    expect(T.link).toBe(`var(${varName('link')})`);
  });

  it('references a variable that both palettes actually define', () => {
    const keys = new Set(Object.keys(LIGHT));
    const referenced = [T.bg1, T.bg2, T.bg3, T.fg1, T.fg2, T.fg3, T.link, T.warnBg, T.dangerFg];
    for (const ref of referenced) {
      const key = /^var\(--cec-(.+)\)$/.exec(ref)?.[1];
      expect(key, ref).toBeDefined();
      expect(keys.has(key ?? ''), ref).toBe(true);
    }
  });

  it('keeps the BODY surface a literal white, never a themed token', () => {
    // The frozen decision: a sender's HTML stays on white in dark theme too, because inverting it
    // would alter a business document and mail is written for a white background.
    expect(BODY_SURFACE).toBe('#ffffff');
    expect(BODY_SURFACE).not.toContain('var(');
  });
});

describe('no component paints a hardcoded surface', () => {
  it('is enforced by a source scan, because only dark theme reveals it', () => {
    // Found in the published app 2026-09-22 by applying the dark palette and looking for surfaces
    // that stayed light: three hardcoded hexes (#fffbe6 twice, #faf9f8 once) in components that
    // otherwise themed correctly. A literal hex in an inline style cannot follow the variables,
    // and in light theme it looks perfect — so the only guard is refusing to let one in.
    //
    // `ui/theme.ts` is the exception: it is where the literals belong. `BODY_SURFACE` in
    // tokens.ts is the other, and it is deliberate — a sender's HTML stays on white.
    const files = [
      'BodyFrame.tsx', 'ThreadList.tsx', 'ReadingPane.tsx', 'parts.tsx', 'EmailClientRoot.tsx',
      'Compose.tsx', 'Editor.tsx',
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      for (const line of source.split('\n')) {
        // A hex used as a colour, excluding the ones inside SVG path data and comments.
        if (/^\s*(\*|\/\/)/.test(line)) continue;
        const hex = /#[0-9a-fA-F]{6}\b/.exec(line);
        if (hex) offenders.push(`${file}: ${line.trim().slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
