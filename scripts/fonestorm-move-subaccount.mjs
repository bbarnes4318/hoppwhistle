#!/usr/bin/env node
/**
 * Point every FoneStorm DID on a subaccount at a device (e.g. the Dograh
 * outbound SIP trunk), and report what's needed to move them to another
 * subaccount.
 *
 * What the FoneStorm API (v2.12 spec) allows:
 *   - POST /subaccounts/token { subaccount }  → token that acts as that subaccount
 *   - GET  /fonenumbers, GET /devices          → scoped to the token's account
 *   - PUT  /fonenumbers/{tn}                   → routing via call_options.receive
 *                                                { type: "Device", value: <device id> }
 * It has NO field or endpoint for moving a number between subaccounts; that
 * has to be done in the FracTEL portal or by FracTEL support.
 *
 * Dry run by default: lists the numbers on --from, finds --device on --to
 * (or --from), and prints the routing change. --apply makes the change and
 * re-reads each number.
 *
 *   FONESTORM_USERNAME=... FONESTORM_PASSWORD=... \
 *   node scripts/fonestorm-move-subaccount.mjs \
 *     --from 2005555318 --to 2005555185 --device Trunk-1-178.156.223.97 [--apply]
 *
 * Each run saves the --from numbers to fonestorm-<subaccount>-numbers.txt.
 * Once they have been moved to --to, route just those numbers with:
 *   --from 2005555185 --device Trunk-1-178.156.223.97 --only fonestorm-2005555318-numbers.txt --apply
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const FROM = opt('from');
const TO = opt('to');
const DEVICE = opt('device');
const APPLY = args.includes('--apply');
const ONLY = opt('only');
const RESTORE = opt('restore');

const BASE = (process.env.FONESTORM_BASE_URL || 'https://api.fonestorm.com/v2').replace(/\/$/, '');
const USER = process.env.FONESTORM_USERNAME;
const PASS = process.env.FONESTORM_PASSWORD;

if (!FROM || (!DEVICE && !RESTORE)) {
  console.error('Usage: --from <subaccount> [--to <subaccount>] --device <device name, id or host IP> [--apply]\n       --from <subaccount> --restore <routing-backup.jsonl> [--apply]');
  process.exit(1);
}
if (!USER || !PASS) {
  console.error('Set FONESTORM_USERNAME and FONESTORM_PASSWORD.');
  process.exit(1);
}

async function call(token, method, path, body) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.token = token;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return data;
}

// The token sits at different depths depending on the endpoint.
function findToken(data) {
  if (!data || typeof data !== 'object') return undefined;
  if (typeof data.token === 'string') return data.token;
  for (const v of Object.values(data)) {
    const t = findToken(v);
    if (t) return t;
  }
  return undefined;
}

// FoneStorm wraps lists as { fonenumbers: [...] }, { devices: [...] }, etc.
const firstArray = (data) => (Array.isArray(data) ? data : Object.values(data ?? {}).find(Array.isArray) ?? []);
const tenDigit = (v) => String(v).replace(/\D/g, '').slice(-10);

// Put each number's call routing back from a backup written by --apply.
async function restore(token) {
  const rows = readFileSync(RESTORE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.receive?.type);
  console.log(`${rows.length} numbers to restore from ${RESTORE}`);
  const byType = {};
  for (const r of rows) byType[`${r.receive.type} ${r.receive.id ?? r.receive.value ?? ''}`] = (byType[`${r.receive.type} ${r.receive.id ?? r.receive.value ?? ''}`] ?? 0) + 1;
  for (const [k, n] of Object.entries(byType)) console.log(`  ${n} → ${k}`);
  if (!APPLY) {
    console.log('Dry run. Re-run with --apply to restore.');
    return;
  }
  const failed = [];
  for (const r of rows) {
    const { type, id, value, url_method } = r.receive;
    const receive = { type, value: String(id ?? value ?? '') };
    if (url_method) receive.url_method = url_method;
    try {
      await call(token, 'PUT', `/fonenumbers/${r.fonenumber}`, { call_options: { receive } });
      console.log(`OK    ${r.fonenumber}  → ${type} ${receive.value}`);
    } catch (e) {
      console.error(`FAIL  ${r.fonenumber}: ${e.message}`);
      failed.push(r.fonenumber);
    }
  }
  console.log(`\nRestored ${rows.length - failed.length}/${rows.length}.`);
  if (failed.length) process.exit(3);
}

async function main() {
  const parent = findToken(await call(null, 'POST', '/auth', { username: USER, password: PASS, expires: 3600 }));
  if (!parent) throw new Error('FoneStorm auth returned no token');
  const subToken = async (id) => {
    const t = findToken(await call(parent, 'POST', '/subaccounts/token', { subaccount: id }));
    if (!t) throw new Error(`No token returned for subaccount ${id}`);
    return t;
  };

  const fromToken = await subToken(FROM);
  if (RESTORE) return restore(fromToken);
  let numbers = firstArray(await call(fromToken, 'GET', '/fonenumbers')).map((n) =>
    tenDigit(typeof n === 'object' ? n.fonenumber ?? n.number : n)
  );
  if (!ONLY) {
    writeFileSync(`fonestorm-${FROM}-numbers.txt`, numbers.join('\n') + '\n');
  } else {
    const keep = new Set(readFileSync(ONLY, 'utf8').replace(/^\uFEFF/, '').split(/\s+/).filter(Boolean).map(tenDigit));
    const missing = [...keep].filter((tn) => !numbers.includes(tn));
    if (missing.length) console.log(`Not on ${FROM} yet (skipped): ${missing.join(', ')}`);
    numbers = numbers.filter((tn) => keep.has(tn));
  }
  console.log(`Subaccount ${FROM}: ${numbers.length} numbers${ONLY ? ` (limited to ${ONLY})` : ''}`);
  for (const tn of numbers) console.log('  ', tn);
  if (!numbers.length) return;

  // Look for the device on --to first (where the numbers are going), then --from.
  let device;
  let deviceAcct;
  for (const id of [TO, FROM].filter(Boolean)) {
    const token = id === FROM ? fromToken : await subToken(id);
    const devices = firstArray(await call(token, 'GET', '/devices'));
    console.log(`\nDevices on ${id}: ${devices.map((d) => `${d.name} (${d.id}, ${d.type})`).join(', ') || 'none'}`);
    device = devices.find((d) => d.id === DEVICE || d.name === DEVICE || d.host_ip === DEVICE);
    if (device) {
      deviceAcct = id;
      break;
    }
  }
  if (!device) {
    console.log(`\nDevice "${DEVICE}" not found on ${[TO, FROM].filter(Boolean).join(' or ')}. Nothing changed.`);
    process.exit(2);
  }
  console.log(`\nDevice: ${device.name} → id ${device.id} (on subaccount ${deviceAcct})`);

  if (TO && TO !== FROM) {
    console.log(
      `\nNOTE: the FoneStorm API cannot move numbers from ${FROM} to ${TO}.` +
        `\nDo that in the FracTEL portal or via FracTEL support, then re-run with:\n  --from ${TO} --device ${DEVICE} --only fonestorm-${FROM}-numbers.txt`
    );
    if (deviceAcct !== FROM) {
      console.log(`The device is on ${deviceAcct}, so numbers still on ${FROM} can't be routed to it yet. Nothing changed.`);
      return;
    }
  }

  const body = { call_options: { receive: { type: 'Device', value: device.id } } };
  console.log(`\nUpdate: PUT /fonenumbers/<tn>  ${JSON.stringify(body)}`);
  if (!APPLY) {
    console.log(`Dry run: ${numbers.length} numbers would be routed to ${device.name}. Re-run with --apply.`);
    return;
  }

  // Record each number's current routing before changing it, so it can be undone.
  const backupFile = `fonestorm-${FROM}-routing-backup.jsonl`;
  console.log(`Saving previous routing to ${backupFile}`);
  const failed = [];
  for (const tn of numbers) {
    try {
      const before = await call(fromToken, 'GET', `/fonenumbers/${tn}`);
      const prev = (before.fonenumber ?? before).call_options?.receive ?? null;
      appendFileSync(backupFile, JSON.stringify({ fonenumber: tn, receive: prev }) + '\n');
      await call(fromToken, 'PUT', `/fonenumbers/${tn}`, body);
      const after = await call(fromToken, 'GET', `/fonenumbers/${tn}`);
      const recv = (after.fonenumber ?? after).call_options?.receive ?? {};
      const ok = recv.type === 'Device' && String(recv.id ?? recv.value) === String(device.id);
      console.log(`${ok ? 'OK   ' : 'CHECK'} ${tn}  receive=${JSON.stringify(recv)}`);
      if (!ok) failed.push(tn);
    } catch (e) {
      console.error(`FAIL  ${tn}: ${e.message}`);
      failed.push(tn);
    }
  }
  console.log(`\nDone: ${numbers.length - failed.length}/${numbers.length} routed to ${device.name}.`);
  if (failed.length) {
    console.log('Needs attention:', failed.join(', '));
    process.exit(3);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
