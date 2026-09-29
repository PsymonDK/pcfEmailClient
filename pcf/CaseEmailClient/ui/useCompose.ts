import * as React from 'react';
import { type EmailRow } from '../domain/threading';
import {
  allRecipients, buildQuotedBlock, composeSubject, headerFor, resolveRecipients, type ComposeMode,
  type Recipient, type RecipientField,
} from '../domain/compose';
import {
  DataverseError, fetchAttachments, fetchParties, type MessageParties, type Party,
} from '../data/emailQueries';
import { agentFacingMessage } from '../data/errors';
import type { TemplateOutcome } from './Compose';
import {
  discardDraft, fetchDraftById, findExistingDraft, saveDraft, type DraftApiLike,
} from '../data/draft';
import { draftArgsFrom, draftContinuation, worthSaving } from '../domain/draft';
import { createSerialQueue } from '../domain/serialQueue';
import {
  admitFiles, blockProgress, DEFAULT_INLINE_CEILING, type PendingAttachment, type Rejection,
} from '../domain/attachments';
import {
  fetchInlineCeiling, fileToBytes, removeAttachment as removeAttachmentRow, reuseAttachment,
  uploadAttachment,
} from '../data/attachmentUpload';
import { runSend, type SendOutcome } from '../data/sendFlow';
import { type SenderCandidate } from '../domain/sender';
import { reportFor, type SendReport } from '../domain/send';
import {
  partyNavFor, recipientFromParty, replaceUnresolved, withoutDuplicates, type ResolutionOutcome,
} from '../domain/recipients';
import {
  enrichRecipients, fetchPartyAddress, openRecipientLookup, pickedEntity, searchRecipients,
} from '../data/recipients';
import { pollUntilSettled } from '../data/send';
import type { RecipientSuggestion } from '../domain/recipientSearch';
import { instantiateTemplate, resolveXrmExecute } from '../data/templates';
import { initialBodyWithSignature } from '../domain/signature';
import { sanitiseEmailBody } from '../domain/sanitise';
import { splitQuotedHistory } from '../domain/quoting';
import type { EditorHandle } from './Editor';
import { formatWhen } from './tokens';

import type { SenderHook } from './useSender';

/**
 * The compose surface (R9–R17): the draft, its autosave, attachments, recipients and the send.
 *
 * Out of `EmailClientRoot` (R3, 2026-09-28). Everything in here shares one set of refs — the
 * save queue, the per-session row ids, the tray — and splitting it further would mean passing
 * those between hooks, which is how the races this review fixed got in. The pure rules it applies
 * live in `domain/` and `data/sendFlow.ts`, where they are tested.
 */

/** A transient message over the panes. `tone: 'info'` for good news. */
export interface Notice {
  headline: string;
  detail: string;
  tone?: 'info';
}

/** An open compose surface. One at a time — a second would have nowhere to dock. */
export interface ComposeDraft {
  /**
   * Which opening of compose this is. Keys the editor and scopes every save, so nothing from one
   * compose can land in another (H2).
   */
  session: number;
  /** The case this compose answers on. Saves use this, not whatever case is on screen now. */
  caseId: string;
  mode: ComposeMode;
  /** The message being answered, named in the context bar. */
  activityId: string;
  to: Recipient[];
  cc: Recipient[];
  /** Never inherited from the message being answered — only what the agent adds, or a resumed draft holds. */
  bcc: Recipient[];
  subject: string;
  quotedBlock: string;
  answeringLabel: string;
  /** The editor's signature no longer matches the chosen sender, because the agent had typed. */
  signatureStale?: boolean;
  /**
   * The durable draft row's `activityid`, once one exists (R16).
   *
   * Seeded from a resumed draft and updated after each save, for display. Saves themselves read
   * the per-session `draftIds` ref first: a save queued behind the create must see the new id
   * before React has re-rendered, or it creates a second row.
   */
  emailId?: string;
  savedAt?: number;
  /** Set when a save failed. R16's whole point is that a lost draft must not be lost silently. */
  saveError?: string;
  /** New text recovered from an existing draft row, seeded into the editor instead of a signature. */
  resumedHtml?: string;
}

export interface ComposeArgs extends Pick<SenderHook,
  'senderState' | 'setSenderState' | 'chosenSender' | 'signatureHtml' | 'orgPolicyRef'> {
  caseId?: string;
  userId?: string;
  webApiRef: React.MutableRefObject<DraftApiLike>;
  rows: EmailRow[];
  parties: Map<string, MessageParties>;
  ourAddresses: Set<string>;
  ensureBody: (activityId: string) => Promise<string | undefined>;
  load: () => Promise<void>;
  setNotice: (notice: Notice | undefined) => void;
}

