import * as React from 'react';
import { Editor as TiptapEditor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { T } from './tokens';

/**
 * The rich-text editor (R11) — TipTap 2, mounted **imperatively**.
 *
 * `@tiptap/react` is not an option: a virtual PCF shares the platform's React 16.14 and those
 * bindings need 17+. So the core is created by hand into a ref'd div and destroyed on unmount.
 * That is the documented pattern for this project (S10/S13); do not reach for the React wrapper.
 *
 * **TipTap 2, not 3.** v3's extensions carry an `@jsxImportSource` pragma that pcf-scripts' Babel
 * refuses under its `classic` JSX runtime — measured, it does not build. The dependency is pinned
 * `^2` and moving it is a build-breaking change, not a version bump.
 *
 * **The inherited quote never arrives here.** This component only ever holds the agent's new text;
 * the quote is rendered read-only beneath it and concatenated at send. See `domain/compose.ts`.
 */

export interface EditorHandle {
  /** The new text as HTML. Never includes the quote. */
  getHTML(): string;
  focus(): void;
  /** Inserts at the cursor — templates and Copilot drafts (R14/R19) land here, not in the quote. */
  insertHTML(html: string): void;
  /** Replaces the new text wholesale. Used by "Replace" on a template, never by "Insert". */
  setHTML(html: string): void;
  isEmpty(): boolean;
}

export interface EditorProps {
  /** Initial new text — a signature (R15), or a restored draft. */
  initialHtml?: string;
  onChange?: (html: string, isEmpty: boolean) => void;
  /** Reports the content's pixel height so the shell can grow the docked surface (R10). */
  onHeightChange?: (contentHeight: number) => void;
  ariaLabel: string;
  /** Locked while a send is in flight — the surface stays visible, per the spec. */
  disabled?: boolean;
}

export const Editor = React.forwardRef<EditorHandle, EditorProps>((props, ref) => {
  const { initialHtml, onChange, onHeightChange, ariaLabel, disabled } = props;

  const hostRef = React.useRef<HTMLDivElement>(null);
  const editorRef = React.useRef<TiptapEditor | null>(null);

  // Held in refs for the same reason `onStateChange` is in EmailClientRoot: these arrive as fresh
  // closures every render, and TipTap's handlers are registered ONCE at construction. Depending on
  // their identity would mean recreating the editor on every keystroke — which loses the cursor.
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const onHeightRef = React.useRef(onHeightChange);
  onHeightRef.current = onHeightChange;
  const initialRef = React.useRef(initialHtml);

  React.useImperativeHandle(ref, (): EditorHandle => ({
    getHTML: () => editorRef.current?.getHTML() ?? '',
    focus: () => editorRef.current?.commands.focus(),
    insertHTML: (html) => { editorRef.current?.commands.insertContent(html); },
    setHTML: (html) => { editorRef.current?.commands.setContent(html); },
    isEmpty: () => editorRef.current?.isEmpty ?? true,
  }), []);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const editor = new TiptapEditor({
      element: host,
      extensions: [
        StarterKit.configure({
          // No headings in a reply: a mail client is not a document editor, and an <h1> in an
          // email body renders at wildly different sizes in different clients.
          heading: false,
          // The quote is ours to manage (R12) — an agent inserting a blockquote would put markup
          // in the new text that our own splitter looks for.
          blockquote: false,
          codeBlock: false,
          horizontalRule: false,
        }),
        Link.configure({
          openOnClick: false,
          // Matches the sanitiser's allow-list: anything it would strip on the way back in should
          // not be creatable on the way out.
          protocols: ['http', 'https', 'mailto'],
          HTMLAttributes: { rel: 'noopener noreferrer' },
        }),
      ],
      content: initialRef.current ?? '',
      editable: !disabled,
      onUpdate: ({ editor: e }) => {
        onChangeRef.current?.(e.getHTML(), e.isEmpty);
        onHeightRef.current?.(host.scrollHeight);
      },
    });

    editorRef.current = editor;
    onHeightRef.current?.(host.scrollHeight);

    return () => {
      // Destroy, always. A TipTap instance holds ProseMirror plugins and DOM listeners; leaking
      // one per compose-open would accumulate for the life of the session, and CSW sessions are
      // long-lived.
      editor.destroy();
      editorRef.current = null;
    };
    // Constructed ONCE. `initialHtml` is read from a ref so changing it does not rebuild the
    // editor and throw away what the agent has typed.
  }, []);

  // `editable` is a runtime setting, not a construction argument, so it can change without a
  // rebuild.
  React.useEffect(() => {
    editorRef.current?.setEditable(!disabled);
  }, [disabled]);

  return (
    <div
      ref={hostRef}
      aria-label={ariaLabel}
      style={{
        flexGrow: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '8px 10px',
        boxSizing: 'border-box',
        background: T.bg1,
        color: T.fg1,
        font: `400 14px/20px ${T.font}`,
        cursor: disabled ? 'default' : 'text',
        opacity: disabled ? 0.6 : 1,
      }}
    />
  );
});

Editor.displayName = 'Editor';
