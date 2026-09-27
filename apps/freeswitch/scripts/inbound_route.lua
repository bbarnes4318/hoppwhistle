--[==[
  inbound_route.lua — FreeSWITCH Dynamic Inbound DID Routing
  
  Called from the public dialplan context for all inbound tracking DIDs.
  
  Flow:
    1. Extract caller number (ANI) and dialed number (DNIS/DID)
    2. HTTP GET to API: /api/v1/freeswitch/lookup?did=<DID>
    3. If route found → start recording → bridge to the legs of the dial plan
    4. On hangup → POST CDR to API for tracking, naming the leg that answered
    5. Kick off recording upload to S3

  Who answered:
    The API's `dialString` is the routing plan with every leg tagged:
      [x_leg_party=buyer:<id>,x_leg_target=<endpointId>,x_leg_number=<n>,leg_timeout=<s>]<n>
      [x_leg_party=agent:<userId>,x_leg_number=<n>,leg_timeout=<s>]<n>
    Those ride on the B-leg. After the bridge this script reads them back off
    the leg that answered and reports them as `answeredParty` / `answeredNumber`
    / `answeredTarget`, which is the only thing the API attributes the call by.

  Environment:
    API_URL     — Base URL of the platform API (default: http://127.0.0.1:3001)
    RECORDING_DIR — Directory for recordings (default: /recordings)
    FREESWITCH_INTERNAL_KEY — REQUIRED. Shared secret proving to the API that
                  this really is FreeSWITCH calling. Without it the API answers
                  401 and no call routes. See docs/TENANT_ISOLATION_AUDIT.md.

  ── Why the key is in the query string and not a header ──────────────────────

  Because mod_curl cannot send request headers. Its syntax is
    curl <url> [headers|json] [get|head|post [body]] [connect-timeout n] [timeout n]
  where `headers` means "return the response headers", not "send these". There
  is no request-header argument in any released version.

  So the key goes in `?k=`, and FreeSWITCH logs the URLs it fetches, which means
  the key ends up in FreeSWITCH's logs. That is why it is its own secret, used
  for nothing but these five read-mostly endpoints, and why rotating it is
  cheap. This script's own log lines redact it; mod_curl's do not.

  The key is percent-encoded before it goes into the query. Generating it as
  `openssl rand -hex 32` makes that a no-op, and the encoding is there so a key
  generated some other way -- one containing a `&` or a `#` -- truncates
  nothing and simply fails the comparison instead of silently sending half a
  key and half a query.

  It is strictly better than what it replaces, which was no authentication at
  all on an endpoint reachable through nginx.

  This header is a level-2 long comment (equals signs in its brackets) because
  the mod_curl syntax above contains two closing brackets in a row, which end a
  plain long comment early and made this whole script fail to load.
]==]

-- ── Configuration ───────────────────────────────────────────────────────────
local API_URL      = os.getenv("API_URL") or "http://127.0.0.1:3001"
local RECORDING_DIR = os.getenv("RECORDING_DIR") or "/recordings"
local UPLOAD_SCRIPT = "/usr/share/freeswitch/scripts/upload-recording.sh"
local INTERNAL_KEY = os.getenv("FREESWITCH_INTERNAL_KEY") or ""

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- FS API handle for sofia_contact registration checks and the CDR post.
-- (Referenced as `api:execute` below — must be defined or the script dies
-- with a nil-index error right before bridging.)
local api = freeswitch.API()

local function log(level, msg)
  freeswitch.consoleLog(level, "[INBOUND-ROUTE] " .. msg .. "\n")
end

-- Simple JSON value extractor (avoids cjson dependency)
local function json_value(json_str, key)
  local pattern = '"' .. key .. '"%s*:%s*"([^"]*)"'
  local val = string.match(json_str, pattern)
  if val then return val end
  -- Try boolean/number values (but treat JSON null as Lua nil)
  pattern = '"' .. key .. '"%s*:%s*(%w+)'
  val = string.match(json_str, pattern)
  if val == "null" then return nil end
  return val
end

local function trim(s)
  return (string.gsub(s or "", "^%s*(.-)%s*$", "%1"))
end

-- ── Tagged dial plan ────────────────────────────────────────────────────────
-- A leg may carry per-leg variables, `[a=b,c=d]<leg>`, whose commas are not
-- leg separators. Steps (`|`) and legs (`,`) are split outside brackets only.
-- ##LEG_TAGS_BEGIN##
local function split_outside_brackets(s, sep)
    local parts, current, depth = {}, {}, 0
    for i = 1, string.len(s or "") do
        local ch = string.sub(s, i, i)
        if ch == "[" then
            depth = depth + 1
        elseif ch == "]" and depth > 0 then
            depth = depth - 1
        end
        if ch == sep and depth == 0 then
            table.insert(parts, table.concat(current))
            current = {}
        else
            table.insert(current, ch)
        end
    end
    table.insert(parts, table.concat(current))
    return parts
end

-- "[a=b,c=d]rest" -> { a = "b", c = "d" }, "rest". No brackets -> {}, token.
local function parse_leg(token)
    local tags = {}
    token = trim(token)
    local inner = string.match(token, "^%[([^%]]*)%]")
    if not inner then
        return tags, token
    end
    for pair in string.gmatch(inner, "[^,]+") do
        local k, v = string.match(pair, "^%s*([^=%s]+)%s*=(.*)$")
        if k then tags[k] = trim(v) end
    end
    return tags, trim(string.sub(token, string.len(inner) + 3))
end

-- Ordered per-leg variables. A later set of the same name replaces the value.
local function new_leg_vars()
    return { order = {}, values = {} }
end

-- Values go inside `[...]`, where a comma or bracket would end them early.
local function leg_var_value(v)
    return (string.gsub(tostring(v or ""), "[%[%],|'\"]", ""))
end

local function set_leg_var(vars, name, value)
    if value == nil or value == "" then return end
    if vars.values[name] == nil then table.insert(vars.order, name) end
    vars.values[name] = leg_var_value(value)
end

-- Prefix a leg with its variables, merging into a `[...]` the leg already has
-- (its own values listed last, so they win).
local function with_leg_vars(vars, leg)
    if #vars.order == 0 then return leg end
    local out = {}
    for _, name in ipairs(vars.order) do
        table.insert(out, name .. "=" .. vars.values[name])
    end
    local ours = table.concat(out, ",")
    if string.sub(leg, 1, 1) == "[" then
        return "[" .. ours .. "," .. string.sub(leg, 2)
    end
    return "[" .. ours .. "]" .. leg
end
-- ##LEG_TAGS_END##

-- ── Agent busy check ────────────────────────────────────────────────────────
-- An agent already on a call must never have a second call rung at them.
-- FreeSWITCH's live channel table is the only real-time truth for this: the
-- API's DB/Redis concurrency gate cannot see an in-progress inbound call (the
-- Call row is written from the CDR *after* hangup), and static DID→extension
-- routes never reach that gate at all. So busy endpoints are dropped from the
-- ring group here, at bridge time.
--
-- Kill switch, effective on the very next call, no restart, no deploy:
--     fs_cli -x "global_setvar agent_busy_check=false"     (disable)
--     fs_cli -x "global_setvar agent_busy_check=true"      (re-enable)
-- Falls back to env AGENT_BUSY_CHECK, default enabled.
-- Per-agent limit: global var agent_max_concurrent_calls, or env
-- AGENT_MAX_CONCURRENT_CALLS. Default 1 — one call at a time per agent.
--
-- The markers below delimit the block that tests/test_agent_busy.lua loads and
-- exercises directly — keep them in place.
-- ##AGENT_BUSY_BEGIN##
local function fs_global(name)
    local ok, val = pcall(function() return api:execute("global_getvar", name) or "" end)
    if not ok or type(val) ~= "string" then return "" end
    val = string.gsub(val, "^%s*(.-)%s*$", "%1")
    if val == "" or val == "_undef_" or string.match(val, "^%-ERR") then return "" end
    return val
