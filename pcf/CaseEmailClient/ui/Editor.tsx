import * as React from 'react';
import { T } from './tokens';

/**
 * The compose editor (R11) — **the Dynamics rich text editor**, hosted inside this control.
 *
 * Decided 2026-09-30 (#17, S14; `docs/design/05-platform-editor.md`). The platform's own
 * `MscrmControls.RichTextEditorV2.RichTextEditorControlV2` — Microsoft's licensed CKEditor 5
 * build, the one the standard email form uses — is mounted through `context.factory`. Templates,
 * signatures and pasted Outlook/Word content keep their formatting, and agents get the toolbar
 * they already know. TipTap, which this replaced, dropped tables, fonts, colours, alignment and
 * images on the way in.
 *
 * **What makes it an editor** (measured, S14): a static `value`, **`configUrl`** — our own copy of
 * the email editor's configuration, shipped in the solution and customisable after a managed
 * install — and **`isReadOnly: false`**. Without the config it renders an inert shell (S10's
 * result); without `isReadOnly` it renders read-only.
 *
 * **The risk, confined here:** `createComponent` / `bindDOMComponent` and the parameter shape are
 * UNDOCUMENTED (the typings expose 2 of the factory's 11 members). There is deliberately no second
 * editor to fall back to: when this one cannot become editable, the editor reports
 * `onUnavailable` and compose offers the standard email form instead. Every CKEditor call is in
 * this file, behind `EditorHandle`, so a platform change is fixed in one place.
 *
 * **The inherited quote never arrives here** (R12). This editor only ever holds the agent's new
 * text; the quote is rendered read-only beneath it and concatenated at send.
 */

export interface EditorHandle {
  /** The new text as HTML. Never includes the quote. */
  getHTML(): string;
  focus(): void;
  /** Inserts at the cursor — templates land here, never in the quote. */
  insertHTML(html: string): void;
  /**
   * Replaces the new text wholesale.
   *
   * `asEdit` says whether this counts as the agent editing: a template "Replace" passes `true`
   * so the body counts as touched and autosaves; our own signature seeding passes nothing and
   * stays silent, so a reseed never marks the body as edited (M15).
   */
  setHTML(html: string, asEdit?: boolean): void;
  isEmpty(): boolean;
  /** Inserts at the very START of the new text — above the signature (R22 "fill"). */
  insertHTMLAtStart(html: string): void;
  /** One step of the editor's own history — the Undo on the "Inserted template" bar (R22). */
  undo(): void;
}

/**
 * The part of the PCF factory this uses. Untyped at runtime and undeclared in
 * `@types/powerapps-component-framework` — declared once, here, rather than `as any` elsewhere.
 */
export interface PlatformFactory {
  createComponent(type: string, id: string, properties: unknown): unknown;
  bindDOMComponent(component: unknown, element: HTMLElement): void;
  unbindDOMComponent(id: string): void;
}

export const PLATFORM_EDITOR = 'MscrmControls.RichTextEditorV2.RichTextEditorControlV2';
/** Our configuration — shipped in the solution, "Can be customized" so admins can edit it. */
// A configUrl the PLATFORM editor resolves, in the form Learn prescribes ("/WebResources/<name>",
// relative). The rule targets code that fetches web resources itself; this code never does.
// eslint-disable-next-line @microsoft/power-apps/use-cached-webresource
export const EDITOR_CONFIG_URL = '/WebResources/jhrb_/CaseEmailClient/EmailRTEconfig.js';
/** Measured ~0.8 s warm and ~1.5–2 s cold (S14). Past this, the editor is reported unavailable. */
export const READY_TIMEOUT_MS = 10_000;

export type UnavailableReason = 'no-factory' | 'mount-failed' | 'timeout' | 'read-only';

/** The parameters the standard email form gives the control, less the binding (S14). */
export function editorParameters(initialHtml: string): Record<string, unknown> {
  return {
    parameters: {
      value: { Type: 'Multiple', Static: true, Usage: 1, Primary: true, Value: initialHtml },
      configUrl: { Type: 'SingleLine.URL', Static: true, Usage: 1, Primary: false, Value: EDITOR_CONFIG_URL },
      isReadOnly: { Type: 'TwoOptions', Static: true, Usage: 1, Primary: false, Value: false },
    },
  };
}

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
  editing: { view: { focus(): void } };
  execute(command: string): void;
  enableReadOnlyMode?(lockId: string): void;
  disableReadOnlyMode?(lockId: string): void;
}

/** CKEditor 5 exposes its instance on the editable element — its documented debugging hook. */
function findEditor(host: HTMLElement): { editable: HTMLElement; editor: CkEditor } | undefined {
  const editable = host.querySelector<HTMLElement>('.ck-editor__editable');
  const editor = (editable as unknown as { ckeditorInstance?: CkEditor } | null)?.ckeditorInstance;
  return editable && editor ? { editable, editor } : undefined;
}

