import fs from 'node:fs';

const SP = import.meta.dirname;
const ORG = process.env.DV_ORG || 'https://your-org.crm4.dynamics.com';
const TOK = process.env.DV_TOKEN || fs.readFileSync(`${SP}/.tok`, 'utf8').trim();
const CASE = process.env.DV_CASE || fs.readFileSync(`${SP}/.caseid`, 'utf8').trim();

const AGENT_EMAIL = 'care@example.invalid';
const AGENT_NAME = 'Kundeservice';
const CONTACT_ID = '9ca2974a-f749-f111-bec6-70a8a52bb847'; // Anna Hansen
const CONTACT_EMAIL = 'anna.hansen@example.invalid';
const CONTACT_NAME = 'Anna Hansen';

const HASH_A = 111000001;
const HASH_B = 111000002;

const api = async (path, method, body) => {
  const r = await fetch(`${ORG}/api/data/v9.2/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOK}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'OData-Version': '4.0',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${path}\n${txt.slice(0, 700)}`);
  return txt ? JSON.parse(txt) : {};
};

const dk = (iso) =>
  new Date(iso).toLocaleString('da-DK', { dateStyle: 'long', timeStyle: 'short' });

// Wrap `prev` as Outlook-style quoted history, with DANISH headers -
// deliberately exercising the localisation concern flagged for R4/R12.
const quote = (prev, from, fromEmail, to, sent, subject) =>
  prev === null
    ? ''
    : `<div id="divRplyFwdMsg" dir="ltr"><hr style="display:inline-block;width:98%">` +
      `<b>Fra:</b> ${from} &lt;${fromEmail}&gt;<br>` +
      `<b>Sendt:</b> ${dk(sent)}<br>` +
      `<b>Til:</b> ${to}<br>` +
      `<b>Emne:</b> ${subject}<br><br>` +
      prev +
      `</div>`;

const body = (newText, quoted) =>
  `<html><body><div dir="ltr"><div style="font-family:Segoe UI,sans-serif;font-size:11pt">` +
  newText +
  `</div>${quoted}</div></body></html>`;

async function createEmail({ subject, newText, outgoing, when, hash, prev, prevMeta }) {
  const quoted = prev
    ? quote(prev, prevMeta.from, prevMeta.fromEmail, prevMeta.to, prevMeta.when, prevMeta.subject)
    : '';
  const html = body(newText, quoted);

  const sender = outgoing
    ? { addressused: AGENT_EMAIL, participationtypemask: 1 }
    : { 'partyid_contact@odata.bind': `/contacts(${CONTACT_ID})`, participationtypemask: 1 };
  const recipient = outgoing
    ? { 'partyid_contact@odata.bind': `/contacts(${CONTACT_ID})`, participationtypemask: 2 }
    : { addressused: AGENT_EMAIL, participationtypemask: 2 };

  const payload = {
    subject,
    description: html,
    directioncode: !!outgoing,
    overriddencreatedon: when,
    'regardingobjectid_incident@odata.bind': `/incidents(${CASE})`,
    email_activity_parties: [sender, recipient],
  };
  if (hash !== undefined) payload.baseconversationindexhash = hash;

  const rec = await api('emails?$select=activityid,subject,statecode,statuscode', 'POST', payload);
  return { id: rec.activityid, html, subject };
}

// Mark as genuinely sent/received rather than leaving everything as Draft.
async function setState(id, outgoing) {
  try {
    await api(`emails(${id})`, 'PATCH', { statecode: 1, statuscode: outgoing ? 3 : 4 });
    return 'ok';
  } catch (e) {
    return `FAILED: ${String(e.message).split('\n')[0]}`;
  }
}

const SUBJ_A = 'Reklamation: utaette samlinger efter montage - Jensen VVS';
const SUBJ_B = 'Tilbud paa reservedele - hastesag';
const SUBJ_C = 'Fakturaspoergsmaal - ordre 44812';