export function useCompose(args: ComposeArgs) {
  const {
    caseId, userId, webApiRef, rows, parties, ourAddresses, ensureBody, load, setNotice,
    senderState, setSenderState, chosenSender, signatureHtml, orgPolicyRef,
  } = args;

  /** R9/R10 — the open compose surface, or nothing. One at a time, docked in the reading pane. */
  const [compose, setCompose] = React.useState<ComposeDraft>();
  const [composeContentHeight, setComposeContentHeight] = React.useState(0);
  /** R10: compose never shrinks back while open. Reset when it closes. */
  const composeHighWater = React.useRef(0);
  const editorRef = React.useRef<EditorHandle>(null);
  /** True once the AGENT has changed the body. Not set by our own seeding — see `seeding`. */
  const bodyTouched = React.useRef(false);
  /** Guards `bodyTouched` while we write the signature in ourselves. */
  const seeding = React.useRef(false);

  /**
   * Live mirrors of state the autosave reads.
   *
   * `flushDraft` is called from a debounce, an interval and an unmount, and must not be rebuilt
   * on every keystroke — a new identity would restart the interval each time and the periodic
   * save would never fire. So it depends only on stable things (the save queue) and reads
   * everything else through these, which are updated on every render.
   */
  const composeRef = React.useRef<ComposeDraft>();
  /** The attachment list — the SOURCE OF TRUTH, which state mirrors. See `updateAttachments`. */
  const attachmentsRef = React.useRef<PendingAttachment[]>([]);
  const inlineBytesRef = React.useRef(0);
  const signatureRef = React.useRef('');
  const senderRef = React.useRef<SenderCandidate>();
  /** Whose signature is in the editor, so switching From back again clears the stale note. */
  const signatureOwner = React.useRef<string>();
  /** Effects key on the session, not the draft object — that changes on every save. */
  const composeSession = compose?.session;

  /**
   * R13 — files on the reply, and the ones that were turned away.
   *
   * Held beside the compose draft rather than inside it because uploads finish out of order and
   * each needs its own progress updates; folding them into `ComposeDraft` would make every
   * percentage tick rewrite the whole draft object.
   */
  const [attachments, setAttachments] = React.useState<PendingAttachment[]>([]);
  const [rejections, setRejections] = React.useState<Rejection[]>([]);
  /**
   * Bytes on the message the tray does not show — inline images the platform materialised from
   * `cid:` references in the quoted history. Real on the wire, so they count toward the limit.
   */
  const [inlineBytes, setInlineBytes] = React.useState(0);
  inlineBytesRef.current = inlineBytes;

  /**
   * Every change to the tray goes through here: the REF is the source of truth, state mirrors it.
   *
   * The ref used to be refreshed from state on render, so it lagged every update until React got
   * round to rendering. Two quick drops each measured the size cap against the same stale list
   * and could together exceed it (L9); a send could read a tray from before the last carry-over
   * (H4); a remove could miss a file whose upload had just landed (M8). Writing the ref first
   * makes it current the moment anything changes.
   */
  const updateAttachments = React.useCallback(
    (next: (list: PendingAttachment[]) => PendingAttachment[]) => {
      attachmentsRef.current = next(attachmentsRef.current);
      setAttachments(attachmentsRef.current);
    },
    [],
  );

  const patchAttachment = React.useCallback(
    (key: string, patch: Partial<PendingAttachment>) => {
      updateAttachments((list) => list.map((a) => (a.key === key ? { ...a, ...patch } : a)));
    },
    [updateAttachments],
  );

  /** Files the agent removed while their upload or carry-over was still running. See M8. */
  const removedKeys = React.useRef(new Set<string>());

  /**
   * Delete a row the agent no longer wants, and say so if it will not go.
   *
   * A delete that fails leaves the file on the email, so it WILL be sent. Swallowing that — which
   * the previous `void removeAttachmentRow(...)` did — meant the agent saw the file vanish while
   * the customer received it: the worst direction this can fail in. So the file comes back into
   * the tray, marked failed, and a failed item blocks Send until it is dealt with.
   */
  const discardAttachmentRow = React.useCallback(
    async (item: PendingAttachment, attachmentId: string): Promise<void> => {
      const outcome = await removeAttachmentRow(webApiRef.current, attachmentId);
      if (outcome.ok) return;
      updateAttachments((list) => [...list, {
        ...item,
        attachmentId,
        status: 'failed',
        error: 'This file could not be removed, so it would still be sent. Remove it again.',
      }]);
    },
    [webApiRef, updateAttachments],
  );

  const inlineCeiling = React.useRef(DEFAULT_INLINE_CEILING);

  React.useEffect(() => {
    void (async () => {
      inlineCeiling.current = await fetchInlineCeiling(webApiRef.current);
    })();
  }, [webApiRef]);

  /**
   * Autosave the open draft to Dataverse (R16).
   *
   * Debounced while typing, on an interval, and on close — `setControlState` already survives a
   * session teardown, so this exists for the cases it does not cover: a reload, a crash, a closed
   * browser. Defence in depth, and the difference between losing a draft and losing one silently.
   *
   * **Every save goes through one serial queue** (H3). The busy flag this replaced made a flush
   * that found a save in flight return at once, so Send could send the text from before that
   * save began, or fail outright when the in-flight save was the create. Queued, a forced save
   * waits its turn and then writes what is on screen now; and two saves can never both create.
   */
  composeRef.current = compose;
  signatureRef.current = signatureHtml;
  senderRef.current = chosenSender;

  const [saveQueue] = React.useState(createSerialQueue);
  const draftTimer = React.useRef<ReturnType<typeof setTimeout>>();
  /**
   * Parties (sender, To, Cc) changed since the row last had them written.
   *
   * A counter pair rather than a flag, so a change made while a save is in flight is not
   * forgotten when that save — which carried the OLDER recipients — clears the flag.
   */
  const partiesVersion = React.useRef(0);
  const savedPartiesVersion = React.useRef(0);
  const markPartiesDirty = React.useCallback(() => { partiesVersion.current += 1; }, []);
  /** Row id per compose session: a save queued behind the create must update, not create again. */
  const draftIds = React.useRef(new Map<number, string>());
  /** Sessions whose row THIS client created — the only rows discard-on-close may delete. */
  const createdHere = React.useRef(new Set<number>());
  const sessionCounter = React.useRef(0);
  /** The editor's content as of the last keystroke — for a save after the editor has unmounted. */
  const latestHtml = React.useRef<string>();

  /**
   * Turn carried-over forward attachments into real rows, once there is a draft to hang them on.
   *
   * Runs INSIDE the save that created the row, not in an effect after it. As an effect it raced
   * `issueSend`, so a quick Forward → Send could go out without the files the tray showed (H4).
   * Now Send's own save awaits it, and `blockingReasonAfterSave` refuses if one did not make it.
   */
  const carryForwardAttachments = React.useCallback(
    async (session: number, emailId: string): Promise<void> => {
      if (composeRef.current?.session !== session) return;
      const pending = attachmentsRef.current.filter(
        (a) => a.reusedAttachmentId && !a.attachmentId && a.status !== 'failed',
      );
      for (const item of pending) {
        if (removedKeys.current.has(item.key)) continue;
        const outcome = await reuseAttachment(webApiRef.current, emailId, item.reusedAttachmentId!);
        if (outcome.ok && removedKeys.current.has(item.key)) {
          // Removed while the row was being created: the row exists now, so it must go.
          await discardAttachmentRow(item, outcome.attachmentId!);
          continue;
        }
        patchAttachment(item.key, outcome.ok
          ? { attachmentId: outcome.attachmentId }
          : { status: 'failed', error: outcome.error?.message ?? 'Could not carry this file over.' });
      }
    },
    [webApiRef, discardAttachmentRow, patchAttachment],
  );

  const flushDraft = React.useCallback((opts: {
    /** Save even with nothing typed — an attachment IS content, and Send must always save. */
    force?: boolean;
    /** Write sender/To/Cc even if nothing changed. Send passes this: the row is what is sent. */
    includeParties?: boolean;
    /** Save as this sender. Send passes the one it is about to pre-flight, so the two agree. */
    sender?: SenderCandidate;
  } = {}): Promise<string | undefined> => {
    // Snapshot NOW, not when the queue reaches this save: what the agent saw at the moment they
    // pressed Send, or closed compose, is what must be written.
    const draft = composeRef.current;
    if (!draft) return Promise.resolve(undefined);
    const newHtml = editorRef.current?.getHTML() ?? latestHtml.current ?? '';
    const sender = opts.sender ?? senderRef.current;
    // The quote is always present, so judging by the whole body would save every opened reply.
    // Only the agent's own text counts — unless `force` says otherwise.
    const worth = opts.force === true || worthSaving(newHtml, signatureRef.current);
    const version = partiesVersion.current;

    return saveQueue(async () => {
      const emailId = draftIds.current.get(draft.session) ?? draft.emailId;
      if (!worth || !sender) return emailId;

      const includeParties = opts.includeParties === true
        || emailId === undefined
        || version > savedPartiesVersion.current;
      const outcome = await saveDraft(
        webApiRef.current,
        emailId,
        // The compose's OWN case, never the current one: a compose settled after the record
        // changed must not be re-filed under the new case.
        draftArgsFrom(draft, newHtml, sender, draft.caseId),
        includeParties,
      );

      const savedId = outcome.ok ? outcome.emailId : undefined;
      if (savedId) {
        draftIds.current.set(draft.session, savedId);
        if (emailId === undefined) createdHere.current.add(draft.session);
        if (includeParties) {
          savedPartiesVersion.current = Math.max(savedPartiesVersion.current, version);
        }
        await carryForwardAttachments(draft.session, savedId);
      }

      setCompose((c) => {
        // Compose may have closed, or moved to a different message, while the save was queued.
        if (!c || c.session !== draft.session) return c;
        return savedId
          ? { ...c, emailId: savedId, savedAt: outcome.savedAt?.getTime(), saveError: undefined }
          : { ...c, saveError: outcome.error?.message ?? 'The draft could not be saved.' };
      });
      return savedId;
    });
  }, [webApiRef, saveQueue, carryForwardAttachments]);

  /** Typing restarts the clock; a pause of ~2s commits. */
  const scheduleDraftSave = React.useCallback(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      draftTimer.current = undefined;
      void flushDraft();
    }, 2000);
  }, [flushDraft]);

  // A periodic save, so a long uninterrupted spell of typing is still protected. Closing and
  // switching compose are handled by `closeCompose`, which saves rather than dropping the timer.
  React.useEffect(() => {
    if (composeSession === undefined) return undefined;
    const id = setInterval(() => { void flushDraft(); }, 30000);
    return () => clearInterval(id);
  }, [composeSession, flushDraft]);

  /**
   * The control is being torn down — a session switch, a navigation. Save what the debounce was
   * still holding (M11). Clearing the timer without saving, as the interval cleanup used to,
   * dropped the last couple of seconds of typing on every CSW session switch.
   */
  const flushDraftRef = React.useRef(flushDraft);
  flushDraftRef.current = flushDraft;
  const mounted = React.useRef(true);
  React.useEffect(() => () => {
    mounted.current = false;
    if (draftTimer.current) {
      clearTimeout(draftTimer.current);
      draftTimer.current = undefined;
      void flushDraftRef.current();
    }
  }, []);

  /**
   * Close the open compose: save it, or clean up after an agent who opened Reply and changed
   * their mind. The same path whether they closed it or opened a different compose over it.
   *
   * The second case is H2. Opening Reply on B while A was open used to replace A in place: the
   * editor was reused, A's pending save was cancelled, and depending on timing A's text was
   * either lost or written into B's draft. Now A is settled first, and `key={session}` gives B
   * an editor of its own.
   */
  const closeCompose = React.useCallback(async (): Promise<void> => {
    const closing = composeRef.current;
    if (!closing) return;
    if (draftTimer.current) {
      clearTimeout(draftTimer.current);
      draftTimer.current = undefined;
    }
    const newHtml = editorRef.current?.getHTML() ?? latestHtml.current ?? '';
    if (worthSaving(newHtml, signatureRef.current)) {
      await flushDraft();
      return;
    }
    // Nothing worth keeping. Wait for any queued save first, so a row it is creating is known.
    const emailId = await saveQueue(
      () => Promise.resolve(draftIds.current.get(closing.session) ?? closing.emailId),
    );
    // Only ever a row WE created. An adopted draft — one the standard email form left behind,
    // say — is somebody else's unsent work, and emptying the editor must not delete it.
    if (emailId && createdHere.current.has(closing.session)) {
      await discardDraft(webApiRef.current, emailId);
    }
  }, [webApiRef, flushDraft, saveQueue]);
  const closeComposeRef = React.useRef(closeCompose);
  closeComposeRef.current = closeCompose;

  /** R9 — open compose against one message. */
  const openSeq = React.useRef(0);
  const openCompose = React.useCallback(async (
    mode: ComposeMode,
    activityId: string,
    /** Reopen THIS draft — the one that was open before a teardown (M11). */
    resumeEmailId?: string,
    /**
     * The agent asked to continue this draft (N7), so if it can no longer be continued — sent or
     * discarded since the list loaded — say so. Starting a fresh reply instead would be a
     * different message from the one they clicked. M11 leaves this off: after a teardown a fresh
     * reply is the best that can be restored.
     */
    resumeOnly = false,
  ) => {
    // A second click while the first is still loading wins; the first must not land on top of it.
    const seq = ++openSeq.current;
    const superseded = () => seq !== openSeq.current;

    const message = rows.find((r) => r.activityid === activityId);
    if (!message || !caseId) return;
    const p = parties.get(activityId) ?? { to: [], cc: [], bcc: [] };

    // Bcc is deliberately not read: carrying a hidden recipient forward discloses them.
    const original = {
      // The sender matters most of all: on a reply it becomes the To recipient, so its record
      // identity is what makes the reply deliverable.
      sender: p.sender ? toRecipient(p.sender) : undefined,
      // Carry the record identity, do NOT flatten to name+address. This `.map()` used to drop
      // `partyId` on the floor, which is why every reply wrote an unresolved recipient.
      to: p.to.map(toRecipient),
      cc: p.cc.map(toRecipient),
    };
    const api = webApiRef.current;

    try {
      const { to: rawTo, cc: rawCc } = resolveRecipients(mode, original, ourAddresses);

      // The message being answered often carries UNRESOLVED parties — the platform stores
      // whatever the mail server reported. Resolving here means the reply binds a record even
      // when the original did not. One shared cache: the same address usually appears in both.
      const cache = new Map<string, ResolutionOutcome>();
      let [to, cc] = await Promise.all([
        enrichRecipients(api, rawTo, cache),
        enrichRecipients(api, rawCc, cache),
      ]);
      // Bcc is never derived from the message being answered — only a resumed draft brings one.
      let bcc: Recipient[] = [];

      // The quote needs the original body, which is fetched lazily. If it will not load, do NOT
      // open with an empty quote (M10): the reply would go out missing the message it answers,
      // and nothing on screen would say so.
      const body = await ensureBody(activityId);
      if (superseded()) return;
      if (body === undefined) {
        setNotice({
          headline: "Couldn't open the reply",
          detail: 'The original message could not be loaded, and a reply without it would go out '
            + 'missing the message it answers. Try again.',
        });
        return;
      }
      const quotedBlock = buildQuotedBlock(headerFor(message, original, formatWhen), body);

      // R16 — resume rather than start again. Without this, closing compose and reopening Reply
      // creates a SECOND draft row, then a third. Only a reply resumes: a forward is a new
      // message to new people each time.
      const existing = resumeEmailId
        ? await fetchDraftById(api, resumeEmailId, userId)
        : mode !== 'forward'
          ? await findExistingDraft(api, caseId, activityId, userId)
          : undefined;
      if (superseded()) return;
      if (resumeOnly && !existing) {
        setNotice({
          headline: "Couldn't continue that draft",
          detail: 'It is no longer an open draft of yours — it may have been sent or discarded since '
            + 'the list loaded. Refresh the list to see where it went.',
        });
        return;
      }

      // Splitting our own stored body back apart is exactly R12's round-trip invariant: what we
      // emitted, we can re-split. The new text goes back in the editor; the quote stays opaque.
      const resumedNewText = existing ? splitQuotedHistory(existing.bodyHtml).newHtml : undefined;

      let trayRows: PendingAttachment[] = [];
      let inline = 0;
      if (existing) {
        /*
         * A resumed draft shows the recipients STORED on it (H1). Re-deriving them from the
         * original message showed one set while the row kept another — a Cc the agent had
         * removed, say — and the row's set is what gets sent.
         */
        const stored = (await fetchParties(api, [existing.emailId])).get(existing.emailId);
        if (stored && stored.to.length + stored.cc.length + stored.bcc.length > 0) {
          to = stored.to.map(toRecipient);
          cc = stored.cc.map(toRecipient);
          // Rehydrated, not dropped: the first save after resume rewrites every party, and a Bcc
          // left out of compose would be deleted from the row (issue #11, measured 2026-09-29).
          bcc = stored.bcc.map(toRecipient);
        }

        /*
         * Rehydrate the resumed draft's attachments.
         *
         * Not cosmetic: the files are already rows on that email, so they WILL be sent. Showing
         * an empty tray would mean the agent sees no attachments while the customer receives
         * them — and they could not remove one they cannot see.
         *
         * Inline images are NOT attachments, and must not be offered as ones. Measured
         * 2026-09-25: saving a draft whose quoted history contains `<img src="cid:…">` makes the
         * platform create an `activitymimeattachment` for it, reusing the original's blob.
         * Listing it would invite an agent to "remove" part of the quoted message. It is still on
         * the wire, so its bytes are counted toward the size limit.
         */
        const saved = await fetchAttachments(api, existing.emailId);
        trayRows = saved.filter((r) => !r.contentId).map((r) => ({
          key: r.id,
          filename: r.filename,
          mimeType: r.mimeType,
          size: r.fileSize,
          status: 'done' as const,
          progress: 100,
          attachmentId: r.id,
        }));
        inline = saved.filter((r) => r.contentId).reduce((sum, r) => sum + r.fileSize, 0);
      } else if (mode === 'forward') {
        /*
         * Forward carries the original's attachments (R13).
         *
         * Held as `reusedAttachmentId` and NOT uploaded: `attachmentid` points at the same stored
         * blob, so the row is created for free when the draft first saves. Forwarding a message
         * and silently dropping its attachments is the alternative, and it is the whole reason
         * people forward mail.
         */
        const originals = await fetchAttachments(api, activityId);
        inline = originals.filter((r) => r.contentId).reduce((sum, r) => sum + r.fileSize, 0);
        trayRows = originals.filter((r) => !r.contentId && r.attachmentId).map((r) => ({
          key: `fwd-${r.id}`,
          filename: r.filename,
          mimeType: r.mimeType,
          size: r.fileSize,
          status: 'done' as const,
          progress: 100,
          reusedAttachmentId: r.attachmentId,
        }));
      }
      if (superseded()) return;

      // Settle whatever compose is open before this one replaces it (H2).
      await closeCompose();
      if (superseded()) return;

      const session = ++sessionCounter.current;
      signatureOwner.current = senderRef.current?.id;
      composeHighWater.current = 0;
      bodyTouched.current = existing !== undefined;
      latestHtml.current = undefined;
      removedKeys.current.clear();
      setRejections([]);
      updateAttachments(() => trayRows);
      setInlineBytes(inline);
      setComposeContentHeight(0);
      setSendReport(undefined);
      // The chosen sender may differ from the one stored on a resumed draft, and the displayed
      // recipients are the stored ones only when they could be read — so the first save rewrites
      // the parties either way, and the row always matches the screen.
      if (existing) markPartiesDirty();
      setCompose({
        session,
        caseId,
        mode,
        activityId,
        to,
        cc,
        bcc,
        emailId: existing?.emailId,
        resumedHtml: resumedNewText,
        // `firstNonEmpty`, not `??`: a draft row saved with an empty subject must fall through
        // to the derived one, and `??` only catches null/undefined.
        subject: firstNonEmpty(existing?.subject, composeSubject(mode, message.subject)),
        quotedBlock,
        // `??` is wrong here too: a party with an empty-string name must fall through to the
        // address. Written as an explicit chain so the intent is not mistaken for a slip.
        answeringLabel: firstNonEmpty(
          original.sender?.name, original.sender?.address, '(unknown sender)',
        ),
      });
    } catch (e) {
      // `fetchAttachments` and `fetchParties` throw. Silently doing nothing on Reply was the old
      // failure; refusing with a reason is the honest one — the tray could not be made truthful.
      if (superseded()) return;
      const normalised = e instanceof DataverseError ? e.normalised : { message: String(e), raw: e };
      setNotice({ headline: "Couldn't open the reply", detail: agentFacingMessage(normalised, 'body').detail });
    }
  }, [setNotice, webApiRef, rows, parties, ourAddresses, caseId, userId, closeCompose, updateAttachments, markPartiesDirty, ensureBody]);
  const openComposeRef = React.useRef(openCompose);
  openComposeRef.current = openCompose;

  /** N7 — continue the agent's own draft, on the same row, against the message it answers. */
  const resumeDraft = React.useCallback(async (draftId: string): Promise<void> => {
    const draft = rows.find((r) => r.activityid === draftId);
    if (!draft) return;
    const next = draftContinuation(draft, new Set(rows.map((r) => r.activityid)), userId);
    if (next?.kind !== 'resume') return;
    await openCompose(next.mode, next.answeringId, draftId, true);
  }, [rows, userId, openCompose]);

  /**
   * Attach dropped or picked files (R13).
   *
   * **Uploaded one at a time, deliberately.** Parallel uploads of several large files compete
   * for the same connection and make every progress bar crawl; sequential means the first file
   * is attached and safe while the second is still going.
   */
  const addFiles = React.useCallback(async (files: File[]): Promise<void> => {
    const described = files.map((f) => ({ name: f.name, size: f.size, type: f.type }));
    const { accepted, rejected } = admitFiles(described, attachmentsRef.current, inlineBytesRef.current);
    setRejections(rejected);
    if (accepted.length === 0) return;

    // `admitFiles` returns the very objects it was given, so each maps back to ITS file — two
    // files with the same name and size no longer upload the same bytes twice.
    const queued = accepted.map((f, i) => ({
      file: files[described.indexOf(f)],
      item: {
        key: `${Date.now()}-${i}-${f.name}`,
        filename: f.name,
        mimeType: f.type,
        size: f.size,
        status: 'pending',
        progress: 0,
      } as PendingAttachment,
    }));
    updateAttachments((list) => [...list, ...queued.map((q) => q.item)]);

    // An attachment row needs an email row to hang off, so the draft has to exist first — even
    // if the agent has typed nothing at all. `force` is what makes that happen.
    const emailId = await flushDraft({ force: true });
    if (!emailId) {
      for (const { item } of queued) {
        patchAttachment(item.key, {
          status: 'failed',
          error: 'The draft could not be saved, so there is nothing to attach to.',
        });
      }
      return;
    }

    for (const { file, item } of queued) {
      if (removedKeys.current.has(item.key)) continue;
      patchAttachment(item.key, { status: 'uploading', progress: 0 });
      try {
        const bytes = await fileToBytes(file);
        const outcome = await uploadAttachment(
          webApiRef.current,
          { emailId, filename: item.filename, mimeType: item.mimeType, bytes },
          inlineCeiling.current,
          (sent, total) => patchAttachment(item.key, { progress: blockProgress(sent, total) }),
        );
        if (outcome.ok && removedKeys.current.has(item.key)) {
          // Removed while it uploaded. The row exists now, so it must go (M8).
          await discardAttachmentRow(item, outcome.attachmentId!);
          continue;
        }
        patchAttachment(item.key, outcome.ok
          ? { status: 'done', progress: 100, attachmentId: outcome.attachmentId }
          : { status: 'failed', error: outcome.error?.message ?? 'The upload failed.' });
      } catch (e) {
        // Reading the file can fail on its own — a file removed from disk mid-drag, or one the
        // browser will not read. That is not an upload failure and must not read as one.
        patchAttachment(item.key, {
          status: 'failed',
          error: e instanceof Error ? e.message : 'The file could not be read.',
        });
      }
    }
  }, [webApiRef, flushDraft, patchAttachment, updateAttachments, discardAttachmentRow]);

  /**
   * Add recipients through the platform's own lookup (R9).
   *
   * Every recipient added this way names a **real record**, which is the whole point: Dataverse
   * only reliably delivers to a party bound to a contact, account, user, lead or queue.
   *
   * A pick whose record has no email address is refused with a reason rather than added as a
   * chip that could never receive anything — the same class of quiet failure as the unresolved
   * party this work exists to fix.
   */
  /** Every way of adding recipients ends here: de-duplicated, parties dirty, save scheduled. */
  const addToField = React.useCallback((field: RecipientField, people: readonly Recipient[]) => {
    if (people.length === 0) return;
    setCompose((c) => {
      if (!c) return c;
      const fresh = withoutDuplicates([...people], allRecipients(c));
      if (fresh.length === 0) return c;
      return { ...c, [field]: [...c[field], ...fresh] };
    });
    markPartiesDirty();
    scheduleDraftSave();
  }, [markPartiesDirty, scheduleDraftSave]);

  /** Type-ahead search. Stable: the recipient row's search effect depends on its identity. */
  const searchRecipientSuggestions = React.useCallback((text: string) => {
    const c = composeRef.current;
    return searchRecipients(webApiRef.current, text, c ? allRecipients(c).map((r) => r.address) : []);
  }, [webApiRef]);

  const pickRecipient = React.useCallback((field: RecipientField, s: RecipientSuggestion) => {
    addToField(field, [{
      name: s.name, address: s.address, partyId: s.partyId, partyEntity: s.partyEntity,
      partyNav: partyNavFor(s.partyEntity),
    }]);
  }, [addToField]);

  /**
   * An address typed and entered without picking a suggestion. Resolved exactly like an inherited
   * one: one matching record binds, two stay unresolved and say so, none stays unresolved — and
   * the send guard names it. Our own mailbox is refused outright: replying to it loops.
   */
  const addTypedAddress = React.useCallback(async (field: RecipientField, address: string) => {
    const typed = address.trim().toLowerCase();
    if (ourAddresses.has(typed)) {
      setNotice({
        headline: "That is this case's own mailbox",
        detail: 'Mail sent to it comes straight back into the case. Pick the customer instead.',
      });
      return;
    }
    const [r] = await enrichRecipients(webApiRef.current, [{ name: '', address: typed }]);
    addToField(field, [r]);
  }, [addToField, ourAddresses, setNotice, webApiRef]);

  /**
   * A flagged (unresolved) chip was clicked: open the platform lookup searching for its address,
   * and put the picked record in its place. The chip then names a record and is deliverable.
   */
  const resolveRecipient = React.useCallback(async (field: RecipientField, address: string): Promise<void> => {
    const [picked] = await openRecipientLookup({ searchText: address, allowMultiSelect: false });
    if (!picked) return; // cancelled: the chip stays as it was
    const entity = pickedEntity(picked);
    const found = entity ? await fetchPartyAddress(webApiRef.current, entity, picked.id) : undefined;
    const out = recipientFromParty(picked, found);
    if (!out.ok) {
      setNotice({ headline: 'That record was not used', detail: out.reason });
      return;
    }
    setCompose((c) => {
      if (!c) return c;
      const others = allRecipients({ ...c, [field]: [] });
      return { ...c, [field]: replaceUnresolved(c[field], others, address, out.recipient) };
    });
    markPartiesDirty();
    scheduleDraftSave();
  }, [markPartiesDirty, scheduleDraftSave, setNotice, webApiRef]);

  const addRecipients = React.useCallback(async (field: RecipientField): Promise<void> => {
    const picked = await openRecipientLookup();
    // Cancelling resolves with an empty array rather than rejecting, so this is the normal
    // "changed my mind" path, not an error.
    if (picked.length === 0) return;

    const accepted: Recipient[] = [];
    const refused: string[] = [];
    for (const p of picked) {
      const entity = pickedEntity(p);
      if (!entity) {
        refused.push(`${p.name} cannot receive email.`);
        continue;
      }
      const address = await fetchPartyAddress(webApiRef.current, entity, p.id);
      const out = recipientFromParty(p, address);
      if (out.ok) accepted.push(out.recipient);
      else refused.push(out.reason);
    }

    addToField(field, accepted);
    if (refused.length > 0) {
      setNotice({ headline: 'Some records were not added', detail: refused.join(' ') });
    }
  }, [setNotice, webApiRef, addToField]);

  /**
   * Take a file back off the reply.
   *
   * The Dataverse row is deleted too when there is one. Leaving it would send a file the agent
   * had visibly removed — the worst possible direction for this to fail in. A file still
   * uploading or being carried over is remembered in `removedKeys`, and its row is deleted the
   * moment it lands (M8).
   */
  const removeAttachment = React.useCallback((key: string) => {
    const item = attachmentsRef.current.find((a) => a.key === key);
    if (!item) return;
    removedKeys.current.add(key);
    updateAttachments((list) => list.filter((a) => a.key !== key));
    setRejections([]);
    if (item.attachmentId) void discardAttachmentRow(item, item.attachmentId);
  }, [updateAttachments, discardAttachmentRow]);

  /**
   * Send (R17). The sequence itself is `runSend` in `data/sendFlow.ts`, where it is tested.
   *
   * **There is deliberately no "don't really send" switch here.** `IssueSend: false` marks a
   * message sent without sending it, which is precisely the silent non-delivery this whole
   * feature exists to prevent — a product that could be configured into it would be worse than
   * one that cannot. It stays a development tool, used from a probe, never from the UI.
   */
  const [sendReport, setSendReport] = React.useState<SendReport>();
  const [sending, setSending] = React.useState(false);
  /** The double-click guard. A ref, because two clicks in one frame both read the same state. */
  const sendingRef = React.useRef(false);

  /** Keep watching an accepted send in the background, and correct the notice to what happened. */
  const watchSend = React.useCallback(async (emailId: string): Promise<void> => {
    const polled = await pollUntilSettled(webApiRef.current, emailId);
    if (!mounted.current) return;
    const report = reportFor(polled.statusCode, polled.exhausted);
    setNotice(report.confirmed
      ? { headline: 'Sent', detail: 'The message has left the queue.', tone: 'info' }
      : { headline: report.headline, detail: report.detail ?? '' });
    void load();
  }, [setNotice, webApiRef, load]);

  const sendDraft = React.useCallback(async (): Promise<void> => {
    const draft = composeRef.current;
    const sender = senderRef.current;
    if (!draft || !sender || sendingRef.current) return;

    sendingRef.current = true;
    setSending(true);
    setSendReport(undefined);
    let outcome: SendOutcome;
    try {
      outcome = await runSend(
        { to: draft.to, cc: draft.cc, bcc: draft.bcc, sender, allowUnresolved: orgPolicyRef.current.allowUnresolved },
        {
          api: webApiRef.current,
          attachments: () => attachmentsRef.current,
          // Parties ALWAYS, and as THIS sender: pre-flight checks `sender`, and SendEmail sends
          // whatever sender is on the row. Letting them differ was H1.
          save: async () => ({
            emailId: await flushDraft({ force: true, includeParties: true, sender }),
            attachments: attachmentsRef.current,
          }),
        },
      );
    } catch (e) {
      outcome = { ok: false, detail: e instanceof Error ? e.message : 'Something went wrong while sending.' };
    } finally {
      // Released as soon as the platform has answered — NOT after the background poll, which
      // held the next compose disabled for half a minute (M9).
      sendingRef.current = false;
      setSending(false);
    }

    const stillOpen = composeRef.current?.session === draft.session;
    if (!outcome.ok) {
      if (outcome.verdict) {
        const verdict = outcome.verdict;
        setSenderState((s) => {
          const next = new Map(s.verdicts);
          next.set(sender.id, verdict);
          return { ...s, verdicts: next };
        });
      }
      if (stillOpen) {
        setSendReport({ phase: 'failed', headline: 'Not sent', detail: outcome.detail, confirmed: false });
      } else {
        setNotice({ headline: 'Not sent', detail: outcome.detail });
      }
      return;
    }

    /*
     * Accepted — NOT delivered. Compose closes anyway, and here is why that is right.
     *
     * The first version held compose open until a confirmed `Sent`. Measured 2026-09-25 on a
     * real send: a perfectly healthy message took **~2.5 minutes** to move from Pending Send to
     * Sent, because that is the server-side sync cadence. No agent will watch a panel for two and
     * a half minutes, so they essentially never saw success — which teaches them to ignore the
     * status line, defeating the point of reporting it.
     *
     * Closing is safe because acceptance means the message is already a real row on the case.
     * The status keeps being reported where it belongs — a `Sending` badge on the thread-list
     * row, which survives navigation, reload, and the agent going for coffee. What is NOT done
     * here is claim delivery.
     */
    if (stillOpen) {
      setCompose(undefined);
      updateAttachments(() => []);
      composeHighWater.current = 0;
    }
    setNotice({
      headline: 'Message accepted — sending',
      detail: 'It is on the case and will show as Sent once it leaves. This usually takes a '
        + 'couple of minutes.',
      tone: 'info',
    });
    void load();
    void watchSend(outcome.emailId);
  }, [orgPolicyRef, setNotice, setSenderState, webApiRef, flushDraft, load, updateAttachments, watchSend]);

  /**
   * The agent picked a different From while composing.
   *
   * The row's sender is rewritten on the next save — marking the parties dirty is what makes
   * that happen (H1). Without it an existing draft kept its OLD sender, pre-flight approved the
   * new one, and `SendEmail` sent from whichever was on the row.
   *
   * The signature is swapped only while the editor is still untouched. Once they have typed,
   * rewriting the body to move a signature block risks eating their words — so the signature is
   * left alone and `signatureStale` puts a note next to Send instead. A stale sign-off the agent
   * can see beats a silent edit they cannot.
   */
  const changeSender = React.useCallback((id: string) => {
    if (!senderState.candidates.some((c) => c.id === id)) return;
    setSenderState((s) => ({ ...s, chosenId: id }));
    // Stale only while the sender differs from the one whose signature is in the editor: after
    // switching away and back, the sign-off matches again and the note must go.
    setCompose((c) => (c ? { ...c, signatureStale: bodyTouched.current && id !== signatureOwner.current } : c));
    markPartiesDirty();
    scheduleDraftSave();
  }, [setSenderState, senderState.candidates, markPartiesDirty, scheduleDraftSave]);

  /**
   * Put the new sender's signature in the editor — but only if the agent has not typed.
   *
   * `initialHtml` seeds the editor at construction and nothing re-reads it, so a signature that
   * arrives later (or changes with the sender) has to be written in. `bodyTouched` is set by the
   * editor's own change event and suppressed around this write, so a reseed does not mark the
   * body as edited and then block the next one.
   */
  React.useEffect(() => {
    if (composeSession === undefined || bodyTouched.current) return;
    const editor = editorRef.current;
    if (!editor) return;
    seeding.current = true;
    editor.setHTML(initialBodyWithSignature(signatureHtml));
    signatureOwner.current = senderRef.current?.id;
    seeding.current = false;
  }, [signatureHtml, composeSession]);

  /**
   * R14 — resolve a template against this case, server-side.
   *
   * `InstantiateTemplate` is an unbound action, so it goes through `Xrm.WebApi.online.execute`;
   * `context.webAPI` has no `execute`. The result is **sanitised before it is previewed**: it is
   * HTML heading for the DOM, and the fact that it came from our own org is a reason to trust the
   * author, not a reason to skip the sanitiser.
   */
  const resolveTemplate = React.useCallback(async (templateId: string): Promise<TemplateOutcome> => {
    const execute = resolveXrmExecute();
    if (!execute || !caseId) {
      return {
        html: '', subject: '', unresolved: [],
        error: 'Templates are unavailable here — the platform action could not be reached.',
      };
    }
    const { template, error } = await instantiateTemplate(execute, templateId, caseId);
    if (error || !template) {
      return {
        html: '', subject: '', unresolved: [],
        error: error?.message ?? 'That template could not be resolved.',
      };
    }
    return {
      html: sanitiseEmailBody(template.html).html,
      subject: template.subject,
      unresolved: template.unresolved,
    };
  }, [caseId]);


  return {
    compose, setCompose, composeContentHeight, setComposeContentHeight, composeHighWater,
    editorRef, bodyTouched, seeding, latestHtml, attachments, rejections, inlineBytes,
    sendReport, sending, openCompose, openComposeRef, closeCompose, closeComposeRef,
    scheduleDraftSave, markPartiesDirty, addFiles, addRecipients, removeAttachment, sendDraft,
    changeSender, resolveTemplate, searchRecipientSuggestions, pickRecipient, addTypedAddress,
    resolveRecipient, resumeDraft,
  };
}

/**
 * A `data/` party becomes a compose `Recipient`, identity intact.
 *
 * One function so no call site can flatten the record away again — which is precisely how the
 * unresolved-recipient bug got in, as a `.map()` that kept only name and address.
 */
function toRecipient(p: Party): Recipient {
  return {
    name: p.name,
    address: p.address,
    partyId: p.partyId,
    partyEntity: p.partyEntity,
    partyNav: p.partyNav,
  };
}

/** First value that is a non-empty string. `??` cannot express this: '' is not nullish. */
function firstNonEmpty(...values: (string | undefined)[]): string {
  for (const v of values) if (v && v.trim().length > 0) return v;
  return '';
}
