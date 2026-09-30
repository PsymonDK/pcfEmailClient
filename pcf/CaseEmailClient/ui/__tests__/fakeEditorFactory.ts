import type { PlatformFactory } from '../Editor';

/**
 * A stand-in for `context.factory` hosting the Dynamics editor (#17) — jsdom cannot load the
 * platform control, so shell tests mount this instead.
 *
 * It provides exactly the slice of CKEditor 5's API `ui/Editor.tsx` uses — `getData`, `setData`,
 * `data.parse`, `model.change`/`setSelection`/`insertContent`, `change:data`, `execute('undo')` —
 * on a plain editable element carrying `ckeditorInstance`, the hook the real editor exposes.
 * Anything `Editor.tsx` starts calling that is not here fails loudly in the tests, which is the
 * point: the seam stays narrow.
 */
export function fakeEditorFactory(options: { readOnly?: boolean; throwOnCreate?: boolean } = {}): {
  factory: PlatformFactory;
  mounted: () => number;
} {
  const hosts = new Map<string, HTMLElement>();
  const factory: PlatformFactory = {
    createComponent: (type, id, properties) => {
      if (options.throwOnCreate) throw new Error('createComponent is not available');
      return { type, id, properties };
    },
    bindDOMComponent: (component, host) => {
      const { id, properties } = component as { id: string; properties: { parameters: { value: { Value: string } } } };
      const editable = document.createElement('div');
      editable.className = 'ck-editor__editable';
      editable.setAttribute('contenteditable', options.readOnly ? 'false' : 'true');
      editable.innerHTML = properties.parameters.value.Value ?? '';
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
      host.appendChild(editable);
      hosts.set(id, host);
    },
    unbindDOMComponent: (id) => {
      const host = hosts.get(id);
      if (host) host.innerHTML = '';
      hosts.delete(id);
    },
  };
  return { factory, mounted: () => hosts.size };
}
