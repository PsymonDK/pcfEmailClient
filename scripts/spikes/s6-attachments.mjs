// S6 - attachment round-trip against the real environment.
// Read-only on System Settings: MaxUploadFileSize is NOT changed.
import fs from 'node:fs';
import crypto from 'node:crypto';

const SP = import.meta.dirname;
const ORG = process.env.DV_ORG || 'https://your-org.crm4.dynamics.com';
const TOK = process.env.DV_TOKEN || fs.readFileSync(`${SP}/.tok`, 'utf8').trim();
const CASE = process.env.DV_CASE || fs.readFileSync(`${SP}/.caseid`, 'utf8').trim();

const api = async (path, method, body, extraHeaders = {}) => {
  const r = await fetch(`${ORG}/api/data/v9.2/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOK}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'OData-Version': '4.0',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let parsed = null;
  try { parsed = txt ? JSON.parse(txt) : null; } catch { /* non-JSON */ }
  return { ok: r.ok, status: r.status, txt, json: parsed, headers: r.headers };
};

const errOf = (res) => {
  const m = res.json?.error?.message ?? res.txt ?? '';
  return String(m).replace(/\s+/g, ' ').slice(0, 220);
};

const MB = 1048576;
const created = { emails: [], attachments: [] };

// --- 0. read the ceiling (no writes) ---------------------------------------
const org = await api('organizations?$select=name,maxuploadfilesize', 'GET');
const MAX = org.json.value[0].maxuploadfilesize;
console.log(`MaxUploadFileSize = ${MAX} bytes (${(MAX / MB).toFixed(2)} MB)\n`);

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
  if (id) created.attachments.push(id);
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

fs.writeFileSync(`${SP}/s6-created.json`, JSON.stringify(created, null, 2));
console.log(`\nCreated ids written to s6-created.json for cleanup.`);
