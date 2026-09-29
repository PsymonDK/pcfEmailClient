// Shared plumbing for every script under scripts/ that talks to Dataverse.
//
// One copy of the things that used to be pasted into 18 scripts, and the safety rails that the
// copies did not all have:
//
//   - ENVIRONMENT GUARD. `DV_ORG` must resolve to ALLOWED_ORG or the process exits before a single
//     request is made. Every revert here deletes by NAME, so a shell left pointed at another
//     environment (pac profile [2], another environment, is one `pac auth select` away)
//     would otherwise run them there.
//   - TOKEN IN-PROCESS. `DV_TOKEN` if you set it, otherwise `az account get-access-token`. There is
//     deliberately no `.tok` file fallback any more: a bearer token on disk outlives the shell
//     that needed it. The token is never logged.
//   - ONE FETCH WRAPPER. Throws with status and body on failure. A 404 becomes `null` only when the
//     caller says 404 means "absent" — so a 401 or 403 can never be mistaken for "nothing to do".
//   - DRY RUN BY DEFAULT. `CONFIRM` is `--confirm` on the command line; `runSteps` prints the plan
//     without it.
//   - RECIPIENT ALLOWLIST. `guardRecipient` refuses any real address but the one approved for
//     test sends (CLAUDE.md, 2026-09-25).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** The only environment any script here may touch: pac profile [3], the demo environment. */
export const ALLOWED_ORG = 'https://your-org.crm4.dynamics.com';

/** The only real mailbox test sends may reach. Everything else must be RFC 2606 undeliverable. */
export const APPROVED_TEST_RECIPIENT = 'simon.jehrbo@example.com';

export const CONFIRM = process.argv.includes('--confirm');

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

const fail = (message) => {
  console.error(`\nREFUSING: ${message}`);
  process.exit(2);
};

/**
 * Canonical form of an org URL: scheme + lower-cased host, no trailing slash. Anything that is
 * not a bare origin (a path, query, fragment or credentials) returns `null`, so it can never
 * compare equal to ALLOWED_ORG.
 */
export const normaliseOrg = (raw) => {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (u.username || u.password || u.search || u.hash) return null;
  if (u.pathname.replace(/\/+$/, '') !== '') return null;
  return `${u.protocol}//${u.host.toLowerCase()}`;
};

let env = null;

/**
 * `{ org, token }` for the one allowed environment, or exit non-zero.
 *
 * On Windows `az` is `az.cmd`, and Node refuses to spawn a `.cmd` without a shell (CVE-2024-27980),
 * so the command runs through the shell there. Every argument is a constant or the org, which has
 * already been proven equal to ALLOWED_ORG, so nothing user-controlled reaches the shell.
 */
