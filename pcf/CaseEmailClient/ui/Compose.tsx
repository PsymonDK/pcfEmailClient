import * as React from 'react';
import type { ComposeMode, Recipient, RecipientField } from '../domain/compose';
import type { PendingAttachment, Rejection } from '../domain/attachments';
import { isResolved } from '../domain/recipients';
import { entityLabel, MIN_SEARCH_LENGTH, type RecipientSuggestion } from '../domain/recipientSearch';
import { sanitiseEmailBody } from '../domain/sanitise';
import type { SendReport } from '../domain/send';
import { describeSender, type SenderCandidate } from '../domain/sender';
import type { PreflightVerdict } from '../domain/preflight';
import { BODY_SURFACE, BODY_SURFACE_FG, formatSize, RADIUS, T } from './tokens';
import { IconButton } from './parts';
import { Editor, type EditorHandle } from './Editor';
import type { EmailTemplate } from '../data/templates';
import { TemplatePicker, type TemplateOutcome } from './TemplatePicker';
import { describeLost, formattingLost, insertPlacement } from '../domain/templatePicker';

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
  /** Blind copies (issue #11). Shown only once asked for, like Cc. */
  bcc: Recipient[];
  subject: string;
  /** The inherited chain, already assembled. Rendered read-only; never given to the editor. */
  quotedBlock?: string;
  /** The editor opens on a resumed draft's text rather than a fresh signature. */
  resumed?: boolean;
  /** Initial new text — signature (R15) or a restored draft (R16). */
  initialHtml?: string;
  height: number;
  onHeightChange: (contentHeight: number) => void;
  onClose: () => void;
  onSubjectChange: (next: string) => void;
  onRemoveRecipient: (field: RecipientField, address: string) => void;
  /**
   * Opens the platform's lookup so the agent can add a recipient that names a real record.
   *
   * Absent when `Xrm.Utility` is unreachable, in which case the Add button is simply not
   * rendered rather than offered and broken.
   */
  onAddRecipients?: (field: RecipientField) => void | Promise<void>;
  /**
   * Type-ahead: records whose name or address starts with the text. Must be a STABLE function —
   * the row's search effect depends on it.
   */
  onSearchRecipients?: (text: string) => Promise<RecipientSuggestion[]>;
  /** A suggestion was picked — it names a real record. */
  onPickRecipient?: (field: RecipientField, suggestion: RecipientSuggestion) => void;
  /** Enter on a typed address that no suggestion matched: resolve it like a reply would. */
  onTypedAddress?: (field: RecipientField, address: string) => void;
  /** A flagged chip was clicked: pick the record it should be. Absent without the lookup. */
  onResolveRecipient?: (field: RecipientField, address: string) => void;
  /** Mark recipients that match no record — i.e. this org refuses unresolved parties. */
  flagUnresolved?: boolean;
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
  /**
   * R17 — what the platform ACTUALLY did, once Send was pressed.
   *
   * Outranks every other message on the Send row, and is deliberately not a success toast: an
   * HTTP 200 from `SendEmail` means "accepted", and an unapproved sender parks at Pending Send
   * forever with no error recorded anywhere. Only `confirmed` gets the success colour.
   */
  sendReport?: SendReport;
  /** R22 — templates that apply to a Case. Empty hides the picker rather than showing an empty one. */
  templates: readonly EmailTemplate[];
  /** Resolves one server-side. Returns the prepared content, or an agent-facing reason. */
  onUseTemplate: (templateId: string) => Promise<TemplateOutcome>;
  /** `context.userSettings.languageId` — the picker's default language (R22, decision 1). */
  uiLanguage?: number;
  /**
   * Has the agent typed anything beyond the signature? Decides where a picked template goes:
   * an empty message is filled from the top, anything typed gets it at the cursor (decision 3).
   */
  hasTypedText: () => boolean;
}

/** The Undo / Replace links on the post-insert bar (R22). */
const barLink: React.CSSProperties = {
  border: 'none', background: 'transparent', padding: '0 2px', font: 'inherit', fontSize: '12px',
  color: T.link, cursor: 'pointer', flex: '0 0 auto',
};

