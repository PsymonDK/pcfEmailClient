import type { IInputs } from '../generated/ManifestTypes';

/**
 * Where the case id comes from, per host. Measured 2026-09-10 (S2 / S11).
 *
 * Lives outside index.ts because **PCF allows exactly one export from the control source** —
 * `pcf-scripts build` fails with pcf-1023 "Control source code defines more than one export"
 * otherwise.
 */
export type CaseIdSource = 'property' | 'contextInfo' | 'unresolved';

export interface ResolvedCaseId {
  id?: string;
  source: CaseIdSource;
}

/**
 * `context.mode.contextInfo` is **not declared in `@types/powerapps-component-framework`**
 * (^1.3.16 — `Mode` has allocatedHeight, allocatedWidth, isControlDisabled, isVisible, label,
 * setControlState, setFullScreen, trackContainerResize, and nothing else). It is nevertheless
 * present at runtime and is how both chosen placements deliver the record — measured in the
 * published app on 2026-09-10, not inferred.
 *
 * So the untyped surface is declared here, once, and confined to this module. Do not spread
 * `as any` through the codebase to reach it: if the platform ever changes the shape, this is the
 * single place that has to change, and the tests below are what will notice.
 */
interface PlatformContextInfo {
  entityTypeName?: string;
  entityId?: string;
  entityRecordName?: string;
}

type ModeWithContextInfo = ComponentFramework.Mode & {
  contextInfo?: PlatformContextInfo;
};

/**
 * `contextInfo` carries the record on a FORM host, which is both chosen placements: the Case form
 * tab, and a dedicated Case form opened as a session tab by an `Entity record` application tab
 * template.
 *
 * It is EMPTY in an app side pane, in a custom page, and under a `Control` app tab template. Of
 * those, only the custom page can supply the record at all, and it does so as a *page* input the
 * component cannot read — hence the optional `caseId` property, which a custom page binds to
 * `Param("recordId")`. The `Control` template cannot pass it by any route (measured: slug, JSON
 * `data` object, and a literal GUID through `navigateTo` all fail), which is why that host was
 * eliminated on function rather than on its support status.
 *
 * The property is checked first so the fallback host wins when it is actually in use; on both real
 * placements it is unset and `contextInfo` answers.
 */
export function resolveCaseId(context: ComponentFramework.Context<IInputs>): ResolvedCaseId {
  const fromProperty = context.parameters?.caseId?.raw;
  if (fromProperty) return { id: fromProperty, source: 'property' };

  // Studio hands out a DUMMY case id at author time and there is nothing in the value to detect
  // that by. Only the published app tells the truth — never trust a Studio reading of this.
  const mode = context.mode as ModeWithContextInfo | undefined;
  const entityId = mode?.contextInfo?.entityId;
  if (entityId) return { id: entityId, source: 'contextInfo' };

  return { source: 'unresolved' };
}
