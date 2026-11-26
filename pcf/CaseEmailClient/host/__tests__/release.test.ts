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

  it('the control is FIELD-bound and the form binds it to a column (S18, 1.45.0)', () => {
    // A <data-set> brings back the platform's subgrid view query before our first request. The
    // control and the form must agree: a bound property on the manifest side, a `title` field cell
    // with a hostField parameter on the form side - never a subgrid.
    const manifest = read('../../ControlManifest.Input.xml').replace(/<!--[\s\S]*?-->/g, '');
    expect(manifest).not.toMatch(/<data-set\b/);
    expect(manifest).toMatch(/<property name="hostField"[^>]*usage="bound"/);
    for (const file of ['{729d9197-cdad-f111-aaac-000d3ab163fb}.xml', '{729d9197-cdad-f111-aaac-000d3ab163fb}_managed.xml']) {
      const form = read(`../../../../solution/src/Entities/Incident/FormXml/main/${file}`);
      expect(form, file).not.toContain('indicationOfSubgrid');
      expect(form, file).toMatch(/datafieldname="title"/);
      expect(form.match(/<hostField>title<\/hostField>/g), file).toHaveLength(3);
    }
  });

  it('dev stays UNMANAGED: the project must not default to a managed package', () => {
    // CLAUDE.md: leaving SolutionPackageType out silently defaults to Managed, which is how a
    // managed solution first got into the dev environment. Release overrides it on the command line.
    expect(read('../../../../solution/solution.cdsproj')).toMatch(/<SolutionPackageType>Unmanaged<\/SolutionPackageType>/);
  });
});
