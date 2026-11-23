// S7 - send round-trip. SENDS REAL EMAIL (IssueSend: true).
//
//   DV_CASE=<case guid> [DV_TO=<recipient>] node scripts/spikes/s7-send.mjs [--confirm]
//
// Environment guard and token acquisition: see scripts/deploy/README.md.
//
// From the approved Care queue to DV_TO, default DV_APPROVED_RECIPIENT — the one address whose
// owner agreed to receive test mail (see CLAUDE.md). `guardRecipient` refuses anything
// else except an RFC 2606 undeliverable address, so a stray DV_TO cannot mail a colleague.
//
// Nothing is written or sent without --confirm, and the recipient is printed before sending.
//
// "Test B" (a send from the unapproved `<Care Agents>` queue) was REMOVED 2026-09-28 (review
// finding H7). It sent real mail from a queue nobody had approved, and did not even test the
// approval guard — that queue has no address. r18-approval-probe.mjs is the probe for R18.
import crypto from 'node:crypto';
import {
  CONFIRM, apiRaw, errorOf, getEnv, guardRecipient, readCaseId, writeIds,
} from '../lib/dv.mjs';

const SP = import.meta.dirname;
const { org: ORG } = getEnv();
const CASE = readCaseId(SP);

const CARE_QUEUE = '23b1c48e-1ff2-f011-8406-7ced8d2e4880';        // approved
// Throws before anything touches the environment if DV_TO is not an allowed recipient.
const TO = guardRecipient(process.env.DV_TO || process.env.DV_APPROVED_RECIPIENT);
const THREAD_SUBJECT = 'Reklamation: utaette samlinger efter montage - Jensen VVS';
const THREAD_HASH = 111000001;
const MB = 1048576;

// Non-throwing on purpose: every stage reports its own outcome.
const api = (p, m, b, headers = {}) => apiRaw(p, { method: m, body: b ?? undefined, headers });
const errOf = (r) => errorOf(r).slice(0, 300);

// --- the reply body: exercises R11 (rich text) and R12 (quoted history) -----
// Quoted history uses the same Outlook divRplyFwdMsg + Danish headers as the seed
// chain, nested two deep, so we can see whether it survives transport intact.
const inner = `<div style="font-family:Segoe UI,sans-serif;font-size:11pt">Tusind tak - det ser taet ud nu. I maa gerne sende dokumentationen til vores tekniske afdeling.</div>`;
const quoted2 =
  `<div id="divRplyFwdMsg" dir="ltr"><hr style="display:inline-block;width:98%">` +
  `<b>Fra:</b> Anna Hansen &lt;anna.hansen@example.invalid&gt;<br>` +
  `<b>Sendt:</b> 7. august 2026 10:33<br><b>Til:</b> Kundeservice<br>` +
  `<b>Emne:</b> RE: ${THREAD_SUBJECT}<br><br>${inner}</div>`;
const quoted1 =
  `<div id="divRplyFwdMsg" dir="ltr"><hr style="display:inline-block;width:98%">` +
  `<b>Fra:</b> Kundeservice &lt;care@example.invalid&gt;<br>` +
  `<b>Sendt:</b> 6. august 2026 15:05<br><b>Til:</b> Anna Hansen<br>` +
  `<b>Emne:</b> RE: ${THREAD_SUBJECT}<br><br>` +
  `<div style="font-family:Segoe UI,sans-serif;font-size:11pt">Teknikeren har vaeret forbi og udskiftet begge koblinger.</div>` +
  quoted2 + `</div>`;

const NEW_TEXT =
  `<div style="font-family:Segoe UI,sans-serif;font-size:11pt">` +
  `<p>Hej Simon,</p>` +
  `<p>This is the <b>S7 send round-trip</b> probe from the Case-scoped email client spike. ` +
  `It is checking three things at once:</p>` +
  `<ul><li><b>Bold</b>, <i>italic</i> and <u>underline</u> survive transport</li>` +
  `<li>A <a href="https://learn.microsoft.com/en-us/power-apps/developer/data-platform/email-activity-entities">link</a> survives</li>` +
  `<li>A table renders:</li></ul>` +
  `<table border="1" cellpadding="4" style="border-collapse:collapse"><tr><th>Probe</th><th>Expected</th></tr>` +
  `<tr><td>Quoted history below</td><td>2 levels, Danish headers, intact</td></tr>` +
  `<tr><td>Attachment</td><td>1 MB, uploaded via the chunked API</td></tr></table>` +
  `<p>Below this line there should be exactly two quoted levels. If the structure is mangled, ` +
  `that is the R12 risk showing itself.</p></div>`;

const BODY = `<html><body><div dir="ltr">${NEW_TEXT}${quoted1}</div></body></html>`;

const log = [];
function say(s) { console.log(s); log.push(s); }

