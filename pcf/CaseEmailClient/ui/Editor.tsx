import * as React from 'react';
import { T } from './tokens';
import { splitQuotedHistory } from '../domain/quoting';
import { createRichText, type RichTextInstance } from '../host/richText';

/**
 * The compose editor (R11) — **TinyMCE, bundled with the control** (S17, 2026-11-23).
 *
 * The body is plain HTML and WE own it again: every draft save writes it (`DraftArgs.bodyHtml`),
 * unlike S16 where the platform's form saved it. The row exists before this mounts — compose
 * creates it when it opens — and the editor starts from what that row holds, so a compose
 * restored after a teardown shows the saved text.
 *
 * **There is no second editor.** When TinyMCE cannot start, this reports `onUnavailable` and
 * compose offers the standard email form instead.
 */

export interface EditorHandle {
  /** The whole body as HTML — new text AND quote. */
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
  /** Has the body changed since the editor loaded it? What "worth keeping / sending" means. */
  hasChanges(): boolean;
}

export type UnavailableReason = 'mount-failed' | 'timeout';

/** TinyMCE failed to start in this long — an editor that never appears must not wait forever. */
export const READY_TIMEOUT_MS = 20_000;

/** The editable never shrinks below this, however much the rows around it take. */
export const MIN_EDITABLE_HEIGHT = 120;
/** Space kept under the editor, so it stops short of the host's edge. */
const BOTTOM_GUTTER = 12;
const norm = (html: string) => html.replace(/\s+/g, ' ').trim();

export interface EditorProps {
  /** Reads the saved body of the draft row — what the editor opens with. */
  loadBody: () => Promise<string>;
  onChange?: () => void;
  ariaLabel: string;
  /** Locked while a send is in flight — the surface stays visible, per the spec. */
  disabled?: boolean;
  /** TinyMCE could not start — compose offers the standard email form. */
  onUnavailable?: (reason: UnavailableReason) => void;
}

export const Editor = React.forwardRef<EditorHandle, EditorProps>((props, ref) => {
  const { loadBody, onChange, ariaLabel, disabled, onUnavailable } = props;
  const hostRef = React.useRef<HTMLDivElement>(null);
  const rtRef = React.useRef<RichTextInstance | null>(null);
  /** The body as the editor loaded it — what `hasChanges` compares with. */
  const loaded = React.useRef<string>();
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'unavailable'>('loading');

  // Fresh closures every render; the editor's listener is registered once. Read through refs.
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const onUnavailableRef = React.useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  const loadBodyRef = React.useRef(loadBody);
  loadBodyRef.current = loadBody;

  React.useImperativeHandle(ref, (): EditorHandle => ({
    getHTML: () => rtRef.current?.getHTML() ?? '',
    focus: () => rtRef.current?.focus(),
    insertHTML: (html) => rtRef.current?.insertHTML(html),
    insertHTMLAtStart: (html) => rtRef.current?.insertAtStart(html),
    setHTML: (html, asEdit = false) => {
      const rt = rtRef.current;
      if (!rt) return;
      const { quotedHtml } = splitQuotedHistory(rt.getHTML());
      rt.setHTML(html + quotedHtml);
      if (asEdit) onChangeRef.current?.();
    },
    isEmpty: () => rtRef.current?.isEmpty() ?? true,
    undo: () => rtRef.current?.undo(),
    hasChanges: () => {
      const rt = rtRef.current;
      return !!rt && loaded.current !== undefined && norm(rt.getHTML()) !== norm(loaded.current);
    },
  }), []);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let cancelled = false;
    let created: RichTextInstance | undefined;
    let resize: ResizeObserver | undefined;
    const fail = (reason: UnavailableReason) => {
      if (cancelled) return;
      setStatus('unavailable');
      onUnavailableRef.current?.(reason);
    };
    const timer = window.setTimeout(() => fail('timeout'), READY_TIMEOUT_MS);

    const fit = () => {
      if (!created) return;
      const room = Math.floor(host.getBoundingClientRect().height - BOTTOM_GUTTER);
      created.resize(Math.max(MIN_EDITABLE_HEIGHT, room));
    };

    loadBodyRef.current()
      .then((html) => createRichText(host, html, { label: ariaLabel, height: MIN_EDITABLE_HEIGHT }))
      .then((rt) => {
        window.clearTimeout(timer);
        if (cancelled) { rt.destroy(); return undefined; }
        created = rt;
        rtRef.current = rt;
        loaded.current = rt.getHTML();
        rt.onChange(() => onChangeRef.current?.());
        if (typeof ResizeObserver !== 'undefined') {
          resize = new ResizeObserver(fit);
          resize.observe(host);
        }
        fit();
        setStatus('ready');
        return undefined;
      })
      .catch((e: unknown) => {
        window.clearTimeout(timer);
        console.warn('The compose body editor could not start', e);
        fail('mount-failed');
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      resize?.disconnect();
      rtRef.current = null;
      created?.destroy();
    };
    // Mounted ONCE per draft row — `Compose` keys the editor by it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (status === 'ready') rtRef.current?.setDisabled(!!disabled);
  }, [disabled, status]);

  return (
    <div
      ref={hostRef}
      aria-label={ariaLabel}
      aria-busy={status === 'loading'}
      style={{
        // Takes every pixel the fixed rows leave; `fit` hands them to the editor.
        flex: '1 1 0',
        minHeight: `${MIN_EDITABLE_HEIGHT + 48}px`,
        overflow: 'hidden',
        display: status === 'unavailable' ? 'none' : 'block',
        background: T.bg1,
        opacity: disabled ? 0.6 : 1,
      }}
    />
  );
});

Editor.displayName = 'Editor';
