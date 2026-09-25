import * as React from 'react';
import type { ComposeMode, Recipient } from '../domain/compose';
import type { PendingAttachment, Rejection } from '../domain/attachments';
import { describeSender, type SenderCandidate } from '../domain/sender';
import type { PreflightVerdict } from '../domain/preflight';
import { BODY_SURFACE, BODY_SURFACE_FG, formatSize, RADIUS, T } from './tokens';
import { IconButton } from './parts';
import { Editor, type EditorHandle } from './Editor';
import type { EmailTemplate } from '../data/templates';

/**
 * The docked compose surface (R9, R10, R11).
 *
 * **Docked, not overlaid** — Gate 2. At 222px it leaves 189px of the reading pane visible at the
 * measured floor, which is the point of composing in place: you can still see what you are
 * answering. It grows to a ~380px ceiling and, per the spec, **never shrinks back while open**.
 *
 * **The quote is below the editor and read-only.** It is not editable text and it is not in the
 * editor's document; `domain/compose.ts` concatenates it verbatim at send. That is R12's whole
 * mechanism and the reason this component takes `quotedBlock` as an opaque string it only renders.
 */

export interface ComposeProps {
  mode: ComposeMode;
  /** Which message is being answered — named in the bar because in a long thread it is ambiguous. */
  answeringLabel: string;
  to: Recipient[];
  cc: Recipient[];
  subject: string;
  /** The inherited chain, already assembled. Rendered read-only; never given to the editor. */
  quotedBlock?: string;
  /** Initial new text — signature (R15) or a restored draft (R16). */
  initialHtml?: string;
  height: number;
  onHeightChange: (contentHeight: number) => void;
  onClose: () => void;
  onSubjectChange: (next: string) => void;
  onRemoveRecipient: (field: 'to' | 'cc', address: string) => void;
  /** Who the message goes out as (R17). On a Case this is normally the Case's queue. */
  sender: SenderCandidate;
  /** Everyone the agent may send as, `sender` first. One entry renders as text, not a picker. */
  candidates: readonly SenderCandidate[];
  /** Pre-flight per candidate, keyed by id. A blocked one stays visible, with its reason. */
  senderVerdicts: ReadonlyMap<string, PreflightVerdict>;
  onSenderChange: (id: string) => void;
  /** Fires when the editor's content changes, so the shell knows the agent has started typing. */
  onBodyChange?: () => void;
  /** R16 — "Saved 14:32". Shown so the agent can see their work is safe without asking. */
  savedLabel?: string;
  /** R16 — a save that FAILED. This is the case the whole feature exists to make non-silent. */
  saveError?: string;
  /** R13 — files attached to this reply, in every state from pending to failed. */
  attachments: readonly PendingAttachment[];
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (key: string) => void;
  /** Files that could not be attached, each with its own reason. */
  attachmentRejections: readonly Rejection[];
  /** Shown when the message is large enough that some mail systems will reject it. */
  attachmentWarning?: string;
  /** Set when the sender changed after the agent had already typed — see `SenderRow`. */
  signatureStale?: boolean;
  /** R18 gates this: never enabled until the sender's mailbox has been pre-flighted. */
  sendBlockedReason?: string;
  onSend: () => void;
  sending?: boolean;
  /** R14 — templates that apply to a Case. Empty hides the picker rather than showing an empty one. */
  templates: readonly EmailTemplate[];
  /** Resolves one server-side. Returns the prepared content, or an agent-facing reason. */
  onUseTemplate: (templateId: string) => Promise<TemplateOutcome>;
}

export interface TemplateOutcome {
  html: string;
  subject: string;
  unresolved: string[];
  error?: string;
}