export const getEnv = () => {
  if (env) return env;

  const requested = process.env.DV_ORG || ALLOWED_ORG;
  const org = normaliseOrg(requested);
  if (org !== ALLOWED_ORG) {
    fail(
      `DV_ORG is "${requested}". These scripts only ever target ${ALLOWED_ORG} `
      + '(pac profile [3], the demo environment). Unset DV_ORG or point it there.',
    );
  }

  let token = process.env.DV_TOKEN?.trim();
  if (!token) {
    const args = ['account', 'get-access-token', '--resource', org, '--query', 'accessToken', '-o', 'tsv'];
    const onWindows = process.platform === 'win32';
    try {
      token = String(onWindows
        ? execFileSync(['az', ...args].join(' '), { shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
        : execFileSync('az', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).trim();
    } catch (e) {
      const why = String(e.stderr ?? e.message ?? '').split('\n').find((l) => l.trim()) ?? 'unknown error';
      fail(`could not get a token from the Azure CLI (${why.trim()}). Run \`az login\`, or set DV_TOKEN.`);
    }
    if (!token) fail('the Azure CLI returned an empty token. Run `az login`, or set DV_TOKEN.');
  }

  env = { org, token };
  return env;
};

// ── requests ─────────────────────────────────────────────────────────────────

const describe = (txt, json) =>
  String(json?.error?.message ?? txt ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);

/**
 * One request, never throws on an HTTP status. For spikes that probe failure on purpose (an
 * over-cap upload, a send that should be refused) and need the response either way.
 *
 * @returns {{ ok: boolean, status: number, txt: string, json: any, headers: Headers, id?: string }}
 */
export const apiRaw = async (apiPath, { method = 'GET', body, solution, headers = {} } = {}) => {
  const { org, token } = getEnv();
  const r = await fetch(`${org}/api/data/v9.2/${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'OData-Version': '4.0',
      // Puts every created component straight into that unmanaged solution, so nothing is left
      // loose in the Default solution where it would be missed at export time.
      ...(solution ? { 'MSCRM.SolutionUniqueName': solution } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await r.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { /* not JSON */ }
  const id = r.headers.get('OData-EntityId')?.match(/\(([^)]+)\)\s*$/)?.[1];
  return { ok: r.ok, status: r.status, txt, json, headers: r.headers, id };
};

/** The message out of a failed `apiRaw` response, whitespace-collapsed. */
export const errorOf = (res) => describe(res.txt, res.json);

/**
 * One request that throws on failure.
 *
 * `allow404: true` turns a 404 into `null` — use it ONLY where 404 genuinely means "not there".
 * Every other failure throws an Error carrying `status` and `body`, which is what stops a 401
 * from an expired token reading as "the table does not exist, nothing to do".
 *
 * @returns {Promise<null | { status: number, json: any, headers: Headers, id?: string }>}
 */
export const api = async (apiPath, { method = 'GET', body, solution, allow404 = false, headers } = {}) => {
  const res = await apiRaw(apiPath, { method, body, solution, headers });
  if (res.status === 404 && allow404) return null;
  if (!res.ok) {
    const err = new Error(`${method} ${apiPath} -> ${res.status}: ${errorOf(res)}`);
    err.status = res.status;
    err.body = res.txt;
    throw err;
  }
  return { status: res.status, json: res.json, headers: res.headers, id: res.id };
};

/** An OData string literal, quotes doubled. */
export const odataString = (s) => `'${String(s).replace(/'/g, "''")}'`;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A bare GUID or exit — keeps anything else out of an OData URL. */
export const assertGuid = (value, what) => {
  const v = String(value ?? '').trim().replace(/^\{|\}$/g, '');
  if (!GUID.test(v)) fail(`${what} is not a GUID: "${value}"`);
  return v.toLowerCase();
};

/** The case a spike works on: `DV_CASE`, else a `.caseid` file beside the script. */
export const readCaseId = (dir) => {
  let raw = process.env.DV_CASE;
  if (!raw) {
    const file = path.join(dir, '.caseid');
    if (!fs.existsSync(file)) fail('set DV_CASE to the case guid (or put it in a .caseid file beside the script).');
    raw = fs.readFileSync(file, 'utf8');
  }
  return assertGuid(raw, 'DV_CASE');
};

// ── metadata helpers ─────────────────────────────────────────────────────────

/** A Dataverse `Label` in English (1033). */
export const label = (text) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.Label',
  LocalizedLabels: [{
    '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel',
    Label: text,
    LanguageCode: 1033,
  }],
});

const SETTLE_ATTEMPTS = 6;

/**
 * Retries a step through the metadata cache lag that follows a table creation.
 *
 * Measured 2026-09-11: `POST EntityDefinitions` returns 201 with a MetadataId, and for several
 * seconds afterwards every request that touches that table fails with *"was not found in the
 * MetadataCache.LazyDynamicMetadataCache"* — or, on the Attributes endpoint, with a bare
 * "An unexpected error occurred." So the first run created the table and then failed every
 * column on it. Without this, whether a script works depends on how fast the server settles.
 */
export const withSettle = async (fn, what) => {
  for (let attempt = 1; attempt <= SETTLE_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      const transient = /MetadataCache|unexpected error occurred/i.test(e.message);
      if (!transient || attempt === SETTLE_ATTEMPTS) throw e;
      console.log(`   ${what}: metadata cache not settled (attempt ${attempt} of ${SETTLE_ATTEMPTS}), retrying…`);
      await new Promise((r) => setTimeout(r, attempt * 4000));
    }
  }
  throw new Error('unreachable');
};

/**
 * PublishXml for the named entities and app modules.
 *
 * NOTE: publishing an ENTITY publishes every pending customisation on it — including other
 * people's unpublished work in this shared environment, not only ours. Scope it as narrowly as
 * the change allows.
 */
