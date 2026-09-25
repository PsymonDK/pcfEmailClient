import { assertGuid } from './emailQueries';
import { normaliseWebApiError, type NormalisedError } from './errors';
import { resolveXrmExecute, type XrmExecute } from './templates';
import type { DraftApiLike } from './draft';
import { isSettled, POLL_DELAYS } from '../domain/send';

/**
 * Issuing the send, and then finding out what actually happened (R17).
 *
 * **`SendEmail` is a BOUND action** — bound to the email row — unlike `InstantiateTemplate` and
 * the attachment upload messages, which are unbound. That changes the hand-built metadata:
 * `boundParameter` is `'entity'` rather than `null`, and the entity goes in the request under
 * that same key with its `@odata.type` and id. Getting this wrong produces the same anonymous
 * *"Error identified in Payload"* that `Edm.Guid` produces, which names nothing useful.
 *
 * **The 200 is not the answer.** It means the platform accepted the request; the email then
 * moves to `Pending Send` and is delivered asynchronously — or, for an unapproved sender, sits
 * there permanently with **no error recorded on the email or the mailbox**. So every send is
 * followed by polling `statuscode`, and the result is reported as what was actually observed.
 */

const bare = (id: string) => id.replace(/^\{|\}$/g, '');

export interface IssueSendResult {
  /** The platform accepted the request. NOT a claim that anything was delivered. */
  accepted: boolean;
  error?: NormalisedError;
}

/**
 * Hand the message to the platform.
 *
 * `issueSend: false` marks the email as sent **without actually sending it** — the safe mode for
 * developing against a shared environment, and the default here for exactly that reason. A real
 * send has to be asked for explicitly by the caller, which is the point.
 */
export async function issueSend(
  emailId: string,
  issueSendForReal: boolean,
  execute: XrmExecute | undefined = resolveXrmExecute(),
): Promise<IssueSendResult> {
  if (!execute) {
    return {
      accepted: false,
      error: { message: 'Sending needs the platform API, which is not available here.', raw: undefined },
    };
  }

  try {
    assertGuid(emailId, 'emailId');
  } catch (e) {
    return { accepted: false, error: { message: 'There is no saved message to send.', raw: e } };
  }

  const id = bare(emailId);
  try {
    await execute({
      entity: {
        entityType: 'email',
        id,
        '@odata.type': 'Microsoft.Dynamics.CRM.email',
      },
      IssueSend: issueSendForReal,
      getMetadata: () => ({
        // Bound, unlike every other action in this project. `'entity'` is the key the platform
        // expects the bound instance under, and it must match the property name above.
        boundParameter: 'entity',
        parameterTypes: {
          entity: { typeName: 'mscrm.email', structuralProperty: 5 },
          IssueSend: { typeName: 'Edm.Boolean', structuralProperty: 1 },
        },
        operationType: 0,
        operationName: 'SendEmail',
      }),
    });
    return { accepted: true };
  } catch (rejection) {
    return { accepted: false, error: normaliseWebApiError(rejection) };
  }
}

/** One reading of where the message has got to. */
export async function readSendStatus(
  webApi: DraftApiLike,
  emailId: string,
): Promise<number | undefined> {
  try {
    const row = await webApi.retrieveRecord(
      'email', bare(emailId), '?$select=statuscode,statecode',
    );
    return typeof row.statuscode === 'number' ? row.statuscode : undefined;
  } catch {
    return undefined;
  }
}

export interface PollResult {
  statusCode?: number;
  /** True when we ran out of patience rather than reaching a settled state. */
  exhausted: boolean;
}

/**
 * Watch the message until it settles, or until we stop pretending it is going to.
 *
 * Backs off through `POLL_DELAYS` and then gives up — deliberately, because a message stranded
 * by an unapproved sender never settles and polling it forever would spin until the agent
 * navigates away, all the while showing a spinner that means "this is fine".
 *
 * `wait` is injected so the policy can be tested without the test taking half a minute.
 */
export async function pollUntilSettled(
  webApi: DraftApiLike,
  emailId: string,
  onStatus?: (statusCode: number | undefined) => void,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
): Promise<PollResult> {
  let last: number | undefined;
  for (const delay of POLL_DELAYS) {
    await wait(delay);
    last = await readSendStatus(webApi, emailId);
    onStatus?.(last);
    if (isSettled(last)) return { statusCode: last, exhausted: false };
  }
  return { statusCode: last, exhausted: true };
}
