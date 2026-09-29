// Threading strategy from docs/research/04-data-model.md, as a pure module so it can be
// unit-tested without a Dataverse context.
//
// Precedence:
//   1. baseconversationindexhash  - grouping key. Measured 100% populated.
//   2. conversationindex          - ordering + parent/child nesting inside a group.
//                                   NEVER present on API-created or seeded mail
//                                   (IsValidForCreate:false / IsValidForUpdate:false).
//   3. correlatedactivityid / parentactivityid - stitch what the above misses.
//   4. normalised subject         - last-resort fallback for mail with none of the above.
//
// conversationtrackingid is deliberately NOT used: measured 0% populated.

export interface EmailRow {
  activityid: string;
  subject: string | null;
  description?: string | null;
  directioncode: boolean | null; // true = Outgoing
  statuscode: number | null;
  statuslabel?: string;
  createdon: string;
  baseconversationindexhash: number | null;
  conversationindex: string | null;
  correlatedactivityid?: string | null;
  parentactivityid?: string | null;
  /** `_ownerid_value`, lower-cased. Decides whether a draft is the agent's own to continue (N7). */
  ownerid?: string | null;
  /** When a draft was last saved — what the pane shows for it instead of "Sent on". */
  modifiedon?: string;
  attachmentcount?: number | null;
  /** The case this message is regarding. Set from `_regardingobjectid_value`; drives R8. */
  regardingCaseId?: string | null;
}

export interface Thread {
  key: string;
  /** How the thread was assembled - surfaced in the UI so the spike shows which path ran. */
  groupedBy: 'hash' | 'correlation' | 'subject';
  subject: string;
  messages: EmailRow[];
  /** True when no message in the thread has a conversationindex, so ordering fell back to createdon. */
  orderedByCreatedOnFallback: boolean;
}

const RE_PREFIX =
  /^\s*(?:(?:re|fw|fwd|sv|vs|aw|antw|rif|ang|vb|vl)\s*(?:\[\d+\])?\s*:\s*)+/i;

/**
 * Tracking tokens the platform APPENDS to an outgoing subject, e.g. "… CRM:0100009".
 * Found by S7 (2026-09-10): sending stamps the token into the subject, so without
 * stripping it the subject fallback treats a tracked reply as a different thread.
 * Kept generic because the prefix is configurable and the seed data also contains
 * third-party tokens of the same shape (e.g. "MON:026300261").
 */
const RE_TRACKING_TOKEN = /\s*\b[A-Za-z]{2,8}:\d{4,12}\b\s*/g;

/** Strips localised reply/forward prefixes and tracking tokens, and collapses whitespace. */
export function normaliseSubject(subject: string | null | undefined): string {
  if (!subject) return '(no subject)';
  let s = subject;
  // Repeat because "RE: FW: RE:" needs several passes once prefixes are mixed.
  for (let i = 0; i < 8; i++) {
    const next = s.replace(RE_PREFIX, '');
    if (next === s) break;
    s = next;
  }
  s = s.replace(RE_TRACKING_TOKEN, ' ');
  const cleaned = s.replace(/\s+/g, ' ').trim().toLowerCase();
  return cleaned.length > 0 ? cleaned : '(no subject)';
}

/**
 * Exchange ConversationIndex is a hex string: a 22-byte header followed by 5-byte
 * child blocks, one appended per reply. Length therefore encodes reply depth, and
 * the string is prefix-ordered, so a plain lexicographic sort yields correct
 * parent-before-child ordering without parsing the timestamps.
 */
export function conversationDepth(conversationIndex: string | null | undefined): number {
  if (!conversationIndex) return 0;
  const hexLen = conversationIndex.trim().length;
  if (hexLen <= 44) return 0;
  return Math.floor((hexLen - 44) / 10);
}

/** The 22-byte header (44 hex chars) that identifies a conversation's root. */
const rootOf = (conversationIndex: string): string => conversationIndex.trim().slice(0, 44);

function compareMessages(a: EmailRow, b: EmailRow): number {
  const ai = a.conversationindex;
  const bi = b.conversationindex;
  if (ai && bi) {
    // Prefix-ordered: lexicographic sort puts parents before their children — but ONLY within one
    // conversation root. Across two roots (a thread merged by correlation) the comparison is
    // between unrelated timestamps, so it falls through to the date.
    if (ai !== bi && rootOf(ai) === rootOf(bi)) return ai < bi ? -1 : 1;
  } else if (ai && !bi) {
    return -1; // rows with real conversation data first
  } else if (!ai && bi) {
    return 1;
  }
  const at = Date.parse(a.createdon);
  const bt = Date.parse(b.createdon);
  if (at !== bt) return at - bt;
  return a.activityid < b.activityid ? -1 : 1;
}