export const Compose = React.forwardRef<EditorHandle, ComposeProps>((props, ref) => {
  const {
    mode, answeringLabel, to, cc, subject, quotedBlock, initialHtml, height,
    onHeightChange, onClose, onSubjectChange, onRemoveRecipient,
    sender, candidates, senderVerdicts, onSenderChange, signatureStale, onBodyChange,
    savedLabel, saveError,
    attachments, onAddFiles, onRemoveAttachment, attachmentRejections, attachmentWarning,
    sendBlockedReason, onSend, sending, templates, onUseTemplate,
  } = props;

  const [quoteOpen, setQuoteOpen] = React.useState(false);
  const [editingSubject, setEditingSubject] = React.useState(false);
  const [empty, setEmpty] = React.useState(true);
  const [dragging, setDragging] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  /**
   * Drag enter/leave fire for every child element the pointer crosses, so a naive boolean
   * flickers the drop overlay on and off as the cursor moves over the editor. Counting entries
   * against leaves is the standard fix.
   */
  const dragDepth = React.useRef(0);

  // Compose needs the editor handle itself (templates insert into it) AND the shell needs it
  // (to read the body at send). One ref, forwarded — two refs would drift.
  const editorApi = React.useRef<EditorHandle>(null);
  React.useImperativeHandle(ref, () => editorApi.current!, []);

  const verb = mode === 'forward' ? 'Forward' : mode === 'replyAll' ? 'Reply all' : 'Reply';
  const canSend = !sendBlockedReason && !sending && (!empty || mode === 'forward');

  return (
    <div
      role="region"
      aria-label={`${verb} — compose`}
      onDragEnter={(e) => {
        // Only react to an actual file drag. Dragging selected text within the editor also
        // fires these, and showing a "drop files" overlay for that is nonsense.
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        // Without preventDefault the browser navigates away to the dropped file, losing the
        // whole reply. This is the one that must never be removed.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) onAddFiles(files);
      }}
      style={{
        flex: `0 0 ${height}px`,
        height: `${height}px`,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        boxSizing: 'border-box',
        borderTop: `1px solid ${T.stroke1}`,
        background: T.bg2,
        position: 'relative',
      }}
    >
      {/* R13 — the drop target, shown only mid-drag. `pointerEvents: none` is load-bearing:
          an overlay that accepts the pointer swallows the drop event it exists to advertise. */}
      {dragging && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: T.brandBg2, border: `2px dashed ${T.brandStroke2}`,
            borderRadius: RADIUS.md, fontSize: '14px', fontWeight: 600, color: T.fg1,
          }}
        >
          Drop files to attach
        </div>
      )}

      {/* Context bar. Naming the message being answered is not decoration: in a six-message
          thread it is genuinely ambiguous, and getting it wrong answers the wrong person. */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 32px', height: '32px',
          padding: '0 10px', boxSizing: 'border-box', background: T.brandBg2,
          borderBottom: `1px solid ${T.brandStroke2}`,
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 600, color: T.fg1 }}>{verb}</span>
        <span
          style={{
            fontSize: '12px', color: T.fg2, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
          }}
        >
          to {answeringLabel}
        </span>
        <span style={{ flexGrow: 1 }} />
        <IconButton label="Close compose" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </IconButton>
      </div>

      {/* From (R17). On a Case, mail goes out as the QUEUE, not as the agent — so who it comes
          from is a fact the agent has to be able to see, not an implementation detail. */}
      <SenderRow
        sender={sender}
        candidates={candidates}
        verdicts={senderVerdicts}
        disabled={sending}
        onChange={onSenderChange}
      />

      {/* Recipients. Fixed height and horizontally scrolling: a wrapping recipient row is the
          classic way compose silently eats the reading pane. */}
      <RecipientRow label="To" people={to} onRemove={(a) => onRemoveRecipient('to', a)} />
      {cc.length > 0 && (
        <RecipientRow label="Cc" people={cc} onRemove={(a) => onRemoveRecipient('cc', a)} />
      )}

      {/* Subject is inherited and HIDDEN behind a link — editing it breaks threading, so it is
          deliberately a deliberate act. */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 26px', height: '26px',
          padding: '0 10px', boxSizing: 'border-box', fontSize: '12px', color: T.fg3,
        }}
      >
        {editingSubject ? (
          <input
            autoFocus
            value={subject}
            onChange={(e) => onSubjectChange(e.target.value)}
            onBlur={() => setEditingSubject(false)}
            aria-label="Subject"
            style={{
              flexGrow: 1, minWidth: 0, height: '20px', padding: '0 6px', boxSizing: 'border-box',
              border: `1px solid ${T.stroke1}`, borderRadius: RADIUS.sm, background: T.bg1,
              font: 'inherit', fontSize: '12px', color: T.fg1,
            }}
          />
        ) : (
          <>
            <span
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
            >
              {subject}
            </span>
            <button
              type="button"
              onClick={() => setEditingSubject(true)}
              style={{
                border: 'none', background: 'transparent', color: T.link, cursor: 'pointer',
                font: 'inherit', fontSize: '12px', padding: 0, flex: '0 0 auto',
              }}
            >
              Edit subject
            </button>
          </>
        )}
      </div>

      <Toolbar>
        {/* R13. Fluent UI v9 has no file-uploader component, so this is a plain hidden input
            driven by a button — the same thing the drop zone feeds. */}
        <input
          ref={fileInput}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) onAddFiles(Array.from(e.target.files));
            // Reset, or re-picking the same file after removing it fires no change event.
            e.target.value = '';
          }}
        />
        <IconButton
          label="Attach files"
          disabled={sending}
          onClick={() => fileInput.current?.click()}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M13.5 6.5l-5.2 5.2a1.6 1.6 0 002.3 2.3l5.2-5.2a3.2 3.2 0 00-4.5-4.5L5.6 9.9a4.8 4.8 0 006.8 6.8l4.6-4.6" />
          </svg>
        </IconButton>
        {templates.length > 0 && (
          <TemplatePicker
            templates={templates}
            disabled={sending}
            onUse={onUseTemplate}
            onInsert={(html) => editorApi.current?.insertHTML(html)}
            onReplace={(html) => editorApi.current?.setHTML(html)}
            onSubject={onSubjectChange}
          />
        )}
      </Toolbar>

      <Editor
        ref={editorApi}
        ariaLabel={`${verb} message body`}
        initialHtml={initialHtml}
        disabled={sending}
        onChange={(_html, isEmpty) => { setEmpty(isEmpty); onBodyChange?.(); }}
        onHeightChange={onHeightChange}
      />

      {/* R13 — attachments. Absent entirely when there are none, rather than an empty tray
          eating pixels from a 471px-tall host. */}
      {attachments.length > 0 && (
        <AttachmentBar
          items={attachments}
          onRemove={onRemoveAttachment}
          disabled={sending}
          warning={attachmentWarning}
        />
      )}
      {attachmentRejections.length > 0 && (
        <div
          role="alert"
          style={{
            flex: '0 0 auto', padding: '4px 10px', fontSize: '12px', color: T.dangerFg,
            background: T.dangerBg, borderBottom: `1px solid ${T.stroke3}`,
          }}
        >
          {/* Named per file. "Too big" with no detail leaves an agent who dropped five files
              unable to tell which one to remove. */}
          {attachmentRejections.map((r) => (
            <div key={r.filename}>
              <strong>{r.filename}</strong> — {r.reason}
            </div>
          ))}
        </div>
      )}

      {/* R12 — the inherited chain, read-only, folded. NOT in the editor's document. */}
      {quotedBlock && (
        <div style={{ flex: '0 0 auto', borderTop: `1px solid ${T.stroke3}` }}>
          <button
            type="button"
            onClick={() => setQuoteOpen((o) => !o)}
            aria-expanded={quoteOpen}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px', width: '100%', height: '24px',
              padding: '0 10px', boxSizing: 'border-box', border: 'none', background: 'transparent',
              font: 'inherit', fontSize: '12px', color: T.fg2, cursor: 'pointer', textAlign: 'left',
            }}
          >
            <span>{quoteOpen ? '⌄' : '›'}</span>
            <span>Quoted message — sent unchanged</span>
          </button>
          {quoteOpen && (
            <div
              // Read-only by construction: no contentEditable, and the string is never handed to
              // the editor. Rendered on the same literal white as any other sender HTML (N7).
              dangerouslySetInnerHTML={{ __html: quotedBlock }}
              style={{
                maxHeight: '120px', overflowY: 'auto', padding: '6px 10px',
                boxSizing: 'border-box', background: BODY_SURFACE, colorScheme: 'light',
                color: BODY_SURFACE_FG, font: `400 12px/17px ${T.font}`, contain: 'content',
              }}
            />
          )}
        </div>
      )}

      {/* Send row */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 40px', height: '40px',
          padding: '0 10px', boxSizing: 'border-box', borderTop: `1px solid ${T.stroke3}`,
        }}
      >
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px', height: '28px',
            padding: '0 14px', boxSizing: 'border-box', border: 'none', borderRadius: RADIUS.md,
            background: canSend ? T.brandBg : T.stroke2,
            color: canSend ? T.onBrand : T.fg4,
            font: 'inherit', fontSize: '13px', fontWeight: 600,
            cursor: canSend ? 'pointer' : 'default',
          }}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
        {/*
          R18. The reason is shown, never just a greyed button: an agent who cannot send and is not
          told why will assume the client is broken and send it some other way. Measured: an
          unapproved sender returns HTTP 200 and the mail never leaves, with no error anywhere — so
          this is the only place the problem can surface.
        */}
        {sendBlockedReason && (
          <span
            role="alert"
            // These reasons name the failure AND the fix, so they run long — and the Send row is
            // a fixed 40px. Wrapping to two lines fits ~300 characters at this width; a single
            // nowrap line spilled out of the row. `title` carries the whole thing regardless,
            // and `role="alert"` means a screen reader gets it in full either way.
            title={sendBlockedReason}
            style={{
              fontSize: '12px', color: T.dangerFg, minWidth: 0,
              lineHeight: 1.25, maxHeight: '32px', overflow: 'hidden',
            }}
          >
            {sendBlockedReason}
          </span>
        )}
        {/* R16. A FAILED save outranks everything else on this row, including why Send is
            blocked: Send being unavailable costs the agent a minute, an unsaved draft costs
            them the reply. Silence here is the exact failure this feature exists to prevent. */}
        {saveError && (
          <span role="alert" style={{ fontSize: '12px', color: T.dangerFg, minWidth: 0 }}>
            Draft not saved — {saveError}
          </span>
        )}
        {!saveError && !sendBlockedReason && savedLabel && (
          <span style={{ fontSize: '12px', color: T.fg3, minWidth: 0 }}>{savedLabel}</span>
        )}
        {/* The sender changed after the agent had started typing, so the signature was left
            alone. Silently rewriting a half-written reply is worse than a stale sign-off — but
            saying nothing is worse than both. */}
        {!saveError && !sendBlockedReason && signatureStale && (
          <span role="status" style={{ fontSize: '12px', color: T.warnFg, minWidth: 0 }}>
            Signature still belongs to the previous sender — check it before sending.
          </span>
        )}
        <span style={{ flexGrow: 1 }} />
      </div>
    </div>
  );
});

