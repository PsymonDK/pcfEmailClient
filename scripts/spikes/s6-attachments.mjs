// S6 - attachment round-trip against the real environment.
// Read-only on System Settings: MaxUploadFileSize is NOT changed.
//
//   DV_CASE=<case guid> node scripts/spikes/s6-attachments.mjs [--confirm]
//
// Environment guard and token acquisition: see scripts/deploy/README.md.
//
// Dry run unless --confirm: it creates a draft email and about 21 MB of attachments on the case.
// Created ids are written to s6-created.json as they are made, so a run that fails halfway still
// says what to clean up.
import crypto from 'node:crypto';
import {
  CONFIRM, apiRaw, errorOf, getEnv, readCaseId, writeIds,
} from '../lib/dv.mjs';

const SP = import.meta.dirname;
const { org: ORG } = getEnv();
const CASE = readCaseId(SP);
const CREATED_FILE = `${SP}/s6-created.json`;

// Non-throwing on purpose: the over-cap probe is EXPECTED to fail, and that failure is the finding.
const api = (path, method, body, headers = {}) => apiRaw(path, { method, body, headers });

const errOf = (res) => errorOf(res).slice(0, 220);

const MB = 1048576;
const created = { emails: [], attachments: [] };
const saveCreated = () => writeIds(CREATED_FILE, { caseId: CASE, ...created });

console.log(`Target: ${ORG}`);

// --- 0. read the ceiling (no writes) ---------------------------------------
const org = await api('organizations?$select=name,maxuploadfilesize', 'GET');
if (!org.ok) { console.error('could not read the organization:', errOf(org)); process.exit(1); }
const MAX = org.json.value[0].maxuploadfilesize;
console.log(`MaxUploadFileSize = ${MAX} bytes (${(MAX / MB).toFixed(2)} MB)\n`);

if (!CONFIRM) {
  console.log('DRY RUN — nothing created. Re-run with --confirm.');
  console.log(`Would create one draft email on case ${CASE}, attach 5 probes (1 KB to 6 MB, inline and`);
  console.log('chunked), download each back to compare SHA-256, and record the ids in s6-created.json.');
  process.exit(0);
}

// --- 1. a draft email to hang attachments on -------------------------------
const draft = await api('emails?$select=activityid', 'POST', {
  subject: 'TEST S6 attachment round-trip (safe to delete)',
  description: '<p>S6 spike. Created by scripts, safe to delete.</p>',
  directioncode: true,
  'regardingobjectid_incident@odata.bind': `/incidents(${CASE})`,
}, { Prefer: 'return=representation' });
if (!draft.ok) { console.error('could not create draft:', errOf(draft)); process.exit(1); }
const EMAIL = draft.json.activityid;
created.emails.push(EMAIL);
saveCreated();
console.log(`draft email ${EMAIL}  (statecode/statuscode left at platform default = Open/Draft)\n`);

// --- helpers ---------------------------------------------------------------
const makeBuf = (bytes) => {
  // Incompressible random data so nothing is silently deflated in transit.
  const b = Buffer.alloc(bytes);
  crypto.randomFillSync(b);
  return b;
};

async function uploadInline(label, bytes) {
  const buf = makeBuf(bytes);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const t0 = Date.now();
  const res = await api('activitymimeattachments?$select=activitymimeattachmentid', 'POST', {
    'objectid_email@odata.bind': `/emails(${EMAIL})`,
    objecttypecode: 'email',
    subject: label,
    filename: `${label}.bin`,
    mimetype: 'application/octet-stream',
    body: buf.toString('base64'),
  }, { Prefer: 'return=representation' });
  const ms = Date.now() - t0;
  if (res.ok) {
    created.attachments.push(res.json.activitymimeattachmentid);
    saveCreated();
    return { ok: true, id: res.json.activitymimeattachmentid, sha, ms, bytes };
  }
  return { ok: false, status: res.status, err: errOf(res), ms, bytes };
}