end

local busy_check_setting = fs_global("agent_busy_check")
if busy_check_setting == "" then
    busy_check_setting = os.getenv("AGENT_BUSY_CHECK") or "true"
end
local AGENT_BUSY_CHECK = busy_check_setting ~= "false"

local limit_setting = fs_global("agent_max_concurrent_calls")
if limit_setting == "" then
    limit_setting = os.getenv("AGENT_MAX_CONCURRENT_CALLS") or "1"
end
local AGENT_MAX_CONCURRENT = tonumber(limit_setting) or 1
if AGENT_MAX_CONCURRENT < 1 then AGENT_MAX_CONCURRENT = 1 end

-- Channel states that mean "this call is already going away". A call that just
-- ended can sit in these for a moment; counting them would wrongly hold an
-- agent busy and leave the next caller unanswered.
local CHANNEL_TEARDOWN_STATES = {
    CS_HANGUP = true,
    CS_REPORTING = true,
    CS_DESTROY = true,
    CS_NONE = true,
}

-- Snapshot the live channel table as rows of fields.
-- `show channels as delim |` emits a header row plus one row per channel.
-- application_data (field 12) can itself contain the delimiter, so only fields
-- 1-11 are trustworthy — we read uuid (1), direction (2), name (5), state (6)
-- and cid_num (8), all of which sit safely before it.
local function live_channel_rows()
    local rows = {}
    local ok, out = pcall(function()
        return api:execute("show", "channels as delim |") or ""
    end)
    if not ok or type(out) ~= "string" or out == "" or string.match(out, "^%-ERR") then
        return rows
    end
    for line in string.gmatch(out, "[^\r\n]+") do
        if string.find(line, "|", 1, true) then
            local fields = {}
            for field in string.gmatch(line .. "|", "(.-)|") do
                table.insert(fields, field)
                if #fields >= 11 then break end
            end
            -- Skip the header row and the trailing "N total." summary.
            if fields[1] and fields[1] ~= "uuid" and fields[1] ~= "" then
                table.insert(rows, fields)
            end
        end
    end
    return rows
end

local function starts_with(s, prefix)
    return string.sub(s or "", 1, string.len(prefix)) == prefix
end

-- Live channels belonging to one agent's softphone. Counts calls TO the phone
-- (b-leg named after its registered contact, e.g. a WebRTC contact token) and
-- calls FROM it (a-leg named after / identified by the extension). Our own
-- A-leg is excluded so a call can never mark its own destination busy.
local function agent_channel_count(extension, contact_uri, rows, self_uuid)
    local contact_prefix = nil
    local user_host = string.match(contact_uri or "", "^sofia/internal/sip:([^;>]+)")
    if user_host and user_host ~= "" then
        contact_prefix = "sofia/internal/" .. user_host
    end
    local ext_prefix = "sofia/internal/" .. extension .. "@"

    local count = 0
    for _, f in ipairs(rows) do
        if f[1] ~= self_uuid and not CHANNEL_TEARDOWN_STATES[f[6] or ""] then
            local name = f[5] or ""
            local matched = false
            if contact_prefix and starts_with(name, contact_prefix) then
                matched = true
            elseif starts_with(name, ext_prefix) then
                matched = true
            elseif starts_with(name, "sofia/internal/") and f[2] == "inbound" and f[8] == extension then
                matched = true
            end
            if matched then count = count + 1 end
        end
    end
    return count
end
-- ##AGENT_BUSY_END##

-- ── Agent cell legs ─────────────────────────────────────────────────────────
-- An agent may take calls on their own mobile instead of the softphone. The API
-- lists those legs in `agentCellLegs` (ten-digit keys). Each such leg:
--   * is skipped when that cell is already on one of our calls, since the
--     agent's busy check above only sees softphone channels; and
--   * can be made to press 1 to accept, so a voicemail or a pocket answer
--     cannot take the call away from agents who are really there.
-- The confirmation is OFF by default: on Anveo buyer legs the prompt hung up
-- the answered leg at once (DESTINATION_OUT_OF_ORDER), so every call dropped.
-- Turn it on, next call, no restart:
--     fs_cli -x "global_setvar agent_cell_confirm=true"   (or env AGENT_CELL_CONFIRM=true)
-- Prompt override: global var agent_cell_confirm_file / env AGENT_CELL_CONFIRM_FILE.
local function ten_digit_key(value)
    local digits = string.gsub(value or "", "%D", "")
    if string.len(digits) > 10 then
        digits = string.sub(digits, -10)
    end
    return digits
end

local cell_confirm_setting = fs_global("agent_cell_confirm")
if cell_confirm_setting == "" then
    cell_confirm_setting = os.getenv("AGENT_CELL_CONFIRM") or "false"
