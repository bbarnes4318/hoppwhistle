/**
 * Live three-way merge check against real FreeSWITCH. See README.md; run.sh
 * starts the switches and runs this.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '../../../api');
const service = resolve(apiDir, 'src/services/freeswitch-service.ts');
const require = createRequire(resolve(apiDir, 'package.json'));
const modesl = require('modesl');

const SW = process.env.FREESWITCH_HOST!;
const PH = process.env.PH_HOST!;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function api(host: string, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = new modesl.Connection(host, 8021, 'ClueCon');
    c.on('error', reject);
    c.on('esl::ready', () =>
      c.api(cmd, (r: { body?: string }) => {
        c.disconnect();
        resolve((r.body || '').trim());
      })
    );
  });
}
const ph = (c: string) => api(PH, c);
const sw = (c: string) => api(SW, c);

async function alive(host: string, uuid: string) {
  return (await api(host, `uuid_exists ${uuid}`)) === 'true';
}
async function waitAnswered(host: string, uuid: string, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await api(host, `uuid_getvar ${uuid} answered_time`)).match(/^[1-9]/)) return;
    await sleep(200);
  }
  throw new Error(`not answered: ${uuid}`);
}
/** The ph-side channel that the switch created for a given ph outbound call is the far end; find ph inbound leg by destination. */
async function phChannelTo(dest: string): Promise<string> {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    const rows = (JSON.parse(await ph('show channels as json')).rows || []) as Array<
      Record<string, string>
    >;
    const r = rows.find(x => x.dest === dest && x.direction === 'inbound');
    if (r) return r.uuid;
    await sleep(200);
  }
  throw new Error(`no ph channel to ${dest}`);
}
async function originate(dest: string, uuid: string) {
  const res = await ph(
    `originate {origination_uuid=${uuid},ignore_early_media=true}sofia/external/${dest}@sw:5080 &park()`
  );
  if (!res.startsWith('+OK')) throw new Error(`originate ${dest}: ${res}`);
}
function uuid() {
  return crypto.randomUUID();
}

async function confMembers(name: string): Promise<number> {
  const out = await sw(`conference ${name} list count`).catch(() => '0');
  return /^\d+$/.test(out) ? Number(out) : 0;
}

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
async function toneHeard(from: string, hz: number, listeners: string[]): Promise<boolean> {
  await ph(`uuid_broadcast ${from} tone_stream://%(20000,0,${hz}) aleg`);
  for (const l of listeners) await ph(`uuid_record ${l} start /tmp/l_${l}.wav`);
  await sleep(1500);
  for (const l of listeners) await ph(`uuid_record ${l} stop /tmp/l_${l}.wav`);
  await ph(`uuid_break ${from} all`);
  await sleep(300);
  return listeners.every(l => {
    const local = resolve(tmpdir(), `three-way-${l}.wav`);
    execSync(`docker cp ph:/tmp/l_${l}.wav ${local}`);
    const buf = readFileSync(local);
    const sr = buf.readUInt32LE(24),
      ch = buf.readUInt16LE(22);
    const x: number[] = [];
    for (let i = 44; i + 1 < buf.length; i += 2 * ch) x.push(buf.readInt16LE(i));
    const k = 2 * Math.cos((2 * Math.PI * hz) / sr);
    let s1 = 0,
      s2 = 0;
    for (const v of x) {
      const s = v + k * s1 - s2;
      s2 = s1;
      s1 = s;
    }
    const p = s1 * s1 + s2 * s2 - k * s1 * s2,
      tot = x.reduce((a, v) => a + v * v, 0) || 1;
    const share = p / ((tot * x.length) / 2);
    return share > 0.3; // the tone dominates what this listener heard
  });
}

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