Compose.displayName = 'Compose';

/**
 * The From line (R17/R18).
 *
 * One candidate — or one the agent may not change — renders as plain text. The picker only
 * appears when there is genuinely something to pick, because a disabled-looking select invites
 * people to fight it.
 *
 * **A candidate that fails pre-flight stays in the list and stays SELECTABLE**, flagged "cannot
 * send". Disabling it was the first attempt and it was wrong: a disabled `<option>` cannot be
 * chosen, hovered or read out, so the reason — the one thing Gate 2 says must be visible — was
 * unreachable. Selecting it now puts the full reason on the Send row, where the agent can read it
 * and repeat it to an administrator. Send stays blocked throughout, so nothing is risked by
 * looking; the worst case is that they switch back.
 *
 * Removing the candidate entirely would be worse still: "send as me" would simply be absent, and
 * the agent would ask an administrator to fix the wrong thing.
 */
const SenderRow: React.FC<{
  sender: SenderCandidate;
  candidates: readonly SenderCandidate[];
  verdicts: ReadonlyMap<string, PreflightVerdict>;
  disabled?: boolean;
  onChange: (id: string) => void;
}> = ({ sender, candidates, verdicts, disabled, onChange }) => {
  const canPick = candidates.length > 1;
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 26px', height: '26px',
        padding: '0 10px', boxSizing: 'border-box', overflow: 'hidden',
        borderBottom: `1px solid ${T.stroke3}`,
      }}
    >
      <span style={{ fontSize: '12px', color: T.fg3, flex: '0 0 auto', width: '32px' }}>From</span>
      {canPick ? (
        <select
          aria-label="Send as"
          disabled={disabled}
          value={sender.id}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flexGrow: 1, minWidth: 0, height: '20px', padding: '0 4px', boxSizing: 'border-box',
            border: `1px solid ${T.stroke1}`, borderRadius: RADIUS.sm, background: T.bg1,
            font: 'inherit', fontSize: '12px', color: T.fg1,
          }}
        >
          {candidates.map((c) => {
            const verdict = verdicts.get(c.id);
            const blocked = verdict ? !verdict.ok : true;
            return (
              <option key={c.id} value={c.id} title={verdict?.reason}>
                {describeSender(c)}
                {blocked ? ' — cannot send' : ''}
              </option>
            );
          })}
        </select>
      ) : (
        <span
          title={describeSender(sender)}
          style={{
            fontSize: '12px', color: T.fg1, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
          }}
        >
          {describeSender(sender)}
        </span>
      )}
    </div>
  );
};

