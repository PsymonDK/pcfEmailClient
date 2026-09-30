import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * N3 (2026-09-30): the SOLUTION version travels with the control version.
 *
 * A managed solution upgrades by its own `<Version>`, not by the control's. Until now the control
 * had been bumped 26 times while the solution stayed at `1.0` — harmless for the unmanaged dev
 * imports, but a managed release built that way would carry a new control under an unchanged
 * solution version, which a target environment does not treat as an upgrade. Bump both, always:
 * this fails the moment they drift.
 */
const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('release versions', () => {
  it('the solution version is the control version', () => {
    const control = /<control [^>]*version="(\d+\.\d+\.\d+)"/.exec(read('../../ControlManifest.Input.xml'))?.[1];
    const solution = /<Version>(\d+\.\d+\.\d+)(?:\.\d+)?<\/Version>/.exec(read('../../../../solution/src/Other/Solution.xml'))?.[1];
    expect(control).toBeDefined();
    expect(solution).toBe(control);
  });

  it('dev stays UNMANAGED: the project must not default to a managed package', () => {
    // CLAUDE.md: leaving SolutionPackageType out silently defaults to Managed, which is how a
    // managed solution first got into the dev environment. Release overrides it on the command line.
    expect(read('../../../../solution/solution.cdsproj')).toMatch(/<SolutionPackageType>Unmanaged<\/SolutionPackageType>/);
  });
});