export function buildThreads(rows: EmailRow[]): Thread[] {
  const byKey = new Map<string, { groupedBy: Thread['groupedBy']; rows: EmailRow[] }>();

  // Index for precedence step 3.
  const idToRow = new Map<string, EmailRow>();
  for (const r of rows) idToRow.set(r.activityid, r);

  const keyOf = (r: EmailRow): { key: string; by: Thread['groupedBy'] } => {
    // 1. hash
    if (r.baseconversationindexhash !== null && r.baseconversationindexhash !== undefined) {
      return { key: `h:${r.baseconversationindexhash}`, by: 'hash' };
    }
    // 3. correlation - follow to a row that does have a hash, else use the id itself
    const link = r.correlatedactivityid ?? r.parentactivityid;
    if (link) {
      const target = idToRow.get(link);
      if (target && target.baseconversationindexhash !== null && target.baseconversationindexhash !== undefined) {
        return { key: `h:${target.baseconversationindexhash}`, by: 'correlation' };
      }
      return { key: `c:${link}`, by: 'correlation' };
    }
    // 4. normalised subject
    return { key: `s:${normaliseSubject(r.subject)}`, by: 'subject' };
  };

  /*
   * Merge conversations the PLATFORM says are one (measured 2026-09-28, CAS-01130-T1M1W1).
   *
   * A customer's reply can arrive with a NEW `baseconversationindexhash`: their mail client
   * started a fresh Thread-Index instead of continuing ours, so hash grouping put the reply in a
   * thread of its own. The platform still correlated it — `correlatedactivityid` points at the
   * message it answers — so that link joins the two groups.
   *
   * `correlatedactivityid` ONLY, deliberately not `parentactivityid`: the case's automatic
   * acknowledgement carries a parent link to the mail that opened the case, and agents want it
   * kept apart from the conversation. Correlation is the platform matching an incoming reply to
   * something we sent, which is exactly "this is the same conversation".
   */
  const keyed = rows.map((r) => ({ r, ...keyOf(r) }));
  const keyById = new Map(keyed.map((k) => [k.r.activityid, k.key]));
  const mergedInto = new Map<string, string>();
  const find = (key: string): string => {
    let k = key;
    while (mergedInto.has(k)) k = mergedInto.get(k)!;
    return k;
  };
  for (const { r, key } of keyed) {
    const answered = r.correlatedactivityid ? keyById.get(r.correlatedactivityid) : undefined;
    if (!answered) continue;
    const from = find(key);
    const to = find(answered);
    // Onto the conversation being answered, so the thread keeps the older, stable key.
    if (from !== to) mergedInto.set(from, to);
  }

  for (const { r, key: ownKey, by: ownBy } of keyed) {
    const key = find(ownKey);
    const by: Thread['groupedBy'] = key === ownKey ? ownBy : 'correlation';
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.rows.push(r);
      // A thread assembled by more than one route reports the weakest route used.
      const rank = { hash: 0, correlation: 1, subject: 2 } as const;
      if (rank[by] > rank[bucket.groupedBy]) bucket.groupedBy = by;
    } else {
      byKey.set(key, { groupedBy: by, rows: [r] });
    }
  }

  const threads: Thread[] = [];
  for (const [key, { groupedBy, rows: msgs }] of byKey) {
    msgs.sort(compareMessages);
    const withIndex = msgs.filter((m) => !!m.conversationindex).length;
    const roots = new Set(msgs.flatMap((m) => (m.conversationindex ? [rootOf(m.conversationindex)] : [])));
    threads.push({
      key,
      groupedBy,
      // The shortest normalised subject in the thread is usually the original.
      subject:
        msgs
          .map((m) => m.subject ?? '')
          .filter((s) => s.length > 0)
          .sort((a, b) => a.length - b.length)[0] ?? '(no subject)',
      messages: msgs,
      orderedByCreatedOnFallback: withIndex === 0 || roots.size > 1,
    });
  }

  // Most recently active thread first.
  threads.sort((a, b) => {
    const at = Date.parse(a.messages[a.messages.length - 1].createdon);
    const bt = Date.parse(b.messages[b.messages.length - 1].createdon);
    return bt - at;
  });
  return threads;
}
