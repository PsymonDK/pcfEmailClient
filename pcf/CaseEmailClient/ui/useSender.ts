import * as React from 'react';
import { fetchSignatureFor } from '../data/signature';
import { type DraftApiLike } from '../data/draft';
import { bareId } from '../domain/guid';
import { fetchCaseQueue, fetchQueueById } from '../data/caseQueue';
import { fetchSettings } from '../data/settings';
import { DEFAULT_RECIPIENT_SOURCE, type RecipientSource } from '../data/recipients';
import {
  fetchAgentIdentity, fetchOrgApprovalPolicy, preflightCandidate, type OrgApprovalPolicy,
} from '../data/preflight';
import { pickSetting, resolveSender, type SenderCandidate } from '../domain/sender';
import type { PreflightVerdict } from '../domain/preflight';
import { fetchCaseTemplates, type EmailTemplate } from '../data/templates';


/**
 * Who outgoing mail goes out as (R17), whether it can actually leave (R18), the signature that
 * follows the sender (R15), and the templates (R14) — resolved once per case.
 *
 * Out of `EmailClientRoot` (R3, 2026-09-28) so the shell is about layout and selection, and this
 * is about identity. The fail-safe direction is unchanged: until everything resolves, the only
 * candidate is the agent with no verdict, which keeps Send disabled.
 */

/** The resolved sending identities, and what pre-flight said about each (R17/R18). */
interface SenderState {
  /** Everyone the agent may send as, the default first. */
  candidates: SenderCandidate[];
  chosenId: string;
  /** Keyed by candidate id. A missing entry means "not checked yet", which blocks Send. */
  verdicts: Map<string, PreflightVerdict>;
  /** Where a NEW email's default recipient comes from — the same settings row as the sender. */
  recipientSource: RecipientSource;
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

export interface SenderHook {
  senderState: SenderState;
  setSenderState: React.Dispatch<React.SetStateAction<SenderState>>;
  chosenSender: SenderCandidate;
  signatureHtml: string;
  templates: EmailTemplate[];
  /** The org's send policy, once read. Stricter defaults until then. */
  orgPolicyRef: React.MutableRefObject<OrgApprovalPolicy>;
}

export function useSender(
  caseId: string | undefined,
  userId: string | undefined,
  webApiRef: React.MutableRefObject<DraftApiLike>,
): SenderHook {
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
    recipientSource: DEFAULT_RECIPIENT_SOURCE,
  }));

  /**
   * The org's send policy, once read.
   *
   * Defaults to the STRICTER reading — approval required, unresolved recipients refused — so a
   * send attempted before the policy has loaded errs toward blocking rather than toward a
   * message that quietly never arrives.
   */
  const orgPolicyRef = React.useRef<OrgApprovalPolicy>({
    requireForQueue: true, requireForUser: true, allowUnresolved: false,
  });

  // Templates. Per-org, not per-case, and a failure here must not touch the mail list's own
  // error handling.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const tpl = await fetchCaseTemplates(webApiRef.current);
      if (!cancelled) setTemplates(tpl.templates);
    })();
    return () => { cancelled = true; };
  }, [webApiRef]);

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
      const bareUser = bareId(userId);

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
        // Held for the send-time recipient check, which needs `allowUnresolved` before it has
        // any reason to re-read the org row.
        orgPolicyRef.current = policyResult.policy;
      }));
      if (cancelled) return;

      // Only a complete pair overrides the default: half a configuration names nothing.
      const recipientSource = setting?.recipientEntity && setting.recipientLookup
        ? { entity: setting.recipientEntity, lookup: setting.recipientLookup }
        : DEFAULT_RECIPIENT_SOURCE;
      setSenderState({ candidates, chosenId: chosen.id, verdicts, recipientSource });
    })();

    return () => { cancelled = true; };
  }, [webApiRef, caseId, userId]);

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
  }, [webApiRef, chosenSender, userId]);

  return { senderState, setSenderState, chosenSender, signatureHtml, templates, orgPolicyRef };
}
