/**
 * A stand-in for the platform's form component (`window._getModelFormComponent`) — jsdom has no
 * Dynamics, so shell tests mount this instead of the draft's real email form.
 *
 * Like the real one it shows a ROW: the editable it renders starts with whatever `bodyFor` says the
 * row holds, and `save()` is recorded rather than written. It provides exactly the slice of
 * CKEditor 5's API `ui/Editor.tsx` uses — `getData`, `setData`, `data.parse`,
 * `model.change`/`setSelection`/`insertContent`, `change:data`, `execute('undo')`,
 * `editing.view.change`/`setStyle` — on a plain editable carrying `ckeditorInstance`, the hook the
 * real editor exposes. Anything `Editor.tsx` starts calling that is not here fails loudly.
 */
export interface FakeFormComponent {
  /** The body at each `save()`, in order. */
  saves: string[];
  /** Forms currently mounted. */
  mounted: () => number;
  /** The record id each form was constructed for, in order. */
  records: string[];
  uninstall(): void;
}

interface FakeOptions {
  /** What the row holds when the form loads it. */
  bodyFor: (emailId: string) => string;
  /** The form loads, but its editor never becomes editable. */
  readOnly?: boolean;
  /** `render()` throws. */
  failRender?: boolean;
}

interface Win { _getModelFormComponent?: () => Promise<unknown> }

export function installFakeFormComponent(options: FakeOptions): FakeFormComponent {
  const saves: string[] = [];
  const records: string[] = [];
  let live = 0;

  class FakeForm {
    private editable: HTMLElement | undefined;
    constructor(private readonly container: HTMLElement, _formId: string, _entity: string, private readonly recordId: string) {
      records.push(recordId);
    }

    render(): void {
      if (options.failRender) throw new Error('render failed');
      const editable = document.createElement('div');
      editable.className = 'ck-editor__editable';
      editable.setAttribute('contenteditable', options.readOnly ? 'false' : 'true');
      editable.innerHTML = options.bodyFor(this.recordId);
      const listeners: (() => void)[] = [];
      const history: string[] = [];
      let atStart = false;
      const changed = () => listeners.forEach((l) => l());
      const instance = {
        isReadOnly: options.readOnly === true,
        getData: () => editable.innerHTML,
        setData: (html: string) => { history.push(editable.innerHTML); editable.innerHTML = html; changed(); },
        data: { parse: (html: string) => html },
        model: {
          change: (cb: (w: { setSelection(root: unknown, offset: number): void }) => void) => cb({
            setSelection: (_root, offset) => { atStart = offset === 0; },
          }),
          insertContent: (html: unknown) => {
            history.push(editable.innerHTML);
            editable.innerHTML = atStart ? `${String(html)}${editable.innerHTML}` : `${editable.innerHTML}${String(html)}`;
            atStart = false;
            changed();
          },
          document: { getRoot: () => editable, on: (_event: string, cb: () => void) => { listeners.push(cb); } },
        },
        editing: {
          view: {
            focus: () => editable.focus(),
            change: (cb: (w: { setStyle(name: string, value: string, el: unknown): void }) => void) => cb({
              setStyle: (name, value) => { editable.style.setProperty(name, value); },
            }),
            document: { getRoot: () => editable },
          },
        },
        execute: (command: string) => {
          if (command === 'undo' && history.length > 0) { editable.innerHTML = history.pop()!; changed(); }
        },
        enableReadOnlyMode: () => undefined,
        disableReadOnlyMode: () => undefined,
      };
      (editable as unknown as { ckeditorInstance: unknown }).ckeditorInstance = instance;
      this.container.appendChild(editable);
      this.editable = editable;
      live += 1;
    }

    save(): Promise<void> {
      saves.push(this.editable?.innerHTML ?? '');
      return Promise.resolve();
    }

    dispose(): void {
      if (this.editable) { this.editable.remove(); this.editable = undefined; live -= 1; }
    }
  }

  (window as unknown as Win)._getModelFormComponent = () => Promise.resolve(FakeForm);
  return {
    saves,
    records,
    mounted: () => live,
    uninstall: () => { delete (window as unknown as Win)._getModelFormComponent; },
  };
}
