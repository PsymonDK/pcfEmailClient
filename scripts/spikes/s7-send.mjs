// S7 - send round-trip. SENDS REAL EMAIL (IssueSend: true), authorised by the requester.
// From the approved Care queue (caredemo@...) to simon.jehrbo@example.com.
import fs from 'node:fs';
import crypto from 'node:crypto';

const SP = import.meta.dirname;
const ORG = process.env.DV_ORG || 'https://your-org.crm4.dynamics.com';
const TOK = process.env.DV_TOKEN || fs.readFileSync(`${SP}/.tok`, 'utf8').trim();
const CASE = process.env.DV_CASE || fs.readFileSync(`${SP}/.caseid`, 'utf8').trim();

const CARE_QUEUE = '23b1c48e-1ff2-f011-8406-7ced8d2e4880';        // approved
const UNAPPROVED_QUEUE = '07a28679-31f5-f011-8406-7c1e521fcfa3';  // <Care Agents>, approval 0
const TO = process.env.DV_TO || 'simon.jehrbo@example.com';
const THREAD_SUBJECT = 'Reklamation: utaette samlinger efter montage - Jensen VVS';
const THREAD_HASH = 111000001;
const MB = 1048576;

const api = async (p, m, b, hdr = {}) => {
  const r = await fetch(`${ORG}/api/data/v9.2/${p}`, {
    method: m,
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json',
               Accept: 'application/json', 'OData-Version': '4.0', ...hdr },
    body: b ? JSON.stringify(b) : undefined,
  });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* */ }
  return { ok: r.ok, status: r.status, txt: t, json: j };
};
const errOf = (r) => String(r.json?.error?.message ?? r.txt ?? '').replace(/\s+/g, ' ').slice(0, 300);

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

// ============ TEST A: the real send ========================================
say('TEST A - real send from approved Care queue to ' + TO);
const a = await makeDraft({ fromQueue: CARE_QUEUE, to: TO, subject: `RE: ${THREAD_SUBJECT}`, hash: THREAD_HASH });
if (!a.ok) { say('  draft FAILED: ' + a.err); process.exit(1); }
say(`  draft created ${a.id}`);
const att = await attachChunked(a.id, 's7-1MB-chunked', 1 * MB);
say(att.ok ? `  attached 1 MB via chunked API (${att.id})` : `  attach FAILED @${att.stage}: ${att.err}`);
const before = await state(a.id);
say(`  before send: state=${before.state} status=${before.status} attachments=${before.attachments}`);
const t0 = Date.now();
const send = await api(`emails(${a.id})/Microsoft.Dynamics.CRM.SendEmail`, 'POST', { IssueSend: true });
const ms = Date.now() - t0;
if (send.ok) {
  const after = await state(a.id);
  say(`  SendEmail OK (${ms}ms) -> state=${after.state} status=${after.status}`);
  say(`  messageid=${after.messageid ?? '(null)'} conversationindex=${after.cIdx ? after.cIdx.length + ' chars' : '(null)'} trackingtoken=${after.token ?? '(null)'}`);
} else {
  say(`  SendEmail FAILED ${send.status}: ${errOf(send)}`);
}

// ============ TEST B: R18 - unapproved sender ==============================
say('\nTEST B - R18: send from an UNAPPROVED queue (expect a clean error)');
const b = await makeDraft({ fromQueue: UNAPPROVED_QUEUE, to: TO, subject: 'S7 R18 probe - unapproved sender (should not arrive)' });
if (!b.ok) { say('  draft FAILED: ' + b.err); }
else {
  const r = await api(`emails(${b.id})/Microsoft.Dynamics.CRM.SendEmail`, 'POST', { IssueSend: true });
  if (r.ok) {
    const st = await state(b.id);
    say(`  SendEmail returned OK -> state=${st.state} status=${st.status}  (no synchronous approval guard)`);
  } else {
    say(`  SendEmail FAILED ${r.status}: ${errOf(r)}`);
  }
  fs.writeFileSync(`${SP}/s7-testb.json`, JSON.stringify({ id: b.id }, null, 2));
}

fs.writeFileSync(`${SP}/s7-created.json`, JSON.stringify({ sent: a.id, testB: b.ok ? b.id : null }, null, 2));
say('\nids written to s7-created.json');