export const publish = ({ entities = [], appModules = [] } = {}) => {
  const xml = '<importexportxml>'
    + (entities.length ? `<entities>${entities.map((e) => `<entity>${e}</entity>`).join('')}</entities>` : '')
    + (appModules.length ? `<appmodules>${appModules.map((a) => `<appmodule>${a}</appmodule>`).join('')}</appmodules>` : '')
    + '</importexportxml>';
  return api('PublishXml', { method: 'POST', body: { ParameterXml: xml } });
};

// ── dry-run step lists ───────────────────────────────────────────────────────

/**
 * Runs `[{ what, run }]` in order, or — without confirmation — only lists them.
 *
 * A step's `run` returning `null` (an `allow404` miss, or nothing matched) reports "already gone".
 * A failing step is reported and the rest still run, because these are cleanup lists where each
 * step is independent enough that stopping halfway leaves more behind.
 *
 * @returns {Promise<boolean>} true only when confirmed AND every step succeeded.
 */
export const runSteps = async (steps, { confirm = CONFIRM } = {}) => {
  if (!confirm) {
    console.log('DRY RUN — nothing changed. Re-run with --confirm.\n');
    steps.forEach((s, i) => console.log(`  ${i + 1}. would ${s.what}`));
    return false;
  }
  let allOk = true;
  for (const [i, s] of steps.entries()) {
    try {
      const r = await s.run();
      console.log(`  ${i + 1}. ${s.what} -> ${r === null ? 'already gone' : 'ok'}`);
    } catch (e) {
      allOk = false;
      console.log(`  ${i + 1}. ${s.what} -> FAILED: ${String(e.message).slice(0, 300)}`);
    }
  }
  return allOk;
};

// ── ids files ────────────────────────────────────────────────────────────────

const looksAbsolute = (s) =>
  /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('\\\\')
  || s.includes(REPO_ROOT) || s.toLowerCase().includes(os.homedir().toLowerCase());

const assertNoLocalPaths = (value, where = '') => {
  if (typeof value === 'string') {
    if (looksAbsolute(value)) throw new Error(`refusing to write an absolute local path into an ids file (${where || 'value'})`);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertNoLocalPaths(v, where ? `${where}.${k}` : k);
  }
};

/** Parsed ids file, or `null` when it does not exist. */
export const readIds = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);

/** Writes an ids file stamped with the target org. Refuses absolute local paths in the content. */
export const writeIds = (file, obj) => {
  const out = { ...obj, org: obj.org ?? getEnv().org };
  assertNoLocalPaths(out);
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  return out;
};

/** Exit unless an ids file was written against `org`. A file with no org recorded is refused too. */
export const assertIdsOrg = (ids, org = getEnv().org) => {
  const recorded = ids?.org ? normaliseOrg(ids.org) : null;
  if (recorded !== org) {
    fail(`the ids file was recorded against "${ids?.org ?? '(no org recorded)'}", not ${org}. `
      + 'Its ids mean nothing here; nothing was changed.');
  }
};

// ── mail ─────────────────────────────────────────────────────────────────────

const RFC2606_UNDELIVERABLE = (domain) =>
  domain.endsWith('.invalid') || domain === 'example.com' || domain.endsWith('.example.com');

/**
 * Throws unless `to` is ONE address that is either the approved test recipient or undeliverable
 * by construction (RFC 2606 `.invalid` / `example.com`). Call it before any `SendEmail` with
 * `IssueSend: true`. Every other address in the shared demo environment belongs to someone who
 * did not agree to receive test mail.
 */
export const guardRecipient = (to) => {
  const addr = String(to ?? '').trim().toLowerCase();
  if (!/^[^\s@,;<>"']+@[^\s@,;<>"']+$/.test(addr)) {
    throw new Error(`guardRecipient: "${to}" is not exactly one plain email address`);
  }
  if (addr === APPROVED_TEST_RECIPIENT) return addr;
  const domain = addr.slice(addr.indexOf('@') + 1);
  if (RFC2606_UNDELIVERABLE(domain)) return addr;
  throw new Error(
    `guardRecipient: refusing to send to "${to}". Test sends may go only to ${APPROVED_TEST_RECIPIENT} `
    + 'or to an RFC 2606 undeliverable address (*.invalid, example.com).',
  );
};