// --- helper: chunked attachment upload -------------------------------------
async function attachChunked(emailId, label, bytes) {
  const buf = Buffer.alloc(bytes); crypto.randomFillSync(buf);
  const Target = { '@odata.type': 'Microsoft.Dynamics.CRM.activitymimeattachment',
    'objectid_email@odata.bind': `/emails(${emailId})`, objecttypecode: 'email',
    subject: label, filename: `${label}.bin`, mimetype: 'application/octet-stream' };
  const init = await api('InitializeAttachmentBlocksUpload', 'POST', { Target });
  if (!init.ok) return { ok: false, stage: 'Init', err: errOf(init) };
  const token = init.json.FileContinuationToken; const ids = [];
  for (let off = 0; off < buf.length; off += 4 * MB) {
    const id = Buffer.from(String(off).padStart(16, '0')).toString('base64'); ids.push(id);
    const up = await api('UploadBlock', 'POST', { BlockId: id,
      BlockData: buf.subarray(off, Math.min(off + 4 * MB, buf.length)).toString('base64'),
      FileContinuationToken: token });
    if (!up.ok) return { ok: false, stage: 'Block', err: errOf(up) };
  }
  const c = await api('CommitAttachmentBlocksUpload', 'POST', { BlockList: ids, FileContinuationToken: token, Target });
  return c.ok ? { ok: true, id: c.json?.ActivityMimeAttachmentId } : { ok: false, stage: 'Commit', err: errOf(c) };
}

async function makeDraft({ fromQueue, to, subject, hash }) {
  const parties = [
    { 'partyid_queue@odata.bind': `/queues(${fromQueue})`, participationtypemask: 1 },
    { addressused: to, participationtypemask: 2 },
  ];
  const payload = {
    subject, description: BODY, directioncode: true,
    'regardingobjectid_incident@odata.bind': `/incidents(${CASE})`,
    email_activity_parties: parties,
  };
  if (hash !== undefined) payload.baseconversationindexhash = hash;
  const r = await api('emails?$select=activityid', 'POST', payload, { Prefer: 'return=representation' });
  return r.ok ? { ok: true, id: r.json.activityid } : { ok: false, err: errOf(r) };
}

const state = async (id) => {
  const r = await api(`emails(${id})?$select=statecode,statuscode,subject,messageid,conversationindex,trackingtoken,attachmentcount`, 'GET',
    null, { Prefer: 'odata.include-annotations="*"' });
  const f = (k) => r.json?.[`${k}@OData.Community.Display.V1.FormattedValue`] ?? r.json?.[k];
  return { state: f('statecode'), status: f('statuscode'), attachments: r.json?.attachmentcount,
           messageid: r.json?.messageid, cIdx: r.json?.conversationindex, token: r.json?.trackingtoken };
};

console.log(`Target:    ${ORG}`);
console.log(`Case:      ${CASE}`);
console.log(`From:      Care queue ${CARE_QUEUE}`);
console.log(`RECIPIENT: ${TO}`);

if (!CONFIRM) {
  console.log('\nDRY RUN — nothing written, nothing sent. Re-run with --confirm to SEND REAL EMAIL');
  console.log(`to ${TO}: one reply on the case with a 1 MB chunked attachment, IssueSend: true.`);
  process.exit(0);
}

// ============ the real send ================================================
say(`\nReal send from the approved Care queue. Sending to: ${TO}`);
const a = await makeDraft({ fromQueue: CARE_QUEUE, to: TO, subject: `RE: ${THREAD_SUBJECT}`, hash: THREAD_HASH });
if (!a.ok) { say('  draft FAILED: ' + a.err); process.exit(1); }
say(`  draft created ${a.id}`);
writeIds(`${SP}/s7-created.json`, { caseId: CASE, draft: a.id, to: TO, sent: false });
const att = await attachChunked(a.id, 's7-1MB-chunked', 1 * MB);
say(att.ok ? `  attached 1 MB via chunked API (${att.id})` : `  attach FAILED @${att.stage}: ${att.err}`);
const before = await state(a.id);
say(`  before send: state=${before.state} status=${before.status} attachments=${before.attachments}`);
// Re-checked immediately before IssueSend, so nothing between the top of the script and here can
// have changed who this goes to.
guardRecipient(TO);
say(`  SENDING to ${TO} (IssueSend: true)`);
const t0 = Date.now();
const send = await api(`emails(${a.id})/Microsoft.Dynamics.CRM.SendEmail`, 'POST', { IssueSend: true });
const ms = Date.now() - t0;
if (send.ok) {
  const after = await state(a.id);
  say(`  SendEmail OK (${ms}ms) -> state=${after.state} status=${after.status}`);
  say(`  messageid=${after.messageid ?? '(null)'} conversationindex=${after.cIdx ? after.cIdx.length + ' chars' : '(null)'} trackingtoken=${after.token ?? '(null)'}`);
  say('  (200 means accepted — Pending Send — not delivered. See CLAUDE.md, Send (R17).)');
} else {
  say(`  SendEmail FAILED ${send.status}: ${errOf(send)}`);
}

writeIds(`${SP}/s7-created.json`, { caseId: CASE, draft: a.id, to: TO, sent: send.ok });
say('\nids written to s7-created.json');
