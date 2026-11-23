/**
 * The compose body editor — TinyMCE 8, bundled with the control (S17, 2026-11-23).
 *
 * Why bundled TinyMCE: the standard Rich Text Editor is a poor experience and hosting the draft's
 * email form inside compose is slow (S16). TinyMCE stores plain HTML and keeps what mail is made of
 * — tables, `bgcolor`/`align`, fonts, colours, `cid:` images — where TipTap and CKEditor's schema
 * rewrote or dropped it (S14, S17). The price is size (~+450 KiB gzipped); the licence is GPL-2.0-or-later,
 * which is why this repository is open source.
 *
 * Everything TinyMCE-shaped lives in THIS file; `ui/Editor.tsx` sees only `RichTextInstance`, which
 * is also what tests replace.
 *
 * Skin and content CSS are bundled as modules (`skin.js` / `content.js` register themselves with
 * TinyMCE), so nothing is fetched from a path — a PCF has nowhere to serve static files from.
 */
import tinymce from 'tinymce/tinymce';
import 'tinymce/models/dom/model';
import 'tinymce/themes/silver/theme';
import 'tinymce/icons/default/icons';
import 'tinymce/plugins/lists';
import 'tinymce/plugins/link';
import 'tinymce/plugins/table';
import 'tinymce/plugins/image';
import 'tinymce/skins/ui/oxide/skin.js';
import 'tinymce/skins/ui/oxide/content.js';
import 'tinymce/skins/content/default/content.js';

/** What `ui/Editor.tsx` needs from an editor — and all a test double has to provide. */
export interface RichTextInstance {
  getHTML(): string;
  /** Replaces the whole content. Does not count as the agent typing. */
  setHTML(html: string): void;
  /** Inserts at the cursor. */
  insertHTML(html: string): void;
  /** Inserts at the very start of the content. */
  insertAtStart(html: string): void;
  focus(): void;
  /** One step of the editor's own history. */
  undo(): void;
  /** Has no text (an image alone counts as empty, as before). */
  isEmpty(): boolean;
  setDisabled(disabled: boolean): void;
  /** Gives the editor this much height, toolbar included. */
  resize(heightPx: number): void;
  /** The agent changed the content — typed, pasted, formatted, undone. */
  onChange(listener: () => void): void;
  destroy(): void;
}

export interface RichTextOptions {
  /** Accessible name for the editable. */
  label: string;
  /** Starting height in px; `resize` takes over once the host is measured. */
  height: number;
}

/** The toolbar: what an agent answering a customer uses. */
const TOOLBAR = 'undo redo | bold italic underline | bullist numlist | link table image | removeformat';

export async function createRichText(host: HTMLElement, html: string, options: RichTextOptions): Promise<RichTextInstance> {
  const target = document.createElement('div');
  host.appendChild(target);
  const [editor] = await tinymce.init({
    target,
    license_key: 'gpl',
    menubar: false,
    statusbar: false,
    resize: false,
    promotion: false,
    height: options.height,
    plugins: 'lists link table image',
    toolbar: TOOLBAR,
    toolbar_mode: 'wrap',
    // Mail HTML is what it is: keep the attributes it relies on. TinyMCE's own sanitiser still
    // removes scripts and event handlers.
    extended_valid_elements: '*[*]',
    // Pasted images arrive as inline data: images, as before; no upload endpoint exists.
    paste_data_images: true,
    automatic_uploads: false,
    // A quoted reply and a signature are ordinary HTML here, not special blocks.
    entity_encoding: 'raw',
    // The editable's accessible name.
    iframe_aria_text: options.label,
    setup: (e) => { e.on('init', () => e.getBody().setAttribute('aria-label', options.label)); },
  });
  editor.setContent(html);
  editor.undoManager.clear();
  editor.undoManager.add();

  let silent = false;
  const listeners: (() => void)[] = [];
  const fire = () => { if (!silent) listeners.forEach((l) => l()); };
  editor.on('input Change Undo Redo ExecCommand', fire);

  const write = (fn: () => void) => { silent = true; try { fn(); } finally { silent = false; } };
  return {
    getHTML: () => editor.getContent(),
    setHTML: (next) => { write(() => { editor.setContent(next); editor.undoManager.add(); }); },
    insertHTML: (snippet) => { editor.focus(); editor.insertContent(snippet); },
    insertAtStart: (snippet) => {
      editor.focus();
      editor.selection.setCursorLocation(editor.getBody(), 0);
      editor.insertContent(snippet);
    },
    focus: () => editor.focus(),
    undo: () => { editor.undoManager.undo(); },
    isEmpty: () => (editor.getBody().textContent ?? '').trim().length === 0,
    setDisabled: (disabled) => { editor.mode.set(disabled ? 'readonly' : 'design'); },
    resize: (heightPx) => { editor.getContainer().style.height = `${heightPx}px`; },
    onChange: (listener) => { listeners.push(listener); },
    destroy: () => { try { editor.remove(); } catch { /* already gone with its host */ } },
  };
}
