/**
 * The compose body: the draft email on a REAL email form, rendered inside our compose (S16,
 * 2026-10-02; `docs/research/06-spikes.md`).
 *
 * Why a form and not the bare editor: the Dynamics editor decides whether to load Draft with
 * Copilot from its host — `parentEntity.typeName === "email"` — and the bare editor hosted through
 * `context.factory` inherits the CASE's context, so Copilot drafting never loads (S15). On a
 * genuine email form it does, and so do Translate and Adjust with Copilot.
 *
 * **The mechanism is the platform's form component** — what the documented form component control
 * (`MscrmControls.ModelForm.ModelFormControl`) is a 5.6 KB shim over: `window._getModelFormComponent()`
 * resolves to a class used as `new FormComponent(container, formId, entityType, recordId)` +
 * `render(options, events)`, with `save()` and `dispose()`. UNDOCUMENTED, like the factory members
 * this replaced — confined to this file.
 *
 * Three measured facts this file exists to respect:
 * - A full form component takes the **bare form GUID**. The `<QuickFormIds>` XML the form editor
 *   writes is the quick-view format and parses to no form here.
 * - **`dispose()` does not save.** Closing compose lost Copilot's text until the body was saved
 *   first — see `disposeEmailForm`.
 * - `overrideXrmPageByFormContext` does not repoint the global `Xrm.Page` the editor reads, so the
 *   editor's Copilot toolbox found no Regarding. Its own fallback, `window.OpenEmailInfo`, does:
 *   set before render, removed on dispose (authorised by the product owner, 2026-10-01).
 */

/**
 * "Case Email Client - compose body" — shipped in the solution. Only Description is visible; From,
 * To, Cc, Bcc, Subject and Regarding are on the form HIDDEN, for form scripts and Copilot; and
 * Description's editor uses our `jhrb_/CaseEmailClient/EmailRTEconfig.js`, customisable after a
 * managed install. Another team's `team_onLoadEmail` sender script is deliberately not on it.
 */
export const COMPOSE_BODY_FORM_ID = '6a39076b-85bd-f111-aaad-000d3ab16615';

/** What the editor's Copilot reads about the email — the draft's real values, from compose. */
export interface EmailFormContext {
  caseId: string;
  caseTitle?: string;
  /** To recipients that name a record. */
  to: { id: string; entityType: string; name: string }[];
  subject: string;
}

/** The form component instance. Untyped and undocumented — the slice this uses. */
export interface FormComponent {
  render(options: Record<string, unknown>, events: Record<string, unknown>): void;
  save?(): Promise<unknown>;
  dispose?(): void;
}
type FormComponentClass = new (container: HTMLElement, formId: string, entityType: string, recordId: string) => FormComponent;
interface FormComponentWindow {
  _getModelFormComponent?: () => Promise<FormComponentClass>;
  OpenEmailInfo?: unknown;
}

const win = (): FormComponentWindow => window as unknown as FormComponentWindow;

/** Does this page offer the form component? Without it compose offers the standard form instead. */
export function formComponentAvailable(): boolean {
  return typeof win()._getModelFormComponent === 'function';
}

/**
 * A form context for `window.OpenEmailInfo`.
 *
 * The editor reads Regarding and To from it when its Copilot toolbox initialises. Template
 * insertion would write the subject through it, so writes are deliberately ignored — our rule is
 * that a template never changes the subject.
 */
export function openEmailFormContext(emailId: string, ctx: EmailFormContext): unknown {
  const braced = (id: string) => `{${id.replace(/[{}]/g, '').toUpperCase()}}`;
  const attr = (name: string, value: unknown) => ({
    getName: () => name, getValue: () => value, setValue: () => undefined,
    addOnChange: () => undefined, removeOnChange: () => undefined, fireOnChange: () => undefined,
  });
  const attrs: Record<string, unknown> = {
    regardingobjectid: attr('regardingobjectid', [{ id: braced(ctx.caseId), entityType: 'incident', name: ctx.caseTitle ?? '' }]),
    to: attr('to', ctx.to.map((p) => ({ id: braced(p.id), entityType: p.entityType, name: p.name }))),
    subject: attr('subject', ctx.subject),
  };
  const get = (name: string) => attrs[name] ?? null;
  return {
    getAttribute: get,
    data: { entity: { attributes: { get }, getId: () => braced(emailId), getEntityName: () => 'email' } },
  };
}

/** Mounts the draft's compose-body form into `host`. */
export async function mountEmailForm(host: HTMLElement, emailId: string, ctx: EmailFormContext): Promise<FormComponent> {
  const get = win()._getModelFormComponent;
  if (typeof get !== 'function') throw new Error('The form component is not available on this page');
  if (!host.id) host.id = `cecComposeBody_${Math.random().toString(16).slice(2)}`;
  const FormComponentCtor = await get();
  // BEFORE render: the editor reads it once, when its Copilot toolbox initialises.
  win().OpenEmailInfo = { formContext: openEmailFormContext(emailId, ctx) };
  const component = new FormComponentCtor(host, COMPOSE_BODY_FORM_ID, 'email', emailId);
  component.render({
    // The switches ModelFormControl reads, after its "true"/"false" parsing.
    displayHeader: false,
    displayCommandbar: false,
    displayBusinessProcessFlow: false,
    displayTabs: false,
    showSectionBordersInSmallViewports: false,
    enableBackground: false,
    enableHighDensityPageHeader: false,
    displayFormSelector: false,
    addToRecentItems: false,
    displayPopoutCommand: false,
    displayNavigateBackCommand: false,
    overrideXrmPageByFormContext: true,
  }, {});
  return component;
}

/**
 * Saves the form if the body changed since its last save, then disposes it and removes
 * `OpenEmailInfo`. Measured: `dispose()` alone does not save.
 */
export function disposeEmailForm(component: FormComponent | undefined, dirty: boolean): void {
  const done = () => {
    try { component?.dispose?.(); } catch { /* already gone with its host */ }
    delete win().OpenEmailInfo;
  };
  if (component?.save && dirty) {
    const save = component.save.bind(component);
    void (async () => {
      try { await save(); } catch (e) { console.warn('Could not save the email body on close', e); }
      done();
    })();
  } else done();
}
