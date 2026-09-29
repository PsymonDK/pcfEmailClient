/**
 * Run async tasks strictly one after another, and let every caller wait for its own turn.
 *
 * Draft saves need exactly this. The autosave used a busy flag instead, and a flush that found
 * the flag set **returned immediately** — so Send, pressed while an autosave was in flight, either
 * sent the text as it stood when that older save began, or reported "could not be saved" because
 * the in-flight save was the create and no row id existed yet (H3, 2026-09-28). Queuing means a
 * forced save waits for the one ahead of it and then saves again with what is on screen now.
 *
 * A task that rejects does not break the chain: the next one still runs, and the rejection
 * reaches only the caller whose task it was.
 */
export type SerialQueue = <T>(task: () => Promise<T>) => Promise<T>;

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}