const threadA = [
  [false, '2026-08-03T07:14:00Z', 'Hej,<br><br>Vi har konstateret utaetheder ved to af samlingerne efter montagen i sidste uge. Der draaber synligt ved den nederste kobling. Kan I sende en tekniker?<br><br>Venlig hilsen<br>Anna Hansen'],
  [true,  '2026-08-03T09:02:00Z', 'Hej Anna,<br><br>Tak for din henvendelse. Jeg har oprettet en sag og booker en tekniker. Kan du bekraefte, om anlaegget er lukket ned i mellemtiden?<br><br>Venlig hilsen<br>Kundeservice'],
  [false, '2026-08-04T06:41:00Z', 'Ja, anlaegget er lukket ned. Vi har sat en spand under samlingen. Hvornaar kan teknikeren komme?'],
  [true,  '2026-08-04T11:20:00Z', 'Teknikeren kan vaere hos jer torsdag mellem 08 og 10. Passer det?'],
  [false, '2026-08-05T05:58:00Z', 'Torsdag passer fint. Adressen er den samme som ved montagen.'],
  [true,  '2026-08-06T13:05:00Z', 'Teknikeren har vaeret forbi og udskiftet begge koblinger. Han vurderer at spaendmomentet var for lavt ved den oprindelige montage. Vi daekker arbejdet under garantien.'],
  [false, '2026-08-07T08:33:00Z', 'Tusind tak - det ser taet ud nu. I maa gerne sende dokumentationen til vores tekniske afdeling.'],
];

const threadB = [
  [false, '2026-08-11T09:12:00Z', 'Hej, vi mangler et tilbud paa reservedele til det samme anlaeg. Det er en hastesag.'],
  [true,  '2026-08-11T10:44:00Z', 'Hej Anna, jeg vedhaefter tilbuddet. Det er gyldigt 14 dage.'],
  [false, '2026-08-12T07:05:00Z', 'Modtaget, tak. Vi vender tilbage efter intern godkendelse.'],
];

// No baseconversationindexhash - forces the subject-normalisation fallback.
const orphans = [
  [false, '2026-08-18T09:00:00Z', SUBJ_C, 'Hej, vi kan ikke genkende linje 3 paa faktura 44812. Kan I uddybe?'],
  [true,  '2026-08-18T12:30:00Z', `RE: ${SUBJ_C}`, 'Hej Anna, linje 3 er koerselstillaeg. Jeg vedhaefter den specificerede opgoerelse.'],
];

const created = [];

async function runThread(msgs, subjBase, hash) {
  let prev = null, prevMeta = null;
  for (let i = 0; i < msgs.length; i++) {
    const [outgoing, when, text] = msgs[i];
    const subject = i === 0 ? subjBase : `RE: ${subjBase}`;
    const r = await createEmail({ subject, newText: text, outgoing, when, hash, prev, prevMeta });
    const st = await setState(r.id, outgoing);
    created.push({ id: r.id, subject, dir: outgoing ? 'Out' : 'In', when, hash, state: st });
    console.log(`  ${String(i + 1).padStart(2)}. ${outgoing ? 'Out' : 'In '} ${when.slice(0, 10)}  ${subject.slice(0, 52)}  [${st}]`);
    prev = r.html;
    prevMeta = {
      from: outgoing ? AGENT_NAME : CONTACT_NAME,
      fromEmail: outgoing ? AGENT_EMAIL : CONTACT_EMAIL,
      to: outgoing ? CONTACT_NAME : AGENT_NAME,
      when, subject,
    };
  }
}

console.log(`Seeding into Case ${CASE}\n`);
console.log(`Thread A (hash ${HASH_A}, ${threadA.length} messages):`);
await runThread(threadA, SUBJ_A, HASH_A);
console.log(`\nThread B (hash ${HASH_B}, ${threadB.length} messages):`);
await runThread(threadB, SUBJ_B, HASH_B);

console.log(`\nOrphans (no hash - tests subject-normalisation fallback):`);
let prev = null, prevMeta = null;
for (const [outgoing, when, subject, text] of orphans) {
  const r = await createEmail({ subject, newText: text, outgoing, when, hash: undefined, prev, prevMeta });
  const st = await setState(r.id, outgoing);
  created.push({ id: r.id, subject, dir: outgoing ? 'Out' : 'In', when, hash: null, state: st });
  console.log(`   -  ${outgoing ? 'Out' : 'In '} ${when.slice(0, 10)}  ${subject.slice(0, 52)}  [${st}]`);
  prev = r.html;
  prevMeta = { from: outgoing ? AGENT_NAME : CONTACT_NAME, fromEmail: outgoing ? AGENT_EMAIL : CONTACT_EMAIL, to: outgoing ? CONTACT_NAME : AGENT_NAME, when, subject };
}

fs.writeFileSync(`${SP}/seeded-ids.json`, JSON.stringify({ caseId: CASE, emails: created }, null, 2));
console.log(`\nCreated ${created.length} emails. IDs written to seeded-ids.json (for cleanup).`);
