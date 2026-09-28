import * as React from 'react';
import { buildThreads, type EmailRow, type Thread } from '../domain/threading';
import { resolveLayout, composeHeight } from '../domain/layout';
import { type ComposeMode } from '../domain/compose';
import {
  DataverseError, fetchAncestry, fetchAttachments, fetchBody, fetchCaseEmails, fetchParties,
  type AncestorCase, type MessageParties,
} from '../data/emailQueries';
import { agentFacingMessage } from '../data/errors';
import { browserDownloadIo, downloadAttachment } from '../data/attachments';
import { fetchReadState, markRead as persistRead, type ReadStateMap } from '../data/readState';
import { collapsedOlderCount, isUnread, messageToOpen, worthPersisting } from '../domain/unread';
import { initialExpansion } from '../domain/listRows';
import {
  buildParticipantIndex, EMPTY_FILTER, filterThreads, isFilterActive, participantOptions,
  type ParticipantIndex, type ThreadFilter,
} from '../domain/filter';
import { ThreadList } from './ThreadList';
import { useSender } from './useSender';
import { useCompose, type Notice } from './useCompose';
import { toSummary, type ThreadSummary } from '../domain/threadSummary';
import { ReadingPane, type MessageState } from './ReadingPane';
import { Compose } from './Compose';
import { type DraftApiLike } from '../data/draft';
import { describeSaved } from '../domain/draft';
import { sizeWarning } from '../domain/attachments';
import { ourAddresses as ourAddressesFor } from '../domain/sender';
import { sendBlockedBy } from '../domain/preflight';
import { resolveXrmUtility } from '../data/recipients';
import { initialBodyWithSignature } from '../domain/signature';
import { T } from './tokens';
import { ErrorBoundary } from './parts';
import { cssVariables, resolveThemeMode, type ThemeSignals } from './theme';

/**
 * The shell. Owns data loading, selection, expansion and read state, and hands the two cards
 * everything they render.
 *
 * Sizing comes from `domain/layout.ts`, which encodes both measured traps: `allocatedHeight` is
 * −1 on a form tab so height is claimed from the viewport, and width must be claimed too because
 * the subgrid cell's ancestors content-size their child.
 */

export interface EmailClientRootProps {
  caseId?: string;
  caseIdSource: 'property' | 'contextInfo' | 'unresolved';
  webApi: DraftApiLike;
  /** N7. What the host tells us about its theme; see `resolveThemeMode`. */
  themeSignals?: ThemeSignals;
  /** `context.userSettings.userId`, braces and all — R6 read state is per agent. */
  userId?: string;
  allocatedHeight: number;
  allocatedWidth: number;
  /** Restored from `setControlState` after a session-switch teardown (R16/N1). */
  restored?: RestorableState;
  onStateChange: (state: RestorableState) => void;
}

/** The slice of UI state that survives a teardown. Bodies are excluded: they are re-fetchable. */
export interface RestorableState {
  selectedThreadKey?: string;
  expandedMessageIds?: string[];
  readMessageIds?: string[];
  scrollTop?: number;
  /** R8. A standing choice about what the list is for, so it survives a teardown. */
  includeParent?: boolean;
  /** Issue #4. Conversations expanded in the list, and the single message being read. */
  expandedThreadKeys?: string[];
  selectedMessageId?: string;
  /**
   * The compose that was open, so a session switch does not close it (M11). Its text is not
   * here: it is on the draft row, which is re-read and re-checked on restore.
   */
  compose?: { mode: ComposeMode; activityId: string; emailId?: string };
}

