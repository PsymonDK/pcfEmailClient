/**
 * Light and dark palettes, and how the mode is decided (N7).
 *
 * The values are read out of `@fluentui/react-components@9.46.2` — the exact platform library this
 * environment loads — rather than eyeballed, so the control sits next to OOB CSW pages without
 * looking like a transplant.
 *
 * **Why CSS custom properties rather than a React context.** `ui/tokens.ts` exports `T`, and ~200
 * sites across six files reference `T.bg1` and friends inside inline styles. Threading a theme
 * object through all of them would be a large mechanical change with a bug in every place it was
 * missed. Instead `T` holds `var(--cec-*)` references, and the root element sets those variables
 * for the active mode: one place changes, every component follows, and nothing has to remember to
 * ask for the theme.
 */

export type ThemeMode = 'light' | 'dark';

/** Every themed token. The keys are the contract with `ui/tokens.ts`. */
export interface Palette {
  bg1: string; bg2: string; bg3: string; selected: string; brandBg: string; brandBg2: string;
  fg1: string; fg2: string; fg3: string; fg4: string; onBrand: string;
  stroke1: string; stroke2: string; stroke3: string; brandStroke2: string; focus: string;
  link: string; incoming: string; outgoing: string;
  warnBg: string; warnBg2: string; warnStroke: string; warnFg: string;
  /** The borrowed-thread left edge (R8). Its own token: it must read as "not from here". */
  parentEdge: string;
  dangerBg: string; dangerStroke: string; dangerFg: string;
  okBg: string; okFg: string;
  avatarVioletBg: string; avatarVioletFg: string;
  avatarRedBg: string; avatarRedFg: string;
  avatarGoldBg: string; avatarGoldFg: string;
  avatarNeutralBg: string; avatarNeutralFg: string;
}

export const LIGHT: Palette = {
  bg1: '#ffffff', bg2: '#fafafa', bg3: '#f5f5f5', selected: '#ebebeb',
  brandBg: '#0f6cbd', brandBg2: '#ebf3fc',
  fg1: '#242424', fg2: '#424242', fg3: '#616161', fg4: '#707070', onBrand: '#ffffff',
  stroke1: '#d1d1d1', stroke2: '#e0e0e0', stroke3: '#f0f0f0',
  brandStroke2: '#b4d6fa', focus: '#0f6cbd',
  link: '#115ea3', incoming: '#0e700e', outgoing: '#115ea3',
  // warnBg2 is the paler tint used for a LARGE warn surface — the expanded notices panel and the
  // borrowed-thread row. Separate from warnBg because a whole row in the button colour shouts.
  warnBg: '#fff4ce', warnBg2: '#fffbe6', warnStroke: '#f2d999', warnFg: '#8a6300',
  parentEdge: '#f2c811',
  dangerBg: '#fdf6f6', dangerStroke: '#eec7c8', dangerFg: '#a4262c',
  okBg: '#dff6dd', okFg: '#0e700e',
  avatarVioletBg: '#e8ddf5', avatarVioletFg: '#5c2e91',
  avatarRedBg: '#fde7e9', avatarRedFg: '#a4262c',
  avatarGoldBg: '#fff4ce', avatarGoldFg: '#8a6300',
  avatarNeutralBg: '#f0f0f0', avatarNeutralFg: '#616161',
};

/**
 * Fluent's `webDarkTheme` neutrals, plus the accent ramps shifted the way Fluent shifts them.
 *
 * Note what does NOT simply invert: the status colours move to their *dark-theme* variants
 * (`#479ef5` link rather than a darkened `#115ea3`) because a dark surface needs a lighter accent
 * to hold the same contrast, and the semantic backgrounds become deep tints rather than pale ones.
 * Inverting the light values instead produces the washed-out look that marks a bolted-on dark mode.
 */
export const DARK: Palette = {
  bg1: '#292929', bg2: '#1f1f1f', bg3: '#333333', selected: '#3d3d3d',
  brandBg: '#115ea3', brandBg2: '#082338',
  fg1: '#ffffff', fg2: '#d6d6d6', fg3: '#adadad', fg4: '#999999', onBrand: '#ffffff',
  stroke1: '#666666', stroke2: '#525252', stroke3: '#3d3d3d',
  brandStroke2: '#0f6cbd', focus: '#479ef5',
  link: '#479ef5', incoming: '#54b054', outgoing: '#479ef5',
  warnBg: '#4a3407', warnBg2: '#3a2806', warnStroke: '#835b00', warnFg: '#fdea3d',
  parentEdge: '#dcb800',
  dangerBg: '#3b1113', dangerStroke: '#8b2b30', dangerFg: '#f1707b',
  okBg: '#052505', okFg: '#54b054',
  avatarVioletBg: '#3b2159', avatarVioletFg: '#d0aefc',
  avatarRedBg: '#4d1e24', avatarRedFg: '#f1707b',
  avatarGoldBg: '#463100', avatarGoldFg: '#fdea3d',
  avatarNeutralBg: '#3d3d3d', avatarNeutralFg: '#d6d6d6',
};

/** The CSS variable name for a token. The single source of the `--cec-*` spelling. */
export const varName = (key: keyof Palette): string => `--cec-${key}`;

/** The variables to set on the root element for a mode, as a React style object. */
export function cssVariables(mode: ThemeMode): Record<string, string> {
  const palette = mode === 'dark' ? DARK : LIGHT;
  const out: Record<string, string> = {};
  for (const key of Object.keys(palette) as (keyof Palette)[]) {
    out[varName(key)] = palette[key];
  }
  return out;
}

/**
 * What the host tells us about its theme.
 *
 * Deliberately a loose shape rather than the platform type: `fluentDesignLanguage` is not in
 * `@types/powerapps-component-framework@1.3.16`, and the runtime object has more on it than the
 * types admit. Taking only what is needed keeps the guesswork in one place.
 */
export interface ThemeSignals {
  /** `context.fluentDesignLanguage?.tokenTheme` — a Fluent v9 theme object when present. */
  tokenTheme?: { colorNeutralBackground1?: unknown } | null;
  /** `window.matchMedia('(prefers-color-scheme: dark)').matches`. */
  prefersDark?: boolean;
}

/**
 * Decides light or dark.
 *
 * **The host's own theme wins**, because N7 is "consistent with the surrounding app" — an agent
 * who set Dynamics to dark wants this dark even if their OS says otherwise. The OS preference is
 * only the fallback for when the platform tells us nothing, and light is the last resort: the
 * control has always rendered light, so an unknown host keeps today's behaviour rather than
 * flipping to dark on a guess.
 *
 * The host theme is read by *measuring its background*, not by looking for an `isDark` flag —
 * there is no documented flag, and a custom Dynamics theme is not obliged to call itself dark.
 */
export function resolveThemeMode(signals: ThemeSignals): ThemeMode {
  const background = signals.tokenTheme?.colorNeutralBackground1;
  if (typeof background === 'string') {
    const luminance = relativeLuminance(background);
    if (luminance !== undefined) return luminance < 0.5 ? 'dark' : 'light';
  }
  if (signals.prefersDark === true) return 'dark';
  return 'light';
}

/**
 * Rough perceived brightness of a hex colour, 0..1.
 *
 * Coefficients are the usual sRGB luma weights, without gamma correction — this only has to
 * answer "is this surface dark?", and the gamma step would not change the answer either side of
 * the midpoint for any plausible neutral.
 */
export function relativeLuminance(hex: string): number | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