end
local AGENT_CELL_CONFIRM = cell_confirm_setting == "true"

local AGENT_CELL_CONFIRM_FILE = fs_global("agent_cell_confirm_file")
if AGENT_CELL_CONFIRM_FILE == "" then
    AGENT_CELL_CONFIRM_FILE = os.getenv("AGENT_CELL_CONFIRM_FILE") or "ivr/ivr-accept_reject_voicemail.wav"
end

-- Optionally the agent's cell shows the CUSTOMER's number instead of our DID.
-- OFF by default: carriers refuse a caller ID we do not own (Anveo answered
-- NORMAL_TEMPORARY_FAILURE), so agent cells present our DID like buyer legs
-- (campaign_external_cid_fix_v1). Turn it on, next call, no restart:
--     fs_cli -x "global_setvar agent_cell_show_caller=true"   (or env AGENT_CELL_SHOW_CALLER=true)
local cell_caller_setting = fs_global("agent_cell_show_caller")
if cell_caller_setting == "" then
    cell_caller_setting = os.getenv("AGENT_CELL_SHOW_CALLER") or "false"
end
local AGENT_CELL_SHOW_CALLER = cell_caller_setting == "true"

-- 1XXXXXXXXXX for a real NANP caller, or nil (withheld, anonymous, garbage).
local function presentable_caller(caller)
    local digits = string.gsub(caller or "", "%D", "")
    if string.len(digits) == 10 then
        digits = "1" .. digits
    end
    if string.len(digits) == 11 and string.match(digits, "^1[2-9]%d%d[2-9]") then
        return digits
    end
    return nil
end

local function agent_cell_leg_vars(caller)
    local vars = {}
    if AGENT_CELL_CONFIRM then
        table.insert(vars, "group_confirm_key=1")
        table.insert(vars, "group_confirm_file=" .. AGENT_CELL_CONFIRM_FILE)
        table.insert(vars, "group_confirm_read_timeout=10000")
    end
    local cid = AGENT_CELL_SHOW_CALLER and presentable_caller(caller) or nil
    if cid then
        table.insert(vars, "sip_from_user=" .. cid)
        table.insert(vars, "origination_caller_id_number=" .. cid)
        table.insert(vars, "effective_caller_id_number=" .. cid)
    end
    if #vars == 0 then
        return ""
    end
    return "[" .. table.concat(vars, ",") .. "]"
end

-- Live non-softphone channels that dialed (or came from) this ten-digit number.
local function cell_channel_count(key, rows, self_uuid)
    local count = 0
    for _, f in ipairs(rows) do
        local name = f[5] or ""
        if f[1] ~= self_uuid and not CHANNEL_TEARDOWN_STATES[f[6] or ""]
            and not starts_with(name, "sofia/internal/") then
            local last = string.match(name, "([^/]+)$") or ""
            last = string.match(last, "^([^@]*)") or last
            if ten_digit_key(last) == key then
                count = count + 1
            end
        end
    end
    return count
end

-- ── Main Logic ──────────────────────────────────────────────────────────────
local caller_number = session:getVariable("caller_id_number") or "unknown"
local did_number    = session:getVariable("destination_number") or ""
local call_uuid     = session:getVariable("uuid") or ""
local call_start_epoch = os.time()

log("INFO", "Inbound call: " .. caller_number .. " → DID " .. did_number .. " (UUID: " .. call_uuid .. ")")

-- Normalize DID for lookup
local did_normalized = did_number
if not string.match(did_normalized, "^%+") then
  if string.len(did_normalized) == 10 then
    did_normalized = "+1" .. did_normalized
  elseif string.len(did_normalized) == 11 and string.sub(did_normalized, 1, 1) == "1" then
    did_normalized = "+" .. did_normalized
  end
end

-- Normalize caller number for TCPA lookup
local caller_normalized = caller_number
if caller_normalized ~= "unknown" and not string.match(caller_normalized, "^%+") then
  if string.len(caller_normalized) == 10 then
    caller_normalized = "+1" .. caller_normalized
  elseif string.len(caller_normalized) == 11 and string.sub(caller_normalized, 1, 1) == "1" then
    caller_normalized = "+" .. caller_normalized
  end
end

-- ── Step 0: Twilio caller-ID verification ───────────────────────────────────
-- deploy/dograh/twilio-trunk/verify_caller_ids.py asks Twilio to verify one of
-- our DIDs, stores Twilio's code with `hash insert/twverify/<10 digits>/<code>`
-- and Twilio then calls that DID. Answer that one call, key in the code, and
-- clear it. With no code stored for the DID, nothing here runs.
local twverify_did = string.sub(string.gsub(did_number, "%D", ""), -10)
local twverify_code = api:executeString("hash select/twverify/" .. twverify_did) or ""
twverify_code = string.gsub(twverify_code, "%s", "")
if string.match(twverify_code, "^%d+$") then
  log("INFO", "Twilio caller-ID verification call for " .. twverify_did .. ": answering and sending the code")
  session:answer()
  session:sleep(4000)
  session:execute("send_dtmf", twverify_code .. "@200")
  session:sleep(8000)
  api:executeString("hash delete/twverify/" .. twverify_did)
  if session:ready() then session:hangup() end
  return
end

-- ── Step 1: Lookup route via API ────────────────────────────────────────────
local function url_encode_plus(val)
    return string.gsub(val or "", "%+", "%%2B")
end

-- Full percent-encoding, for values that are not phone numbers. `url_encode_plus`
-- above escapes only `+`, which is all a normalized E.164 needs; a shared secret
-- may contain anything, and a `&` in one would otherwise end the parameter and
-- start a new one.
local function url_encode_component(val)
    return (string.gsub(val or "", "[^%w%-%_%.%~]", function(c)
        return string.format("%%%02X", string.byte(c))
    end))
end

-- ── CDR ─────────────────────────────────────────────────────────────────────
-- One place builds and posts the CDR, so a call that never bridges (no
-- eligible destination) is recorded exactly like one that did.
local function json_text(v)
    return (string.gsub(tostring(v or ""), "[\"'\\%c]", ""))
end

local function json_number(v)
    local n = tonumber(v)
    if not n then return "0" end
    return string.format("%d", math.floor(n))
end

