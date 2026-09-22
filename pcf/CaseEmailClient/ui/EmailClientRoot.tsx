import * as React from 'react';
import { buildThreads, type EmailRow, type Thread } from '../domain/threading';
import { resolveLayout, LIST_WIDTH } from '../domain/layout';
import {
  DataverseError, fetchAttachments, fetchBody, fetchCaseEmails, fetchParties,
  type Attachment, type MessageParties, type WebApiLike,
} from '../data/emailQueries';
import { agentFacingMessage } from '../data/errors';
import { browserDownloadIo, downloadAttachment } from '../data/attachments';
import { fetchReadState, markRead as persistRead, type ReadStateApiLike, type ReadStateMap } from '../data/readState';
import {
  collapsedOlderCount, isUnread, messageToOpen, worthPersisting,
} from '../domain/unread';
import { ThreadList, type ThreadSummary } from './ThreadList';
import { ReadingPane, type MessageState } from './ReadingPane';
import { T } from './tokens';

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
  webApi: ReadStateApiLike;
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
}

export const EmailClientRoot: React.FC<EmailClientRootProps> = (props) => {
  const {
    caseId, caseIdSource, webApi, userId, allocatedHeight, allocatedWidth, restored, onStateChange,
  } = props;

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
      const fetched = await fetchCaseEmails(webApi, caseId);
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
  }, [caseId, userId]);

  React.useEffect(() => { void load(); }, [load]);

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
    });
  }, [selectedKey, states, readIds]);

  const selected = threads.find((t) => t.key === selectedKey);

  // Open the newest UNREAD message on selection; if all are read, the newest. Older messages
  // collapse into one row rather than being listed individually.
  const selectThread = React.useCallback((key: string) => {
    setSelectedKey(key);
    const thread = threads.find((t) => t.key === key);
    if (!thread) return;

    // Newest unread INCOMING message, or the newest message if nothing is waiting. Without the
    // direction check this auto-opened the agent's own sent mail and treated it as unread.
    const target = messageToOpen(thread.messages, readIds);
    if (!target) return;

    setCollapsedOlder(collapsedOlderCount(
      thread.messages.length,
      thread.messages.findIndex((m) => m.activityid === target.activityid),
    ));
    setStates((prev) => {
      const next = new Map(prev);
      for (const m of thread.messages) {
        next.set(m.activityid, {
          ...(next.get(m.activityid) ?? blankState(!isUnread(m, readIds))),
          expanded: m.activityid === target.activityid,
          unread: isUnread(m, readIds),
        });
      }
      return next;
    });
    void ensureBody(target.activityid);
  }, [threads, readIds]);

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

  const toggleMessage = (activityId: string) => {
    setStates((prev) => withState(prev, activityId, (s) => ({ ...s, expanded: !s.expanded })));
    const current = states.get(activityId);
    if (!current?.expanded) void ensureBody(activityId);
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

  const summaries = React.useMemo<ThreadSummary[]>(
    () => threads.map((thread) => toSummary(thread, parties, readIds)),
    [threads, parties, readIds],
  );

  const unreadTotal = rows.filter((r) => isUnread(r, readIds)).length;

  if (caseIdSource === 'unresolved') return <NoCaseContext />;

  return (
    <div
      ref={rootRef}
      style={{
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
            boxSizing: 'border-box', background: '#fdf6f6', border: '1px solid #eec7c8',
            borderRadius: '4px',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#a4262c" strokeWidth="1.5" style={{ flex: '0 0 15px', marginTop: '2px' }} aria-hidden="true">
            <circle cx="10" cy="10" r="7.2" /><path d="M10 6.3v4.6M10 13.2v.4" />
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#a4262c' }}>{notice.headline}</span>
            <span style={{ fontSize: '12px', color: '#3b3a39' }}>{notice.detail}</span>
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
          onRefresh={() => void load()}
          totalThreadCount={threads.length}
          filterActive={false}
          onClearFilters={() => undefined}
          parentCaseThreadCount={0}
        />
      )}

      {(layout.layout === 'two-pane' || selected) && (
        <ReadingPane
          thread={selected}
          parties={parties}
          states={states}
          collapsedOlderCount={selected ? Math.min(collapsedOlder, selected.messages.length - 1) : 0}
          onExpandOlder={() => setCollapsedOlder(0)}
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
          loading={loading && !!selectedKey}
          error={listError}
          onRetry={() => void load()}
        />
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

function toSummary(
  thread: Thread,
  parties: Map<string, MessageParties>,
  readIds: Set<string>,
): ThreadSummary {
  const names = new Set<string>();
  for (const m of [...thread.messages].reverse()) {
    const p = parties.get(m.activityid);
    if (p?.sender?.name) names.add(p.sender.name);
  }
  const last = thread.messages[thread.messages.length - 1];
  return {
    thread,
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
