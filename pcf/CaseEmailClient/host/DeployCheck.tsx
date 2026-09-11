import * as React from 'react';
import type { IInputs } from '../generated/ManifestTypes';
import { resolveCaseId } from './caseId';
import { isSanitiserAvailable } from '../domain/sanitise';

/**
 * PHASE 0 SCAFFOLDING — replaced by the real UI in Phase 1.
 *
 * Its only job is to make the deploy loop verifiable. Power Apps Studio actively misreports the
 * two things that matter here — it returns "Method not implemented" for data calls and hands out a
 * DUMMY case id — so the only trustworthy reading comes from the published app, and the only way to
 * get `allocatedHeight` out of the published app is for the control to report it.
 *
 * Everything shown is a fact the build depends on:
 *   - allocatedHeight is expected to be **-1** on both placements, which is why height is claimed
 *     from the viewport rather than inherited.
 *   - the case id must arrive **via contextInfo** on a form host.
 *   - the rendered box proves the claimed height actually materialised.
 *   - init # and state prove the session-switch teardown and `setControlState` round-trip (N1/R16).
 */

export interface DeployCheckProps {
  context: ComponentFramework.Context<IInputs>;
  initCount: number;
  initAt: string;
  stateRestored: boolean;
  restoredProbe?: string;
  onProbeChange: (value: string) => void;
}

interface Box {
  height: number;
  width: number;
  top: number;
  viewport: number;
  claimed: number;
}

const mono = 'Consolas, "Courier New", monospace';

export const DeployCheck: React.FC<DeployCheckProps> = (props) => {
  const { context, initCount, initAt, stateRestored, restoredProbe, onProbeChange } = props;
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [box, setBox] = React.useState<Box | null>(null);
  const [probe, setProbe] = React.useState(restoredProbe ?? '');

  const allocatedHeight = context.mode.allocatedHeight;
  const allocatedWidth = context.mode.allocatedWidth;
  const { id, source } = resolveCaseId(context);

  // The height rule, as the real UI will implement it: honour the host when it gives a number,
  // claim from the viewport when it says -1.
  const claimed = React.useMemo(() => {
    if (allocatedHeight > 0) return allocatedHeight;
    const top = rootRef.current?.getBoundingClientRect().top ?? 0;
    return Math.max(320, Math.floor(window.innerHeight - top - 24));
  }, [allocatedHeight, box?.top]);

  React.useEffect(() => {
    const measure = () => {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setBox({
        height: Math.round(r.height),
        width: Math.round(r.width),
        top: Math.round(r.top),
        viewport: window.innerHeight,
        claimed,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [claimed]);

  const row = (label: string, value: React.ReactNode, emphasis = false) => (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
      <span style={{ color: '#616161', width: '150px', flex: '0 0 150px', fontSize: '12px' }}>{label}</span>
      <span style={{ fontFamily: mono, fontSize: '12px', color: emphasis ? '#0e700e' : '#242424', fontWeight: emphasis ? 600 : 400 }}>
        {value}
      </span>
    </div>
  );

  return (
    <div
      ref={rootRef}
      style={{
        height: allocatedHeight > 0 ? '100%' : `${claimed}px`,
        // WIDTH MUST BE EXPLICIT. Measured 2026-09-11 in the published app: without this the
        // rendered box came out 588px wide inside a full-width tab, because the subgrid cell's
        // ancestors content-size their child. It is the same trap S1 found for height, and it
        // applies on the same hosts — so the rule is "claim both dimensions, inherit neither".
        width: '100%',
        boxSizing: 'border-box',
        overflow: 'auto',
        background: '#ffffff',
        border: '1px solid #e0e0e0',
        borderRadius: '6px',
        padding: '12px 14px',
        fontFamily: "'Segoe UI', 'Segoe UI Web (West European)', sans-serif",
        fontSize: '14px',
        color: '#242424',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <span style={{ fontSize: '16px', fontWeight: 600 }}>Case Email Client</span>
        <span style={{ fontSize: '11px', fontWeight: 600, color: '#115ea3', background: '#ebf3fc', borderRadius: '4px', padding: '2px 7px' }}>
          PHASE 0 — DEPLOY CHECK
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {row('allocatedHeight', String(allocatedHeight), allocatedHeight === -1)}
        {row('allocatedWidth', String(Math.round(allocatedWidth)))}
        {row('case id', id ?? '(unresolved)', !!id)}
        {row('id came from', source, source === 'contextInfo')}
        {row('rendered box', box ? `${box.height}px high x ${box.width}px wide` : 'measuring…', !!box && box.height > 320)}
        {row('claimed from', box ? `viewport ${box.viewport}px, top ${box.top}px -> ${box.claimed}px` : '—')}
        {row('init #', String(initCount), initCount > 1)}
        {row('init at', initAt)}
        {row('state', stateRestored ? 'RESTORED' : 'not restored', stateRestored)}
        {row('sanitiser', isSanitiserAvailable() ? 'available' : 'UNAVAILABLE', isSanitiserAvailable())}
      </div>

      <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <span style={{ fontSize: '12px', color: '#616161' }}>Draft probe — type, switch case session, come back:</span>
        <input
          value={probe}
          onChange={(e) => {
            setProbe(e.target.value);
            onProbeChange(e.target.value);
          }}
          style={{ fontFamily: mono, fontSize: '12px', padding: '4px 6px', border: '1px solid #d1d1d1', borderRadius: '4px', width: '260px' }}
        />
      </div>
    </div>
  );
};