local CDR_FIELDS = {
    { "callId" }, { "routeId" }, { "tenantId" }, { "callerNumber" }, { "did" },
    { "destination" }, { "buyerId" }, { "targetId" }, { "campaignId" },
    { "duration", "n" }, { "connectedDuration", "n" },
    { "hangupCause" }, { "sipHangupDisposition" },
    { "startedAt" }, { "answeredAt" }, { "endedAt" },
    { "recordingPath" }, { "recordingDuration", "n" },
    { "bridgeChannelName" },
    -- Who actually answered: "buyer:<id>", "agent:<userId>", or "" for nobody.
    { "answeredParty" }, { "answeredNumber" }, { "answeredTarget" },
}

local function build_cdr_json(cdr)
    local parts = {}
    for _, field in ipairs(CDR_FIELDS) do
        local name, kind = field[1], field[2]
        if kind == "n" then
            table.insert(parts, '"' .. name .. '":' .. json_number(cdr[name]))
        else
            table.insert(parts, '"' .. name .. '":"' .. json_text(cdr[name]) .. '"')
        end
    end
    return "{" .. table.concat(parts, ",") .. "}"
end

local function post_cdr(cdr)
    local cdr_json = build_cdr_json(cdr)
    local cdr_url = API_URL .. "/api/v1/freeswitch/cdr?k=" .. url_encode_component(INTERNAL_KEY)
    local cdr_cmd = string.format(
      "%s content-type application/json timeout 10 post '%s'",
      cdr_url,
      cdr_json
    )
    log("INFO", "Posting CDR to: " .. string.gsub(cdr_url, "([?&]k=)[^&]*", "%1REDACTED"))
    local cdr_response = api:execute("curl", cdr_cmd) or ""
    log("INFO", "CDR response: " .. cdr_response)
    return cdr_response
end

local encoded_did = url_encode_plus(did_normalized)
local encoded_caller = url_encode_plus(caller_normalized)

if INTERNAL_KEY == "" then
    -- Fail loudly at the point of use rather than letting the API answer 401
    -- and leaving whoever reads the log to work out why every call is dropping.
    log("ERR", "FREESWITCH_INTERNAL_KEY is not set in the FreeSWITCH environment. "
        .. "The API will refuse every lookup. Set it in the FreeSWITCH container "
        .. "environment to the same value as the API's.")
end

local lookup_url = API_URL .. "/api/v1/freeswitch/lookup?did=" .. encoded_did
if encoded_caller ~= "" and encoded_caller ~= "unknown" then
    lookup_url = lookup_url .. "&caller=" .. encoded_caller
end
lookup_url = lookup_url .. "&k=" .. url_encode_component(INTERNAL_KEY)

-- Bounds are passed as mod_curl arguments. Setting `curl_connect_timeout` and
-- `curl_timeout` as channel variables, as this did before, has no effect —
-- mod_curl does not read them — which left an inbound call blocked on this
-- lookup for as long as the API cared to take.
-- Logged WITHOUT the key. FreeSWITCH's own mod_curl logging still records the
-- full URL, which is the cost noted at the top of this file; there is no reason
-- for this script to add a second copy.
log("INFO", "Looking up route: " .. string.gsub(lookup_url, "([?&]k=)[^&]*", "%1REDACTED"))

session:execute("curl", lookup_url .. " connect-timeout 3 timeout 15")

local response_code = session:getVariable("curl_response_code") or ""
local response_body = session:getVariable("curl_response_data") or ""

log("INFO", "Lookup HTTP status=" .. tostring(response_code) .. " body=" .. tostring(response_body))

local numeric_code = tonumber(response_code) or 0

if response_code == "" or response_code == "0" or numeric_code >= 500 then
    log("ERR", "Route API failure: HTTP " .. tostring(response_code))
    session:hangup("NORMAL_TEMPORARY_FAILURE")
    return
end

if numeric_code == 404 then
    log("WARNING", "No configured route for DID: " .. did_normalized)
    session:hangup("UNALLOCATED_NUMBER")
    return
end

if numeric_code < 200 or numeric_code >= 300 then
    log("ERR", "Unexpected route API response: HTTP " .. tostring(response_code))
    session:hangup("NORMAL_TEMPORARY_FAILURE")
    return
end

-- Parse response
local destination     = json_value(response_body, "destination")
local route_id        = json_value(response_body, "routeId")
local tenant_id       = json_value(response_body, "tenantId")
local buyer_id        = json_value(response_body, "buyerId")
local target_id       = json_value(response_body, "targetId")
local campaign_id     = json_value(response_body, "campaignId")
local recording_flag  = json_value(response_body, "recordingEnabled")
local no_eligible     = json_value(response_body, "noEligibleDestination")
-- The same plan as `destination` with every leg tagged with who it rings.
-- Preferred; an API that predates it sends only `destination`.
local dial_plan       = json_value(response_body, "dialString")
if not dial_plan or dial_plan == "" then
    dial_plan = destination or ""
end
local agent_cell_keys = {}
for key in string.gmatch(json_value(response_body, "agentCellLegs") or "", "[^,%s]+") do
    agent_cell_keys[key] = true
end

-- External PSTN gateway chain for buyer/fallback legs. The API sends the
-- current carrier chain (env INBOUND_EXTERNAL_GATEWAYS); default matches the
-- outbound FracTEL trunk. BulkVS/SignalWire/Telnyx were retired for egress
-- after the July 2026 incident — do not hardcode them here.
-- `externalBridgeTemplate` is the whole leg list with `{DEST}` standing in for
-- the 10-digit destination, and is preferred because it is the only one that
-- carries each carrier's number format — a chain that falls from FracTEL
-- (1XXXXXXXXXX) to SignalWire (+1XXXXXXXXXX) cannot be expressed as a list of
-- gateway names. `externalGateways` is the older field, kept so this script
-- still works against an API that predates the template.
local external_bridge_template = json_value(response_body, "externalBridgeTemplate")
local external_gateways_csv = json_value(response_body, "externalGateways") or "fractel1,fractel2,fractel3"
local external_gateways = {}
for gw in string.gmatch(external_gateways_csv, "[^,%s]+") do
    table.insert(external_gateways, gw)
end
if #external_gateways == 0 then
    external_gateways = { "fractel1" }
end

