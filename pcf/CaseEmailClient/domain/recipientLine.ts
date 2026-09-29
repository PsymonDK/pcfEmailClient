/**
 * The one-line recipient summary under a message's sender: `To: … · Cc: … · Bcc: …`.
 *
 * **Bcc only on OUTGOING mail (issue #11).** On our own sent mail the agent is entitled to see
 * who was blind-copied — that is the only place the fact is recorded. On RECEIVED mail a Bcc list
 * is someone else's private choice; if a sender's system ever exposes one, the client must not
 * amplify it. The rule lives here, under test, rather than as a condition buried in the pane.
 *
 * Overflow is collapsed (`+2`) rather than wrapped: the header row has a fixed height.
 */
export function recipientSummary(
  parties: {
    to: readonly { name: string }[];
    cc: readonly { name: string }[];
    bcc: readonly { name: string }[];
  },
  outgoing: boolean,
): string {
  const show = (list: readonly { name: string }[], max = 2): string => {
    if (list.length === 0) return '';
    const names = list.slice(0, max).map((p) => p.name);
    const extra = list.length - names.length;
    return names.join(', ') + (extra > 0 ? ` +${extra}` : '');
  };
  const to = show(parties.to);
  const cc = show(parties.cc);
  const bcc = outgoing ? show(parties.bcc) : '';
  return [to && `To: ${to}`, cc && `Cc: ${cc}`, bcc && `Bcc: ${bcc}`].filter(Boolean).join(' · ');
}