async function scenario(kind: 'outbound' | 'inbound') {
  const { freeswitchService } = await import(service);
  console.log(`\n=== ${kind} customer call ===`);
  // Phone legs on ph. agent1 = browser's first call, customer = customer's phone.
  let agent1: string, customer: string;
  if (kind === 'outbound') {
    agent1 = uuid();
    await originate('out-customer', agent1);
    customer = await phChannelTo('customer');
  } else {
    customer = uuid();
    await originate('in-lua', customer);
    agent1 = await phChannelTo('agentin');
  }
  await waitAnswered(PH, agent1);
  await waitAnswered(PH, customer);
  const heldCallId = await ph(`uuid_getvar ${agent1} sip_call_id`);

  // Agent dials the third party.
  const agent2 = uuid();
  await originate('out-thirdparty', agent2);
  const third = await phChannelTo('thirdparty');
  await waitAnswered(PH, agent2);
  await waitAnswered(PH, third);
  const activeCallId = await ph(`uuid_getvar ${agent2} sip_call_id`);

  const { conferenceName } = await freeswitchService.mergeCalls(activeCallId, heldCallId);
  await sleep(2500); // let any post-bridge teardown (lua, dialplan) run

  check(
    'conference has customer, third party and agent (3 members)',
    (await confMembers(conferenceName)) === 3
  );
  check('customer still connected after merge', await alive(PH, customer));
  check('third party still connected after merge', await alive(PH, third));
  check("agent's merged call still connected", await alive(PH, agent2));
  check("agent's held first call was released", !(await alive(PH, agent1)));

  // Audio, every direction that matters: the customer's tone must reach the
  // third party and the agent, and the third party's must reach the customer.
  check(
    'customer is heard by third party and agent',
    await toneHeard(customer, 1000, [third, agent2])
  );
  check('third party is heard by customer', await toneHeard(third, 600, [customer]));
  check(
    'agent is heard by customer and third party',
    await toneHeard(agent2, 800, [customer, third])
  );

  // Agent drops: customer and third party keep talking.
  await ph(`uuid_kill ${agent2}`);
  await sleep(1500);
  check('agent leaves: customer still connected', await alive(PH, customer));
  check('agent leaves: third party still connected', await alive(PH, third));
  check('agent leaves: conference has 2 members', (await confMembers(conferenceName)) === 2);

  // Third party drops: nobody is left alone in the room.
  await ph(`uuid_kill ${third}`);
  await sleep(1500);
  check('third party leaves: customer is hung up, not left alone', !(await alive(PH, customer)));
  check('conference is gone', (await confMembers(conferenceName)) === 0);
}

async function refusal() {
  const { freeswitchService, MergeCallsError } = await import(service);
  console.log('\n=== guard rails ===');
  const agent1 = uuid();
  await originate('out-customer', agent1);
  const customer = await phChannelTo('customer');
  await waitAnswered(PH, agent1);
  const heldCallId = await ph(`uuid_getvar ${agent1} sip_call_id`);
  // A switch-side channel UUID instead of a Call-ID must not resolve any more.
  const swRows = (JSON.parse(await sw('show channels as json')).rows || []) as Array<
    Record<string, string>
  >;
  let err: unknown;
  try {
    await freeswitchService.mergeCalls(swRows[0].uuid, heldCallId);
  } catch (e) {
    err = e;
  }
  check(
    'a raw channel UUID is refused (CALL_NOT_FOUND)',
    err instanceof MergeCallsError && err.code === 'CALL_NOT_FOUND'
  );
  check('refused merge left the customer alone', await alive(PH, customer));

  // Merge clicked while the person being added is still ringing.
  const ringing = uuid();
  await ph(
    `bgapi originate {origination_uuid=${ringing}}sofia/external/out-slowparty@sw:5080 &park()`
  );
  await sleep(1500);
  const ringingCallId = await ph(`uuid_getvar ${ringing} sip_call_id`);
  err = undefined;
  try {
    await freeswitchService.mergeCalls(ringingCallId, heldCallId);
  } catch (e) {
    err = e;
  }
  check(
    'merging before the third party answers is refused (NOT_ANSWERED)',
    err instanceof MergeCallsError && err.code === 'NOT_ANSWERED'
  );
  check(
    'refused merge left the customer and the held call alone',
    (await alive(PH, customer)) && (await alive(PH, agent1))
  );
  await ph(`uuid_kill ${ringing}`);
  await ph(`uuid_kill ${agent1}`);
}

const which = process.argv[2] ?? 'all';
(async () => {
  if (which === 'all' || which === 'outbound') await scenario('outbound');
  if (which === 'all' || which === 'inbound') await scenario('inbound');
  if (which === 'all' || which === 'guard') await refusal();
  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error('RIG ERROR', e);
  process.exit(2);
});
