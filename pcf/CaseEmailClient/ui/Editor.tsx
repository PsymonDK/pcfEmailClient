import * as React from 'react';
import { T } from './tokens';
import { splitQuotedHistory } from '../domain/quoting';
import {
  disposeEmailForm, formComponentAvailable, mountEmailForm, type EmailFormContext, type FormComponent,
} from '../host/emailForm';

/**
 * The compose editor (R11) — **the draft email's own form, inside compose**.
 *
 * Decided 2026-10-02 after S16 (`docs/research/06-spikes.md`): the body is the draft row shown on
 * our "compose body" email form through the platform's form component (`host/emailForm.ts`). The
 * editor inside is the Dynamics rich text editor running on a genuine email form, so agents get
 * Draft with Copilot, Translate and Adjust with Copilot, templates and pasted Outlook/Word content
 * keep their formatting, and the toolbar comes from our own config file.
 *
 * **The form owns the body.** It loads the saved row and saves it — `save()` below; our own draft
 * saves write only subject and recipients once the row exists (`DraftArgs.omitBody`). So:
 * - the row must exist before this mounts — compose creates it when it opens;
 * - "is there anything to keep or send" is whether the body changed since the form loaded it
 *   (`hasChanges`), not a split of the body — measured, Copilot's *Keep it* inserts at the very
 *   start of the body, which on a reply is inside our quote container;
 * - the quote is in the editor, as on the standard email form. R12 still governs the body we
 *   build for the first save; after that the body is the form's.
 *
 * **There is no second editor.** When the form or its editor cannot load, this reports
 * `onUnavailable` and compose offers the standard email form instead.
 */

export interface EditorHandle {
  /** The whole body as HTML — new text AND quote. The form owns it. */
  getHTML(): string;
  focus(): void;
  /** Inserts at the cursor — templates land here. */
  insertHTML(html: string): void;
  /**
   * Replaces the agent's new text, keeping the quote.
   *
   * `asEdit` says whether this counts as the agent editing: a template "Replace" passes `true`;
   * our own signature reseed passes nothing and stays silent (M15).
   */
  setHTML(html: string, asEdit?: boolean): void;
  isEmpty(): boolean;
  /** Inserts at the very START of the body — above the signature (R22 "fill"). */
  insertHTMLAtStart(html: string): void;
  /** One step of the editor's own history — the Undo on the "Inserted template" bar (R22). */
  undo(): void;
  /** Has the body changed since the form loaded it? What "worth keeping / sending" means here. */
  hasChanges(): boolean;
  /** Saves the body through the form. Our own saves never write it once the row exists. */
  save(): Promise<void>;
}

/** The form plus the editor initialising inside it; past this, the editor is reported unavailable. */
export const READY_TIMEOUT_MS = 20_000;

export type UnavailableReason = 'no-form-component' | 'mount-failed' | 'timeout' | 'read-only';

/** The subset of CKEditor 5's public API used below — and all a test double has to provide. */
interface CkEditor {
  isReadOnly: boolean;
  getData(): string;
  setData(html: string): void;
  data: { parse(html: string): unknown };
  model: {
    change(callback: (writer: { setSelection(root: unknown, offset: number): void }) => void): void;
    insertContent(content: unknown): void;
    document: { getRoot(): unknown; on(event: 'change:data', callback: () => void): void };
  };
  editing: {
    view: {
      focus(): void;
      change(callback: (writer: { setStyle(name: string, value: string, element: unknown): void }) => void): void;
      document: { getRoot(): unknown };
    };
  };
  execute(command: string): void;
  enableReadOnlyMode?(lockId: string): void;
  disableReadOnlyMode?(lockId: string): void;
}

/** CKEditor 5 exposes its instance on the editable element — its documented debugging hook. */
function findEditor(host: HTMLElement): { editable: HTMLElement; editor: CkEditor } | undefined {
  for (const editable of Array.from(host.querySelectorAll<HTMLElement>('.ck-editor__editable'))) {
    const editor = (editable as unknown as { ckeditorInstance?: CkEditor }).ckeditorInstance;
    if (editor) return { editable, editor };
  }
  return undefined;
}