export const Compose = React.forwardRef<EditorHandle, ComposeProps>((props, ref) => {
  const {
    mode, answeringLabel, to, cc, bcc, subject, quotedBlock, initialHtml, height,
    onHeightChange, onClose, onSubjectChange, onRemoveRecipient,
    sender, candidates, senderVerdicts, onSenderChange, signatureStale, onBodyChange,
    onAddRecipients, flagUnresolved, onSearchRecipients, onPickRecipient, onTypedAddress,
    onResolveRecipient,
    savedLabel, saveError,
    attachments, onAddFiles, onRemoveAttachment, attachmentRejections, attachmentWarning,
    sendBlockedReason, onSend, sending, sendReport, templates, onUseTemplate, resumed, uiLanguage, hasTypedText,
  } = props;

  const [quoteOpen, setQuoteOpen] = React.useState(false);
  const safeQuote = React.useMemo(() => sanitiseEmailBody(quotedBlock).html, [quotedBlock]);
  const [editingSubject, setEditingSubject] = React.useState(false);
  // A resumed draft starts with the agent's own text in it, so Send starts enabled (M15). It
  // used to wait for a keystroke, because the editor reports only changes, never its first state.
  const [empty, setEmpty] = React.useState(!resumed);
  const [dragging, setDragging] = React.useState(false);
  const [ccOpen, setCcOpen] = React.useState(false);
  const [bccOpen, setBccOpen] = React.useState(false);
  /** R22 — the template just inserted, for the Undo / Replace bar. Cleared by either, or ✕. */
  const [inserted, setInserted] = React.useState<{ title: string; html: string; unresolved: string[]; lost: string[] }>();
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
          {/* A forward has no recipient yet: the label says whose message it carries (N9). */}
          {mode === 'forward' ? 'message from' : 'to'} {answeringLabel}
        </span>
        <span style={{ flexGrow: 1 }} />
        {/* Cc is hidden until asked for. An always-visible empty Cc row would spend 30 of the
            471 measured vertical pixels saying nothing. */}
        {cc.length === 0 && !ccOpen && (
          <button
            type="button"
            onClick={() => setCcOpen(true)}
            style={{
              border: 'none', background: 'transparent', color: T.link, cursor: 'pointer',
              font: 'inherit', fontSize: '12px', padding: '0 4px', flex: '0 0 auto',
            }}
          >
            Cc
          </button>
        )}
        {bcc.length === 0 && !bccOpen && (
          <button
            type="button"
            onClick={() => setBccOpen(true)}
            title="Blind copy: recipients no one else on the message can see"
            style={{
              border: 'none', background: 'transparent', color: T.link, cursor: 'pointer',
              font: 'inherit', fontSize: '12px', padding: '0 4px', flex: '0 0 auto',
            }}
          >
            Bcc
          </button>
        )}
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
      <RecipientRow
        label="To"
        people={to}
        onRemove={(a) => onRemoveRecipient('to', a)}
        onAdd={onAddRecipients ? () => void onAddRecipients('to') : undefined}
        disabled={sending}
        flagUnresolved={flagUnresolved}
        onSearch={onSearchRecipients}
        onPick={(s) => onPickRecipient?.('to', s)}
        onTypedAddress={(a) => onTypedAddress?.('to', a)}
        onResolve={onResolveRecipient ? (a) => onResolveRecipient('to', a) : undefined}
      />
      {/* Cc appears once it has someone in it, or once the agent asks for it. Rendering it
          unconditionally would spend 30 of the 471 measured vertical pixels on an empty row. */}
      {(cc.length > 0 || ccOpen) && (
        <RecipientRow
          label="Cc"
          people={cc}
          onRemove={(a) => onRemoveRecipient('cc', a)}
          onAdd={onAddRecipients ? () => void onAddRecipients('cc') : undefined}
          disabled={sending}
          flagUnresolved={flagUnresolved}
          onSearch={onSearchRecipients}
          onPick={(s) => onPickRecipient?.('cc', s)}
          onTypedAddress={(a) => onTypedAddress?.('cc', a)}
          onResolve={onResolveRecipient ? (a) => onResolveRecipient('cc', a) : undefined}
        />
      )}
      {/* Bcc (issue #11): the same row, the same record rules — a blind copy must name a record
          too. Never pre-filled: nothing is carried into Bcc from the message being answered. */}
      {(bcc.length > 0 || bccOpen) && (
        <RecipientRow
          label="Bcc"
          people={bcc}
          onRemove={(a) => onRemoveRecipient('bcc', a)}
          onAdd={onAddRecipients ? () => void onAddRecipients('bcc') : undefined}
          disabled={sending}
          flagUnresolved={flagUnresolved}
          onSearch={onSearchRecipients}
          onPick={(s) => onPickRecipient?.('bcc', s)}
          onTypedAddress={(a) => onTypedAddress?.('bcc', a)}
          onResolve={onResolveRecipient ? (a) => onResolveRecipient('bcc', a) : undefined}
        />
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
            uiLanguage={uiLanguage}
            disabled={sending}
            onResolve={onUseTemplate}
            onPick={(template, outcome) => {
              // Click 2 inserts (R22). The subject is never touched — see the regression test.
              if (insertPlacement(hasTypedText()) === 'fill') editorApi.current?.insertHTMLAtStart(outcome.html);
              else editorApi.current?.insertHTML(outcome.html);
              setInserted({
                title: template.title, html: outcome.html, unresolved: outcome.unresolved,
                lost: formattingLost(outcome.html),
              });
            }}
          />
        )}
      </Toolbar>

      {/* R22 — Insert vs Replace without a third click: a single pick never destroys work, and
          Replace (or Undo) is one deliberate click away here, right after the insert. */}
      {inserted && (
        <div
          role="status"
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 auto', minHeight: '26px',
            padding: '2px 10px', boxSizing: 'border-box', fontSize: '12px', color: T.fg2,
            borderBottom: `1px solid ${T.stroke3}`,
            background: inserted.unresolved.length > 0 ? T.warnBg2 : 'transparent',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            Inserted &quot;{inserted.title}&quot;
            {inserted.lost.length > 0 && (
              <span style={{ color: T.fg3 }}> · formatting simplified ({describeLost(inserted.lost)})</span>
            )}
            {inserted.unresolved.length > 0 && (
              <span style={{ color: T.warnFg }}>
                {' '}· {inserted.unresolved.length === 1 ? '1 placeholder' : `${inserted.unresolved.length} placeholders`} couldn&apos;t be filled ({inserted.unresolved.join(', ')}) — fix before sending
              </span>
            )}
          </span>
          <span style={{ flexGrow: 1 }} />
          <button type="button" onClick={() => { editorApi.current?.undo(); setInserted(undefined); }} style={barLink}>Undo</button>
          <button type="button" onClick={() => { editorApi.current?.setHTML(inserted.html, true); setInserted(undefined); }} style={barLink}>Replace the whole message instead</button>
          <button type="button" aria-label="Dismiss" onClick={() => setInserted(undefined)} style={{ ...barLink, color: T.fg3 }}>✕</button>
        </div>
      )}

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
          {attachmentRejections.map((r, i) => (
            <div key={`${i}-${r.filename}`}>
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
              //
              // Sanitised AGAIN at render, although `buildQuotedBlock` already sanitises: a
              // resumed draft's quote comes back out of Dataverse, and a draft saved before
              // 2026-09-28 carries the sender's raw HTML. Display only — what is sent is still
              // `quotedBlock`, untouched, so R12's round trip is unaffected.
              dangerouslySetInnerHTML={{ __html: safeQuote }}
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
        {sendReport && (
          <span
            role="status"
            title={sendReport.detail}
            style={{
              fontSize: '12px', minWidth: 0, lineHeight: 1.25, maxHeight: '32px',
              overflow: 'hidden',
              color: sendReport.confirmed
                ? T.okFg
                : sendReport.phase === 'failed' ? T.dangerFg : T.warnFg,
            }}
          >
            <strong>{sendReport.headline}</strong>
            {sendReport.detail ? ` — ${sendReport.detail}` : ''}
          </span>
        )}
        {!sendReport && sendBlockedReason && (
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
        {!sendReport && saveError && (
          <span role="alert" style={{ fontSize: '12px', color: T.dangerFg, minWidth: 0 }}>
            Draft not saved — {saveError}
          </span>
        )}
        {!sendReport && !saveError && !sendBlockedReason && savedLabel && (
          <span style={{ fontSize: '12px', color: T.fg3, minWidth: 0 }}>{savedLabel}</span>
        )}
        {/* The sender changed after the agent had started typing, so the signature was left
            alone. Silently rewriting a half-written reply is worse than a stale sign-off — but
            saying nothing is worse than both. */}
        {!sendReport && !saveError && !sendBlockedReason && signatureStale && (
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
/**
 * One recipient field.
 *
 * **An unresolved chip is marked, not hidden.** A recipient that matches no record is one this
 * organisation may refuse to deliver to, and the agent can only act on that if they can see
 * which chip is the problem — so it carries a warning border and says why on hover. The Add
 * button beside it is how they fix it.
 */
/** One plain address — what Enter on typed text may add when no suggestion is chosen. */
const LOOKS_LIKE_ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

/**
 * A recipient row: chips, a type-ahead input, and the lookup button.
 *
 * The suggestions render IN FLOW under the row rather than floating over it: the row scrolls
 * horizontally and clips its overflow, and CSW's form containers carry transforms that break
 * fixed positioning. Compose makes room while the list is open.
 */
const RecipientRow: React.FC<{
  label: string;
  people: Recipient[];
  onRemove: (address: string) => void;
  onAdd?: () => void;
  disabled?: boolean;
  /** When false, an unresolved chip is just informational rather than a blocker. */
  flagUnresolved?: boolean;
  onSearch?: (text: string) => Promise<RecipientSuggestion[]>;
  onPick?: (suggestion: RecipientSuggestion) => void;
  onTypedAddress?: (address: string) => void;
  /** Resolve a flagged chip to a record. When set, a flagged chip's label is a button. */
  onResolve?: (address: string) => void;
}> = ({ label, people, onRemove, onAdd, disabled, flagUnresolved, onSearch, onPick, onTypedAddress, onResolve }) => {
  const [text, setText] = React.useState('');
  const [suggestions, setSuggestions] = React.useState<RecipientSuggestion[]>([]);
  const [active, setActive] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  /** Only the newest search may answer — typing fast must not show an older query's results. */
  const searchSeq = React.useRef(0);
  const listId = `cec-suggest-${label.toLowerCase()}`;

  React.useEffect(() => {
    if (!onSearch) return undefined;
    const query = text.trim();
    if (query.length < MIN_SEARCH_LENGTH) {
      searchSeq.current += 1;
      setSuggestions([]);
      setOpen(false);
      return undefined;
    }
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      void onSearch(query).then((found) => {
        if (seq !== searchSeq.current) return undefined;
        setSuggestions(found);
        setActive(0);
        setOpen(true);
        return undefined;
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [text, onSearch]);

  const reset = () => { setText(''); setSuggestions([]); setOpen(false); searchSeq.current += 1; };
  const pick = (s: RecipientSuggestion) => { onPick?.(s); reset(); };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && open && suggestions.length > 0) {
      e.preventDefault();
      setActive((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (e.key === 'ArrowUp' && open && suggestions.length > 0) {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && suggestions[active]) pick(suggestions[active]);
      else if (LOOKS_LIKE_ADDRESS.test(text.trim())) { onTypedAddress?.(text.trim()); reset(); }
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  const showList = open && text.trim().length >= MIN_SEARCH_LENGTH;

  return (
    <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 30px', height: '30px',
          padding: '0 10px', boxSizing: 'border-box', overflowX: 'auto', overflowY: 'hidden',
          borderBottom: `1px solid ${T.stroke3}`,
        }}
      >
        {/* 24px: wide enough for "Bcc", so the three rows' chips start on one line. */}
        <span style={{ fontSize: '12px', color: T.fg3, flex: '0 0 auto', width: '24px' }}>{label}</span>
        {people.length === 0 && !onSearch && (
          <span style={{ fontSize: '12px', color: T.fg4 }}>No recipients</span>
        )}
        {people.map((r, i) => {
          const unknown = flagUnresolved && !isResolved(r);
          const resolvable = unknown && !!onResolve && !disabled;
          const why = r.ambiguousMatches
            ? `${r.address} — matches more than one record`
            : `${r.address} — not a known contact, account, lead, user or queue`;
          return (
            <span
              key={`${i}-${r.address}`}
              title={!unknown ? r.address : resolvable ? `${why}. Click to pick the right record.` : why}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px', flex: '0 0 auto',
                height: '22px', padding: '0 4px 0 8px', boxSizing: 'border-box',
                background: unknown ? T.warnBg : T.bg3,
                border: `1px solid ${unknown ? T.warnFg : T.stroke2}`,
                borderRadius: RADIUS.pill,
                fontSize: '12px', color: T.fg1, maxWidth: '200px',
              }}
            >
              {unknown && <span aria-hidden style={{ color: T.warnFg, flex: '0 0 auto' }}>!</span>}
              {resolvable ? (
                <button
                  type="button"
                  onClick={() => onResolve?.(r.address)}
                  aria-label={`Resolve ${r.address} to a record`}
                  style={{
                    border: 'none', background: 'transparent', padding: 0, cursor: 'pointer',
                    font: 'inherit', fontSize: '12px', color: T.fg1, textDecoration: 'underline dotted',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {r.name || r.address}
                </button>
              ) : (
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name || r.address}
                </span>
              )}
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
          );
        })}
        {onSearch && (
          <input
            type="text"
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => setOpen(false)}
            onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
            placeholder={people.length === 0 ? 'Type a name or address' : ''}
            role="combobox"
            aria-label={`Add ${label} recipient by name or address`}
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listId}
            aria-activedescendant={showList && suggestions[active] ? `${listId}-${active}` : undefined}
            style={{
              flex: '1 0 140px', minWidth: '140px', height: '22px', border: 'none', outline: 'none',
              background: 'transparent', font: 'inherit', fontSize: '12px', color: T.fg1,
            }}
          />
        )}
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            disabled={disabled}
            aria-label={`Add ${label} recipient`}
            title="Look up a contact, account, user or queue"
            style={{
              flex: '0 0 auto', height: '22px', padding: '0 8px', boxSizing: 'border-box',
              border: `1px dashed ${T.stroke1}`, borderRadius: RADIUS.pill, background: 'transparent',
              font: 'inherit', fontSize: '12px', color: disabled ? T.fg4 : T.link,
              cursor: disabled ? 'default' : 'pointer',
            }}
          >
            + Add
          </button>
        )}
      </div>
      {showList && (
        <div
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          style={{ borderBottom: `1px solid ${T.stroke3}`, background: T.bg1, padding: '2px 0' }}
        >
          {suggestions.length === 0 && (
            <div style={{ padding: '4px 40px', fontSize: '12px', color: T.fg3 }}>
              No contact, account, user or queue starts with that.
              {LOOKS_LIKE_ADDRESS.test(text.trim()) && ' Press Enter to add the address as typed.'}
            </div>
          )}
          {suggestions.map((s, i) => (
            <div
              key={`${s.partyEntity}:${s.partyId}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: a click would first blur the input and close the list.
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              onMouseEnter={() => setActive(i)}
              style={{
                display: 'flex', alignItems: 'baseline', gap: '8px', padding: '3px 10px 3px 40px',
                fontSize: '12px', cursor: 'pointer', background: i === active ? T.selected : 'transparent',
              }}
            >
              <span style={{ color: T.fg1, fontWeight: 600 }}>{s.name}</span>
              <span style={{ color: T.fg2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.address}
              </span>
              <span style={{ flexGrow: 1 }} />
              <span style={{ color: T.fg3, flex: '0 0 auto' }}>{entityLabel(s.partyEntity)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

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
