/**
 * Fluent v9 token values, read out of `@fluentui/react-components@9.46.2` — the exact platform
 * library this environment loads — rather than eyeballed.
 *
 * These are literals on purpose, for now. The real control should consume the tokens through
 * Griffel so dark theme follows the agent's own Dynamics setting for free; that is a Phase 1b
 * refactor once the component shapes have settled. Keeping them in one file means the refactor is
 * mechanical rather than a hunt.
 */
export const T = {
  // surfaces
  bg1: '#ffffff',
  bg2: '#fafafa',
  bg3: '#f5f5f5',
  selected: '#ebebeb',
  brandBg: '#0f6cbd',
  brandBg2: '#ebf3fc',

  // text
  fg1: '#242424',
  fg2: '#424242',
  fg3: '#616161',
  fg4: '#707070',
  onBrand: '#ffffff',

  // strokes
  stroke1: '#d1d1d1',
  stroke2: '#e0e0e0',
  stroke3: '#f0f0f0',
  brandStroke2: '#b4d6fa',
  focus: '#0f6cbd',

  // accents
  link: '#115ea3',
  incoming: '#0e700e',
  outgoing: '#115ea3',
  warnBg: '#fff4ce',
  warnStroke: '#f2d999',
  warnFg: '#8a6300',
  dangerBg: '#fdf6f6',
  dangerStroke: '#eec7c8',
  dangerFg: '#a4262c',
  okBg: '#dff6dd',
  okFg: '#0e700e',

  // avatar fills, muted, matching the real form's palette
  avatarViolet: { bg: '#e8ddf5', fg: '#5c2e91' },
  avatarRed: { bg: '#fde7e9', fg: '#a4262c' },
  avatarGold: { bg: '#fff4ce', fg: '#8a6300' },
  avatarNeutral: { bg: '#f0f0f0', fg: '#616161' },

  // type
  font: "'Segoe UI', 'Segoe UI Web (West European)', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', sans-serif",
  mono: "Consolas, 'Courier New', monospace",
} as const;

export const RADIUS = { sm: '2px', md: '4px', lg: '6px', pill: '10000px' } as const;

/** Deterministic avatar colour, so the same person is the same colour everywhere. */
export function avatarFill(seed: string): { bg: string; fg: string } {
  const palette = [T.avatarViolet, T.avatarRed, T.avatarGold, T.avatarNeutral];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

/** Two-letter initials, the form's own avatar idiom. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => /[a-zA-ZÀ-ɏ]/.test(p));
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Danish-format date, matching what the rest of the form shows. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** File size for an attachment chip. */
export function formatSize(bytes: number): string {
  if (bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
