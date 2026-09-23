/**
 * The token names every component uses — now resolved through CSS custom properties so the whole
 * control follows the host's light/dark theme (N7).
 *
 * `T.bg1` is the string `var(--cec-bg1)`, not a hex. The values live in `ui/theme.ts` and are set
 * once on the root element; see the note there for why this is variables rather than a React
 * context. Nothing here parses or manipulates a colour, which is what makes the swap safe.
 *
 * **A sender's HTML body is NOT themed** — it stays on a white card in dark mode too. Inverting it
 * would alter a business document, and automatic inversion cannot tell a deliberate colour from an
 * incidental one. That is what Outlook and Gmail both do, and it is a frozen decision
 * (docs/design/01-design-decisions.md). `BODY_SURFACE` below is the literal white that enforces it.
 */
import { varName, type Palette } from './theme';

const v = (key: keyof Palette): string => `var(${varName(key)})`;

export const T = {
  // surfaces
  bg1: v('bg1'),
  bg2: v('bg2'),
  bg3: v('bg3'),
  selected: v('selected'),
  brandBg: v('brandBg'),
  brandBg2: v('brandBg2'),

  // text
  fg1: v('fg1'),
  fg2: v('fg2'),
  fg3: v('fg3'),
  fg4: v('fg4'),
  onBrand: v('onBrand'),

  // strokes
  stroke1: v('stroke1'),
  stroke2: v('stroke2'),
  stroke3: v('stroke3'),
  brandStroke2: v('brandStroke2'),
  focus: v('focus'),

  // accents
  link: v('link'),
  incoming: v('incoming'),
  outgoing: v('outgoing'),
  warnBg: v('warnBg'),
  warnBg2: v('warnBg2'),
  parentEdge: v('parentEdge'),
  warnStroke: v('warnStroke'),
  warnFg: v('warnFg'),
  dangerBg: v('dangerBg'),
  dangerStroke: v('dangerStroke'),
  dangerFg: v('dangerFg'),
  okBg: v('okBg'),
  okFg: v('okFg'),

  // avatar fills, muted, matching the real form's palette
  avatarViolet: { bg: v('avatarVioletBg'), fg: v('avatarVioletFg') },
  avatarRed: { bg: v('avatarRedBg'), fg: v('avatarRedFg') },
  avatarGold: { bg: v('avatarGoldBg'), fg: v('avatarGoldFg') },
  avatarNeutral: { bg: v('avatarNeutralBg'), fg: v('avatarNeutralFg') },

  // type
  font: "'Segoe UI', 'Segoe UI Web (West European)', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', sans-serif",
  mono: "Consolas, 'Courier New', monospace",
} as const;

/**
 * The surface a sender's HTML renders on. **A literal, never a themed token.**
 *
 * Mail arrives written for a white background — black text, white-background logos, tables with
 * light borders. Rendering it on a dark surface makes a proportion of real messages unreadable,
 * and inverting it rewrites documents people rely on.
 */
export const BODY_SURFACE = '#ffffff';
/** Text on `BODY_SURFACE`, for the chrome we add around a body (folds, rules). */
export const BODY_SURFACE_FG = '#242424';
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
