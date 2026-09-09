import * as React from 'react';
import { Badge, Button, Divider, Input, Spinner, Text, Tooltip } from '@fluentui/react-components';
import { IInputs } from './generated/ManifestTypes';
import { buildThreads, conversationDepth, EmailRow, Thread } from './threading';
import { quoteDepth, splitQuotedHistory } from './quoting';

export interface EmailClientProps {
  context: ComponentFramework.Context<IInputs>;
  restoredState: ComponentFramework.Dictionary | null;
  initAt: string;
  initCount: number;
  persistState: (scratch: string) => boolean;
}

const SELECT = [
  'activityid', 'subject', 'directioncode', 'statuscode', 'createdon',
  'baseconversationindexhash', 'conversationindex',
  '_correlatedactivityid_value', '_parentactivityid_value', 'attachmentcount',
].join(',');

// Defensive readers. context.webAPI hands back an index-signature bag, so narrow
// each value rather than trusting its shape.
const asStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const asNum = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const asBool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

function toRow(raw: ComponentFramework.WebApi.Entity): EmailRow {
  const e = raw as Record<string, unknown>;
  return {
    activityid: asStr(e.activityid) ?? '',
    subject: asStr(e.subject),
    directioncode: asBool(e.directioncode),
    statuscode: asNum(e.statuscode),
    statuslabel: asStr(e['statuscode@OData.Community.Display.V1.FormattedValue']) ?? undefined,
    createdon: asStr(e.createdon) ?? '',
    baseconversationindexhash: asNum(e.baseconversationindexhash),
    conversationindex: asStr(e.conversationindex),
    correlatedactivityid: asStr(e._correlatedactivityid_value),
    parentactivityid: asStr(e._parentactivityid_value),
    attachmentcount: asNum(e.attachmentcount),
  };
}

interface ContextInfoLike { entityId?: string; entityTypeName?: string }
interface ModeLike { contextInfo?: ContextInfoLike }

/** Resolve the Case id from the page/form context the host supplies. */
function resolveCaseId(context: ComponentFramework.Context<IInputs>): string | null {
  const mode = context.mode as unknown as ModeLike;
  const id = mode.contextInfo?.entityId;
  return id ? id.replace(/[{}]/g, '') : null;
}

const errText = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error';

