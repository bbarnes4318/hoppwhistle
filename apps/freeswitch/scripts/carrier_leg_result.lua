--[==[
  carrier_leg_result.lua — report ONE outbound carrier leg's outcome.

  Run twice per answered leg, once per unanswered one. The carrier-routing
  bridge builder sets both hooks on every leg when leg outcome reporting is on:

    {...,execute_on_answer=lua carrier_leg_result.lua answer,api_reporting_hook=lua carrier_leg_result.lua}
      [hopwhistle_carrier=VONAGE,hopwhistle_gateway=vonage]sofia/gateway/vonage/1XXXXXXXXXX
     |[hopwhistle_carrier=FRACTEL,hopwhistle_gateway=fractel1]sofia/gateway/fractel1/1XXXXXXXXXX

  ── Why per leg ──────────────────────────────────────────────────────────────

  A sequential `|` waterfall tells whoever started it only how the LAST leg
  ended. When Vonage refuses with a 503 and FracTEL then answers, the bridge
  "succeeds" and the Vonage failure is invisible: its circuit never opens and
  every following call pays the progress timeout on it. Each leg reporting for
  itself is what lets the circuit breaker see a carrier that is failing over.

  It is also the only place the carrier that actually CONNECTED a call is
  known, so an answered leg's report is what attributes the call to it. That
  report is sent at ANSWER (`argv[1] == "answer"`, run by execute_on_answer
  with a session), not only after hangup: at hangup the browser's own hangup
  request is rewriting the same call row. The API keeps the first report of a
  leg for health, and the first attribution of a call.

  ── What this must never do ──────────────────────────────────────────────────

  Affect the call. The reporting hook runs after the leg has hung up, the HTTP
  request is backgrounded, and every failure here is swallowed. Health
  telemetry is best-effort by construction.

  ── Where the values come from ───────────────────────────────────────────────

  `env` — the channel's variables, handed to API hooks by FreeSWITCH. Read
  rather than `${...}` in the hook value, because the bridge string passes
  through dialplan variable expansion on the CALLING leg first, where
  `${hangup_cause}` would expand to the caller's (empty) value.

  The internal key travels in `?k=` for the reason documented at length in
  inbound_route.lua: mod_curl cannot send request headers. This script's own
  log line redacts it.
]==]

local API_URL      = os.getenv("API_URL") or "http://127.0.0.1:3001"
local INTERNAL_KEY = os.getenv("FREESWITCH_INTERNAL_KEY") or ""

local function log(level, msg)
  freeswitch.consoleLog(level, "[CARRIER-LEG] " .. msg .. "\n")
end

local function url_encode_component(val)
  return (string.gsub(val or "", "[^%w%-%_%.%~]", function(c)
    return string.format("%%%02X", string.byte(c))
  end))
end

-- A variable from the hook's event, or from the session when FreeSWITCH
-- passed one (session_in_hangup_hook=true). Empty string when absent.
local function var(name)
  local value = nil
  if env then
    value = env:getHeader("variable_" .. name)
  end
  if (value == nil or value == "") and session ~= nil and session.getVariable then
    local ok, v = pcall(function() return session:getVariable(name) end)
    if ok then value = v end
  end
  return value or ""
end

local function run()
  local gateway = var("hopwhistle_gateway")
  if gateway == "" then gateway = var("sip_gateway_name") end
  if gateway == "" then
    -- Not a carrier leg this platform routed. Nothing to say about it.
    return
  end

  local at_answer = (argv ~= nil and argv[1] == "answer")

  local cause = ""
  if not at_answer then
    cause = var("hangup_cause")
    if cause == "" and env then cause = env:getHeader("Hangup-Cause") or "" end
  end

  -- `answer_epoch` is 0 on a leg that never answered. Early media (183) is not
  -- an answer and must not credit a carrier with a connected call.
  local answer_epoch = tonumber(var("answer_epoch")) or 0
  local answered = at_answer or answer_epoch > 0

  -- The callee's own outcomes say nothing about the carrier, and the API
  -- ignores them anyway; not posting them keeps a busy calling day from
  -- turning into one HTTP request per busy signal.
  if not answered then
    if cause == "USER_BUSY" or cause == "NO_ANSWER" or cause == "NO_USER_RESPONSE"
      or cause == "ORIGINATOR_CANCEL" or cause == "LOSE_RACE" or cause == "UNALLOCATED_NUMBER"
      or cause == "NORMAL_CLEARING" or cause == "SUBSCRIBER_ABSENT" then
      return
    end
  end

  local params = {
    { "mode", "leg" },
    { "phase", at_answer and "answer" or "end" },
    { "gateway", gateway },
    { "cause", cause },
    { "answered", answered and "true" or "false" },
    { "carrier", var("hopwhistle_carrier") },
    { "route_type", var("hopwhistle_route_type") },
    { "tenant", var("hopwhistle_tenant_id") },
    { "call_id", var("hopwhistle_call_id") },
    { "corr", var("hopwhistle_corr") },
    { "attempt_id", var("hopwhistle_attempt_id") },
    { "sip_status", var("sip_term_status") },
    { "answer_epoch", tostring(answer_epoch) },
  }

  local query = {}
  for _, p in ipairs(params) do
    if p[2] ~= nil and p[2] ~= "" then
      table.insert(query, p[1] .. "=" .. url_encode_component(p[2]))
    end
  end

  local url = API_URL .. "/api/v1/freeswitch/carrier-result?" .. table.concat(query, "&")
  log("INFO", "leg " .. gateway .. " cause=" .. cause .. " answered=" .. tostring(answered))

  url = url .. "&k=" .. url_encode_component(INTERNAL_KEY)
  -- bgapi: the reporting state of a channel is not the place to wait on HTTP.
  freeswitch.API():execute("bgapi", "curl " .. url .. " connect-timeout 2 timeout 4")
end

local ok, err = pcall(run)
if not ok then
  log("WARNING", "could not report leg outcome: " .. tostring(err))
end