async function uploadChunked(label, bytes, blockSize = 4 * MB) {
  const buf = makeBuf(bytes);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const t0 = Date.now();
  const init = await api('InitializeAttachmentBlocksUpload', 'POST', {
    Target: {
      '@odata.type': 'Microsoft.Dynamics.CRM.activitymimeattachment',
      'objectid_email@odata.bind': `/emails(${EMAIL})`,
      objecttypecode: 'email',
      subject: label,
      filename: `${label}.bin`,
      mimetype: 'application/octet-stream',
    },
  });
  if (!init.ok) return { ok: false, stage: 'Initialize', status: init.status, err: errOf(init), bytes };
  const token = init.json.FileContinuationToken;
  const blockIds = [];
  for (let off = 0; off < buf.length; off += blockSize) {
    const chunk = buf.subarray(off, Math.min(off + blockSize, buf.length));
    const blockId = Buffer.from(String(off).padStart(16, '0')).toString('base64');
    blockIds.push(blockId);
    const up = await api('UploadBlock', 'POST', {
      BlockId: blockId,
      BlockData: chunk.toString('base64'),
      FileContinuationToken: token,
    });
    if (!up.ok) return { ok: false, stage: `UploadBlock@${off}`, status: up.status, err: errOf(up), bytes };
  }
  const commit = await api('CommitAttachmentBlocksUpload', 'POST', {
    BlockList: blockIds,
    FileContinuationToken: token,
    Target: {
      '@odata.type': 'Microsoft.Dynamics.CRM.activitymimeattachment',
      'objectid_email@odata.bind': `/emails(${EMAIL})`,
      objecttypecode: 'email',
      subject: label,
      filename: `${label}.bin`,
      mimetype: 'application/octet-stream',
    },
  });
  const ms = Date.now() - t0;
  if (!commit.ok) return { ok: false, stage: 'Commit', status: commit.status, err: errOf(commit), ms, bytes };
  const id = commit.json?.ActivityMimeAttachmentId ?? commit.json?.activitymimeattachmentid ?? null;
  if (id) { created.attachments.push(id); saveCreated(); }
  return { ok: true, id, sha, ms, bytes, blocks: blockIds.length };
}

async function download(id, expectSha) {
  const res = await api(`activitymimeattachments(${id})?$select=filename,filesize,mimetype,body`, 'GET');
  if (!res.ok) return { ok: false, err: errOf(res) };
  const back = Buffer.from(res.json.body, 'base64');
  return {
    ok: true,
    filesize: res.json.filesize,
    bytesBack: back.length,
    shaMatch: crypto.createHash('sha256').update(back).digest('hex') === expectSha,
  };
}

// --- 2. the probes ---------------------------------------------------------
const cases = [
  ['s6-1KB', 1024, 'inline'],
  ['s6-4MB', 4 * MB, 'inline'],
  ['s6-6MB-over-cap', 6 * MB, 'inline'],
  ['s6-6MB-chunked', 6 * MB, 'chunked'],
  ['s6-4MB-chunked', 4 * MB, 'chunked'],
];

const results = [];
for (const [label, bytes, mode] of cases) {
  const r = mode === 'inline' ? await uploadInline(label, bytes) : await uploadChunked(label, bytes);
  results.push({ label, mode, ...r });
  const size = `${(bytes / MB).toFixed(2)}MB`.padStart(8);
  if (r.ok) console.log(`  ${label.padEnd(18)} ${mode.padEnd(8)} ${size}  OK    ${r.ms}ms${r.blocks ? ` (${r.blocks} blocks)` : ''}`);
  else console.log(`  ${label.padEnd(18)} ${mode.padEnd(8)} ${size}  FAIL  ${r.status}${r.stage ? ` @${r.stage}` : ''}: ${r.err}`);
}

// --- 3. download round-trip for the ones that uploaded ---------------------
console.log('\nDownload round-trip (sha256 compared):');
for (const r of results.filter((x) => x.ok && x.id)) {
  const d = await download(r.id, r.sha);
  console.log(d.ok
    ? `  ${r.label.padEnd(18)} filesize=${String(d.filesize).padStart(8)}  bytesBack=${String(d.bytesBack).padStart(8)}  sha match: ${d.shaMatch}`
    : `  ${r.label.padEnd(18)} DOWNLOAD FAILED: ${d.err}`);
}

saveCreated();
console.log(`\nCreated ids written to s6-created.json for cleanup.`);
