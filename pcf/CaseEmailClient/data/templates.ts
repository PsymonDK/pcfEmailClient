import { assertGuid, type WebApiLike } from './emailQueries';
import { normaliseWebApiError, type NormalisedError } from './errors';
import { prepareTemplate, type PreparedTemplate } from '../domain/templateContent';

/**
 * Email templates for a Case (R14).
 *
 * **Listing** goes through `context.webAPI` like everything else. **Instantiating** cannot:
 * `InstantiateTemplate` is an unbound action and `context.webAPI` exposes no `execute`, so it
 * goes through `window.Xrm.WebApi.online.execute` with a hand-built `getMetadata()`. That is the
 * documented escape hatch for this project and the only one; see CLAUDE.md.
 *
 * **Never write `email.templateid`** — it is documented "for internal use only". Resolving the
 * content and inserting it is the supported path.
 */

/** Templates are typed per entity; only `incident` ones can be instantiated against a Case. */
export const CASE_TEMPLATE_TYPE = 'incident';

export interface EmailTemplate {
  templateId: string;
  title: string;
  /** The unresolved subject, for the picker. The resolved one comes from instantiation. */
  subject: string;
}

export function buildTemplateListQuery(): string {
  return (
    '?$select=templateid,title,subject'
    + `&$filter=templatetypecode eq '${CASE_TEMPLATE_TYPE}'`
    + '&$orderby=title asc'
  );
}

/**
 * Templates that apply to a Case.
 *
 * Filtered to `incident` because `InstantiateTemplate` requires `ObjectType` to match the
 * template's own type — offering an agent a `contact` template they cannot use would be a menu of
 * errors. Measured: this environment has 5 incident templates out of 49, and `templatetypecode`
 * **is** filterable over the Web API.
 *
 * Returns an empty list on failure rather than throwing: templates are a convenience, and losing
 * them must not cost the agent the ability to write a reply.
 */
export async function fetchCaseTemplates(
  webApi: WebApiLike,
): Promise<{ templates: EmailTemplate[]; error?: NormalisedError }> {
  try {
    const page = await webApi.retrieveMultipleRecords('template', buildTemplateListQuery(), 100);
    return {
      templates: page.entities.map((row) => ({
        // These come back as `unknown`; `String(x)` on an object yields "[object Object]",
        // which would put that text in the picker rather than failing visibly.
        templateId: typeof row.templateid === 'string' ? row.templateid : '',
        title: typeof row.title === 'string' && row.title.length > 0 ? row.title : '(untitled)',
        subject: typeof row.subject === 'string' ? row.subject : '',
      })).filter((t) => t.templateId.length > 0),
    };
  } catch (rejection) {
    return { templates: [], error: normaliseWebApiError(rejection) };
  }
}

/** The `Xrm.WebApi.online.execute` surface, narrowed to what this file uses. */
export type XrmExecute = (request: unknown) => Promise<{ json(): Promise<unknown> }>;

/**
 * Resolves a template against a Case, server-side.
 *
 * Tokens are filled by the platform — verified against the real action: the probe came back with
 * the customer name and case number substituted. Anything it could NOT fill is returned in
 * `unresolved` so the agent sees it, rather than a customer receiving `{!Case:Title;}`.
 */
export async function instantiateTemplate(
  execute: XrmExecute,
  templateId: string,
  caseId: string,
): Promise<{ template?: PreparedTemplate; error?: NormalisedError }> {
  try {
    assertGuid(templateId, 'templateId');
    assertGuid(caseId, 'caseId');
  } catch (e) {
    return { error: { message: e instanceof Error ? e.message : 'Invalid id', raw: e } };
  }

  // The metadata object is hand-built because there is no typed helper for unbound actions in
  // PCF. `operationType: 0` is Action, `boundParameter: null` makes it unbound.
  //
  // **Every parameter is `Edm.String`, including the two GUIDs.** Declaring them `Edm.Guid` — the
  // obviously correct choice, and what the action's own signature says — fails with
  // *"Error identified in Payload provided by the user for Entity :''"*, which names neither the
  // parameter nor the type. Measured in the published app on 2026-09-23 by running all three
  // variants against the live host: `Edm.Guid` fails, `Edm.String` returns subject and
  // description. `Xrm.WebApi.online.execute` evidently serialises Guid parameters in a shape this
  // action rejects. The raw Web API accepts either, which is why this only shows up in the client.
  const request = {
    TemplateId: templateId.replace(/^\{|\}$/g, ''),
    ObjectType: 'incident',
    ObjectId: caseId.replace(/^\{|\}$/g, ''),
    getMetadata: () => ({
      boundParameter: null,
      parameterTypes: {
        TemplateId: { typeName: 'Edm.String', structuralProperty: 1 },
        ObjectType: { typeName: 'Edm.String', structuralProperty: 1 },
        ObjectId: { typeName: 'Edm.String', structuralProperty: 1 },
      },
      operationType: 0,
      operationName: 'InstantiateTemplate',
    }),
  };

  try {
    const response = await execute(request);
    const payload = await response.json() as { value?: { subject?: string; description?: string }[] };
    const first = payload.value?.[0];
    if (!first) {
      return {
        error: {
          message: 'The template resolved to nothing. It may not apply to this case.',
          raw: payload,
        },
      };
    }
    return { template: prepareTemplate(first.subject, first.description) };
  } catch (rejection) {
    return { error: normaliseWebApiError(rejection) };
  }
}

/**
 * `Xrm.WebApi.online.execute`, or `undefined` where it is not reachable.
 *
 * Confined here so exactly one place knows this is the global escape hatch. Returning `undefined`
 * rather than throwing lets the caller disable templates and keep composing, which is the right
 * failure for a convenience feature.
 */
export function resolveXrmExecute(): XrmExecute | undefined {
  // `window` always exists in a PCF, but this function's whole contract is "returns undefined
  // when the escape hatch is unreachable" — and throwing a ReferenceError is not that. Being
  // total also lets the no-execute branch of its callers be tested outside a DOM.
  if (typeof window === 'undefined') return undefined;
  const xrm = (window as unknown as Record<string, unknown>).Xrm as
    | { WebApi?: { online?: { execute?: unknown } } }
    | undefined;
  const execute = xrm?.WebApi?.online?.execute;
  return typeof execute === 'function'
    ? (execute as XrmExecute).bind(xrm?.WebApi?.online)
    : undefined;
}
