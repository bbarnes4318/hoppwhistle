/**
 * Runs apps/freeswitch/scripts/inbound_route.lua for real, in fengari (a Lua
 * VM written in JavaScript), against a scripted FreeSWITCH.
 *
 * The script is executed as FreeSWITCH would execute it: as one chunk, with
 * `session` and `freeswitch` as globals. The fake session answers the route
 * lookup with the body a scenario gives, plays out each `bridge` as the
 * scenario says (no answer, or answered by a B-leg carrying some variables),
 * and records every bridge string, every hangup and every CDR the script
 * posts. Nothing here reimplements the script: a test asserts on what the
 * script itself did.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lauxlib, lua, lualib, to_luastring } from 'fengari';

const here = path.dirname(fileURLToPath(import.meta.url));

export const INBOUND_ROUTE_LUA = path.resolve(
  here,
  '../../../../freeswitch/scripts/inbound_route.lua'
);

export function inboundRouteSource(): string {
  return readFileSync(INBOUND_ROUTE_LUA, 'utf8');
}

export interface BridgeOutcome {
  /** Whether a leg of this bridge answered. */
  answer: boolean;
  /** `bridge_channel` on our leg: the answered B-leg's channel name. */
  channel?: string;
  /** The answered B-leg's uuid, left in `last_bridge_to`. */
  bUuid?: string;
  /** The B-leg's own variables, served by `uuid_getvar` while it still exists. */
  bVars?: Record<string, string>;
  /** What the leg's api_on_answer stamped on our leg (`x_answered_leg`). */
  stampedLeg?: string;
  /** `originate_disposition` when nobody answered. Default NO_ANSWER. */
  disposition?: string;
  /** `originate_causes` when nobody answered: `uuid;CAUSE` per leg, `|`-joined. */
  causes?: string;
}

export interface InboundRouteScenario {
  /** The route lookup's JSON body. */
  lookup: Record<string, unknown>;
  lookupCode?: number;
  callerNumber?: string;
  did?: string;
  uuid?: string;
  /** Registered softphones: extension -> sofia_contact result. */
  contacts?: Record<string, string>;
  /** One outcome per `bridge` the script executes, in order. Missing = no answer. */
  bridges?: BridgeOutcome[];
}

export interface InboundRouteRun {
  bridges: string[];
  cdrs: Array<Record<string, unknown>>;
  hangups: string[];
  error: string | null;
}

type LuaValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | LuaValue[]
  | { [k: string]: LuaValue };

