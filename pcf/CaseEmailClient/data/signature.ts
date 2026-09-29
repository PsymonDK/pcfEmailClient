import { asString } from './coerce';
import { bareId, toGuid } from '../domain/guid';
import { assertGuid, type WebApiLike } from './emailQueries';
import { normaliseWebApiError, type NormalisedError } from './errors';
import { extractSignatureHtml } from '../domain/signature';
import { sanitiseEmailBody } from '../domain/sanitise';

/**
 * The sending identity's email signature (R15).
 *
 * `emailsignature.body` is an XSLT stylesheet, not HTML — `domain/signature.ts` explains why and
 * does the extraction. This file only fetches, and fetches the one extra field the stylesheet
 * needs to personalise itself.
 *
 * **Two paths, because Dataverse stores the two kinds of signature differently.** A user's is an
 * `emailsignature` row they own, found by `_ownerid_value` (below). A queue's is whatever its
 * `queue.emailsignature` lookup points at — `systemuser` has no equivalent lookup, so neither
 * shape can be used for both. `fetchSignatureFor` at the bottom of this file picks between them
 * and is what callers should use; `fetchSignatureHtml` is the user half of it.
 */

const SIGNATURE_COLUMNS = ['emailsignatureid', 'title', 'body', 'isdefault'] as const;

export function buildSignatureQuery(userId: string): string {
  const bare = bareId(userId);
  return (
    `?$select=${SIGNATURE_COLUMNS.join(',')}`
    + `&$filter=_ownerid_value eq ${bare}`
    // Default first, then most recently touched. NOT filtered to isdefault — see below.
    + '&$orderby=isdefault desc,modifiedon desc'
  );
}

/**
 * The agent's signature, as ready-to-insert HTML.
 *
 * **Not filtered to `isdefault eq true`.** The only signature in this environment has
 * `isdefault = false`, so that filter — the obvious one — returns nothing and the agent silently
 * gets no signature. Ordering by `isdefault desc` prefers a default when one exists and falls
 * back to the agent's other signature when it does not.
 *
 * Failure returns an empty string, never an error the agent has to dismiss: a missing signature
 * is a small annoyance, and a blocked reply is not.
 */
export async function fetchSignatureHtml(
  webApi: WebApiLike,
  userId: string,
): Promise<{ html: string; error?: NormalisedError }> {
  try {
    assertGuid(userId, 'userId');
  } catch (e) {
    return { html: '', error: { message: 'No user to load a signature for.', raw: e } };
  }

  try {
    const page = await webApi.retrieveMultipleRecords(
      'emailsignature', buildSignatureQuery(userId), 5,
    );
    const row = page.entities[0];
    if (!row) return { html: '' };

    // The stylesheet personalises itself from the sender. One extra retrieve, only when there is
    // actually a signature to fill.
    const values = await fetchSignatureValues(webApi, userId);
    return { html: safeSignature(extractSignatureHtml(typeof row.body === 'string' ? row.body : '', values)) };
  } catch (rejection) {
    return { html: '', error: normaliseWebApiError(rejection) };
  }
}

/**
 * The values the stylesheet's `xsl:value-of` paths refer to.
 *
 * Keyed by the stylesheet's own `select` expression, so adding a field the signature uses means
 * adding one entry here — not changing the extractor.
 */
async function fetchSignatureValues(
  webApi: WebApiLike,
  userId: string,
): Promise<Record<string, string>> {
  try {
    const user = await webApi.retrieveRecord(
      'systemuser',
      toGuid(userId, 'userId'),
      '?$select=firstname,lastname,fullname,jobtitle,internalemailaddress',
    );
    const s = (v: unknown) => asString(v);
    return {
      'systemuser/firstname': s(user.firstname),
      'systemuser/lastname': s(user.lastname),
      'systemuser/fullname': s(user.fullname),
      'systemuser/jobtitle': s(user.jobtitle),
      'systemuser/internalemailaddress': s(user.internalemailaddress),
    };
  } catch {
    // An unresolved value becomes an empty string, which is exactly what the stylesheet's own
    // `<xsl:otherwise></xsl:otherwise>` says to do. Better a signature missing a first name than
    // no signature at all.
    return {};
  }
}

// ── the sender's signature, not the agent's ──────────────────────────────────

/**
 * The signature belonging to whoever is actually sending (R15).
 *
 * **This is the fix for a real defect.** `fetchSignatureHtml` above finds the signature owned by
 * the logged-in agent, which is right only when the agent is the sender. On a Case the client
 * sends as the Case's **queue**, and a queue's signature is a different record reached a different
 * way — `queue.emailsignature`, a genuine platform lookup, resolved by `data/caseQueue.ts` and
 * carried on the candidate as `signatureId`.
 *
 * The defect hid because **this environment contains exactly one `emailsignature` row**, and it is
 * simultaneously the row the agent owns and the row the Care queue points at. Both code paths
 * returned the same HTML, so the queue path looked verified when it had never been exercised.
 * Anyone re-testing this must create a second signature first — see the plan's verification notes.
 *
 * Substitution values stay `systemuser/*` for the **acting agent** in both cases. That is not a
 * shortcut: the real Care signature's stylesheet selects `systemuser/firstname`, and personalising
 * a queue signature with the person who sent it is the platform's own behaviour.
 */
export async function fetchSignatureFor(
  webApi: WebApiLike,
  sender: { kind: 'queue' | 'user'; id: string; signatureId?: string },
  actingUserId: string,
): Promise<{ html: string; error?: NormalisedError }> {
  if (sender.kind === 'user') return fetchSignatureHtml(webApi, sender.id);

  // A queue with no signature configured is ordinary, not a failure: the agent gets a blank
  // sign-off and can type one.
  if (!sender.signatureId) return { html: '' };

  try {
    const row = await webApi.retrieveRecord(
      'emailsignature',
      toGuid(sender.signatureId, 'signatureId'),
      '?$select=body',
    );
    const values = await fetchSignatureValues(webApi, actingUserId);
    return { html: safeSignature(extractSignatureHtml(typeof row.body === 'string' ? row.body : '', values)) };
  } catch (rejection) {
    return { html: '', error: normaliseWebApiError(rejection) };
  }
}

/**
 * A signature is HTML another user can edit, heading for the editor and then for the customer.
 * It was safe only because TipTap's schema happens to drop what it does not know (L5); an Image or
 * raw-HTML extension, or a signature preview, would have made it a live hole. Sanitised here, once,
 * with pictures kept — a logo in our own sign-off is not a tracking pixel.
 */
function safeSignature(html: string): string {
  return sanitiseEmailBody(html, { allowRemoteImages: true, isolateIds: false }).html;
}
