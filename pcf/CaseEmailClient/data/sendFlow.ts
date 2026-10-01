import type { PendingAttachment } from '../domain/attachments';
import type { Recipient } from '../domain/compose';
import type { PreflightVerdict } from '../domain/preflight';
import { ambiguousAddresses, unresolvedAddresses } from '../domain/recipients';
import { blockingReasonAfterSave, blockingReasonBeforeSend } from '../domain/send';
import type { SenderCandidate } from '../domain/sender';
import { fetchQueueById } from './caseQueue';
import type { DraftApiLike } from './draft';
import { fetchAgentIdentity, fetchOrgApprovalPolicy, preflightCandidate } from './preflight';
import { issueSend, readSendStatus, type IssueSendResult } from './send';

/**
 * The send sequence (R17), out of the component so its ORDER can be tested.
 *
 * Every step exists because of a measured failure, and until 2026-09-28 the sequence lived inside
 * `EmailClientRoot.tsx`, which no test imports. That is the seam CLAUDE.md warns about — a rule in
 * `domain/` proves nothing until a caller passes its input — and it is where the fail-open
 * double-send guard (M3) and the forward/attachment race (H4) hid. Here the component supplies
 * only what it owns (the save, and the tray), and the rest is covered.
 *
 * 1. **Refuse the obvious** — no recipient, files still uploading, an undeliverable address.
 * 2. **Save** — body AND parties, and carry forwarded attachments over. The editor is the
 *    message; the row is what gets sent, so they must agree before anything else is asked.
 * 3. **Re-read the row** — the double-send guard, failing closed when it cannot see.
 * 4. **Re-run pre-flight live** — approval can change while an agent types.
 * 5. **Issue.** Acceptance, not delivery; polling is the caller's.
 */

export interface SendInput {
  to: readonly Recipient[];
  cc: readonly Recipient[];
  bcc: readonly Recipient[];
  subject: string;
  /** Who the row goes out as. The save must write THIS sender — see `save`. */
  sender: SenderCandidate;
  allowUnresolved: boolean;
}

export interface SendDeps {
  api: DraftApiLike;
  /** The tray as it stands now. */
  attachments: () => readonly PendingAttachment[];
  /**
   * Save the draft for sending. Must write the parties — the sender especially — and not just
   * the body: pre-flight below checks `input.sender`, and `SendEmail` sends whatever sender is
   * on the row. If those two disagree, an unapproved sender parks the mail at Pending Send
   * forever (H1). Resolves to the row id and the tray after any forwarded files were carried over.
   */
  save: () => Promise<{ emailId?: string; attachments: readonly PendingAttachment[] }>;
  /** Injected for tests; the product always sends for real. */
  issue?: (emailId: string) => Promise<IssueSendResult>;
}

export type SendOutcome =
  | { ok: true; emailId: string }
  /** `verdict` is set when pre-flight refused, so the caller can show it against the sender. */
  | { ok: false; detail: string; verdict?: PreflightVerdict };

export async function runSend(input: SendInput, deps: SendDeps): Promise<SendOutcome> {
  const before = blockingReasonBeforeSend({
    // A Bcc-only message is a real message: it has recipients.
    recipientCount: input.to.length + input.cc.length + input.bcc.length,
    subject: input.subject,
    attachments: deps.attachments(),
    unresolvedAddresses: unresolvedAddresses(input.to, input.cc, input.bcc),
    ambiguousAddresses: ambiguousAddresses(input.to, input.cc, input.bcc),
    allowUnresolved: input.allowUnresolved,
  });
  if (before) return { ok: false, detail: before };

  const saved = await deps.save();
  const emailId = saved.emailId;
  if (!emailId) {
    return {
      ok: false,
      detail: 'The message could not be saved, so it was not sent. Your text is still here.',
    };
  }

  // Re-reading the row also catches a message sent from another tab, or by a colleague, in the
  // seconds since compose opened.
  const after = blockingReasonAfterSave({
    statusCode: await readSendStatus(deps.api, emailId),
    attachments: saved.attachments,
  });
  if (after) return { ok: false, detail: after };

  const verdict = await preflightLive(deps.api, input.sender);
  if (!verdict.ok) {
    return { ok: false, detail: verdict.reason ?? 'The sender could not be verified.', verdict };
  }

  const issued = await (deps.issue ?? ((id: string) => issueSend(id, true)))(emailId);
  if (!issued.accepted) {
    return { ok: false, detail: issued.error?.message ?? 'The platform refused the message.' };
  }
  return { ok: true, emailId };
}

/**
 * Pre-flight against the LIVE platform, not the verdict cached when compose opened. A mailbox can
 * be disabled while an agent is typing.
 */
export async function preflightLive(
  api: DraftApiLike,
  sender: SenderCandidate,
): Promise<PreflightVerdict> {
  const policy = await fetchOrgApprovalPolicy(api);
  const facts = sender.kind === 'user'
    ? (await fetchAgentIdentity(api, sender.id)).facts
    : await fetchQueueById(api, sender.id).then((q) => (
      q ? { approvalState: q.approvalState, mailboxId: q.mailboxId } : { approvalState: 0 }
    ));
  return preflightCandidate(api, sender, policy.policy, facts);
}