-- Render the template for one destination, or nil when there is no template.
local function carrier_legs_for(dest_digits)
    if not external_bridge_template or external_bridge_template == "" then
        return nil
    end
    local ten = string.gsub(dest_digits, "%D", "")
    if string.len(ten) == 11 and string.sub(ten, 1, 1) == "1" then
        ten = string.sub(ten, 2)
    end
    if string.len(ten) ~= 10 then
        return nil
    end
    -- Replacement passed as a function so `%` in the digits stays literal.
    local rendered = string.gsub(external_bridge_template, "%{DEST%}", function() return ten end)
    return rendered
end

-- ── TCPA Litigator Check ──────────────────────────────────────────────────
local reject_flag = json_value(response_body, "reject")
if reject_flag == "true" then
  local reject_reason = json_value(response_body, "reason") or "BLOCKED"
  log("WARNING", "TCPA BLOCK: caller " .. caller_number .. " on DID " .. did_normalized .. " — reason: " .. reject_reason)
  session:hangup("CALL_REJECTED")
  return
end

-- A route exists but no destination is currently eligible (e.g. campaign with
-- no ringable agents): controlled no-agent response, never a silent drop and
-- never a bridge to a garbage destination.
if no_eligible == "true" or ((not destination or destination == "") and route_id and route_id ~= "") then
  log("WARNING", "Route " .. tostring(route_id) .. " has no eligible destination for DID " .. did_normalized .. " — playing no-agent prompt")
  session:execute("answer")
  session:sleep(500)
  session:execute("playback", "ivr/ivr-no_user_response.wav")
  session:hangup("NO_USER_RESPONSE")
  -- Recorded, not dropped: the caller rang and nobody could take the call.
  -- Answering to play the prompt is not the call being answered, so no
  -- answeredAt and no answering party.
  local no_eligible_end = os.time()
  post_cdr({
    callId = call_uuid,
    routeId = route_id,
    tenantId = tenant_id,
    callerNumber = caller_number,
    did = did_normalized,
    destination = "",
    buyerId = "",
    targetId = target_id,
    campaignId = campaign_id,
    duration = no_eligible_end - call_start_epoch,
    connectedDuration = 0,
    hangupCause = "NO_USER_RESPONSE",
    sipHangupDisposition = session:getVariable("sip_hangup_disposition") or "",
    startedAt = os.date("!%Y-%m-%dT%H:%M:%SZ", call_start_epoch),
    answeredAt = "",
    endedAt = os.date("!%Y-%m-%dT%H:%M:%SZ", no_eligible_end),
    recordingPath = "",
    recordingDuration = 0,
    bridgeChannelName = "",
    answeredParty = "",
    answeredNumber = "",
    answeredTarget = "",
  })
  return
end

if not destination or destination == "" then
  log("WARNING", "No route found for DID: " .. did_normalized .. " — rejecting call")
  session:hangup("UNALLOCATED_NUMBER")
  return
end

log("INFO", "Route found: " .. did_normalized .. " → " .. destination .. " (route: " .. (route_id or "?") .. ")")

-- ── Step 2: Set up call ─────────────────────────────────────────────────────
session:execute("ring_ready")
session:setVariable("call_direction", "inbound")

-- Agent-leg rescue. A softphone whose browser or network dies mid-call stops
-- answering FreeSWITCH's routine re-INVITE, so that leg is torn down with
-- RECOVERY_ON_TIMER_EXPIRE (SIP 408 -> Q.850 cause 102). With
-- hangup_after_bridge=true that tore down the CUSTOMER too, mid-sentence.
-- Disable it so we own the teardown and can re-ring instead of dropping them.
-- Kill switch: AGENT_LEG_RESCUE=false restores the previous behaviour exactly.
local rescue_enabled = (os.getenv("AGENT_LEG_RESCUE") or "true") ~= "false"
local hangup_after_bridge_value = rescue_enabled and "false" or "true"
-- Causes meaning "the agent leg vanished", never "the agent hung up".
local AGENT_LEG_DIED = {
    RECOVERY_ON_TIMER_EXPIRE = true,
    MEDIA_TIMEOUT = true,
    NETWORK_OUT_OF_ORDER = true,
    NETWORK_ERROR = true,
}
session:setVariable("hangup_after_bridge", hangup_after_bridge_value)
session:setVariable("continue_on_fail", "false")
session:setVariable("call_timeout", "120")

-- Codec settings for BulkVS PSTN termination
session:setVariable("absolute_codec_string", "PCMU,PCMA")
session:execute("export", "nolocal:absolute_codec_string=PCMU,PCMA")
session:setVariable("bypass_media", "false")

-- Ringback
session:setVariable("ringback", "%(2000,4000,440,480)")
session:setVariable("instant_ringback", "true")

-- Set caller ID on the outbound leg to be the original caller
session:setVariable("effective_caller_id_number", caller_number)
session:setVariable("effective_caller_id_name", caller_number)
session:setVariable("origination_caller_id_number", caller_number)
session:setVariable("origination_caller_id_name", caller_number)

-- Store metadata in channel variables for CDR
session:setVariable("x_route_id", route_id or "")
session:setVariable("x_tenant_id", tenant_id or "")
session:setVariable("x_buyer_id", buyer_id or "")
session:setVariable("x_target_id", target_id or "")
session:setVariable("x_campaign_id", campaign_id or "")
session:setVariable("x_did", did_normalized)
session:setVariable("x_destination", destination)

-- ── Step 3: Start recording ─────────────────────────────────────────────────
local recording_enabled = (recording_flag ~= "false")
local recording_path = ""

if recording_enabled then
  -- Ensure recording directory exists
  os.execute("mkdir -p " .. RECORDING_DIR)

  recording_path = RECORDING_DIR .. "/in_" .. call_uuid .. ".wav"
  session:setVariable("x_recording_path", recording_path)
  
  -- Prevent record_session from forcing a pre-answer, so the caller hears a ringtone
  session:setVariable("media_bug_answer_req", "true")
  session:setVariable("media_bug_answer", "true")
  session:setVariable("RECORD_ANSWER_REQ", "true")
  
  log("INFO", "Recording to: " .. recording_path)
  session:execute("record_session", recording_path)
end

-- ── Step 4: Bridge to buyer ─────────────────────────────────────────────────
local start_epoch = os.time()
session:setVariable("x_started_at", os.date("!%Y-%m-%dT%H:%M:%SZ", start_epoch))

session:setVariable("continue_on_fail", "true")
session:setVariable("hangup_after_bridge", hangup_after_bridge_value)

