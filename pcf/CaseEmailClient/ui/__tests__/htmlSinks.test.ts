import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * Every `dangerouslySetInnerHTML` in the UI, and what it is allowed to render.
 *
 * There is no iframe: sender HTML lands in the host document, with the agent's authenticated
 * Dynamics session behind it. C1 (2026-09-28) was exactly this — the compose quote rendered the
 * sender's raw body while the reading pane, one component away, sanitised correctly. A grep is
 * crude, but the failure it guards against is a single forgotten call, and a new sink must be
 * justified here before it can ship.
 *
 * Each entry names the file and the expression rendered. Adding one means showing, in review,
 * that the expression has been through `sanitiseEmailBody`.
 */
const ALLOWED_SINKS: Record<string, string[]> = {
  // `html` is the output of BodyFrame's sanitise → split → strip pipeline.
  'BodyFrame.tsx': ['html'],
  // `safeQuote` is sanitised at render; `preview.html` is sanitised when the template resolves.
  'Compose.tsx': ['safeQuote', 'preview.html'],
};

describe('HTML sinks', () => {
  it('renders HTML only from expressions known to be sanitised', () => {
    const dir = new URL('../', import.meta.url);
    const found: Record<string, string[]> = {};
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
      const source = readFileSync(new URL(file, dir), 'utf8');
      for (const m of source.matchAll(/dangerouslySetInnerHTML=\{\{\s*__html:\s*([^}]+?)\s*\}\}/g)) {
        (found[file] ??= []).push(m[1]);
      }
    }
    expect(found).toEqual(ALLOWED_SINKS);
  });
});