const SENDING_LOCK = 'cec-sending';
/** The editable never shrinks below this, however much the rows around it take. */
export const MIN_EDITABLE_HEIGHT = 80;
/** Space the form keeps under its editor, so the editable stops short of the host's edge. */
const FORM_BOTTOM_GUTTER = 12;
const norm = (html: string) => html.replace(/\s+/g, ' ').trim();

export interface EditorProps {
  /** The draft row the form shows. It must exist — compose creates it on open. */
  emailId: string;
  /** What the editor's Copilot reads about the email (`OpenEmailInfo`). */
  context: EmailFormContext;
  onChange?: () => void;
  ariaLabel: string;
  /** Locked while a send is in flight — the surface stays visible, per the spec. */
  disabled?: boolean;
  /** The form or its editor could not load — compose offers the standard email form. */
  onUnavailable?: (reason: UnavailableReason) => void;
}

export const Editor = React.forwardRef<EditorHandle, EditorProps>((props, ref) => {
  const { emailId, context, onChange, ariaLabel, disabled, onUnavailable } = props;
  const hostRef = React.useRef<HTMLDivElement>(null);
  const editorRef = React.useRef<CkEditor | null>(null);
  const editableRef = React.useRef<HTMLElement | null>(null);
  const formRef = React.useRef<FormComponent>();
  /** The body as the form loaded it — what `hasChanges` compares with. */
  const loaded = React.useRef<string>();
  /** The body as last saved through the form — what closing compares with. */
  const saved = React.useRef<string>();
  /** True while WE write, so our own writes do not look like the agent editing. */
  const silent = React.useRef(false);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'unavailable'>('loading');

  // Fresh closures every render; the editor's listeners are registered once. Read through refs.
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const onUnavailableRef = React.useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  const contextRef = React.useRef(context);
  contextRef.current = context;

  React.useImperativeHandle(ref, (): EditorHandle => ({
    getHTML: () => editorRef.current?.getData() ?? '',
    focus: () => editorRef.current?.editing.view.focus(),
    insertHTML: (html) => {
      const e = editorRef.current;
      if (e) e.model.insertContent(e.data.parse(html));
    },
    insertHTMLAtStart: (html) => {
      const e = editorRef.current;
      if (!e) return;
      e.model.change((writer) => writer.setSelection(e.model.document.getRoot(), 0));
      e.model.insertContent(e.data.parse(html));
    },
    setHTML: (html, asEdit = false) => {
      const e = editorRef.current;
      if (!e) return;
      const { quotedHtml } = splitQuotedHistory(e.getData());
      silent.current = !asEdit;
      try { e.setData(html + quotedHtml); } finally { silent.current = false; }
    },
    isEmpty: () => (editableRef.current?.textContent ?? '').trim().length === 0,
    undo: () => editorRef.current?.execute('undo'),
    hasChanges: () => {
      const e = editorRef.current;
      return !!e && loaded.current !== undefined && norm(e.getData()) !== norm(loaded.current);
    },
    save: async () => {
      await formRef.current?.save?.();
      // Saved: closing must not save again — after Send that would write to a sent email.
      const e = editorRef.current;
      if (e) saved.current = e.getData();
    },
  }), []);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const fail = (reason: UnavailableReason) => {
      setStatus('unavailable');
      onUnavailableRef.current?.(reason);
    };
    if (!formComponentAvailable()) {
      fail('no-form-component');
      return undefined;
    }

    let cancelled = false;
    let component: FormComponent | undefined;

    const listened = new WeakSet<object>();
    const listen = (editor: CkEditor) => {
      if (listened.has(editor)) return;
      listened.add(editor);
      editor.model.document.on('change:data', () => {
        if (!silent.current) onChangeRef.current?.();
      });
    };

    // Fill the host. The editable's height is FIXED by our config (`height`) and the form lays
    // itself out around it, so give the editable whatever the host has left below it. Set through
    // CKEditor's view (the documented way to size an editable), as a delta on the current value.
    const fit = () => {
      const editor = editorRef.current;
      const editable = editableRef.current;
      if (!editor || !editable) return;
      const current = parseFloat(editable.style.height) || editable.getBoundingClientRect().height;
      const room = host.getBoundingClientRect().bottom - FORM_BOTTOM_GUTTER - editable.getBoundingClientRect().bottom;
      const next = Math.max(MIN_EDITABLE_HEIGHT, Math.floor(current + room));
      if (Math.abs(next - current) < 1) return;
      editor.editing.view.change((writer) => writer.setStyle('height', `${next}px`, editor.editing.view.document.getRoot()));
    };
    let resize: ResizeObserver | undefined;

    const started = Date.now();
    let sawReadOnly = false;
    let follow: number | undefined;
    /** True once the editor is ready (or given up on). Checked every 100 ms. */
    const check = (): boolean => {
      if (cancelled) return true;
      const found = findEditor(host);
      if (found && !found.editor.isReadOnly) {
        editorRef.current = found.editor;
        editableRef.current = found.editable;
        loaded.current = found.editor.getData();
        saved.current = loaded.current;
        listen(found.editor);
        // Measured: the form rebuilds its editor after loading (Copilot's initializer re-creates
        // it), and a listener on the first instance hears nothing. Follow the current one.
        follow = window.setInterval(() => {
          const now = findEditor(host);
          if (!now || now.editor === editorRef.current) return;
          editorRef.current = now.editor;
          editableRef.current = now.editable;
          listen(now.editor);
          fit();
        }, 500);
        if (typeof ResizeObserver !== 'undefined') {
          resize = new ResizeObserver(fit);
          resize.observe(host);
        }
        fit();
        setStatus('ready');
        return true;
      }
      if (found?.editor.isReadOnly) sawReadOnly = true;
      if (Date.now() - started > READY_TIMEOUT_MS) {
        fail(sawReadOnly ? 'read-only' : 'timeout');
        return true;
      }
      return false;
    };
    const poll = window.setInterval(() => { if (check()) window.clearInterval(poll); }, 100);
    mountEmailForm(host, emailId, contextRef.current)
      .then((c) => {
        if (cancelled) { disposeEmailForm(c, false); return undefined; }
        component = c;
        formRef.current = c;
        // Look at once rather than at the next tick: an edit made before the first check would
        // otherwise go unheard.
        if (check()) window.clearInterval(poll);
        return undefined;
      })
      .catch((e: unknown) => {
        window.clearInterval(poll);
        console.warn('The compose body form could not be mounted', e);
        fail('mount-failed');
      });

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(follow);
      resize?.disconnect();
      // Read before clearing: closing saves the body if it changed since its last save.
      const last = editorRef.current;
      const dirty = !!last && saved.current !== undefined && norm(last.getData()) !== norm(saved.current);
      editorRef.current = null;
      editableRef.current = null;
      formRef.current = undefined;
      disposeEmailForm(component, dirty);
    };
    // Mounted ONCE per draft row — `Compose` keys the editor by it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const e = editorRef.current;
    if (!e || status !== 'ready') return;
    if (disabled) e.enableReadOnlyMode?.(SENDING_LOCK);
    else e.disableReadOnlyMode?.(SENDING_LOCK);
  }, [disabled, status]);

  return (
    <div
      ref={hostRef}
      aria-label={ariaLabel}
      aria-busy={status === 'loading'}
      style={{
        // Takes every pixel the fixed rows leave; `fit` hands them to the editable.
        flex: '1 1 0',
        minHeight: `${MIN_EDITABLE_HEIGHT + 48}px`,
        overflow: 'auto',
        whiteSpace: 'normal',
        display: status === 'unavailable' ? 'none' : 'block',
        background: T.bg1,
        opacity: disabled ? 0.6 : 1,
      }}
    />
  );
});

Editor.displayName = 'Editor';
