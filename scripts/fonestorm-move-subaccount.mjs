#!/usr/bin/env node
/**
 * Move every FoneStorm DID on one subaccount to another subaccount and
 * point it at a new device (e.g. the Dograh outbound trunk).
 *
 * Dry run by default: lists the matching DIDs, prints one raw record so you
 * can confirm the field names, and shows the update it would send.
 * Pass --apply to make the changes; each number is re-read afterwards.
 *
 *   FONESTORM_USERNAME=... FONESTORM_PASSWORD=... \
 *   node scripts/fonestorm-move-subaccount.mjs \
 *     --from 2005555318 --to 2005555185 --device Trunk-1-178.156.223.97 [--apply]
 *
 * Options:
 *   --sub-field <name>     body field for the subaccount (default: sub_account)
 *   --device-field <name>  body field for the device    (default: device)
 *   --method <PUT|PATCH>   update method                 (default: PUT)
 *
 * Auth and error handling mirror apps/api/src/services/provisioning/adapters/fractel-adapter.ts.
 */

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const FROM = opt('from');
const TO = opt('to');
const DEVICE = opt('device');
const SUB_FIELD = opt('sub-field', 'sub_account');
const DEVICE_FIELD = opt('device-field', 'device');
const METHOD = opt('method', 'PUT').toUpperCase();
const APPLY = args.includes('--apply');

const BASE = (process.env.FONESTORM_BASE_URL || 'https://api.fonestorm.com/v2').replace(/\/$/, '');
const USER = process.env.FONESTORM_USERNAME;
const PASS = process.env.FONESTORM_PASSWORD;

if (!FROM || !TO || !DEVICE) {
  console.error('Usage: --from <subaccount> --to <subaccount> --device <device> [--apply]');
  process.exit(1);
}
if (!USER || !PASS) {
  console.error('Set FONESTORM_USERNAME and FONESTORM_PASSWORD.');
  process.exit(1);
}

let token;
async function auth() {
  const res = await fetch(`${BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS, expires: 3600 }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`FoneStorm auth failed (${res.status}): ${JSON.stringify(data)}`);
  const a = data.auth ?? data;
  token = a.token || data.token || data.access_token;
  if (!token) throw new Error(`FoneStorm auth returned no token: ${JSON.stringify(data)}`);
}

async function api(method, path, body, query) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: { token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${method} ${url.pathname}${url.search} → ${res.status}: ${text.slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// FoneStorm wraps lists differently per endpoint; take the first array we find.
function asList(data) {
  if (Array.isArray(data)) return data;
  for (const v of Object.values(data ?? {})) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const inner = asList(v);
      if (inner.length) return inner;
    }
  }
  return [];
}

const tnOf = (r) =>
  String(r.fonenumber ?? r.FoneNumber ?? r.foneNumber ?? r.number ?? r.tn ?? r.did ?? '').replace(/\D/g, '').slice(-10);

// Any field that looks like a subaccount reference, flattened to strings.
function subaccountValues(r) {
  const out = [];
  for (const [k, v] of Object.entries(r)) {
    if (!/sub_?account|^account/i.test(k)) continue;
    if (v && typeof v === 'object') out.push(...Object.values(v).map(String));
    else if (v != null) out.push(String(v));
  }
  return out;
}

// GET /fonenumbers takes no filter or paging params, so fetch it once and
// filter locally.
async function listAll() {
  const data = await api('GET', '/fonenumbers');
  if (!Array.isArray(data)) {
    const keys = Object.entries(data ?? {}).map(([k, v]) => `${k}${Array.isArray(v) ? `[${v.length}]` : ''}`);
    console.log('Response keys:', keys.join(', '));
  }
  return asList(data);
}

async function resolveDevice() {
  try {
    const devices = asList(await api('GET', '/devices'));
    const hit = devices.find((d) => Object.values(d).some((v) => String(v) === DEVICE));
    if (hit) {
      console.log('Device found:', JSON.stringify(hit));
      return hit.id ?? hit.device_id ?? hit.name ?? DEVICE;
    }
    console.warn(`No device matching "${DEVICE}" in GET /devices (${devices.length} listed); sending the name as-is.`);
  } catch (e) {
    console.warn(`Could not list devices (${e.message}); sending the name as-is.`);
  }
  return DEVICE;
}

async function main() {
  await auth();

  const numbers = await listAll();
  const matched = numbers.filter((r) => subaccountValues(r).includes(FROM));

  console.log(`Scanned ${numbers.length} numbers; ${matched.length} on subaccount ${FROM}.`);
  if (!matched.length) {
    if (numbers[0]) console.log('Sample record (check the subaccount field name):\n', JSON.stringify(numbers[0], null, 2));
    process.exit(2);
  }
  console.log('Sample matched record:\n', JSON.stringify(matched[0], null, 2));

  const deviceValue = await resolveDevice();
  const body = { [SUB_FIELD]: TO, [DEVICE_FIELD]: deviceValue };
  console.log(`\nUpdate: ${METHOD} /fonenumbers/<tn>  ${JSON.stringify(body)}`);
  for (const r of matched) console.log('  ', tnOf(r));

  if (!APPLY) {
    console.log(`\nDry run: ${matched.length} numbers would be moved. Re-run with --apply.`);
    return;
  }

  const failed = [];
  for (const r of matched) {
    const tn = tnOf(r);
    try {
      await api(METHOD, `/fonenumbers/${tn}`, body);
      const after = await api('GET', `/fonenumbers/${tn}`).catch(() => ({}));
      const rec = asList(after)[0] ?? after.fonenumber ?? after;
      const subs = subaccountValues(rec);
      const ok = subs.includes(TO);
      console.log(`${ok ? 'OK  ' : 'CHECK'} ${tn}  subaccount=${subs.join('/') || '?'}  device=${JSON.stringify(rec[DEVICE_FIELD] ?? rec.device_id ?? '?')}`);
      if (!ok) failed.push(tn);
    } catch (e) {
      console.error(`FAIL ${tn}: ${e.message}`);
      failed.push(tn);
    }
  }
  console.log(`\nDone: ${matched.length - failed.length}/${matched.length} moved.`);
  if (failed.length) {
    console.log('Needs attention:', failed.join(', '));
    process.exit(3);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
