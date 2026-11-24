// Seeds its OWN Case with 50 emails for the N5 performance measurement. See docs/project-plan.md 3.4.
//
//   node scripts/seed/seed-n5.mjs [--confirm]
//
// Environment guard and token acquisition: see scripts/deploy/README.md. Dry run unless --confirm.
//
// Unlike seed.mjs it creates the Case too (a throwaway, titled TEST - N5 ...), then 10 threads of 5
// messages, each reply quoting the one before as Outlook-style nested history. Nothing is sent: rows
// are created directly and patched to Sent/Received, every address is the demo tenant or
// RFC 2606 `.invalid`. It writes seeded-ids.json after EVERY row, in the format cleanup.mjs reads,
// so `node scripts/seed/cleanup.mjs --confirm` removes the emails and then the Case.
import {
  CONFIRM, api as dvApi, getEnv, readIds, writeIds,
} from '../lib/dv.mjs';

const SP = import.meta.dirname;
const MANIFEST = `${SP}/seeded-ids.json`;
const { org: ORG } = getEnv();

const THREADS = 10;
const PER_THREAD = 5;

const previous = readIds(MANIFEST);
if (previous?.caseId || previous?.emails?.length) {
  console.log(`REFUSING: seeded-ids.json still lists ${previous.emails?.length ?? 0} email(s) on case ${previous.caseId}.`);
  console.log('Run node scripts/seed/cleanup.mjs --confirm first, so those rows are not orphaned.');
  process.exit(1);
}

const AGENT_EMAIL = 'care@example.invalid';
const AGENT_NAME = 'Kundeservice';
const CONTACT_ID = '9ca2974a-f749-f111-bec6-70a8a52bb847'; // Anna Hansen
const CONTACT_EMAIL = 'anna.hansen@example.invalid';
const CONTACT_NAME = 'Anna Hansen';

const api = async (path, method, body) =>
  (await dvApi(path, { method, body, headers: { Prefer: 'return=representation' } })).json ?? {};

const dk = (iso) => new Date(iso).toLocaleString('da-DK', { dateStyle: 'long', timeStyle: 'short' });

const quote = (prev, from, fromEmail, to, sent, subject) =>
  `<div id="divRplyFwdMsg" dir="ltr"><hr style="display:inline-block;width:98%">`
  + `<b>Fra:</b> ${from} &lt;${fromEmail}&gt;<br><b>Sendt:</b> ${dk(sent)}<br>`
  + `<b>Til:</b> ${to}<br><b>Emne:</b> ${subject}<br><br>${prev}</div>`;

const body = (text, quoted) =>
  `<html><body><div dir="ltr"><div style="font-family:Segoe UI,sans-serif;font-size:11pt">${text}</div>${quoted}</div></body></html>`;

// 30 days of mail ending now, spread evenly over the 50 messages.
const DAY = 86_400_000;
const START = Date.now() - 30 * DAY;
const STEP = (30 * DAY) / (THREADS * PER_THREAD);
const when = (n) => new Date(START + n * STEP).toISOString();

const plan = [];
for (let t = 0; t < THREADS; t++) {
  for (let m = 0; m < PER_THREAD; m++) {
    plan.push({ t, m, n: t * PER_THREAD + m });
  }
}

const created = [];
const saveManifest = (caseId) => writeIds(MANIFEST, { org: ORG, caseId, emails: created });

if (!CONFIRM) {
  console.log(`Target: ${ORG}`);
  console.log('\nDRY RUN - nothing created. Re-run with --confirm.');
  console.log(`Would create 1 Case (TEST - N5 performance seed) and ${plan.length} emails`);
  console.log(`in ${THREADS} threads of ${PER_THREAD}, spread over 30 days, nested quoted history.`);
  console.log('and write their ids to seeded-ids.json for cleanup.mjs.');
  process.exit(0);
}

// The contact must exist: a missing one would fail every email after the Case was already created.
await api(`contacts(${CONTACT_ID})?$select=contactid`, 'GET');

const kase = await api('incidents?$select=incidentid,title', 'POST', {
  title: 'TEST - N5 performance seed (50 emails)',
  'customerid_contact@odata.bind': `/contacts(${CONTACT_ID})`,
});
const CASE = kase.incidentid;
saveManifest(CASE);
console.log(`Case ${CASE}`);

const state = new Map(); // thread -> { html, meta } of the previous message
for (const { t, m, n } of plan) {
  const outgoing = m % 2 === 1;
  const subjBase = `Sag ${t + 1}: henvendelse om ordre ${50000 + t}`;
  const subject = m === 0 ? subjBase : `RE: ${subjBase}`;
  const sent = when(n);
  const prev = state.get(t);
  const text = `Besked ${m + 1} i traad ${t + 1}. `
    + 'Vi har gennemgaaet sagen og vender tilbage med en opdatering, saa snart vi har modtaget svar fra den tekniske afdeling.';
  const html = body(text, prev ? quote(prev.html, prev.from, prev.fromEmail, prev.to, prev.sent, prev.subject) : '');

  const sender = outgoing
    ? { addressused: AGENT_EMAIL, participationtypemask: 1 }
    : { 'partyid_contact@odata.bind': `/contacts(${CONTACT_ID})`, participationtypemask: 1 };
  const recipient = outgoing
    ? { 'partyid_contact@odata.bind': `/contacts(${CONTACT_ID})`, participationtypemask: 2 }
    : { addressused: AGENT_EMAIL, participationtypemask: 2 };

  const rec = await api('emails?$select=activityid', 'POST', {
    subject,
    description: html,
    directioncode: outgoing,
    overriddencreatedon: sent,
    baseconversationindexhash: 112000001 + t,
    'regardingobjectid_incident@odata.bind': `/incidents(${CASE})`,
    email_activity_parties: [sender, recipient],
  });
  created.push({ id: rec.activityid, subject, dir: outgoing ? 'Out' : 'In', when: sent, state: 'created' });
  saveManifest(CASE);

  try {
    await api(`emails(${rec.activityid})`, 'PATCH', { statecode: 1, statuscode: outgoing ? 3 : 4 });
    created[created.length - 1].state = 'ok';
  } catch (e) {
    created[created.length - 1].state = `FAILED: ${String(e.message).split('\n')[0]}`;
  }
  saveManifest(CASE);

  state.set(t, {
    html,
    from: outgoing ? AGENT_NAME : CONTACT_NAME,
    fromEmail: outgoing ? AGENT_EMAIL : CONTACT_EMAIL,
    to: outgoing ? CONTACT_NAME : AGENT_NAME,
    sent,
    subject,
  });
  if ((n + 1) % 10 === 0) console.log(`  ${n + 1}/${plan.length}`);
}

const failed = created.filter((e) => e.state !== 'ok').length;
console.log(`\nCreated ${created.length} emails on case ${CASE} (${failed} not marked Sent/Received).`);
console.log('IDs written to seeded-ids.json. Clean up with: node scripts/seed/cleanup.mjs --confirm');