export const EmailClient: React.FC<EmailClientProps> = (props) => {
  const { context, restoredState, initAt, initCount, persistState } = props;

  // The host hands a fresh context object every render, so it must never appear in a
  // dependency array. Keep the latest in a ref and depend on primitives instead.
  const ctxRef = React.useRef(context);
  ctxRef.current = context;

  const caseId = resolveCaseId(context);
  const [scratch, setScratch] = React.useState<string>(asStr(restoredState?.scratch) ?? '');
  const [data, setData] = React.useState<{ rows: EmailRow[]; loading: boolean; error: string | null }>({
    rows: [], loading: true, error: null,
  });
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [bodies, setBodies] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    let cancelled = false;
    if (!caseId) {
      setData({ rows: [], loading: false, error: 'Could not resolve the Case id from context.' });
      return;
    }
    const run = async (): Promise<void> => {
      // Deliberately NOT selecting `description`: the body lives in Azure Blob storage
      // and is fetched lazily on expand. See docs/research/04-data-model.md.
      const filter = `_regardingobjectid_value eq ${caseId} and regardingobjecttypecode eq 'incident'`;
      const query = `?$select=${SELECT}&$filter=${filter}&$orderby=createdon asc&$top=200`;
      try {
        const res = await ctxRef.current.webAPI.retrieveMultipleRecords('email', query);
        if (cancelled) return;
        setData({ rows: res.entities.map(toRow), loading: false, error: null });
      } catch (err: unknown) {
        if (cancelled) return;
        setData({ rows: [], loading: false, error: errText(err) });
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [caseId]);

  const threads = React.useMemo(() => buildThreads(data.rows), [data.rows]);

  // Bodies are fetched once per message, on first expand. A ref of in-flight ids
  // de-dupes concurrent clicks without making this callback depend on `bodies`.
  const inFlight = React.useRef<Set<string>>(new Set());
  const loadBody = React.useCallback((id: string): void => {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    const run = async (): Promise<void> => {
      try {
        const r = await ctxRef.current.webAPI.retrieveRecord('email', id, '?$select=description');
        const body = asStr((r as Record<string, unknown>).description) ?? '';
        setBodies((b) => ({ ...b, [id]: body }));
      } catch {
        setBodies((b) => ({ ...b, [id]: '<i>(body could not be loaded)</i>' }));
      }
    };
    void run();
  }, []);

  const alloc = context.mode.allocatedHeight;
  const allocW = context.mode.allocatedWidth;

  // allocatedHeight is -1 for dataset controls, so the only way to know whether the CSS
  // actually stretched is to measure the rendered box. This is the RQ1 number.
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = React.useState('measuring…');
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const report = (): void => {
      const r = el.getBoundingClientRect();
      setMeasured(`${Math.round(r.height)}px high x ${Math.round(r.width)}px wide`);
    };
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);

  const savedAt = asStr(restoredState?.savedAt);

  return (
    <div className="cec-root" ref={rootRef}>
      {/* ---------- S1 diagnostics. This panel IS the spike result. ---------- */}
      <div className="cec-diag">
        <div className="cec-diag-row">
          <b>S1 diagnostics</b>
          <Badge appearance="tint" color={restoredState ? 'success' : 'danger'}>
            {restoredState ? 'state RESTORED' : 'state NOT restored'}
          </Badge>
          <Badge appearance="tint">init #{initCount}</Badge>
          <Tooltip
            content="Dataset PCFs report -1 here and must fill 100% with CSS."
            relationship="label"
          >
            <Badge appearance="tint" color={alloc === -1 ? 'informative' : 'warning'}>
              allocatedHeight {String(alloc)}
            </Badge>
          </Tooltip>
          <Badge appearance="tint">allocatedWidth {String(allocW)}</Badge>
        </div>
        <div className="cec-diag-row cec-diag-small">
          <span>rendered box: <b>{measured}</b></span>
          <span>init at {initAt}</span>
          {savedAt && <span>state saved at {savedAt}</span>}
          <span>case {caseId ?? '(unresolved)'}</span>
        </div>
        <div className="cec-diag-row">
          <Text size={200}>Draft proxy — type, switch Case session, come back:</Text>
          <Input
            value={scratch}
            placeholder="pretend this is an unsent reply"
            onChange={(_ev, d) => {
              setScratch(d.value);
              persistState(d.value);
            }}
            style={{ minWidth: 300 }}
          />
          <Button size="small" onClick={() => persistState(scratch)}>Persist now</Button>
        </div>
      </div>

      <Divider />

      {/* ---------- Threaded reading ---------- */}
      <div className="cec-threads">
        {data.loading && <Spinner label="Loading Case email…" />}
        {data.error !== null && <Text className="cec-error">Error: {data.error}</Text>}
        {!data.loading && data.error === null && (
          <>
            <Text size={200} className="cec-summary">
              {data.rows.length} messages &rarr; {threads.length} threads
              {threads.some((t) => t.groupedBy === 'subject') ? ' · subject fallback in use' : ''}
            </Text>
            {threads.map((t) => (
              <ThreadView
                key={t.key}
                thread={t}
                expanded={expanded[t.key] === true}
                onToggle={() => setExpanded((e) => ({ ...e, [t.key]: e[t.key] !== true }))}
                bodies={bodies}
                loadBody={loadBody}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
};

const GROUP_COLOR = { hash: 'success', correlation: 'informative', subject: 'warning' } as const;

const ThreadView: React.FC<{
  thread: Thread;
  expanded: boolean;
  onToggle: () => void;
  bodies: Record<string, string>;
  loadBody: (id: string) => void;
}> = ({ thread, expanded, onToggle, bodies, loadBody }) => (
  <div className="cec-thread">
    <button className="cec-thread-head" onClick={onToggle}>
      <span className="cec-chev">{expanded ? '▾' : '▸'}</span>
      <span className="cec-subject">{thread.subject}</span>
      <Badge size="small" appearance="tint">{thread.messages.length}</Badge>
      <Badge size="small" appearance="tint" color={GROUP_COLOR[thread.groupedBy]}>
        {thread.groupedBy}
      </Badge>
      {thread.orderedByCreatedOnFallback && (
        <Badge size="small" appearance="tint" color="warning">createdon order</Badge>
      )}
    </button>
    {expanded && (
      <div className="cec-messages">
        {thread.messages.map((m) => (
          <MessageView key={m.activityid} msg={m} body={bodies[m.activityid]} loadBody={loadBody} />
        ))}
      </div>
    )}
  </div>
);

const MessageView: React.FC<{
  msg: EmailRow;
  body: string | undefined;
  loadBody: (id: string) => void;
}> = ({ msg, body, loadBody }) => {
  const [open, setOpen] = React.useState(false);
  const [showQuote, setShowQuote] = React.useState(false);
  const split = React.useMemo(
    () => (body !== undefined && body !== '' ? splitQuotedHistory(body) : null),
    [body],
  );

  return (
    <div
      className={`cec-msg ${msg.directioncode === true ? 'out' : 'in'}`}
      style={{ marginLeft: Math.min(conversationDepth(msg.conversationindex), 6) * 14 }}
    >
      <button
        className="cec-msg-head"
        onClick={() => {
          setOpen((o) => !o);
          loadBody(msg.activityid);
        }}
      >
        <Badge
          size="small"
          appearance="filled"
          color={msg.directioncode === true ? 'brand' : 'informative'}
        >
          {msg.directioncode === true ? 'Out' : 'In'}
        </Badge>
        <span className="cec-msg-subject">{msg.subject}</span>
        {typeof msg.attachmentcount === 'number' && msg.attachmentcount > 0 && (
          <span title="attachments">&#128206;{msg.attachmentcount}</span>
        )}
        <span className="cec-msg-meta">
          {msg.statuslabel ?? ''} · {new Date(msg.createdon).toLocaleString()}
          {msg.conversationindex === null ? ' · no cIdx' : ''}
        </span>
      </button>
      {open && (
        <div className="cec-msg-body">
          {body === undefined && <Spinner size="tiny" label="Loading body…" />}
          {split !== null && (
            <>
              <div className="cec-new" dangerouslySetInnerHTML={{ __html: split.newHtml }} />
              {split.quotedHtml !== '' ? (
                <>
                  <Button size="small" appearance="subtle" onClick={() => setShowQuote((s) => !s)}>
                    {showQuote ? 'Hide' : 'Show'} trimmed content · matched {split.matchedBy} · depth{' '}
                    {quoteDepth(body)}
                  </Button>
                  {showQuote && (
                    <div className="cec-quoted" dangerouslySetInnerHTML={{ __html: split.quotedHtml }} />
                  )}
                </>
              ) : (
                <Text size={200} className="cec-quote-none">
                  no quoted history detected (matched: {split.matchedBy})
                </Text>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