/** One recipient field. Fixed height, scrolls horizontally rather than wrapping. */
const RecipientRow: React.FC<{
  label: string;
  people: Recipient[];
  onRemove: (address: string) => void;
}> = ({ label, people, onRemove }) => (
  <div
    style={{
      display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 30px', height: '30px',
      padding: '0 10px', boxSizing: 'border-box', overflowX: 'auto', overflowY: 'hidden',
      borderBottom: `1px solid ${T.stroke3}`,
    }}
  >
    <span style={{ fontSize: '12px', color: T.fg3, flex: '0 0 auto', width: '20px' }}>{label}</span>
    {people.length === 0 && (
      <span style={{ fontSize: '12px', color: T.fg4 }}>No recipients</span>
    )}
    {people.map((r) => (
      <span
        key={r.address}
        title={r.address}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '4px', flex: '0 0 auto',
          height: '22px', padding: '0 4px 0 8px', boxSizing: 'border-box',
          background: T.bg3, border: `1px solid ${T.stroke2}`, borderRadius: RADIUS.pill,
          fontSize: '12px', color: T.fg1, maxWidth: '200px',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {r.name || r.address}
        </span>
        <button
          type="button"
          onClick={() => onRemove(r.address)}
          aria-label={`Remove ${r.name || r.address}`}
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer', color: T.fg3,
            font: 'inherit', fontSize: '12px', lineHeight: 1, padding: '2px 3px', flex: '0 0 auto',
          }}
        >
          ✕
        </button>
      </span>
    ))}
  </div>
);