-- Clear any incoming Identity/STIR-SHAKEN headers from the A-leg to prevent
-- downstream carrier (BulkVS) rejection due to mismatched destination TN
session:execute("unset", "sip_h_Identity")
session:execute("unset", "sip_h_Identity-Info")
session:setVariable("sip_h_Identity", nil)
session:setVariable("sip_h_Identity-Info", nil)

local failover_steps = split_outside_brackets(dial_plan, "|")
local answered_bridge_channel = ""
local answered_party = ""
local answered_number = ""
local answered_target = ""

-- The overall ring ceiling. A leg's own leg_timeout never exceeds it.
local CALL_TIMEOUT = tonumber(session:getVariable("call_timeout") or "") or 120

-- External (PSTN/buyer) legs present one of OUR numbers: carriers reject or
-- silently drop a forwarded caller ID we do not own (campaign_external_cid_fix_v1),
-- even while local ringback continues. Anonymous/"restricted" A-leg caller IDs
-- are refused outright (NORMAL_TEMPORARY_FAILURE). So the dialed DID, or the
-- default FracTEL caller ID when the DID is not a usable number.
local outbound_cid = string.gsub(tostring(session:getVariable("destination_number") or ""), "%D", "")
if string.len(outbound_cid) == 10 then
    outbound_cid = "1" .. outbound_cid
end
if string.len(outbound_cid) ~= 11 or string.sub(outbound_cid, 1, 1) ~= "1" then
    outbound_cid = string.gsub(tostring(os.getenv("FRACTEL_DEFAULT_CALLER_ID") or "12294222208"), "%D", "")
    if string.len(outbound_cid) == 10 then
        outbound_cid = "1" .. outbound_cid
    end
end

-- The softphone is on OUR side of the call: it shows the customer's number.
local softphone_cid = string.gsub(caller_number, "[^%w%+]", "")
if softphone_cid == "" then softphone_cid = "unknown" end

-- Variables every leg carries: who it rings (read back after the bridge) and
-- how long it rings.
local function routing_leg_vars(tags, bare)
    local vars = new_leg_vars()
    set_leg_var(vars, "x_leg_party", tags["x_leg_party"])
    set_leg_var(vars, "x_leg_target", tags["x_leg_target"])
    set_leg_var(vars, "x_leg_number", tags["x_leg_number"] or bare)
    local leg_timeout = tonumber(tags["leg_timeout"] or "")
    if leg_timeout and leg_timeout > 0 then
        set_leg_var(vars, "leg_timeout", tostring(math.min(leg_timeout, CALL_TIMEOUT)))
    end
    -- Also stamp the answer onto OUR leg the moment this leg answers, for when
    -- the B-leg is already gone by the time the bridge returns.
    if tags["x_leg_party"] and tags["x_leg_party"] ~= "" and call_uuid ~= "" then
        set_leg_var(vars, "api_on_answer", "uuid_setvar " .. call_uuid .. " x_answered_leg " ..
            tags["x_leg_party"] .. "/" .. (tags["x_leg_target"] or "") .. "/" .. (tags["x_leg_number"] or bare))
    end
    return vars
end

-- The softphone reads the call's id off the INVITE, so its disposition lands
-- on the call row the CDR writes (callSid "fs-<uuid>").
local function agent_leg_vars(vars)
    set_leg_var(vars, "sip_h_X-Call-Id", "fs-" .. call_uuid)
end

local function external_leg_vars(vars)
    set_leg_var(vars, "sip_cid_type", "pid")
    set_leg_var(vars, "sip_from_user", outbound_cid)
    set_leg_var(vars, "origination_caller_id_number", outbound_cid)
    set_leg_var(vars, "origination_caller_id_name", outbound_cid)
    set_leg_var(vars, "effective_caller_id_number", outbound_cid)
    set_leg_var(vars, "effective_caller_id_name", outbound_cid)
end

local function softphone_leg_vars(vars)
    agent_leg_vars(vars)
    set_leg_var(vars, "origination_caller_id_number", softphone_cid)
    set_leg_var(vars, "origination_caller_id_name", softphone_cid)
end

-- The agent-cell extras (press-1 confirm, optional customer caller ID), as
-- variables rather than a bracketed string.
local function add_agent_cell_vars(vars)
    local cell = agent_cell_leg_vars(caller_number)
    local inner = string.match(cell, "^%[(.*)%]$")
    if not inner then return end
    for pair in string.gmatch(inner, "[^,]+") do
        local k, v = string.match(pair, "^([^=]+)=(.*)$")
        if k then set_leg_var(vars, k, v) end
    end
end

-- A variable off the leg that answered. The B-leg's own variables first, via
-- uuid_getvar on whichever of our variables still names it; then the copy the
-- leg's api_on_answer stamped onto this leg.
local function answered_leg_var(name)
    for _, holder in ipairs({ "last_bridge_to", "bridge_uuid", "signal_bond" }) do
        local b_uuid = trim(session:getVariable(holder) or "")
        if b_uuid ~= "" then
            local ok, val = pcall(function() return api:execute("uuid_getvar", b_uuid .. " " .. name) end)
            if ok and type(val) == "string" then
                val = trim(val)
                if val ~= "" and val ~= "_undef_" and not string.match(val, "^%-ERR") then
                    return val
                end
            end
        end
    end
    return ""
end

local function read_answered_leg()
    local party = answered_leg_var("x_leg_party")
    local number = answered_leg_var("x_leg_number")
    local target = answered_leg_var("x_leg_target")
    if party == "" then
        local stamped = trim(session:getVariable("x_answered_leg") or "")
        local s_party, s_target, s_number = string.match(stamped, "^([^/]*)/([^/]*)/(.*)$")
        if s_party and s_party ~= "" then
            party, target, number = s_party, s_target, s_number
        end
    end
    return party, number, target
end

