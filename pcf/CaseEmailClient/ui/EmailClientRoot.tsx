import * as React from 'react';
import { buildThreads, type EmailRow, type Thread } from '../domain/threading';
import { resolveLayout, composeHeight, LIST_WIDTH } from '../domain/layout';
import {
  buildOutgoingBody, buildQuotedBlock, composeSubject, headerFor, resolveRecipients,
  type ComposeMode, type Recipient,
} from '../domain/compose';
import {
  DataverseError, fetchAncestry, fetchAttachments, fetchBody, fetchCaseEmails, fetchParties,
  type AncestorCase, type Attachment, type MessageParties,
} from '../data/emailQueries';
import { agentFacingMessage } from '../data/errors';
import { browserDownloadIo, downloadAttachment } from '../data/attachments';
import { fetchReadState, markRead as persistRead, type ReadStateApiLike, type ReadStateMap } from '../data/readState';
import {
  collapsedOlderCount, isUnread, messageToOpen, worthPersisting,
} from '../domain/unread';
import { initialExpansion } from '../domain/listRows';
import {
  EMPTY_FILTER, filterThreads, isFilterActive, participantOptions,
  type ParticipantIndex, type ThreadFilter,
} from '../domain/filter';
import { ThreadList, type ThreadSummary } from './ThreadList';
import { ReadingPane, type MessageState } from './ReadingPane';
import { Compose, type TemplateOutcome } from './Compose';
import { fetchSignatureFor } from '../data/signature';
import { discardDraft, findExistingDraft, saveDraft, type DraftApiLike } from '../data/draft';
import { describeSaved, worthSaving } from '../domain/draft';
import {
  admitFiles, blockProgress, DEFAULT_INLINE_CEILING, sizeWarning,
  type PendingAttachment, type Rejection,
} from '../domain/attachments';
import {
  fetchInlineCeiling, fileToBytes, removeAttachment as removeAttachmentRow, reuseAttachment,
  uploadAttachment,
} from '../data/attachmentUpload';
import { fetchCaseQueue, fetchQueueById } from '../data/caseQueue';
import { fetchSettings } from '../data/settings';
import { fetchAgentIdentity, fetchOrgApprovalPolicy, preflightCandidate } from '../data/preflight';
import {
  pickSetting, resolveSender, selfAddresses, type SenderCandidate,
} from '../domain/sender';
import { sendBlockedBy, type PreflightVerdict } from '../domain/preflight';
import {
  blockingReasonBeforeSend, EMAIL_STATUS, isInFlight, reportFor, type SendReport,
} from '../domain/send';
import { issueSend, pollUntilSettled } from '../data/send';
import {
  fetchCaseTemplates, instantiateTemplate, resolveXrmExecute, type EmailTemplate,
} from '../data/templates';
import { initialBodyWithSignature } from '../domain/signature';
import { sanitiseEmailBody } from '../domain/sanitise';
import { splitQuotedHistory } from '../domain/quoting';
import type { EditorHandle } from './Editor';
import { formatWhen, T } from './tokens';
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
  const [threads, setThreads] = React.useState<Thread[]>([]);
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
   * save would never fire. So it depends only on `caseId` and reads everything else through
   * these, which are updated on every render.
   */
  const composeRef = React.useRef<ComposeDraft>();
  /** Live mirror of the attachment list, for callbacks that must not depend on it. */
  const attachmentsRef = React.useRef<PendingAttachment[]>([]);
  const inlineBytesRef = React.useRef(0);
  const signatureRef = React.useRef('');
  const senderRef = React.useRef<SenderCandidate>();

  /**
   * R15 signature and R14 templates — fetched once per case, not per compose-open.
   *
   * Both are conveniences: each resolves its own failure to "empty" rather than throwing, so a
   * missing signature or an unreachable template list costs a nicety and never the reply.
   */
  const [signatureHtml, setSignatureHtml] = React.useState('');
  const [templates, setTemplates] = React.useState<EmailTemplate[]>([]);

  /**
   * Who outgoing mail goes out as (R17), and whether it can actually leave (R18).
   *
   * Resolved once per case, in one batched state object so the compose surface never renders
   * against a half-resolved sender. Until it resolves there is one candidate — the agent — with
   * no verdict, which `sendBlockedBy` reports as "checking": Send stays disabled, which is the
   * only safe state to be in before pre-flight has answered.
   */
  const [senderState, setSenderState] = React.useState<SenderState>(() => ({
    candidates: [FALLBACK_SENDER],
    chosenId: FALLBACK_SENDER.id,
    verdicts: new Map<string, PreflightVerdict>(),
  }));

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
  const [notice, setNotice] = React.useState<{ headline: string; detail: string }>();

  // Bodies are cached for the control's lifetime and deliberately NOT persisted: they are large
  // and re-fetchable, and putting them in setControlState would bloat every session switch.
  const bodyCache = React.useRef(new Map<string, string>());
  const inFlight = React.useRef(new Set<string>());

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

  const load = React.useCallback(async () => {
    const webApi = webApiRef.current;
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
      setAncestorCases(ancestors);

      const caseIds = [caseId, ...ancestors.map((a) => a.caseId)];
      const fetched = await fetchCaseEmails(webApi, caseIds);
      setRows(fetched);
      setThreads(buildThreads(fetched));
      // Recipients are a second, batched query rather than an $expand on the list.
      setParties(await fetchParties(webApi, fetched.map((r) => r.activityid)));

      // R6 — durable read state, one page for this case and this agent. Deliberately AFTER the
      // list is in state: this query must never be able to delay the mail appearing, and it
      // resolves its own failure rather than throwing, so a read-state problem renders as
      // "everything looks unread" instead of as a case with no mail on it.
      if (userId) {
        const { read, error } = await fetchReadState(webApi, caseId, userId);
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
    } catch (e) {
      const normalised = e instanceof DataverseError
        ? e.normalised
        : { message: String(e), raw: e };
      setListError(agentFacingMessage(normalised, 'list'));
      setRows([]);
      setThreads([]);
    } finally {
      setLoading(false);
    }
  }, [caseId, userId, includeParent]);

  React.useEffect(() => { void load(); }, [load]);

  // Templates. Per-org, not per-case, and a failure here must not touch the mail list's own
  // error handling.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const tpl = await fetchCaseTemplates(webApiRef.current);
      if (!cancelled) setTemplates(tpl.templates);
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * Resolve the sender, then pre-flight every candidate (R17/R18).
   *
   * Per case, because the queue is a property of the case. One `setSenderState` at the end: a
   * partially-applied sender would let compose open against a From line that is about to change.
   */
  React.useEffect(() => {
    if (!caseId || !userId) return undefined;
    let cancelled = false;

    void (async () => {
      const api = webApiRef.current;
      const bareUser = userId.replace(/^\{|\}$/g, '');

      const [queueResult, settingsResult, policyResult, user] = await Promise.all([
        fetchCaseQueue(api, caseId),
        fetchSettings(api),
        fetchOrgApprovalPolicy(api),
        fetchAgentIdentity(api, bareUser),
      ]);
      if (cancelled) return;

      // The settings table is the likeliest thing to be missing in a fresh environment — the
      // read privilege has to be granted explicitly — and its failure mode is silent (zero rows,
      // not an error). Log it so a support call has something to go on.
      if (settingsResult.error) {
        console.warn('Email client settings unreadable; sending as the agent.', settingsResult.error);
      }

      const setting = pickSetting(
        settingsResult.rows,
        // An explicit override queue is configuration about THIS case's sender, so the row that
        // names it is still chosen by the case's own queue.
        queueResult.queue?.candidate.id,
      );
      const queue = setting?.overrideQueueId
        && setting.overrideQueueId !== queueResult.queue?.candidate.id
        ? ((await fetchQueueById(api, setting.overrideQueueId)) ?? queueResult.queue)
        : queueResult.queue;
      if (cancelled) return;

      const { chosen, candidates } = resolveSender(setting, queue?.candidate, user.candidate);

      const verdicts = new Map<string, PreflightVerdict>();
      await Promise.all(candidates.map(async (c) => {
        const facts = c.kind === 'queue' && queue
          ? { approvalState: queue.approvalState, mailboxId: queue.mailboxId }
          : user.facts;
        verdicts.set(c.id, await preflightCandidate(api, c, policyResult.policy, facts));
      }));
      if (cancelled) return;

      setSenderState({ candidates, chosenId: chosen.id, verdicts });
    })();

    return () => { cancelled = true; };
  }, [caseId, userId]);

  const chosenSender = React.useMemo(
    () => senderState.candidates.find((c) => c.id === senderState.chosenId)
      ?? senderState.candidates[0] ?? FALLBACK_SENDER,
    [senderState],
  );

  /**
   * The signature belongs to the SENDER, not to the agent (R15).
   *
   * Keyed on the chosen sender, which is the whole fix: the previous version keyed on `userId`
   * and so signed queue mail with the agent's own signature. It only ever looked right because
   * this environment has exactly one signature record, owned by the agent AND pointed at by the
   * queue.
   */
  React.useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    void (async () => {
      const sig = await fetchSignatureFor(webApiRef.current, chosenSender, userId);
      if (!cancelled) setSignatureHtml(sig.html);
    })();
    return () => { cancelled = true; };
  }, [chosenSender, userId]);

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

  React.useEffect(() => {
    onStateChangeRef.current({
      selectedThreadKey: selectedKey,
      expandedMessageIds: [...states.entries()].filter(([, s]) => s.expanded).map(([id]) => id),
      readMessageIds: [...readIds],
      includeParent,
      expandedThreadKeys: [...expandedThreadKeys],
      selectedMessageId,
    });
  }, [selectedKey, states, readIds, includeParent, expandedThreadKeys, selectedMessageId]);

  // Deliberately the UNFILTERED threads. A filter that hides the thread you are reading should
  // not also close it — you would lose your place for having narrowed the list beside it. The
  // reading pane keeps showing it; the list simply stops listing it, and the chips say why.
  const selected = threads.find((t) => t.key === selectedKey);

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
  }, [threads, readIds]);

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

  /** Lazy body fetch — on expand only, never in the list query. */
  const ensureBody = React.useCallback(async (activityId: string) => {
    const webApi = webApiRef.current;
    if (bodyCache.current.has(activityId) || inFlight.current.has(activityId)) return;
    inFlight.current.add(activityId);
    setStates((prev) => withState(prev, activityId, (s) => ({ ...s, loadingBody: true, bodyError: undefined })));
    try {
      const [body, attachments] = await Promise.all([
        fetchBody(webApi, activityId),
        fetchAttachments(webApi, activityId),
      ]);
      bodyCache.current.set(activityId, body);
      setStates((prev) => withState(prev, activityId, (s) => ({
        ...s, body, attachments, loadingBody: false,
      })));
    } catch (e) {
      const normalised = e instanceof DataverseError ? e.normalised : { message: String(e), raw: e };
      // Scoped to this message. One body that will not load must never blank the thread.
      setStates((prev) => withState(prev, activityId, (s) => ({
        ...s, loadingBody: false, bodyError: agentFacingMessage(normalised, 'body').detail,
      })));
    } finally {
      inFlight.current.delete(activityId);
    }
  }, []);

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

  /**
   * Name and address of everyone on each message, for the filter to match against.
   *
   * Built once per parties load rather than per keystroke — this is the only allocation in the
   * filter path that is not O(threads), and rebuilding it on every character typed would make
   * search feel slow on exactly the busy cases where it matters.
   */
  const participantIndex = React.useMemo<ParticipantIndex>(() => {
    const searchable = new Map<string, string[]>();
    const people = new Map<string, string[]>();
    for (const [activityId, p] of parties) {
      const strings: string[] = [];
      const names: string[] = [];
      for (const party of [p.sender, ...p.to, ...p.cc, ...p.bcc]) {
        if (!party) continue;
        // Free text matches names AND addresses, so searching a domain finds the thread.
        if (party.name) strings.push(party.name);
        if (party.address) strings.push(party.address);
        // The panel lists PEOPLE: their name, or their address when they have no name. Listing
        // both made one person two entries in the dropdown.
        const display = party.name || party.address;
        if (display) names.push(display);
      }
      searchable.set(activityId, strings);
      people.set(activityId, names);
    }
    return {
      searchable: (id) => searchable.get(id),
      people: (id) => people.get(id),
    };
  }, [parties]);

  const visibleThreads = React.useMemo(
    () => filterThreads(threads, participantIndex, readIds, filter),
    [threads, participantIndex, readIds, filter],
  );

  const participantChoices = React.useMemo(
    () => participantOptions(threads, participantIndex),
    [threads, participantIndex],
  );

  /**
   * First load: open the conversation holding the message worth landing on, and select it.
   *
   * Outlook collapses everything by default and mostly that is right — but landing an agent on a
   * list where nothing is open wastes the one thing the client knows: which message is waiting.
   * Guarded by `landed` so it happens once and never argues with the agent afterwards, and skipped
   * entirely when `setControlState` already restored a choice.
   */
  React.useEffect(() => {
    if (landed.current || threads.length === 0) return;
    landed.current = true;
    if (restored?.selectedThreadKey || (restored?.expandedThreadKeys?.length ?? 0) > 0) return;
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
  }, [threads, readIds, restored, openMessage]);

  /**
   * Every address that is *us*.
   *
   * This used to be inferred from the senders of outgoing mail already on the case, which was
   * empty on a case nobody had replied to yet and wrong on one where an earlier reply went out
   * from a different queue. It is now the resolved sending identities themselves — the
   * authoritative answer, and the one pre-flight is already fetching.
   */
  const ourAddresses = React.useMemo(() => {
    // The resolved sending identities — authoritative, and what pre-flight already fetched.
    const out = new Set(selfAddresses(senderState.candidates));

    /*
     * PLUS the senders of outgoing mail already on this case.
     *
     * An earlier version REPLACED the derived set with the resolved one and called the
     * derivation interim. That lost information, and the loss was visible: measured 2026-09-25
     * on CAS-01020, whose queue could not be resolved, so Care was not a candidate, so replying
     * put **the service queue itself in To** — the mail loop this exclusion exists to prevent.
     *
     * The two disagree in both directions, so neither alone is enough. The resolved set knows
     * who we are about to send *as*, including on a case that has never been replied to. The
     * derived set knows every address this case has actually sent *from*, including a queue we
     * cannot resolve today and one that has since been reconfigured. Union.
     */
    for (const row of rows) {
      if (row.directioncode !== true) continue;
      const sender = parties.get(row.activityid)?.sender?.address;
      if (sender) out.add(sender.toLowerCase());
    }
    return out;
  }, [senderState.candidates, rows, parties]);

  /** R9 — open compose against one message. */
  const openCompose = React.useCallback(async (mode: ComposeMode, activityId: string) => {
    const message = rows.find((r) => r.activityid === activityId);
    if (!message) return;
    const p = parties.get(activityId) ?? { to: [], cc: [], bcc: [] };

    // Bcc is deliberately not read: carrying a hidden recipient forward discloses them.
    const original = {
      sender: p.sender ? { name: p.sender.name, address: p.sender.address } : undefined,
      to: p.to.map((x) => ({ name: x.name, address: x.address })),
      cc: p.cc.map((x) => ({ name: x.name, address: x.address })),
    };
    const { to, cc } = resolveRecipients(mode, original, ourAddresses);

    // The quote needs the original body, which is fetched lazily. Open compose either way — an
    // agent who clicked Reply should get a cursor, not a spinner — and fill the quote when it
    // arrives.
    await ensureBody(activityId);
    const body = bodyCache.current.get(activityId) ?? '';
    const quotedBlock = buildQuotedBlock(
      headerFor(message, original, formatWhen),
      body,
    );

    // R16 — resume rather than start again. Without this, closing compose and reopening Reply
    // creates a SECOND draft row, then a third; the Case fills with duplicates of one unsent
    // reply. Only a reply resumes: a forward is a new message to new people each time.
    const existing = caseId && mode !== 'forward'
      ? await findExistingDraft(webApiRef.current, caseId, activityId)
      : undefined;

    // Splitting our own stored body back apart is exactly R12's round-trip invariant, which
    // `roundTrips` tests: what we emitted, we can re-split. The new text goes back in the
    // editor; the quote stays the opaque string it always was.
    const resumedNewText = existing
      ? splitQuotedHistory(existing.bodyHtml).newHtml
      : undefined;

    composeHighWater.current = 0;
    bodyTouched.current = existing !== undefined;
    setRejections([]);
    /*
     * Rehydrate the resumed draft's attachments.
     *
     * Not cosmetic: the files are already rows on that email, so they WILL be sent. Showing an
     * empty tray would mean the agent sees no attachments while the customer receives them —
     * and they could not remove one they cannot see.
     */
    if (existing) {
      const rows = await fetchAttachments(webApiRef.current, existing.emailId);
      /*
       * Inline images are NOT attachments, and must not be offered as ones.
       *
       * Measured 2026-09-25: saving a draft whose quoted history contains `<img src="cid:…">`
       * makes the platform create an `activitymimeattachment` for it, reusing the original's
       * blob. Listing it in the tray would invite an agent to "remove" a file that is actually
       * part of the quoted message — breaking the image for the customer. It is still on the
       * wire, so its bytes are tracked separately and counted toward the size limit.
       */
      setAttachments(rows.filter((r) => !r.contentId).map((r) => ({
        key: r.id,
        filename: r.filename,
        mimeType: r.mimeType,
        size: r.fileSize,
        status: 'done' as const,
        progress: 100,
        attachmentId: r.id,
      })));
      setInlineBytes(rows
        .filter((r) => r.contentId)
        .reduce((sum, r) => sum + r.fileSize, 0));
    } else if (mode === 'forward') {
      /*
       * Forward carries the original's attachments (R13).
       *
       * Held as `reusedAttachmentId` and NOT uploaded: `attachmentid` points at the same stored
       * blob, so the row is created for free at the moment the draft first saves. Re-uploading
       * would duplicate the bytes and make the agent wait for something the platform already
       * has. Forwarding a message and silently dropping its attachments is the alternative, and
       * it is the whole reason people forward mail.
       */
      const rows = await fetchAttachments(webApiRef.current, activityId);
      setInlineBytes(rows.filter((r) => r.contentId).reduce((sum, r) => sum + r.fileSize, 0));
      setAttachments(rows.filter((r) => !r.contentId)
        .filter((r) => r.attachmentId)
        .map((r) => ({
          key: `fwd-${r.id}`,
          filename: r.filename,
          mimeType: r.mimeType,
          size: r.fileSize,
          status: 'done' as const,
          progress: 100,
          reusedAttachmentId: r.attachmentId,
        })));
    } else {
      setAttachments([]);
      setInlineBytes(0);
    }
    setComposeContentHeight(0);
    setCompose({
      mode,
      activityId,
      to,
      cc,
      emailId: existing?.emailId,
      resumedHtml: resumedNewText,
      // `firstNonEmpty`, not `??`: a draft row saved with an empty subject must fall through
      // to the derived one, and `??` only catches null/undefined.
      subject: firstNonEmpty(existing?.subject, composeSubject(mode, message.subject)),
      quotedBlock,
      // `??` is wrong here: a party with an empty-string name must fall through to the address,
      // and `??` only catches null/undefined. Written as an explicit chain so the intent is not
      // mistaken for a missed nullish-coalescing.
      answeringLabel: firstNonEmpty(
        original.sender?.name, original.sender?.address, '(unknown sender)',
      ),
      senderId: chosenSender.id,
    });
  }, [rows, parties, ourAddresses, chosenSender, caseId]);

  /**
   * Autosave the open draft to Dataverse (R16).
   *
   * Debounced while typing, on an interval, and on close — `setControlState` already survives a
   * session teardown, so this exists for the cases it does not cover: a reload, a crash, a closed
   * browser. Defence in depth, and the difference between losing a draft and losing one silently.
   *
   * `savingRef` serialises the writes. Without it a debounce firing next to the interval sends
   * two creates and the Case grows a duplicate draft — the characteristic failure of this feature,
   * and one that looks like data corruption rather than a race.
   */
  composeRef.current = compose;
  signatureRef.current = signatureHtml;
  senderRef.current = chosenSender;

  const savingRef = React.useRef(false);
  const draftTimer = React.useRef<ReturnType<typeof setTimeout>>();
  /** Recipients changed, so the next save must rewrite the party rows as well as the body. */
  const partiesDirty = React.useRef(false);

  const flushDraft = React.useCallback(async (force = false): Promise<string | undefined> => {
    const draft = composeRef.current;
    if (!draft || !caseId || savingRef.current) return draft?.emailId;

    const newHtml = editorRef.current?.getHTML() ?? '';
    // The quote is always present, so judging by the whole body would save every opened reply.
    // Only the agent's own text counts.
    //
    // `force` overrides that for attachments: an `activitymimeattachment` hangs off an email
    // row, so a file dropped into an otherwise-empty reply still needs the draft to exist. An
    // attachment IS content, even when nothing has been typed.
    if (!force && !worthSaving(newHtml, signatureRef.current)) return draft.emailId;

    const sender = senderRef.current;
    if (!sender) return draft.emailId;

    savingRef.current = true;
    const includeParties = partiesDirty.current || draft.emailId === undefined;
    const outcome = await saveDraft(
      webApiRef.current,
      draft.emailId,
      {
        caseId,
        subject: draft.subject,
        bodyHtml: buildOutgoingBody(newHtml, draft.quotedBlock),
        sender,
        to: draft.to,
        cc: draft.cc,
        // The link `findExistingDraft` searches on. Omitting it was a real defect, caught only
        // in the published app: the payload builder supported it, every unit test asserted it,
        // and the shell simply never passed it — so drafts saved with a null parent and resume
        // could never find them. A forward has nothing to link to, and nothing to resume.
        inReplyToId: draft.mode === 'forward' ? undefined : draft.activityId,
      },
      includeParties,
    );
    savingRef.current = false;
    if (outcome.ok) partiesDirty.current = false;

    setCompose((c) => {
      // Compose may have closed, or moved to a different message, while the save was in flight.
      if (!c || c.activityId !== draft.activityId) return c;
      return outcome.ok
        ? {
          ...c,
          emailId: outcome.emailId,
          savedAt: outcome.savedAt?.getTime(),
          saveError: undefined,
          draftCreatedHere: (c.draftCreatedHere ?? false) || draft.emailId === undefined,
        }
        : { ...c, saveError: outcome.error?.message ?? 'The draft could not be saved.' };
    });

    return outcome.ok ? outcome.emailId : undefined;
  }, [caseId]);

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
  attachmentsRef.current = attachments;
  inlineBytesRef.current = inlineBytes;
  const inlineCeiling = React.useRef(DEFAULT_INLINE_CEILING);

  React.useEffect(() => {
    void (async () => {
      inlineCeiling.current = await fetchInlineCeiling(webApiRef.current);
    })();
  }, []);

  const patchAttachment = React.useCallback(
    (key: string, patch: Partial<PendingAttachment>) => {
      setAttachments((list) => list.map((a) => (a.key === key ? { ...a, ...patch } : a)));
    },
    [],
  );

  /**
   * Attach dropped or picked files (R13).
   *
   * **Uploaded one at a time, deliberately.** Parallel uploads of several large files compete
   * for the same connection and make every progress bar crawl; sequential means the first file
   * is attached and safe while the second is still going.
   */
  const addFiles = React.useCallback(async (files: File[]): Promise<void> => {
    const { accepted, rejected } = admitFiles(
      files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
      attachmentsRef.current,
      inlineBytesRef.current,
    );
    setRejections(rejected);
    if (accepted.length === 0) return;

    const queued: PendingAttachment[] = accepted.map((f, i) => ({
      key: `${Date.now()}-${i}-${f.name}`,
      filename: f.name,
      mimeType: f.type,
      size: f.size,
      status: 'pending',
      progress: 0,
    }));
    setAttachments((list) => [...list, ...queued]);

    // An attachment row needs an email row to hang off, so the draft has to exist first — even
    // if the agent has typed nothing at all. `force` is what makes that happen.
    const emailId = await flushDraft(true);
    if (!emailId) {
      for (const q of queued) {
        patchAttachment(q.key, {
          status: 'failed',
          error: 'The draft could not be saved, so there is nothing to attach to.',
        });
      }
      return;
    }

    for (const q of queued) {
      const file = files.find((f) => f.name === q.filename && f.size === q.size);
      if (!file) continue;
      patchAttachment(q.key, { status: 'uploading', progress: 0 });
      try {
        const bytes = await fileToBytes(file);
        const outcome = await uploadAttachment(
          webApiRef.current,
          { emailId, filename: q.filename, mimeType: q.mimeType, bytes },
          inlineCeiling.current,
          (sent, total) => patchAttachment(q.key, { progress: blockProgress(sent, total) }),
        );
        patchAttachment(q.key, outcome.ok
          ? { status: 'done', progress: 100, attachmentId: outcome.attachmentId }
          : { status: 'failed', error: outcome.error?.message ?? 'The upload failed.' });
      } catch (e) {
        // Reading the file can fail on its own — a file removed from disk mid-drag, or one the
        // browser will not read. That is not an upload failure and must not read as one.
        patchAttachment(q.key, {
          status: 'failed',
          error: e instanceof Error ? e.message : 'The file could not be read.',
        });
      }
    }
  }, [flushDraft, patchAttachment]);

  /**
   * Take a file back off the reply.
   *
   * The Dataverse row is deleted too when there is one. Leaving it would send a file the agent
   * had visibly removed — the worst possible direction for this to fail in.
   */
  const removeAttachment = React.useCallback((key: string) => {
    const item = attachmentsRef.current.find((a) => a.key === key);
    setAttachments((list) => list.filter((a) => a.key !== key));
    setRejections([]);
    if (item?.attachmentId) void removeAttachmentRow(webApiRef.current, item.attachmentId);
  }, []);

  /**
   * Turn carried-over forward attachments into real rows, once there is a draft to hang them on.
   *
   * They are shown in the tray the moment Forward is clicked, because the agent needs to see
   * what will go — but `activitymimeattachment` needs an `objectid`, and on Forward the draft
   * does not exist yet. So the row is created the first time the draft saves. Guarded by
   * `attachmentId` so a second save does not attach the same file twice.
   */
  React.useEffect(() => {
    const emailId = compose?.emailId;
    if (!emailId) return;
    const pendingReuse = attachmentsRef.current.filter(
      (a) => a.reusedAttachmentId && !a.attachmentId,
    );
    if (pendingReuse.length === 0) return;

    void (async () => {
      for (const item of pendingReuse) {
        const outcome = await reuseAttachment(
          webApiRef.current, emailId, item.reusedAttachmentId!,
        );
        patchAttachment(item.key, outcome.ok
          ? { attachmentId: outcome.attachmentId }
          : { status: 'failed', error: outcome.error?.message ?? 'Could not carry this file over.' });
      }
    })();
  }, [compose?.emailId, patchAttachment]);

  /**
   * Send (R17).
   *
   * **There is deliberately no "don't really send" switch here.** `IssueSend: false` marks a
   * message sent without sending it, which is precisely the silent non-delivery this whole
   * feature exists to prevent — a product that could be configured into it would be worse than
   * one that cannot. It stays a development tool, used from a probe, never from the UI.
   *
   * The order matters, and each step exists because of a measured failure:
   *
   * 1. **Save first.** The body in the editor is the message; sending a stale draft row would
   *    send yesterday's text.
   * 2. **Re-run pre-flight.** Approval can change between opening compose and pressing Send,
   *    and Gate 2 decided that a pre-flight which cannot answer counts as *not safe*.
   * 3. **Issue, then poll.** The 200 means accepted, not delivered.
   */
  const [sendReport, setSendReport] = React.useState<SendReport>();
  const [sending, setSending] = React.useState(false);

  const sendDraft = React.useCallback(async (): Promise<void> => {
    const draft = composeRef.current;
    const sender = senderRef.current;
    if (!draft || !sender || sending) return;

    setSending(true);
    setSendReport(undefined);
    try {
      const blocked = blockingReasonBeforeSend({
        recipientCount: draft.to.length + draft.cc.length,
        uploadsInFlight: attachmentsRef.current.some(
          (a) => a.status === 'uploading' || a.status === 'pending',
        ),
      });
      if (blocked) {
        setSendReport({ phase: 'failed', headline: 'Not sent', detail: blocked, confirmed: false });
        return;
      }

      const emailId = await flushDraft(true);
      if (!emailId) {
        setSendReport({
          phase: 'failed',
          headline: 'Not sent',
          detail: 'The message could not be saved, so it was not sent. Your text is still here.',
          confirmed: false,
        });
        return;
      }

      // Approval is re-checked against the live platform, not the verdict cached when compose
      // opened. A mailbox can be disabled while an agent is typing.
      const api = webApiRef.current;
      const policy = await fetchOrgApprovalPolicy(api);
      const facts = sender.kind === 'user'
        ? await fetchAgentIdentity(api, sender.id).then((r) => r.facts)
        : await fetchQueueById(api, sender.id).then((q) => (
          q ? { approvalState: q.approvalState, mailboxId: q.mailboxId } : { approvalState: 0 }
        ));
      const verdict = await preflightCandidate(api, sender, policy.policy, facts);
      if (!verdict.ok) {
        setSendReport({
          phase: 'failed', headline: 'Not sent', detail: verdict.reason, confirmed: false,
        });
        setSenderState((s) => {
          const next = new Map(s.verdicts);
          next.set(sender.id, verdict);
          return { ...s, verdicts: next };
        });
        return;
      }

      const issued = await issueSend(emailId, true);
      if (!issued.accepted) {
        setSendReport({
          phase: 'failed',
          headline: 'Not sent',
          detail: issued.error?.message ?? 'The platform refused the message.',
          confirmed: false,
        });
        return;
      }

      // Accepted — NOT delivered. Watch it, and report what was actually observed.
      setSendReport(reportFor(EMAIL_STATUS.pendingSend, false));
      const polled = await pollUntilSettled(api, emailId, (status) => {
        if (isInFlight(status)) setSendReport(reportFor(status, false));
      });
      const report = reportFor(polled.statusCode, polled.exhausted);
      setSendReport(report);

      if (report.confirmed) {
        // Only a confirmed hand-off closes compose. Leaving it open on "still sending" keeps
        // the agent's text in front of them, which is the right place for it if it never goes.
        setCompose(undefined);
        setAttachments([]);
        composeHighWater.current = 0;
      }
      void load();
    } finally {
      setSending(false);
    }
  }, [flushDraft, sending, load]);

  /** Typing restarts the clock; a pause of ~2s commits. */
  const scheduleDraftSave = React.useCallback(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => { void flushDraft(); }, 2000);
  }, [flushDraft]);

  // A periodic save, so a long uninterrupted spell of typing is still protected, and a final one
  // when compose closes for any reason.
  React.useEffect(() => {
    if (!compose) return undefined;
    const id = setInterval(() => { void flushDraft(); }, 30000);
    return () => {
      clearInterval(id);
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [compose?.activityId, flushDraft]);

  /**
   * The agent picked a different From while composing.
   *
   * The signature is swapped only while the editor is still untouched. Once they have typed,
   * rewriting the body to move a signature block risks eating their words — so the signature is
   * left alone and `signatureStale` puts a note next to Send instead. A stale sign-off the agent
   * can see beats a silent edit they cannot.
   */
  const changeSender = React.useCallback((id: string) => {
    if (!senderState.candidates.some((c) => c.id === id)) return;
    setSenderState((s) => ({ ...s, chosenId: id }));
    setCompose((c) => (c ? { ...c, senderId: id, signatureStale: bodyTouched.current } : c));
  }, [senderState.candidates]);

  /**
   * Put the new sender's signature in the editor — but only if the agent has not typed.
   *
   * `initialHtml` seeds the editor at construction and nothing re-reads it, so a signature that
   * arrives later (or changes with the sender) has to be written in. `bodyTouched` is set by the
   * editor's own change event and suppressed around this write, so a reseed does not mark the
   * body as edited and then block the next one.
   */
  React.useEffect(() => {
    if (!compose || bodyTouched.current) return;
    const editor = editorRef.current;
    if (!editor) return;
    seeding.current = true;
    editor.setHTML(initialBodyWithSignature(signatureHtml));
    seeding.current = false;
  }, [signatureHtml, compose?.activityId]);

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

  const summaries = React.useMemo<ThreadSummary[]>(
    () => visibleThreads.map((thread) => toSummary(thread, parties, readIds, ancestorNumbers)),
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
          role="alert"
          style={{
            position: 'absolute', left: '8px', right: '8px', bottom: '8px', zIndex: 2,
            display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px 12px',
            boxSizing: 'border-box', background: T.dangerBg, border: `1px solid ${T.dangerStroke}`,
            borderRadius: '4px',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke={T.dangerFg} strokeWidth="1.5" style={{ flex: '0 0 15px', marginTop: '2px' }} aria-hidden="true">
            <circle cx="10" cy="10" r="7.2" /><path d="M10 6.3v4.6M10 13.2v.4" />
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: T.dangerFg }}>{notice.headline}</span>
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
          onCompose={(mode: ComposeMode, id: string) => { void openCompose(mode, id); }}
          loading={loading && !!selectedKey}
          error={listError}
          onRetry={() => void load()}
        />

        {compose && (
          <Compose
            ref={editorRef}
            mode={compose.mode}
            answeringLabel={compose.answeringLabel}
            to={compose.to}
            cc={compose.cc}
            subject={compose.subject}
            quotedBlock={compose.quotedBlock}
            height={composeHeight(composeContentHeight, composeHighWater.current)}
            onHeightChange={(h) => {
              composeHighWater.current = Math.max(composeHighWater.current, composeHeight(h));
              setComposeContentHeight(h);
            }}
            onClose={() => {
              // Save on the way out, or clean up after an agent who opened Reply and changed
              // their mind. A blank draft row left behind clutters the Case with mail nobody
              // wrote — and the row only exists at all if something was once worth saving.
              const closing = compose;
              const newHtml = editorRef.current?.getHTML() ?? '';
              if (worthSaving(newHtml, signatureHtml)) {
                void flushDraft();
              } else if (closing.emailId && closing.draftCreatedHere) {
                // Only ever a row WE created. An adopted draft stays put — see draftCreatedHere.
                void discardDraft(webApiRef.current, closing.emailId);
              }
              composeHighWater.current = 0;
              setCompose(undefined);
            }}
            onSubjectChange={(next) => {
              setCompose((c) => (c ? { ...c, subject: next } : c));
              scheduleDraftSave();
            }}
            onRemoveRecipient={(field, address) => {
              setCompose((c) => (c
                ? { ...c, [field]: c[field].filter((r) => r.address !== address) }
                : c));
              // The next save must rewrite the party rows, not just the body.
              partiesDirty.current = true;
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
        )}
        </div>
      )}
    </div>
  );
};

/** First value that is a non-empty string.  cannot express this: '' is not nullish. */
function firstNonEmpty(...values: (string | undefined)[]): string {
  for (const v of values) if (v && v.trim().length > 0) return v;
  return '';
}

/** The resolved sending identities, and what pre-flight said about each (R17/R18). */
interface SenderState {
  /** Everyone the agent may send as, the default first. */
  candidates: SenderCandidate[];
  chosenId: string;
  /** Keyed by candidate id. A missing entry means "not checked yet", which blocks Send. */
  verdicts: Map<string, PreflightVerdict>;
}

/**
 * The sender before anything has resolved.
 *
 * Has no address on purpose, so pre-flight blocks Send until the real identities arrive. An
 * optimistic placeholder here would let an agent hit Send against an unverified sender, which is
 * the exact failure R18 exists to prevent.
 */
const FALLBACK_SENDER: SenderCandidate = {
  kind: 'user',
  id: 'pending',
  displayName: 'Resolving sender…',
  address: '',
};

/** An open compose surface. One at a time — a second would have nowhere to dock. */
interface ComposeDraft {
  mode: ComposeMode;
  /** The message being answered, named in the context bar. */
  activityId: string;
  to: Recipient[];
  cc: Recipient[];
  subject: string;
  quotedBlock: string;
  answeringLabel: string;
  /** Who this goes out as. Chosen when compose opens; changeable while it is open. */
  senderId: string;
  /** The editor's signature no longer matches `senderId`, because the agent had already typed. */
  signatureStale?: boolean;
  /**
   * The durable draft row's `activityid`, once one exists (R16).
   *
   * **Losing this creates a second draft on the next autosave**, so it is the one field here
   * whose absence is worse than a stale value. It is deliberately part of the compose state
   * rather than a ref, so `setControlState` carries it through a session teardown.
   */
  emailId?: string;
  savedAt?: number;
  /** Set when a save failed. R16's whole point is that a lost draft must not be lost silently. */
  saveError?: string;
  /** New text recovered from an existing draft row, seeded into the editor instead of a signature. */
  resumedHtml?: string;
  /**
   * THIS client created the draft row in this sitting.
   *
   * Gates the discard-on-close cleanup. A draft we ADOPTED — one the standard email form left
   * behind, say — is somebody else's unsent work, and emptying the editor before closing must
   * not delete it. The demo environment already contains such drafts.
   */
  draftCreatedHere?: boolean;
}

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

function toSummary(
  thread: Thread,
  parties: Map<string, MessageParties>,
  readIds: Set<string>,
  /** Ticket numbers of ancestor cases, keyed by case id — R8. */
  ancestorNumbers?: Map<string, string>,
): ThreadSummary {
  const names = new Set<string>();
  for (const m of [...thread.messages].reverse()) {
    const p = parties.get(m.activityid);
    if (p?.sender?.name) names.add(p.sender.name);
  }
  const last = thread.messages[thread.messages.length - 1];
  return {
    thread,
    // R8. A thread is "borrowed" when ANY of its messages hangs off an ancestor case — a chain
    // can legitimately span both once someone re-parents an email, and in that case the borrowed
    // marking is the safer of the two readings: it says "some of this is not from here".
    parentCaseNumber: ancestorNumbers && ancestorNumbers.size > 0
      ? thread.messages
        .map((m) => (m.regardingCaseId ? ancestorNumbers.get(m.regardingCaseId) : undefined))
        .find((n) => n !== undefined)
      : undefined,
    // Only INBOUND messages can be unread: we do not mark our own sent mail unread.
    unreadCount: thread.messages.filter((m) => isUnread(m, readIds)).length,
    participants: [...names].slice(0, 3),
    hasAttachments: thread.messages.some((m) => (m.attachmentcount ?? 0) > 0),
    // statuscode 1 on an open email is a draft.
    hasDraft: thread.messages.some((m) => m.statuscode === 1),
    lastActivity: last?.createdon ?? '',
  };
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