/**
 * The formatting toolbar.
 *
 * Rendered but **not wired** in this increment — the buttons are visibly disabled rather than
 * present-and-inert, which is the standard this project already applies to the compose `+` in the
 * thread list. Wiring them to `editor.chain()` is the next step.
 */
const Toolbar: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      display: 'flex', alignItems: 'center', gap: '2px', flex: '0 0 28px', height: '28px',
      padding: '0 8px', boxSizing: 'border-box', borderBottom: `1px solid ${T.stroke3}`,
    }}
  >
    {(['B', 'I', 'U'] as const).map((glyph) => (
      <IconButton key={glyph} label={`${glyph} — not wired yet`} disabled>
        <span style={{ fontSize: '13px', fontWeight: glyph === 'B' ? 700 : 400, fontStyle: glyph === 'I' ? 'italic' : 'normal' }}>
          {glyph}
        </span>
      </IconButton>
    ))}
    <span style={{ flexGrow: 1 }} />
    {children}
  </div>
);

/**
 * The template picker (R14).
 *
 * **`Insert` and `Replace` are two separate buttons**, per the frozen design: a template that
 * silently overwrites a half-written reply is unforgivable once. Both act on the **new-text
 * region only** — never the quote, which the editor does not hold.
 *
 * Tokens are resolved server-side before anything is inserted, and anything the platform could
 * not fill is reported instead of being posted to a customer as `{!Case:Title;}`.
 */