const SENDING_LOCK = 'cec-sending';
let componentSeq = 0;

export interface EditorProps {
  /** Initial new text — a signature (R15), or a restored draft. */
  initialHtml?: string;
  onChange?: (html: string, isEmpty: boolean) => void;
  /** Reports the editor's pixel height so the shell can size the docked surface (R10). */
  onHeightChange?: (contentHeight: number) => void;
  ariaLabel: string;
  /** Locked while a send is in flight — the surface stays visible, per the spec. */
  disabled?: boolean;
  /** `context.factory`. Without it the editor cannot be hosted, and says so. */
  factory?: PlatformFactory;
  /** The editor could not become editable — compose offers the standard email form. */
  onUnavailable?: (reason: UnavailableReason) => void;
}

export const Editor = React.forwardRef<EditorHandle, EditorProps>((props, ref) => {
  const { initialHtml, onChange, onHeightChange, ariaLabel, disabled, factory, onUnavailable } = props;
  const hostRef = React.useRef<HTMLDivElement>(null);
  const editorRef = React.useRef<CkEditor | null>(null);
  const editableRef = React.useRef<HTMLElement | null>(null);
  /** A write that arrived before the editor was ready — the signature seed, a resumed draft. */
  const pendingHtml = React.useRef<string | undefined>(initialHtml);
  /** True while WE write, so our own writes do not look like the agent editing. */
  const silent = React.useRef(false);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'unavailable'>('loading');

  // Fresh closures every render; the editor's listeners are registered once. Read through refs.
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const onHeightRef = React.useRef(onHeightChange);
  onHeightRef.current = onHeightChange;
  const onUnavailableRef = React.useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  const isEmptyNow = () => (editableRef.current?.textContent ?? '').trim().length === 0;

  React.useImperativeHandle(ref, (): EditorHandle => ({
    getHTML: () => editorRef.current?.getData() ?? pendingHtml.current ?? '',
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
      if (!e) { pendingHtml.current = html; return; }
      silent.current = !asEdit;
      try { e.setData(html); } finally { silent.current = false; }
    },
    isEmpty: () => (editorRef.current ? isEmptyNow() : (pendingHtml.current ?? '').trim().length === 0),
    undo: () => editorRef.current?.execute('undo'),
  }), []);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const fail = (reason: UnavailableReason) => {
      setStatus('unavailable');
      onUnavailableRef.current?.(reason);
    };
    if (!factory || typeof factory.createComponent !== 'function' || typeof factory.bindDOMComponent !== 'function') {
      fail('no-factory');
      return undefined;
    }

    componentSeq += 1;
    const id = `cecComposeEditor_${componentSeq}`;
    let cancelled = false;
    let resize: ResizeObserver | undefined;
    try {
      factory.bindDOMComponent(factory.createComponent(PLATFORM_EDITOR, id, editorParameters(pendingHtml.current ?? '')), host);
    } catch {
      fail('mount-failed');
      return undefined;
    }

    const started = Date.now();
    let sawReadOnly = false;
    let poll: number | undefined;
    /** True once the editor is ready (or given up on). Checked at once, then every 100 ms. */
    const check = (): boolean => {
      if (cancelled) return true;
      const found = findEditor(host);
      if (found && !found.editor.isReadOnly) {
        const { editor, editable } = found;
        editorRef.current = editor;
        editableRef.current = editable;
        // The value it was mounted with is already in; apply anything written since, silently.
        const pending = pendingHtml.current;
        if (pending !== undefined && pending !== editor.getData()) {
          silent.current = true;
          try { editor.setData(pending); } finally { silent.current = false; }
        }
        editor.model.document.on('change:data', () => {
          if (silent.current) return;
          onChangeRef.current?.(editor.getData(), isEmptyNow());
        });
        if (typeof ResizeObserver !== 'undefined') {
          resize = new ResizeObserver(() => onHeightRef.current?.(host.scrollHeight));
          resize.observe(host);
        }
        onHeightRef.current?.(host.scrollHeight);
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
    if (!check()) {
      poll = window.setInterval(() => { if (check()) window.clearInterval(poll); }, 100);
    }

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      resize?.disconnect();
      editorRef.current = null;
      editableRef.current = null;
      // Unbind, always: the platform holds the control's React tree and CKEditor's listeners, and
      // CSW sessions are long-lived.
      try { factory.unbindDOMComponent(id); } catch { /* already gone with its host */ }
    };
    // Mounted ONCE per compose — `Compose` is keyed by session. Later writes go through the handle.
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
        flex: '0 0 auto',
        minHeight: status === 'loading' ? '80px' : 0,
        display: status === 'unavailable' ? 'none' : 'block',
        background: T.bg1,
        opacity: disabled ? 0.6 : 1,
      }}
    />
  );
});

Editor.displayName = 'Editor';
