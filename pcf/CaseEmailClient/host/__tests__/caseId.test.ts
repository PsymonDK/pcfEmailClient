import { describe, it, expect } from 'vitest';
import { resolveCaseId } from '../caseId';
import type { IInputs } from '../../generated/ManifestTypes';

// Encodes measured host behaviour (S2 / S11, 2026-09-10) rather than assumed behaviour, so that
// if someone "simplifies" the fallback away the test says which host breaks.

type Ctx = ComponentFramework.Context<IInputs>;

const ctx = (over: {
  caseIdRaw?: string | null;
  entityId?: string;
  noParameters?: boolean;
  noMode?: boolean;
}): Ctx =>
  ({
    parameters: over.noParameters ? undefined : { caseId: { raw: over.caseIdRaw ?? null } },
    mode: over.noMode ? undefined : { contextInfo: over.entityId ? { entityId: over.entityId } : {} },
  }) as unknown as Ctx;

const CASE = '40a5d940-0ef6-f011-8406-000d3ab7be36'; // the real case S11 measured against

describe('resolveCaseId', () => {
  it('uses contextInfo on a form host — both chosen placements', () => {
    expect(resolveCaseId(ctx({ entityId: CASE }))).toEqual({ id: CASE, source: 'contextInfo' });
  });

  it('prefers the bound property when a custom page supplies one', () => {
    const r = resolveCaseId(ctx({ caseIdRaw: CASE, entityId: 'should-not-win' }));
    expect(r).toEqual({ id: CASE, source: 'property' });
  });

  it('is unresolved in a side pane or under a Control tab template', () => {
    // Both hosts leave contextInfo empty and cannot bind the property. Measured, and the reason
    // the Control route was eliminated on function rather than on support status.
    expect(resolveCaseId(ctx({}))).toEqual({ source: 'unresolved' });
  });

  it('treats an empty-string property as absent rather than as a case id', () => {
    expect(resolveCaseId(ctx({ caseIdRaw: '', entityId: CASE }))).toEqual({ id: CASE, source: 'contextInfo' });
  });

  it('does not throw when the host omits parameters or mode entirely', () => {
    // Defensive: a host that hands us a partial context must produce "unresolved", not a crash
    // that takes the whole tab down.
    expect(resolveCaseId(ctx({ noParameters: true }))).toEqual({ source: 'unresolved' });
    expect(resolveCaseId(ctx({ noMode: true }))).toEqual({ source: 'unresolved' });
  });
});