const TemplatePicker: React.FC<{
  templates: readonly EmailTemplate[];
  disabled?: boolean;
  onUse: (templateId: string) => Promise<TemplateOutcome>;
  onInsert: (html: string) => void;
  onReplace: (html: string) => void;
  onSubject: (subject: string) => void;
}> = ({ templates, disabled, onUse, onInsert, onReplace, onSubject }) => {
  const [open, setOpen] = React.useState(false);
  const [chosen, setChosen] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [preview, setPreview] = React.useState<TemplateOutcome>();

  const load = async (templateId: string) => {
    setChosen(templateId);
    setPreview(undefined);
    if (!templateId) return;
    setBusy(true);
    // Resolved BEFORE insert, so the agent sees what will land — including anything unfillable.
    setPreview(await onUse(templateId));
    setBusy(false);
  };

  const apply = (replace: boolean) => {
    if (!preview || preview.error) return;
    if (replace) onReplace(preview.html); else onInsert(preview.html);
    if (preview.subject) onSubject(preview.subject);
    setOpen(false);
    setChosen('');
    setPreview(undefined);
  };

  return (
    <div style={{ position: 'relative', flex: '0 0 auto' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
        style={{
          height: '22px', padding: '0 8px', boxSizing: 'border-box',
          border: `1px solid ${T.stroke1}`, borderRadius: RADIUS.md, background: T.bg1,
          font: 'inherit', fontSize: '12px', color: T.fg1,
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        Template
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Insert a template"
          style={{
            position: 'absolute', right: 0, bottom: '26px', zIndex: 3, width: '320px',
            padding: '10px', boxSizing: 'border-box', background: T.bg1,
            border: `1px solid ${T.stroke1}`, borderRadius: RADIUS.md,
            display: 'flex', flexDirection: 'column', gap: '8px',
          }}
        >
          <select
            value={chosen}
            onChange={(e) => void load(e.target.value)}
            aria-label="Template"
            style={{
              height: '28px', padding: '0 6px', boxSizing: 'border-box', width: '100%',
              border: `1px solid ${T.stroke1}`, borderRadius: RADIUS.md, background: T.bg1,
              font: 'inherit', fontSize: '13px', color: T.fg1,
            }}
          >
            <option value="">Choose a template…</option>
            {templates.map((t) => (
              <option key={t.templateId} value={t.templateId}>{t.title}</option>
            ))}
          </select>

          {busy && <span style={{ fontSize: '12px', color: T.fg3 }}>Resolving…</span>}

          {preview?.error && (
            <span role="alert" style={{ fontSize: '12px', color: T.dangerFg }}>{preview.error}</span>
          )}

          {preview && !preview.error && (
            <>
              {/* The preview is what makes "resolved before insert" mean anything to the agent. */}
              <div
                dangerouslySetInnerHTML={{ __html: preview.html }}
                style={{
                  maxHeight: '110px', overflowY: 'auto', padding: '6px 8px',
                  boxSizing: 'border-box', background: BODY_SURFACE, colorScheme: 'light',
                  color: BODY_SURFACE_FG, font: `400 12px/17px ${T.font}`,
                  border: `1px solid ${T.stroke2}`, borderRadius: RADIUS.sm, contain: 'content',
                }}
              />
              {preview.unresolved.length > 0 && (
                <span
                  role="alert"
                  style={{
                    fontSize: '12px', color: T.warnFg, background: T.warnBg2,
                    border: `1px solid ${T.warnStroke}`, borderRadius: RADIUS.sm, padding: '4px 6px',
                  }}
                >
                  {preview.unresolved.length} placeholder
                  {preview.unresolved.length === 1 ? '' : 's'} could not be filled:{' '}
                  {preview.unresolved.join(', ')}. Fix them before sending.
                </span>
              )}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                {/* Two buttons, deliberately. Replace destroys what is written; Insert does not. */}
                <button
                  type="button"
                  onClick={() => apply(false)}
                  style={{
                    height: '26px', padding: '0 12px', boxSizing: 'border-box', border: 'none',
                    borderRadius: RADIUS.md, background: T.brandBg, color: T.onBrand,
                    font: 'inherit', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Insert at cursor
                </button>
                <button
                  type="button"
                  onClick={() => apply(true)}
                  style={{
                    height: '26px', padding: '0 12px', boxSizing: 'border-box',
                    border: `1px solid ${T.stroke1}`, borderRadius: RADIUS.md, background: T.bg1,
                    font: 'inherit', fontSize: '12px', color: T.fg1, cursor: 'pointer',
                  }}
                >
                  Replace all
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * The attachment tray (R13).
 *
 * One horizontally scrolling row, like the recipient rows above it and for the same reason: a
 * wrapping tray is how compose silently eats the reading pane on a 471px-tall host.
 *
 * Every state is visible rather than inferred — uploading shows a progress bar, failed shows why
 * and stays removable, done shows the size. A chip that merely disappears on failure teaches an
 * agent that the client loses files.
 */
const AttachmentBar: React.FC<{
  items: readonly PendingAttachment[];
  onRemove: (key: string) => void;
  disabled?: boolean;
  warning?: string;
}> = ({ items, onRemove, disabled, warning }) => (
  <div style={{ flex: '0 0 auto', borderBottom: `1px solid ${T.stroke3}` }}>
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '6px', height: '34px',
        padding: '0 10px', boxSizing: 'border-box', overflowX: 'auto', overflowY: 'hidden',
      }}
    >
      {items.map((a) => {
        const failed = a.status === 'failed';
        return (
          <span
            key={a.key}
            title={failed ? a.error : `${a.filename} — ${formatSize(a.size)}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px', flex: '0 0 auto',
              maxWidth: '260px', height: '24px', padding: '0 4px 0 8px',
              borderRadius: RADIUS.sm, fontSize: '12px',
              background: failed ? T.dangerBg : T.bg3,
              color: failed ? T.dangerFg : T.fg1,
              border: `1px solid ${failed ? T.dangerFg : T.stroke2}`,
            }}
          >
            <span
              style={{
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
              }}
            >
              {a.filename}
            </span>
            <span style={{ flex: '0 0 auto', color: failed ? T.dangerFg : T.fg3 }}>
              {failed ? 'failed' : a.status === 'done' ? formatSize(a.size) : `${a.progress}%`}
            </span>
            {a.status === 'uploading' && (
              // A determinate bar, because chunked uploads of tens of megabytes take seconds and
              // an indeterminate spinner cannot say whether anything is happening.
              <span
                aria-hidden
                style={{
                  flex: '0 0 32px', height: '3px', borderRadius: '2px', background: T.stroke2,
                }}
              >
                <span
                  style={{
                    display: 'block', width: `${a.progress}%`, height: '100%',
                    borderRadius: '2px', background: T.brandBg,
                  }}
                />
              </span>
            )}
            <IconButton
              label={`Remove ${a.filename}`}
              disabled={disabled}
              onClick={() => onRemove(a.key)}
            >
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </IconButton>
          </span>
        );
      })}
    </div>
    {warning && (
      <div
        role="status"
        style={{ padding: '0 10px 4px', fontSize: '12px', color: T.warnFg }}
      >
        {warning}
      </div>
    )}
  </div>
);