export const EmailClientRoot: React.FC<EmailClientRootProps> = (props) => {
  const {
    caseId, caseIdSource, webApi, userId, allocatedHeight, allocatedWidth, restored, onStateChange,
    themeSignals,
  } = props;

  // N7. Recomputed per render rather than held in state: the host can change theme under us, and
  // `updateView` is how we hear about it.
  const themeMode = resolveThemeMode({
    ...themeSignals,
    prefersDark: themeSignals?.prefersDark
      ?? (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : undefined),
  });

  const rootRef = React.useRef<HTMLDivElement>(null);
  const [rootTop, setRootTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(
    typeof window === 'undefined' ? 800 : window.innerHeight,
  );

  const [rows, setRows] = React.useState<EmailRow[]>([]);
  const [parties, setParties] = React.useState<Map<string, MessageParties>>(new Map());
  /** Derived, not stored: a second copy of the rows is one more thing to keep in step. */
  const threads = React.useMemo<Thread[]>(() => buildThreads(rows), [rows]);
  const [loading, setLoading] = React.useState(true);
  const [listError, setListError] = React.useState<ReturnType<typeof agentFacingMessage>>();

  const [selectedKey, setSelectedKey] = React.useState(restored?.selectedThreadKey);
  const [states, setStates] = React.useState<Map<string, MessageState>>(new Map());
  const [collapsedOlder, setCollapsedOlder] = React.useState(0);
  const [readIds, setReadIds] = React.useState<Set<string>>(new Set(restored?.readMessageIds ?? []));
  /**
   * R8 — "include parent case", persisted through a teardown.
   *
   * Unlike a search term this is a deliberate standing choice about what the list is *for*, so
   * losing it on a session switch would be the wrong kind of forgetting. It does cost a reload
   * when toggled, which is why it is a toggle and not a filter.
   */
  const [includeParent, setIncludeParent] = React.useState(restored?.includeParent ?? false);
  const [ancestorCases, setAncestorCases] = React.useState<AncestorCase[]>([]);

  /**
   * Issue #4 — which conversations are expanded IN THE LIST, and which single message is open.
   *
   * Session UI state, so it goes through `setControlState` alongside the selection: coming back to
   * a session with the list collapsed and your place lost is exactly what that mechanism exists to
   * prevent. Not durable, though — it is about this sitting, not about this case forever.
   */
  const [expandedThreadKeys, setExpandedThreadKeys] = React.useState<Set<string>>(
    new Set(restored?.expandedThreadKeys ?? []),
  );
  const [selectedMessageId, setSelectedMessageId] = React.useState(restored?.selectedMessageId);
  /** True once the first load has chosen what to open, so it never overrides the agent later. */
  const landed = React.useRef(false);



  /**
   * The durable rows this agent already has (R6), keyed by message id.
   *
   * Held in a ref rather than state because nothing renders from it — it exists so a re-mark can
   * skip the write. `context.webAPI` has no `execute` and therefore cannot upsert by the alternate
   * key, so this page IS the "does a row exist?" check.
   */
  const readRows = React.useRef<ReadStateMap>(new Map());
  /** Set once if a read-state write fails, so the agent is told but not nagged per message. */
  const readStateWarned = React.useRef(false);
  /** Transient notice for a failed download. Not persisted — it is about one click. */
  /**
   * `tone: 'info'` for good news. Success used to arrive in the danger styling with
   * `role="alert"`, so "Sent" looked — and was announced — like an error (L11).
   */
  const [notice, setNotice] = React.useState<Notice>();

  // Bodies are cached for the control's lifetime and deliberately NOT persisted: they are large
  // and re-fetchable, and putting them in setControlState would bloat every session switch.
  const bodyCache = React.useRef(new Map<string, string>());
  const bodyRequests = React.useRef(new Map<string, Promise<string | undefined>>());

  // ── sizing ─────────────────────────────────────────────────────────────────
  React.useEffect(() => {
    const measure = () => {
      setRootTop(Math.round(rootRef.current?.getBoundingClientRect().top ?? 0));
      setViewportHeight(window.innerHeight);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const layout = resolveLayout({ allocatedHeight, allocatedWidth, viewportHeight, rootTop });

  // ── load ───────────────────────────────────────────────────────────────────
  // Same reasoning as `onStateChangeRef`: `context.webAPI` is not promised to be a stable
  // reference across `updateView`, and if it is not, having it in the dependency array below would
  // re-run the whole load on every render. The case id is the only thing that should trigger a
  // reload.
  const webApiRef = React.useRef(webApi);
  webApiRef.current = webApi;

  /**
   * Loads can overlap — Refresh, the include-parent toggle, the reloads after a send — and nothing
   * cancelled the older one, so a slow answer could land after a newer one and overwrite it (M12).
   * Each load takes a number, and only the latest may write.
   */
  const loadSeq = React.useRef(0);
  /**
   * The first load has finished, READ STATE INCLUDED. The landing waits for this: run on the
   * rows alone, it chose "the newest unread message" before anything was known to be read (M12).
   */
  const [loaded, setLoaded] = React.useState(false);

  const load = React.useCallback(async () => {
    const webApi = webApiRef.current;
    const seq = ++loadSeq.current;
    const latest = () => seq === loadSeq.current;
    if (!caseId) { setLoading(false); return; }
    setLoading(true);
    setListError(undefined);
    try {
      // R8 — ancestor cases, when the agent has asked for them.
      //
      // The ancestry walk happens BEFORE the list query so both can go in one request. It is two
      // cheap retrieves per level and the chain is almost always empty, but when it fails the
      // right answer is this case's own mail, not an error: a broken parent link must not cost
      // the agent the case they are actually looking at.
      let ancestors: AncestorCase[] = [];
      if (includeParent) {
        try {
          ancestors = await fetchAncestry(webApi, caseId);
        } catch {
          ancestors = [];
        }
      }
      if (!latest()) return;
      setAncestorCases(ancestors);

      const caseIds = [caseId, ...ancestors.map((a) => a.caseId)];
      const fetched = await fetchCaseEmails(webApi, caseIds);
      if (!latest()) return;
      setRows(fetched);
      // Recipients are a second, batched query rather than an $expand on the list.
      const fetchedParties = await fetchParties(webApi, fetched.map((r) => r.activityid));
      if (!latest()) return;
      setParties(fetchedParties);

      // R6 — durable read state, one page for this case and this agent. Deliberately AFTER the
      // list is in state: this query must never be able to delay the mail appearing, and it
      // resolves its own failure rather than throwing, so a read-state problem renders as
      // "everything looks unread" instead of as a case with no mail on it.
      if (userId) {
        const { read, error } = await fetchReadState(webApi, caseId, userId);
        if (!latest()) return;
        readRows.current = read;
        // UNION with whatever `setControlState` restored, never a replacement. A mark made seconds
        // ago whose write has not landed yet must not be undone by the server's older answer.
        setReadIds((prev) => new Set([...prev, ...read.keys()]));
        if (error && !readStateWarned.current) {
          readStateWarned.current = true;
          setNotice({
            headline: 'Read state is not being saved',
            detail: `${error.message} Messages you open will look unread again next time.`,
          });
        }
      }
      setLoaded(true);
    } catch (e) {
      if (!latest()) return;
      const normalised = e instanceof DataverseError
        ? e.normalised
        : { message: String(e), raw: e };
      setListError(agentFacingMessage(normalised, 'list'));
      setRows([]);
    } finally {
      if (latest()) setLoading(false);
    }
  }, [caseId, userId, includeParent]);


  React.useEffect(() => { void load(); }, [load]);

  // R17/R18/R15/R14 — who mail goes out as, whether it can leave, its signature, the templates.
  const {
    senderState, setSenderState, chosenSender, signatureHtml, templates, orgPolicyRef,
  } = useSender(caseId, userId, webApiRef);



  // Deliberately the UNFILTERED threads. A filter that hides the thread you are reading should
  // not also close it — you would lose your place for having narrowed the list beside it. The
  // reading pane keeps showing it; the list simply stops listing it, and the chips say why.
  const selected = threads.find((t) => t.key === selectedKey);

  /**
   * Lazy body fetch — on expand only, never in the list query.
   *
   * Resolves to the body, or `undefined` if it would not load. A second caller while the fetch
   * is in flight gets the SAME promise: returning early instead, as this used to, meant Reply
   * clicked straight after opening a message read an empty cache and quoted nothing (M10).
   */
  const ensureBody = React.useCallback((activityId: string): Promise<string | undefined> => {
    if (bodyCache.current.has(activityId)) return Promise.resolve(bodyCache.current.get(activityId));
    const pending = bodyRequests.current.get(activityId);
    if (pending) return pending;

    const webApi = webApiRef.current;
    const request = (async (): Promise<string | undefined> => {
      setStates((prev) => withState(prev, activityId, (s) => ({ ...s, loadingBody: true, bodyError: undefined })));
      try {
        // The attachment list failing is not the body failing: it gets its own line (L11).
        const [body, attachments] = await Promise.all([
          fetchBody(webApi, activityId),
          fetchAttachments(webApi, activityId).catch(() => undefined),
        ]);
        bodyCache.current.set(activityId, body);
        setStates((prev) => withState(prev, activityId, (s) => ({
          ...s, body, attachments, attachmentsError: attachments === undefined, loadingBody: false,
        })));
        return body;
      } catch (e) {
        const normalised = e instanceof DataverseError ? e.normalised : { message: String(e), raw: e };
        // Scoped to this message. One body that will not load must never blank the thread.
        setStates((prev) => withState(prev, activityId, (s) => ({
          ...s, loadingBody: false, bodyError: agentFacingMessage(normalised, 'body').detail,
        })));
        return undefined;
      } finally {
        bodyRequests.current.delete(activityId);
      }
    })();
    bodyRequests.current.set(activityId, request);
    return request;
  }, []);

  // Open the newest UNREAD message on selection; if all are read, the newest. Older messages
  // collapse into one row rather than being listed individually.
  /**
   * Opens one message of a conversation in the reading pane.
   *
   * The pane still renders the whole conversation as a stack (option (b) in issue #4) and simply
   * expands and scrolls to the chosen message. That keeps the dwell/read-state machinery and the
   * quoted-history context exactly as they are — the alternative, a strictly single-message pane,
   * would move the R6 dwell trigger, and R6 is the requirement most recently and expensively made
   * to work.
   */
  const openMessage = React.useCallback((key: string, activityId: string) => {
    setSelectedKey(key);
    setSelectedMessageId(activityId);
    const thread = threads.find((t) => t.key === key);
    if (!thread) return;

    setCollapsedOlder(collapsedOlderCount(
      thread.messages.length,
      thread.messages.findIndex((m) => m.activityid === activityId),
    ));
    setStates((prev) => {
      const next = new Map(prev);
      for (const m of thread.messages) {
        next.set(m.activityid, {
          ...(next.get(m.activityid) ?? blankState(!isUnread(m, readIds))),
          expanded: m.activityid === activityId,
          unread: isUnread(m, readIds),
        });
      }
      return next;
    });
    void ensureBody(activityId);
  }, [threads, readIds, ensureBody]);

  /** Selecting the conversation itself: lands on the message worth reading. */
  const selectThread = React.useCallback((key: string) => {
    const thread = threads.find((t) => t.key === key);
    if (!thread) { setSelectedKey(key); return; }
    // Newest unread INCOMING message, or the newest message if nothing is waiting. Without the
    // direction check this auto-opened the agent's own sent mail and treated it as unread.
    const target = messageToOpen(thread.messages, readIds);
    if (!target) { setSelectedKey(key); return; }
    openMessage(key, target.activityid);
    // The conversation, not one message of it, is what the agent picked — so the header keeps the
    // selected look rather than handing it to a child row.
    setSelectedMessageId(undefined);
  }, [threads, readIds, openMessage]);

  /** Issue #4 — expand or collapse a conversation in the list. Does not change what is being read. */
  const toggleExpand = React.useCallback((key: string) => {
    setExpandedThreadKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    // Expanding a conversation you are not reading should still show it, the way clicking its row
    // always has. Collapsing changes nothing about the pane.
    if (key !== selectedKey) selectThread(key);
  }, [selectedKey, selectThread]);

  /**
   * A message clicked in the READING PANE.
   *
   * Selection has to be one fact, not one per pane. Before this, opening a message here left the
   * list still highlighting whatever was picked last, so the two panes disagreed about what you
   * were reading — and the list is where you look to answer "where am I?".
   *
   * Expanding selects; collapsing the selected message clears the selection and hands the
   * highlight back to the conversation row. It deliberately does **not** expand the conversation
   * in the list: if you collapsed it there to save room, having it spring open on every click in
   * the pane is the client arguing with you.
   */
  const toggleMessage = (activityId: string) => {
    const wasExpanded = states.get(activityId)?.expanded ?? false;
    setStates((prev) => withState(prev, activityId, (s) => ({ ...s, expanded: !s.expanded })));
    if (!wasExpanded) {
      setSelectedMessageId(activityId);
      void ensureBody(activityId);
    } else {
      setSelectedMessageId((current) => (current === activityId ? undefined : current));
    }
  };

  /**
   * R6 — the dwell timer fired: this message has genuinely been read.
   *
   * The UI updates first and the write follows. Read state is an ornament on a list of mail, and
   * an agent watching a dot linger while a request completes would reasonably conclude the client
   * is broken. If the write fails the dot has still gone — it simply comes back tomorrow, which
   * the notice says.
   */
  const markRead = (activityId: string) => {
    const alreadyKnown = readIds.has(activityId);
    setReadIds((prev) => {
      if (prev.has(activityId)) return prev;
      const next = new Set(prev);
      next.add(activityId);
      return next;
    });
    setStates((prev) => withState(prev, activityId, (s) => ({ ...s, unread: false })));

    // Nothing durable to do if we already knew, or if there is no agent to attribute it to.
    if (alreadyKnown || !caseId || !userId) return;
    // And nothing worth storing for our own sent mail: an outgoing message can never be unread,
    // so the row could never change what anyone sees. Before this check, dwelling on a thread of
    // replies wrote one useless row per message per agent.
    const message = rows.find((r) => r.activityid === activityId);
    if (message && !worthPersisting(message)) return;

    void (async () => {
      const outcome = await persistRead(
        webApiRef.current,
        { emailId: activityId, userId, caseId },
        readRows.current,
      );
      if (outcome.ok) {
        // Remember it so a second dwell — or a reload racing this write — skips the request.
        readRows.current.set(
          activityId.toLowerCase(),
          { rowId: outcome.rowId ?? '', readOn: new Date() },
        );
        return;
      }
      if (!readStateWarned.current) {
        readStateWarned.current = true;
        setNotice({
          headline: 'Read state is not being saved',
          detail: `${outcome.error?.message ?? 'The write was refused.'} `
            + 'Messages you open will look unread again next time.',
        });
      }
    })();
  };

  // ── R7: filter and search ──────────────────────────────────────────────────
  //
  // The filter lives here because the data it filters does. It is NOT persisted through
  // `setControlState`: coming back to a session to find the list mysteriously showing three of
  // nine threads is worse than retyping a search, and the chips that would explain it are the
  // first thing to scroll out of sight.
  const [filter, setFilter] = React.useState<ThreadFilter>(EMPTY_FILTER);

  const ancestorNumbers = React.useMemo(
    () => new Map(ancestorCases.map((a) => [a.caseId, a.ticketNumber])),
    [ancestorCases],
  );

  /** Built once per parties load, not per keystroke — see `buildParticipantIndex`. */
  const participantIndex = React.useMemo<ParticipantIndex>(
    () => buildParticipantIndex(parties),
    [parties],
  );

  const visibleThreads = React.useMemo(
    () => filterThreads(threads, participantIndex, readIds, filter),
    [threads, participantIndex, readIds, filter],
  );

  const participantChoices = React.useMemo(
    () => participantOptions(threads, participantIndex),
    [threads, participantIndex],
  );


  /** Every address that is *us* — the union rule lives, tested, in `domain/sender.ts`. */
  const ourAddresses = React.useMemo(
    () => ourAddressesFor(senderState.candidates, rows, (id) => parties.get(id)?.sender?.address),
    [senderState.candidates, rows, parties],
  );

  // ── compose (R9–R17) — see ui/useCompose.ts ────────────────────────────────
  const {
    compose, setCompose, composeContentHeight, setComposeContentHeight, composeHighWater,
    editorRef, bodyTouched, seeding, latestHtml, attachments, rejections, inlineBytes,
    sendReport, sending, openCompose, openComposeRef, closeCompose, closeComposeRef,
    scheduleDraftSave, markPartiesDirty, addFiles, addRecipients, removeAttachment, sendDraft,
    changeSender, resolveTemplate,
  } = useCompose({
    caseId, userId, webApiRef, rows, parties, ourAddresses, ensureBody, load, setNotice,
    senderState, setSenderState, chosenSender, signatureHtml, orgPolicyRef,
  });

  // ── persist what survives a teardown ───────────────────────────────────────
  //
  // `onStateChange` is held in a ref and deliberately NOT in the dependency array.
  //
  // It reaches us as a fresh closure on every `updateView`, and the callback calls
  // `setControlState`, which makes the platform call `updateView` again. Depending on its identity
  // therefore closes a loop: effect → setControlState → updateView → new closure → effect. That
  // hung the published app solid on 2026-09-11 until it was found. The ref keeps the latest
  // callback without making its identity a trigger.
  const onStateChangeRef = React.useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  // The compose fields effects key on, as primitives: the draft object itself changes on every
  // keystroke-driven save, and an effect keyed on it would re-run with each one.
  const composeMode = compose?.mode;
  const composeActivity = compose?.activityId;
  const composeEmailId = compose?.emailId;

  React.useEffect(() => {
    onStateChangeRef.current({
      selectedThreadKey: selectedKey,
      expandedMessageIds: [...states.entries()].filter(([, s]) => s.expanded).map(([id]) => id),
      readMessageIds: [...readIds],
      includeParent,
      expandedThreadKeys: [...expandedThreadKeys],
      selectedMessageId,
      compose: composeMode && composeActivity
        ? { mode: composeMode, activityId: composeActivity, emailId: composeEmailId }
        : undefined,
    });
  }, [
    selectedKey, states, readIds, includeParent, expandedThreadKeys, selectedMessageId,
    composeMode, composeActivity, composeEmailId,
  ]);

  /**
   * First load: open the conversation holding the message worth landing on, and select it.
   *
   * Outlook collapses everything by default and mostly that is right — but landing an agent on a
   * list where nothing is open wastes the one thing the client knows: which message is waiting.
   * Guarded by `landed` so it happens once and never argues with the agent afterwards, and skipped
   * entirely when `setControlState` already restored a choice.
   */
  React.useEffect(() => {
    if (landed.current || !loaded || threads.length === 0) return;
    landed.current = true;

    // M11 — a teardown used to close compose and collapse every message. Put back what was open.
    if (restored?.compose) {
      const { mode, activityId, emailId } = restored.compose;
      void openComposeRef.current?.(mode, activityId, emailId);
    }
    if (restored?.selectedThreadKey || (restored?.expandedThreadKeys?.length ?? 0) > 0) {
      const onCase = new Set(rows.map((r) => r.activityid));
      const reopen = (restored?.expandedMessageIds ?? []).filter((id) => onCase.has(id));
      if (reopen.length > 0) {
        setStates((prev) => {
          const next = new Map(prev);
          for (const id of reopen) {
            const row = rows.find((r) => r.activityid === id);
            const unread = row ? isUnread(row, readIds) : false;
            next.set(id, { ...(next.get(id) ?? blankState(!unread)), expanded: true, unread });
          }
          return next;
        });
        for (const id of reopen) void ensureBody(id);
      }
      return;
    }
    const first = threads.find((t) => messageToOpen(t.messages, readIds) !== undefined);
    const target = first ? messageToOpen(first.messages, readIds) : undefined;
    if (!first || !target) return;

    setExpandedThreadKeys(initialExpansion(
      threads.map((t) => ({ thread: t, unreadCount: 0 })),
      target.activityid,
    ));
    // …and open it, so the pane is not empty next to a list that has already decided what matters.
    //
    // NOTE, because it is a real behaviour change: the dwell timer will now mark that message read
    // shortly after the case opens, without the agent clicking anything. That follows from landing
    // on it — it is expanded and on screen, which is exactly what Gate 2 defined as read. If that
    // proves too eager, the fix is to land WITHOUT selecting rather than to weaken the dwell rule.
    openMessage(first.key, target.activityid);
    setSelectedMessageId(undefined);
  }, [loaded, threads, rows, readIds, restored, openMessage, ensureBody, openComposeRef]);

  /**
   * The record under the control changed. Everything keyed to the old case goes, and an open
   * compose is settled first — against ITS case, which it carries, not the new one.
   */
  const shownCase = React.useRef(caseId);
  React.useEffect(() => {
    if (shownCase.current === caseId) return;
    shownCase.current = caseId;
    landed.current = false;
    setLoaded(false);
    setSelectedKey(undefined);
    setSelectedMessageId(undefined);
    setStates(new Map());
    setExpandedThreadKeys(new Set());
    setReadIds(new Set());
    bodyCache.current.clear();
    readRows.current = new Map();
    // Through a ref: `closeCompose` is declared further down, and naming it in the dependency
    // array reads it during render, before its declaration has run.
    void closeComposeRef.current?.();
    setCompose(undefined);
  }, [caseId, closeComposeRef, setCompose]);

  const summaries = React.useMemo<ThreadSummary[]>(
    () => visibleThreads.map((thread) => toSummary(
      thread, (id) => parties.get(id)?.sender?.name, readIds, ancestorNumbers,
    )),
    [visibleThreads, parties, readIds, ancestorNumbers],
  );

  const unreadTotal = rows.filter((r) => isUnread(r, readIds)).length;

  if (caseIdSource === 'unresolved') return <NoCaseContext />;

  return (
    <div
      ref={rootRef}
      style={{
        // N7 — every themed token resolves from these. One place to set, everything follows.
        ...cssVariables(themeMode),
        // Tells the browser to theme its own furniture (scrollbars, date pickers, checkboxes) to
        // match. Without it a dark card grows white scrollbars and a white date picker.
        colorScheme: themeMode,
        height: layout.height,
        width: layout.width,
        boxSizing: 'border-box',
        background: T.bg2,
        padding: '8px',
        display: 'flex',
        gap: '8px',
        fontFamily: T.font,
        fontSize: '14px',
        color: T.fg1,
        minWidth: 0,
        position: 'relative',
      }}
    >
      {/* A refused download must be visible. A click that silently does nothing is worse than an
          error message, because the agent assumes the file is on its way. */}
      {notice && (
        <div
          role={notice.tone === 'info' ? 'status' : 'alert'}
          style={{
            position: 'absolute', left: '8px', right: '8px', bottom: '8px', zIndex: 2,
            display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px 12px',
            boxSizing: 'border-box',
            background: notice.tone === 'info' ? T.bg1 : T.dangerBg,
            border: `1px solid ${notice.tone === 'info' ? T.stroke1 : T.dangerStroke}`,
            borderRadius: '4px',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke={notice.tone === 'info' ? T.fg2 : T.dangerFg} strokeWidth="1.5" style={{ flex: '0 0 15px', marginTop: '2px' }} aria-hidden="true">
            <circle cx="10" cy="10" r="7.2" /><path d="M10 6.3v4.6M10 13.2v.4" />
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: notice.tone === 'info' ? T.fg1 : T.dangerFg }}>{notice.headline}</span>
            <span style={{ fontSize: '12px', color: T.fg2 }}>{notice.detail}</span>
          </div>
          <span style={{ flexGrow: 1 }} />
          <button
            type="button"
            onClick={() => setNotice(undefined)}
            aria-label="Dismiss"
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: T.fg2, font: 'inherit', fontSize: '13px' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Below 900px the list and the reading pane share one column; above it, two panes. */}
      {(layout.layout === 'two-pane' || !selected) && (
        <ThreadList
          summaries={summaries}
          selectedKey={selectedKey}
          unreadTotal={unreadTotal}
          loading={loading}
          error={listError}
          onRetry={() => void load()}
          onSelect={selectThread}
          expandedThreadKeys={expandedThreadKeys}
          onToggleExpand={toggleExpand}
          onSelectMessage={openMessage}
          selectedMessageId={selectedMessageId}
          readIds={readIds}
          parties={parties}
          onRefresh={() => void load()}
          // The REAL total, not the filtered one: "no results" and "this customer has never
          // emailed" look identical unless the count says which.
          totalThreadCount={threads.length}
          filterActive={isFilterActive(filter)}
          onClearFilters={() => setFilter(EMPTY_FILTER)}
          parentCaseThreadCount={summaries.filter((s) => s.parentCaseNumber).length}
          filter={filter}
          onFilterChange={setFilter}
          participantOptions={participantChoices}
          includeParent={includeParent}
          onIncludeParentChange={setIncludeParent}
          // Absent when this case has no parent, so the toggle is offered only where it means
          // something. Known only after a load with the toggle on, so the control explains that
          // rather than silently doing nothing.
          ancestorCount={ancestorCases.length}
        />
      )}

      {/* The reading pane and compose share one column: compose is DOCKED, so its height comes
          out of the pane rather than out of the page. Gate 2. */}
      {(layout.layout === 'two-pane' || selected) && (
        <div
          style={{
            display: 'flex', flexDirection: 'column', flexGrow: 1,
            minWidth: 0, minHeight: 0, gap: '8px',
          }}
        >
        <ErrorBoundary label="The reading pane">
        <ReadingPane
          thread={selected}
          parties={parties}
          states={states}
          collapsedOlderCount={selected ? Math.min(collapsedOlder, selected.messages.length - 1) : 0}
          onExpandOlder={() => setCollapsedOlder(0)}
          focusMessageId={selectedMessageId}
          onToggleMessage={toggleMessage}
          onToggleQuote={(id) => setStates((p) => withState(p, id, (s) => ({ ...s, quoteExpanded: !s.quoteExpanded })))}
          onToggleNotices={(id) => setStates((p) => withState(p, id, (s) => ({ ...s, noticesExpanded: !s.noticesExpanded })))}
          onDownloadAttachment={(a) => {
            setNotice(undefined);
            void downloadAttachment(
              webApiRef.current,
              {
                activityMimeAttachmentId: a.id,
                filename: a.filename,
                mimeType: a.mimeType,
                fileSize: a.fileSize,
              },
              browserDownloadIo,
            ).then((outcome): void => {
              // A refusal must be visible. A click that silently does nothing is worse than an
              // error, because the agent assumes the file is on its way.
              if (!outcome.ok) {
                setNotice({
                  headline: outcome.reason ?? "Couldn't download that file",
                  detail: outcome.detail ?? '',
                });
              }
              return undefined;
            });
          }}
          onDwellRead={markRead}
          onRetryBody={(id) => { void ensureBody(id); }}
          onCompose={(mode: ComposeMode, id: string) => { void openCompose(mode, id); }}
          loading={loading && !!selectedKey}
          error={listError}
          onRetry={() => void load()}
        />
        </ErrorBoundary>

        {compose && (
          <ErrorBoundary label="The reply" key={`boundary-${compose.session}`}>
          <Compose
            // One editor per compose session. `Editor` reads `initialHtml` once, so reusing it for
            // a different message carried the previous message's text across (H2).
            key={compose.session}
            ref={editorRef}
            mode={compose.mode}
            answeringLabel={compose.answeringLabel}
            to={compose.to}
            cc={compose.cc}
            subject={compose.subject}
            quotedBlock={compose.quotedBlock}
            resumed={compose.resumedHtml !== undefined}
            height={composeHeight(composeContentHeight, composeHighWater.current)}
            onHeightChange={(h) => {
              composeHighWater.current = Math.max(composeHighWater.current, composeHeight(h));
              setComposeContentHeight(h);
            }}
            onClose={() => {
              // Save on the way out, or clean up a blank draft this client created. The save
              // snapshots the editor before compose unmounts, so closing loses nothing.
              void closeCompose();
              composeHighWater.current = 0;
              setCompose(undefined);
            }}
            onSubjectChange={(next) => {
              setCompose((c) => (c ? { ...c, subject: next } : c));
              scheduleDraftSave();
            }}
            onAddRecipients={resolveXrmUtility() ? (field) => void addRecipients(field) : undefined}
            flagUnresolved={!orgPolicyRef.current.allowUnresolved}
            onRemoveRecipient={(field, address) => {
              setCompose((c) => (c
                ? { ...c, [field]: c[field].filter((r) => r.address !== address) }
                : c));
              // The next save must rewrite the party rows, not just the body.
              markPartiesDirty();
              scheduleDraftSave();
            }}
            // R18 — Send stays blocked until the sender's mailbox has been pre-flighted, which is
            // 2.5. Blocked WITH a reason, never a mystery grey button: an agent who cannot send
            // and is not told why will send it some other way.
            // R15 — the signature is the body's starting content, with blank lines above it so
            // the cursor does not land inside the agent's own sign-off.
            initialHtml={compose.resumedHtml ?? initialBodyWithSignature(signatureHtml)}
            templates={templates}
            onUseTemplate={resolveTemplate}
            sender={chosenSender}
            candidates={senderState.candidates}
            senderVerdicts={senderState.verdicts}
            onSenderChange={changeSender}
            onBodyChange={() => {
              if (seeding.current) return;
              bodyTouched.current = true;
              latestHtml.current = editorRef.current?.getHTML();
              scheduleDraftSave();
            }}
            attachments={attachments}
            onAddFiles={(files) => void addFiles(files)}
            onRemoveAttachment={removeAttachment}
            attachmentRejections={rejections}
            attachmentWarning={sizeWarning(attachments, inlineBytes)}
            savedLabel={describeSaved(compose.savedAt ? new Date(compose.savedAt) : undefined)}
            saveError={compose.saveError}
            signatureStale={compose.signatureStale}
            // Pre-flight decides this now (R18). Until it has answered, `sendBlockedBy` reports
            // "checking" and Send stays disabled — the only safe state before the check lands.
            // The remaining "not built yet" is the write path itself (2.5).
            // R18. Undefined only when pre-flight has answered AND passed; until then it
            // reports "checking", which keeps Send disabled — the only safe state before the
            // check lands. Re-checked again at the moment of sending.
            sendBlockedReason={sendBlockedBy(senderState.verdicts.get(chosenSender.id))}
            onSend={() => void sendDraft()}
            sending={sending}
            sendReport={sendReport}
          />
          </ErrorBoundary>
        )}
        </div>
      )}
    </div>
  );
};





const blankState = (read: boolean): MessageState => ({
  loadingBody: false,
  expanded: false,
  quoteExpanded: false,
  noticesExpanded: false,
  unread: !read,
});

function withState(
  map: Map<string, MessageState>,
  id: string,
  update: (s: MessageState) => MessageState,
): Map<string, MessageState> {
  const next = new Map(map);
  next.set(id, update(next.get(id) ?? blankState(false)));
  return next;
}


/**
 * The one host we cannot serve: no record context. Says what is wrong rather than rendering an
 * empty box, because this is a configuration problem someone has to fix.
 */
const NoCaseContext: React.FC = () => (
  <div
    role="alert"
    style={{
      padding: '16px', fontFamily: T.font, fontSize: '14px', color: T.fg1,
      display: 'flex', flexDirection: 'column', gap: '6px',
    }}
  >
    <span style={{ fontWeight: 600 }}>This control needs to be on a Case form</span>
    <span style={{ color: T.fg3, fontSize: '13px' }}>
      It could not determine which case to show. On a form the record arrives automatically; in a
      side pane or under a <code style={{ fontFamily: T.mono }}>Control</code> tab template it never
      does. See docs/design/01-design-decisions.md.
    </span>
  </div>
);