function toLua(value: LuaValue): string {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') {
    if (value.includes(']===]')) throw new Error('value cannot be embedded as a Lua long string');
    return `[===[${value}]===]`;
  }
  if (Array.isArray(value)) return `{ ${value.map(toLua).join(', ')} }`;
  return `{ ${Object.entries(value)
    // Spaced: `[[===[` would open a long string rather than index one.
    .map(([k, v]) => `[ ${toLua(k)} ] = ${toLua(v)}`)
    .join(', ')} }`;
}

const SEP_ITEM = '\u001f';
const SEP_LIST = '\u001e';

/*
 * `answered_time` is reported in seconds, a form the script accepts from older
 * FreeSWITCH builds: fengari's integers are 32-bit, so the microseconds a
 * current build reports would overflow in the VM rather than in the script.
 */
function prelude(scenario: InboundRouteScenario): string {
  const config = {
    lookupCode: String(scenario.lookupCode ?? 200),
    lookupBody: JSON.stringify(scenario.lookup),
    contacts: scenario.contacts ?? {},
    bridges: (scenario.bridges ?? []).map(b => ({
      answer: b.answer,
      channel: b.channel ?? '',
      bUuid: b.bUuid ?? '',
      stampedLeg: b.stampedLeg ?? '',
      disposition: b.disposition ?? 'NO_ANSWER',
      causes: b.causes ?? '',
    })),
    bVars: Object.fromEntries(
      (scenario.bridges ?? [])
        .filter(b => b.bUuid && b.bVars)
        .map(b => [b.bUuid as string, b.bVars as Record<string, string>])
    ),
    vars: {
      caller_id_number: scenario.callerNumber ?? '+14235551212',
      destination_number: scenario.did ?? '18885550123',
      uuid: scenario.uuid ?? '6f1c2d3e-aaaa-4bbb-8ccc-123456789abc',
      domain_name: 'switch.test',
    },
  };

  return `
os.execute = function() return true end
os.getenv = os.getenv or function() return nil end
local cfg = ${toLua(config as unknown as LuaValue)}
local vars = cfg.vars
local answered, ready = false, true
local events = { bridges = {}, curls = {}, hangups = {} }

session = {}
function session:getVariable(name) return vars[name] end
function session:setVariable(name, value) vars[name] = value end
function session:answered() return answered end
function session:ready() return ready end
function session:answer() answered = true end
function session:sleep() end
function session:hangup(cause)
  vars.hangup_cause = cause or "NORMAL_CLEARING"
  table.insert(events.hangups, vars.hangup_cause)
  ready = false
end
function session:execute(app, arg)
  if app == "curl" then
    vars.curl_response_code = cfg.lookupCode
    vars.curl_response_data = cfg.lookupBody
  elseif app == "answer" then
    answered = true
    vars.answered_time = tostring(os.time())
  elseif app == "bridge" then
    table.insert(events.bridges, arg)
    local outcome = cfg.bridges[#events.bridges]
    if outcome and outcome.answer then
      answered = true
      vars.answered_time = tostring(os.time())
      vars.bridge_channel = outcome.channel
      vars.last_bridge_to = outcome.bUuid
      if outcome.stampedLeg ~= "" then vars.x_answered_leg = outcome.stampedLeg end
    else
      vars.originate_disposition = outcome and outcome.disposition or "NO_ANSWER"
      vars.originate_causes = outcome and outcome.causes or ""
    end
  end
end

local api_handle = {}
function api_handle:execute(cmd, arg)
  if cmd == "sofia_contact" then
    local ext = string.match(arg or "", "^internal/([^@]+)@")
    return cfg.contacts[ext or ""] or "error/user_not_registered"
  elseif cmd == "uuid_getvar" then
    local b_uuid, name = string.match(arg or "", "^(%S+)%s+(%S+)$")
    local b = cfg.bVars[b_uuid or ""]
    return (b and b[name]) or "_undef_"
  elseif cmd == "create_uuid" then
    uuid_seq = (uuid_seq or 0) + 1
    return string.format("00000000-0000-4000-8000-%012d", uuid_seq)
  elseif cmd == "curl" then
    table.insert(events.curls, arg)
    return '{"callId":"db-call-1"}'
  end
  return ""
end
function api_handle:executeString() return "" end

freeswitch = {
  API = function() return api_handle end,
  consoleLog = function() end,
}

function __collect()
  return table.concat(events.bridges, "${SEP_ITEM}") .. "${SEP_LIST}" ..
    table.concat(events.curls, "${SEP_ITEM}") .. "${SEP_LIST}" ..
    table.concat(events.hangups, "${SEP_ITEM}")
end
`;
}

function runChunk(L: object, code: string, name: string): string | null {
  const bytes = to_luastring(code);
  if (lauxlib.luaL_loadbuffer(L, bytes, null, to_luastring(name)) !== lua.LUA_OK) {
    const message = lua.lua_tojsstring(L, -1);
    lua.lua_pop(L, 1);
    return message;
  }
  if (lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
    const message = lua.lua_tojsstring(L, -1);
    lua.lua_pop(L, 1);
    return message;
  }
  return null;
}

function split(value: string): string[] {
  return value === '' ? [] : value.split(SEP_ITEM);
}

export function runInboundRoute(scenario: InboundRouteScenario): InboundRouteRun {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);

  const preludeError = runChunk(L, prelude(scenario), '=prelude');
  if (preludeError) throw new Error(`Lua harness prelude failed: ${preludeError}`);

  const error = runChunk(L, inboundRouteSource(), '=inbound_route.lua');

  const collectError = runChunk(L, '__result = __collect()', '=collect');
  if (collectError) throw new Error(`Lua harness collect failed: ${collectError}`);
  lua.lua_getglobal(L, to_luastring('__result'));
  const raw = lua.lua_tojsstring(L, -1);
  lua.lua_pop(L, 1);

  const [bridges = '', curls = '', hangups = ''] = raw.split(SEP_LIST);
  const cdrs = split(curls).map(cmd => {
    const match = /post '([\s\S]*)'$/.exec(cmd);
    if (!match) throw new Error(`Unexpected curl command from the script: ${cmd}`);
    return JSON.parse(match[1]) as Record<string, unknown>;
  });

  return { bridges: split(bridges), cdrs, hangups: split(hangups), error };
}

/** The `[...]` variables of each leg of a bridge string, by leg. */
export function legsOf(bridge: string): Array<{ vars: Record<string, string>; target: string }> {
  const legs: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of bridge) {
    if (ch === '[') depth += 1;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === '|') && depth === 0) {
      legs.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  legs.push(current);

  return legs
    .filter(leg => leg.trim() !== '')
    .map(leg => {
      const match = /^\[([^\]]*)\](.*)$/.exec(leg.trim());
      const vars: Record<string, string> = {};
      if (match) {
        for (const pair of match[1].split(',')) {
          const eq = pair.indexOf('=');
          if (eq > 0) vars[pair.slice(0, eq)] = pair.slice(eq + 1);
        }
      }
      return { vars, target: match ? match[2] : leg.trim() };
    });
}
