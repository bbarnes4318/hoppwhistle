#!/usr/bin/env node
/**
 * Read-only probe of the FoneStorm API: finds how subaccount numbers, devices
 * and trunks are reached. Makes GET requests only (plus the auth POST).
 *
 *   node scripts/fonestorm-probe.mjs --sub 2005555318 --target 2005555185
 *
 * Writes any API spec it finds to fonestorm-openapi.json.
 */
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const SUB = opt('sub', '2005555318');
const TARGET = opt('target', '2005555185');
const BASE = (process.env.FONESTORM_BASE_URL || 'https://api.fonestorm.com/v2').replace(/\/$/, '');
const ROOT = BASE.replace(/\/v2$/, '');
const { FONESTORM_USERNAME: USER, FONESTORM_PASSWORD: PASS } = process.env;
if (!USER || !PASS) {
  console.error('Set FONESTORM_USERNAME and FONESTORM_PASSWORD.');
  process.exit(1);
}

async function auth(extra = {}) {
  const res = await fetch(`${BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS, expires: 3600, ...extra }),
  });
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {}
  const t = (data.auth ?? data).token;
  return { status: res.status, token: t, text };
}

// Drop bulky base64 blobs (QR codes etc.) so output stays readable.
const trim = (text, n = 600) =>
  text.replace(/"[A-Za-z0-9+/=\\n]{200,}"/g, '"<blob>"').replace(/\s+/g, ' ').slice(0, n);

async function get(label, url, headers) {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
    const text = await res.text();
    console.log(`\n[${res.status}] ${label}\n  ${trim(text)}`);
    return { status: res.status, text };
  } catch (e) {
    console.log(`\n[ERR] ${label}: ${e.message}`);
    return { status: 0, text: '' };
  }
}

const { token, status } = await auth();
if (!token) {
  console.error(`Auth failed (${status}).`);
  process.exit(1);
}
const H = { token };

console.log('=== API spec ===');
for (const p of ['/swagger.json', '/openapi.json', '/documentation/swagger.json', '/api-docs']) {
  for (const base of [BASE, ROOT]) {
    const r = await get(`${base}${p}`, `${base}${p}`, H);
    if (r.status === 200 && /"paths"/.test(r.text)) {
      writeFileSync('fonestorm-openapi.json', r.text);
      console.log('  -> saved to fonestorm-openapi.json');
    }
  }
}

console.log('\n=== Subaccount routes ===');
for (const id of [SUB, TARGET]) {
  for (const p of ['', '/fonenumbers', '/devices', '/trunks', '/siptrunks', '/users']) {
    await get(`/subaccounts/${id}${p}`, `${BASE}/subaccounts/${id}${p}`, H);
  }
}

console.log('\n=== Trunk-ish endpoints on parent ===');
for (const p of ['/trunks', '/siptrunks', '/sip_trunks', '/ringgroups', '/routes', '/users']) {
  await get(p, `${BASE}${p}`, H);
}

console.log('\n=== Subaccount via headers ===');
for (const h of ['account', 'subaccount', 'sub_account', 'account_id']) {
  await get(`/fonenumbers with header ${h}: ${SUB}`, `${BASE}/fonenumbers`, { ...H, [h]: SUB });
}

console.log('\n=== Subaccount via auth body ===');
for (const k of ['account', 'subaccount', 'sub_account', 'account_id']) {
  const a = await auth({ [k]: SUB });
  console.log(`\n[auth ${a.status}] with ${k}: ${SUB}  ${a.token ? '(got token)' : trim(a.text, 300)}`);
  if (a.token) {
    try {
      const p = JSON.parse(Buffer.from(a.token.split('.')[1], 'base64url').toString());
      console.log(`  token account: ${JSON.stringify(p.account)}`);
    } catch {}
    await get(`/fonenumbers as ${k}=${SUB}`, `${BASE}/fonenumbers`, { token: a.token });
    await get(`/devices as ${k}=${SUB}`, `${BASE}/devices`, { token: a.token });
  }
}
