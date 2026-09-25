#!/usr/bin/env node
/**
 * Print the parts of fonestorm-openapi.json (saved by fonestorm-probe.mjs)
 * that matter for moving numbers between subaccounts and routing them to a
 * device/trunk: matching endpoints, their params and request-body fields.
 *
 *   node scripts/fonestorm-spec-summary.mjs > spec-summary.txt
 */
import { readFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync(process.argv[2] || 'fonestorm-openapi.json', 'utf8').replace(/^﻿/, ''));
const MATCH = /fonenumber|subaccount|device|trunk|sip|move|transfer|assign|account/i;

const deref = (s, seen = new Set()) => {
  if (!s || typeof s !== 'object') return s;
  if (s.$ref) {
    if (seen.has(s.$ref)) return { ref: s.$ref };
    seen.add(s.$ref);
    const node = s.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], spec);
    return deref(node, seen);
  }
  return s;
};

// Compact "field: type (enum)" listing of a schema, nested with dots.
function fields(schema, prefix = '', depth = 0, out = []) {
  schema = deref(schema);
  if (!schema || depth > 4) return out;
  for (const k of ['allOf', 'oneOf', 'anyOf']) for (const s of schema[k] ?? []) fields(s, prefix, depth, out);
  const req = new Set(schema.required ?? []);
  for (const [name, raw] of Object.entries(schema.properties ?? {})) {
    const p = deref(raw);
    const enm = p.enum ? ` [${p.enum.join('|')}]` : '';
    out.push(`${prefix}${name}: ${p.type ?? (p.properties ? 'object' : '?')}${enm}${req.has(name) ? ' *' : ''}`);
    if (p.properties || p.allOf || p.oneOf) fields(p, `${prefix}${name}.`, depth + 1, out);
    if (p.type === 'array' && p.items) fields(p.items, `${prefix}${name}[].`, depth + 1, out);
  }
  return out;
}

for (const [path, ops] of Object.entries(spec.paths ?? {})) {
  if (!MATCH.test(path)) continue;
  for (const [method, op] of Object.entries(ops)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    const text = `${path} ${op.summary ?? ''} ${op.description ?? ''} ${(op.tags ?? []).join(' ')}`;
    if (!MATCH.test(text)) continue;
    console.log(`\n${method.toUpperCase()} ${path}  — ${op.summary ?? ''}`);
    if (op.description) console.log(`  ${op.description.replace(/\s+/g, ' ').slice(0, 300)}`);
    for (const p of [...(ops.parameters ?? []), ...(op.parameters ?? [])].map((x) => deref(x))) {
      const s = deref(p.schema) ?? {};
      console.log(`  ${p.in}: ${p.name}${p.required ? ' *' : ''} ${s.type ?? ''}${s.enum ? ` [${s.enum.join('|')}]` : ''}`);
    }
    const body = deref(op.requestBody)?.content;
    const schema = body && Object.values(body)[0]?.schema;
    if (method !== 'get' && schema) for (const f of fields(schema)) console.log(`  body: ${f}`);
  }
}
