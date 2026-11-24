// R18 - what happens when the sender is an addressed but UNAPPROVED queue?
//
//   DV_CASE=<case guid> node scripts/spikes/r18-approval-probe.mjs [--confirm]
//
// Environment guard and token acquisition: see scripts/deploy/README.md.
//
// ATTEMPTS A REAL SEND (IssueSend: true), so nothing is written or sent without --confirm. The
// recipient is an RFC 2606 `.invalid` address and is checked by `guardRecipient`, so even if the
// platform did deliver, nothing could arrive anywhere.
//
// Result 2026-09-10: no synchronous guard and no failure signal — HTTP 200, the email parks at
// Pending Send forever. It leaves that stranded email on the case (id in r18-created.json);
// delete it afterwards.
import {
  CONFIRM, apiRaw, errorOf, envGuid, getEnv, guardRecipient, readCaseId, writeIds,
} from '../lib/dv.mjs';

const SP = import.meta.dirname;
const { org: ORG } = getEnv();
const CASE = readCaseId(SP);
const UNAPPROVED_QUEUE = envGuid('DV_R18_UNAPPROVED_QUEUE_ID', 'the id of a queue with an address whose email approval is not Approved');
const MAILBOX = envGuid('DV_R18_MAILBOX_ID', 'the id of that queue\'s mailbox');
const TO = guardRecipient('anna.hansen@example.invalid');           // RFC 2606, non-routable

// Non-throwing on purpose: a refused send is one of the two outcomes being probed.
const api = (p, m, b, h = {}) => apiRaw(p, { method: m, body: b ?? undefined, headers: h });
const errOf = (r) => errorOf(r);
const codeOf = (r) => r.json?.error?.code ?? '(no code)';
const ANNOTATIONS = { Prefer: 'odata.include-annotations="*"' };

console.log(`Target:    ${ORG}`);
console.log(`Case:      ${CASE}`);
console.log(`From:      unapproved queue ${UNAPPROVED_QUEUE}`);
console.log(`RECIPIENT: ${TO}`);

console.log('\n=== mailbox state before ===');
const mb = await api(`mailboxes(${MAILBOX})?$select=name,emailaddress,outgoingemailstatus,incomingemailstatus,outgoingemaildeliverymethod`, 'GET', null, ANNOTATIONS);
const f = (k) => mb.json?.[`${k}@OData.Community.Display.V1.FormattedValue`] ?? mb.json?.[k];
console.log('  addr:', mb.json?.emailaddress, '| outgoing:', f('outgoingemailstatus'), '| method:', f('outgoingemaildeliverymethod'));

if (!CONFIRM) {
  console.log('\nDRY RUN — nothing written, nothing sent. Re-run with --confirm to create a draft from');
  console.log(`the unapproved queue and call SendEmail with IssueSend: true, addressed to ${TO}.`);
  process.exit(0);
}

console.log('\n=== create draft FROM the unapproved queue ===');
const d = await api('emails?$select=activityid', 'POST', {
  subject: 'S-R18 probe - unapproved queue sender (must not send)',
  description: '<p>R18 probe. Should be blocked by the approval guard.</p>',
  directioncode: true,
  'regardingobjectid_incident@odata.bind': `/incidents(${CASE})`,
  email_activity_parties: [
    { 'partyid_queue@odata.bind': `/queues(${UNAPPROVED_QUEUE})`, participationtypemask: 1 },
    { addressused: TO, participationtypemask: 2 },
  ],
}, { Prefer: 'return=representation' });
if (!d.ok) { console.log('  draft FAILED', d.status, codeOf(d), errOf(d)); process.exit(1); }
const ID = d.json.activityid;
console.log('  draft created', ID);
writeIds(`${SP}/r18-created.json`, { caseId: CASE, id: ID });

console.log(`\n=== SendEmail IssueSend:true — sending to ${TO} ===`);
guardRecipient(TO);
const t0 = Date.now();
const s = await api(`emails(${ID})/Microsoft.Dynamics.CRM.SendEmail`, 'POST', { IssueSend: true });
const ms = Date.now() - t0;
if (s.ok) {
  console.log(`  returned OK in ${ms}ms -> NO synchronous guard`);
} else {
  console.log(`  BLOCKED in ${ms}ms  HTTP ${s.status}  code ${codeOf(s)}`);
  console.log(`  message: ${errOf(s)}`);
}
const st = await api(`emails(${ID})?$select=statecode,statuscode`, 'GET', null, ANNOTATIONS);
const g = (k) => st.json?.[`${k}@OData.Community.Display.V1.FormattedValue`] ?? st.json?.[k];
console.log(`  post-send state: ${g('statecode')} / ${g('statuscode')}`);
console.log('\nid written to r18-created.json — delete the stranded email when done.');
