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
 *   --discover             print the login's account, subaccounts and devices, then exit
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
const DISCOVER = args.includes('--discover');

const BASE = (process.env.FONESTORM_BASE_URL || 'https://api.fonestorm.com/v2').replace(/\/$/, '');
const USER = process.env.FONESTORM_USERNAME;
const PASS = process.env.FONESTORM_PASSWORD;

if (!DISCOVER && (!FROM || !TO || !DEVICE)) {
  console.error('Usage: --from <subaccount> --to <subaccount> --device <device> [--apply]  |  --discover');
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

// Any field (at any depth) that looks like a subaccount reference, as strings.
function subaccountValues(r, inMatch = false) {
  const out = [];
  if (r == null) return out;
  if (typeof r !== 'object') return inMatch ? [String(r)] : out;
  for (const [k, v] of Object.entries(r)) {
    out.push(...subaccountValues(v, inMatch || /sub_?account/i.test(k)));
  }
  return out;
}

// GET /fonenumbers /{tn} may wrap the record, e.g. { fonenumber: {...} }.
function unwrap(data) {
  if (data?.fonenumber && typeof data.fonenumber === 'object') return data.fonenumber;
  const first = asList(data)[0];
  return first && typeof first === 'object' ? first : data;
}

// GET /fonenumbers returns only the numbers (no filter or paging params), so
// fetch each number's record to see its subaccount.
async function listAll() {
  const list = asList(await api('GET', '/fonenumbers'));
  const out = [];
  for (const item of list) {
    if (item && typeof item === 'object') {
      out.push(item);
      continue;
    }
    const tn = String(item).replace(/\D/g, '').slice(-10);
    try {
      out.push({ fonenumber: tn, ...unwrap(await api('GET', `/fonenumbers/${tn}`)) });
    } catch (e) {
      console.warn(`Could not read ${tn}: ${e.message}`);
    }
  }
  return out;
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

// Show which account the login is, plus its subaccounts and devices.
async function discover() {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    console.log('Logged in as account:', JSON.stringify(payload, null, 2));
  } catch {
    console.log('Could not decode token payload.');
  }
  for (const path of ['/subaccounts', '/devices']) {
    try {
      console.log(`\n${path}:\n`, JSON.stringify(await api('GET', path), null, 2));
    } catch (e) {
      console.log(`\n${path}: ${e.message}`);
    }
  }
}

async function main() {
  await auth();
  if (DISCOVER) return discover();

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
      const rec = unwrap(after);
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
