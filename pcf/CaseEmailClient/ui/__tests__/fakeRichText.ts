/**
 * A stand-in for `host/richText.ts` — jsdom cannot run TinyMCE (it needs a real iframe and
 * layout), so shell tests replace the module with this. It is a contenteditable `div` that
 * implements exactly `RichTextInstance`; anything `ui/Editor.tsx` starts calling that is not here
 * fails loudly.
 *
 * The test-only members (`type`, `replaceAll`) stand in for the agent: they change the content and
 * fire the change listener, which `setHTML` — our own writes — deliberately does not.
 */
import type { RichTextInstance, RichTextOptions } from '../../host/richText';

export interface FakeRichText extends RichTextInstance {
  /** The agent types: appends and fires `onChange`. */
  type(html: string): void;
  /** The agent replaces everything (select all, paste): fires `onChange`. */
  replaceAll(html: string): void;
}

export const fakeRichText = {
  /** `createRichText` rejects, as when TinyMCE cannot start. */
  fail: false,
  /** Editors currently mounted. */
  live: 0,
  /** The body each editor was opened with, in order. */
  openedWith: [] as string[],
  reset(): void { this.fail = false; this.live = 0; this.openedWith = []; },
};

export function createRichText(host: HTMLElement, html: string, _options: RichTextOptions): Promise<RichTextInstance> {
  if (fakeRichText.fail) return Promise.reject(new Error('TinyMCE could not start'));
  fakeRichText.openedWith.push(html);
  const editable = document.createElement('div');
  editable.className = 'rt-editable';
  editable.setAttribute('contenteditable', 'true');
  editable.innerHTML = html;
  host.appendChild(editable);
  fakeRichText.live += 1;

  const listeners: (() => void)[] = [];
  const history: string[] = [];
  const changed = () => listeners.forEach((l) => l());
  const remember = () => history.push(editable.innerHTML);

  const instance: FakeRichText = {
    getHTML: () => editable.innerHTML,
    setHTML: (next) => { remember(); editable.innerHTML = next; },
    insertHTML: (snippet) => { remember(); editable.innerHTML += snippet; changed(); },
    insertAtStart: (snippet) => { remember(); editable.innerHTML = snippet + editable.innerHTML; changed(); },
    focus: () => editable.focus(),
    undo: () => { if (history.length > 0) { editable.innerHTML = history.pop()!; changed(); } },
    isEmpty: () => (editable.textContent ?? '').trim().length === 0,
    setDisabled: (disabled) => editable.setAttribute('contenteditable', disabled ? 'false' : 'true'),
    resize: (px) => { editable.style.height = `${px}px`; },
    onChange: (listener) => { listeners.push(listener); },
    destroy: () => {
      if (editable.parentNode) { editable.remove(); fakeRichText.live -= 1; }
    },
    type: (snippet) => {
      remember();
      const html = editable.innerHTML;
      const at = html.indexOf('<div id="divRplyFwdMsg"');
      // The agent writes ABOVE the quote, as in a real reply.
      editable.innerHTML = at < 0 ? html + snippet : html.slice(0, at) + snippet + html.slice(at);
      changed();
    },
    replaceAll: (next) => { remember(); editable.innerHTML = next; changed(); },
  };
  (editable as unknown as { rt: FakeRichText }).rt = instance;
  return Promise.resolve(instance);
}