for i, step in ipairs(failover_steps) do
    if step and step ~= "" then
        local parallel_destinations = split_outside_brackets(step, ",")
        local bridge_components = {}
        -- Each component's per-leg variables, by index into bridge_components.
        local component_vars = {}
        -- The first carrier leg for each external destination, in that
        -- carrier's own number format. Used when an external shares a step
        -- with other legs, where the full waterfall cannot be expressed.
        local external_first_leg = {}

        -- Channel snapshot for this step only. Failover steps run seconds or
        -- minutes apart, so it is refreshed per step, and only fetched at all
        -- when the step actually contains an internal extension.
        local channel_rows = nil
        local function step_channel_rows()
            if channel_rows == nil then channel_rows = live_channel_rows() end
            return channel_rows
        end

        for j, raw_dest in ipairs(parallel_destinations) do
            local tags, p_dest = parse_leg(raw_dest)
            if p_dest ~= "" then
                local vars = routing_leg_vars(tags, p_dest)
                -- Check if it's a short extension (e.g. 1000) or a UUID (User ID)
                local is_internal = false
                if string.match(p_dest, "^%d%d%d%d$") then
                    is_internal = true
                elseif string.match(p_dest, "^%x%x%x%x%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x$") then
                    is_internal = true
                end

                if is_internal then
                    softphone_leg_vars(vars)
                    -- Pre-resolve the contact to check if registered, searching multiple fallback domains
                    local domain = session:getVariable("domain_name") or "localhost"
                    if domain == "" then domain = "localhost" end
                    
                    local domains_to_try = {
                        "hopwhistle.com",
                        "aivoice.hopwhistle.com",
                        domain,
                        "178.156.223.97",
                        "freeswitch",
                        "localhost"
                    }
                    local contact = ""
                    for _, dom in ipairs(domains_to_try) do
                        if dom and dom ~= "" then
                            local res = api:execute("sofia_contact", "internal/" .. p_dest .. "@" .. dom) or ""
                            if res ~= "" and not string.match(res, "^error") then
                                contact = res
                                log("INFO", "Internal extension " .. p_dest .. " found registered on domain " .. dom .. ": " .. contact)
                                break
                            end
                        end
                    end

                    -- Never ring an agent who is already on a call.
                    local busy_calls = 0
                    if AGENT_BUSY_CHECK then
                        busy_calls = agent_channel_count(
                            p_dest,
                            (contact ~= "" and contact or nil),
                            step_channel_rows(),
                            call_uuid
                        )
                    end

                    if busy_calls >= AGENT_MAX_CONCURRENT then
                        log("WARNING", "[AGENT-BUSY] Extension " .. p_dest .. " already on " ..
                            tostring(busy_calls) .. " call(s) (limit " .. tostring(AGENT_MAX_CONCURRENT) ..
                            ") — NOT ringing; leaving their call undisturbed")
                    elseif contact ~= "" then
                        log("INFO", "Internal extension " .. p_dest .. " registered: " .. contact)
                        table.insert(bridge_components, contact)
                        component_vars[#bridge_components] = vars
                    else
                        log("WARNING", "Internal extension " .. p_dest .. " not found via sofia_contact — falling back to user/" .. p_dest)
                        table.insert(bridge_components, "user/" .. p_dest)
                        component_vars[#bridge_components] = vars
                    end
                else
                    -- External PSTN leg. Validate it actually looks like a phone
                    -- number — stale routes can carry sentinels like "Campaign"
                    -- which previously produced sofia/gateway/<gw>/Campaign and a
                    -- guaranteed dead bridge.
                    local dest_digits = string.gsub(p_dest, "%D", "")
                    if string.len(dest_digits) == 10 then
                        dest_digits = "1" .. dest_digits
                    end
                    local is_agent_cell = agent_cell_keys[ten_digit_key(dest_digits)] == true
                    local cell_busy = 0
                    if is_agent_cell and AGENT_BUSY_CHECK then
                        cell_busy = cell_channel_count(ten_digit_key(dest_digits), step_channel_rows(), call_uuid)
                    end
                    if cell_busy >= AGENT_MAX_CONCURRENT then
                        log("WARNING", "[AGENT-BUSY] Agent cell " .. dest_digits .. " already on " ..
                            tostring(cell_busy) .. " call(s) — NOT ringing")
                    elseif string.len(dest_digits) >= 11 and string.len(dest_digits) <= 15 then
                        external_leg_vars(vars)
                        if is_agent_cell or starts_with(tags["x_leg_party"], "agent:") then
                            agent_leg_vars(vars)
                        end
                        if is_agent_cell then
                            add_agent_cell_vars(vars)
                        end
                        table.insert(bridge_components, "sofia/gateway/" .. external_gateways[1] .. "/" .. dest_digits)
                        component_vars[#bridge_components] = vars
                        local templated = carrier_legs_for(dest_digits)
                        external_first_leg[#bridge_components] = templated and string.match(templated, "^[^|]+") or nil
                    else
                        log("ERR", "Skipping non-routable destination token '" .. p_dest .. "' (not an extension, user ID, or phone number)")
                    end
                end
            end
        end
        
        if #bridge_components > 0 then
            if not session:ready() then
                log("WARNING", "Session no longer active, aborting failover loop")
                break
            end
            log("INFO", "External legs present caller ID " .. outbound_cid .. "; original caller=" .. tostring(caller_number))
            -- A registered contact can list several registrations; each is its
            -- own leg and each carries the variables.
            local function tagged(idx, leg)
                local vars = component_vars[idx] or new_leg_vars()
                local out = {}
                for _, one in ipairs(split_outside_brackets(leg, ",")) do
                    if trim(one) ~= "" then
                        table.insert(out, with_leg_vars(vars, trim(one)))
                    end
                end
                return table.concat(out, ",")
            end
            -- Single external destination: retry the same number across the
            -- whole carrier gateway chain (mirrors the outbound dialplan's
            -- fractel1..6 failover) before moving to the next routing step.
            local bridge_body
            if #bridge_components == 1 then
                local gw_dest = string.match(bridge_components[1], "^sofia/gateway/[^/]+/(.+)$")
                local templated = gw_dest and carrier_legs_for(gw_dest) or nil
                local alternatives
                if templated then
                    -- Preferred: the API's rendered waterfall, which carries
                    -- each carrier's own number format.
                    alternatives = templated
                elseif gw_dest and #external_gateways > 1 then
                    local alts = {}
                    for _, gw in ipairs(external_gateways) do
                        table.insert(alts, "sofia/gateway/" .. gw .. "/" .. gw_dest)
                    end
                    alternatives = table.concat(alts, "|")
                else
                    alternatives = bridge_components[1]
                end
                local alts = {}
                for _, alt in ipairs(split_outside_brackets(alternatives, "|")) do
                    if trim(alt) ~= "" then
                        table.insert(alts, tagged(1, trim(alt)))
                    end
                end
                bridge_body = table.concat(alts, "|")
            else
                -- A mixed or ring-all step. Each external leg gets the first
                -- carrier's rendered format -- the bare `gateway/1XXXXXXXXXX`
                -- above drops a carrier's tech prefix, and Anveo refuses a
                -- number without it, so every cell in a softphone+cell step
                -- failed while the softphones rang.
                local legs = {}
                for idx, leg in ipairs(bridge_components) do
                    table.insert(legs, tagged(idx, external_first_leg[idx] or leg))
                end
                bridge_body = table.concat(legs, ",")
            end
            local bridge_string = bridge_body
            log("INFO", "Bridging to failover step " .. tostring(i) .. ": " .. bridge_string)
            session:execute("bridge", bridge_string)

            -- The customer outlives a dead agent leg: re-ring this same group
            -- once rather than hanging up on a live conversation. Bounded to a
            -- single retry per step, and only when the bridge had actually
            -- connected and the customer is still on the line.
            if rescue_enabled and session:answered() and session:ready() then
                local bcause = session:getVariable("bridge_hangup_cause")
                    or session:getVariable("last_bridge_hangup_cause") or ""
                if AGENT_LEG_DIED[bcause] then
                    log("WARNING", "[AGENT-LEG-RESCUE] agent leg died (" .. bcause ..
                        ") with caller still connected — re-ringing step " .. tostring(i))
                    session:execute("bridge", bridge_string)
                end
            end

            if session:answered() then
                -- The leg that took the call, and who it was: the CDR credits
                -- the call to this party and no other.
                answered_bridge_channel = session:getVariable("bridge_channel") or answered_bridge_channel
                answered_party, answered_number, answered_target = read_answered_leg()
                log("INFO", "Call answered on step " .. tostring(i) .. " by '" .. answered_party ..
                    "' (" .. answered_number .. "), exiting failover loop")
                -- hangup_after_bridge is off, so release the caller here.
                if rescue_enabled and session:ready() then
                    session:hangup("NORMAL_CLEARING")
                end
                break
            else
                local cause = session:getVariable("originate_disposition") or session:getVariable("endpoint_disposition") or "UNKNOWN"
                log("INFO", "Step " .. tostring(i) .. " failed to answer (" .. cause .. "), continuing to next step")
            end
        else
            log("WARNING", "Step " .. tostring(i) .. " has no reachable destinations — skipping to next")
        end
    end
end

-- If call was not answered by any buyer leg, answer cleanly and play fallback announcement
if not session:answered() and session:ready() then
    log("WARNING", "All buyer bridge attempts completed without answer — playing fallback prompt")
    session:execute("answer")
    session:sleep(500)
    session:execute("playback", "ivr/ivr-no_user_response.wav")
    session:hangup("NO_USER_RESPONSE")
end

-- ── Step 5: Call ended — collect CDR and report ─────────────────────────────
local end_epoch = os.time()
local hangup_cause = session:getVariable("hangup_cause") or "NORMAL_CLEARING"
-- Who sent the BYE/CANCEL, from our point of view on this leg. NORMAL_CLEARING
-- alone cannot tell a caller hanging up from the buyer hanging up, and that
-- difference is the whole of the abandon-rate metric. recv_* means the caller
-- acted; send_* means we did, which on a bridged call means the buyer leg went
-- away first. Empty on non-SIP legs, and the API records UNKNOWN for those.
local hangup_disposition = session:getVariable("sip_hangup_disposition") or ""
local billsec = session:getVariable("billsec") or "0"
local duration_val = session:getVariable("duration") or tostring(end_epoch - start_epoch)
local answered_epoch = session:getVariable("answered_time") or ""

-- answered_time is in microseconds (older builds: seconds).
local answered_sec = tonumber(answered_epoch ~= "" and answered_epoch or "0") or 0
if answered_sec > 1000000000000 then
  answered_sec = math.floor(answered_sec / 1000000)
end

-- FreeSWITCH fills in `billsec` only when the channel is destroyed, which is
-- after this script ends, so here it reads 0 even for a call the buyer took.
-- The CDR then reported connected transfers as "buyer no-answer / 0s". This
-- leg is answered when the buyer answers, so connected time is end - answer.
-- Only when a buyer leg actually took the call: the no-answer fallback prompt
-- also answers this leg, and that is not connected time.
if (tonumber(billsec) or 0) == 0 and answered_bridge_channel ~= "" and answered_sec > 0 then
  billsec = tostring(math.max(0, end_epoch - answered_sec))
end

log("INFO", "Call ended: " .. caller_number .. " → " .. destination .. 
    " | duration=" .. duration_val .. "s | billsec=" .. billsec .. 
    " | cause=" .. hangup_cause)

-- Build CDR payload. `answeredAt` only when a leg actually answered: the
-- no-answer prompt answers this leg too, which sets answered_time, and that
-- is not the call being answered.
local answered_at_iso = ""
if answered_sec > 0 and answered_bridge_channel ~= "" then
  answered_at_iso = os.date("!%Y-%m-%dT%H:%M:%SZ", answered_sec)
end

local cdr_response = post_cdr({
  callId = call_uuid,
  routeId = route_id,
  tenantId = tenant_id,
  callerNumber = caller_number,
  did = did_normalized,
  destination = destination,
  buyerId = buyer_id,
  targetId = target_id,
  campaignId = campaign_id,
  duration = duration_val,
  connectedDuration = billsec,
  hangupCause = hangup_cause,
  sipHangupDisposition = hangup_disposition,
  startedAt = os.date("!%Y-%m-%dT%H:%M:%SZ", start_epoch),
  answeredAt = answered_at_iso,
  endedAt = os.date("!%Y-%m-%dT%H:%M:%SZ", end_epoch),
  recordingPath = recording_path,
  recordingDuration = billsec,
  bridgeChannelName = answered_bridge_channel,
  answeredParty = answered_bridge_channel ~= "" and answered_party or "",
  answeredNumber = answered_bridge_channel ~= "" and answered_number or "",
  answeredTarget = answered_bridge_channel ~= "" and answered_target or "",
})

  -- Parse the call ID from response for recording upload
  local db_call_id = json_value(cdr_response, "callId")

  -- Note: Recording upload is handled automatically by the API service 
  -- after receiving the CDR webhook, via shared volume access.
  log("INFO", "Recording upload will be handled by API for call ID: " .. (db_call_id or "nil"))


log("INFO", "Inbound call processing complete for UUID: " .. call_uuid)
