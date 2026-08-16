--[[
  inbound_route.lua — FreeSWITCH Dynamic Inbound DID Routing
  
  Called from the public dialplan context for all inbound tracking DIDs.
  
  Flow:
    1. Extract caller number (ANI) and dialed number (DNIS/DID)
    2. HTTP GET to API: /api/v1/freeswitch/lookup?did=<DID>
    3. If route found → start recording → bridge to buyer's phone via BulkVS
    4. On hangup → POST CDR to API for tracking
    5. Kick off recording upload to S3

  Environment:
    API_URL     — Base URL of the Hopwhistle API (default: http://127.0.0.1:3001)
    RECORDING_DIR — Directory for recordings (default: /recordings)
]]

-- ── Configuration ───────────────────────────────────────────────────────────
local API_URL      = os.getenv("API_URL") or "http://127.0.0.1:3001"
local RECORDING_DIR = os.getenv("RECORDING_DIR") or "/recordings"
local UPLOAD_SCRIPT = "/usr/share/freeswitch/scripts/upload-recording.sh"

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

-- ── Main Logic ──────────────────────────────────────────────────────────────
local caller_number = session:getVariable("caller_id_number") or "unknown"
local did_number    = session:getVariable("destination_number") or ""
local call_uuid     = session:getVariable("uuid") or ""

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

-- ── Step 1: Lookup route via API ────────────────────────────────────────────
local function url_encode_plus(val)
    return string.gsub(val or "", "%+", "%%2B")
end

local encoded_did = url_encode_plus(did_normalized)
local encoded_caller = url_encode_plus(caller_normalized)

local lookup_url = API_URL .. "/api/v1/freeswitch/lookup?did=" .. encoded_did
if encoded_caller ~= "" and encoded_caller ~= "unknown" then
    lookup_url = lookup_url .. "&caller=" .. encoded_caller
end

session:setVariable("curl_connect_timeout", "3")
session:setVariable("curl_timeout", "15")

log("INFO", "Looking up route: " .. lookup_url)

session:execute("curl", lookup_url)

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

local function split(s, delimiter)
    local result = {}
    for match in (s..delimiter):gmatch("(.-)"..delimiter) do
        table.insert(result, match)
    end
    return result
end

session:setVariable("continue_on_fail", "true")
session:setVariable("hangup_after_bridge", hangup_after_bridge_value)

-- Clear any incoming Identity/STIR-SHAKEN headers from the A-leg to prevent
-- downstream carrier (BulkVS) rejection due to mismatched destination TN
session:execute("unset", "sip_h_Identity")
session:execute("unset", "sip_h_Identity-Info")
session:setVariable("sip_h_Identity", nil)
session:setVariable("sip_h_Identity-Info", nil)

local failover_steps = split(destination, "|")

for i, step in ipairs(failover_steps) do
    if step and step ~= "" then
        local parallel_destinations = split(step, ",")
        local bridge_components = {}

        -- Channel snapshot for this step only. Failover steps run seconds or
        -- minutes apart, so it is refreshed per step, and only fetched at all
        -- when the step actually contains an internal extension.
        local channel_rows = nil
        local function step_channel_rows()
            if channel_rows == nil then channel_rows = live_channel_rows() end
            return channel_rows
        end

        for j, p_dest in ipairs(parallel_destinations) do
            -- Strip whitespace
            p_dest = string.gsub(p_dest, "^%s*(.-)%s*$", "%1")
            if p_dest ~= "" then
                -- Check if it's a short extension (e.g. 1000) or a UUID (User ID)
                local is_internal = false
                if string.match(p_dest, "^%d%d%d%d$") then
                    is_internal = true
                elseif string.match(p_dest, "^%x%x%x%x%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x$") then
                    is_internal = true
                end

                if is_internal then
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
                    else
                        log("WARNING", "Internal extension " .. p_dest .. " not found via sofia_contact — falling back to user/" .. p_dest)
                        table.insert(bridge_components, "user/" .. p_dest)
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
                    if string.len(dest_digits) >= 11 and string.len(dest_digits) <= 15 then
                        table.insert(bridge_components, "sofia/gateway/" .. external_gateways[1] .. "/" .. dest_digits)
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
            -- Carriers reject anonymous/"restricted" caller IDs on the outbound buyer
            -- leg (NORMAL_TEMPORARY_FAILURE). If the A-leg caller ID isn't a real
            -- number, stamp the dialed DID so the buyer leg is an acceptable call.
            -- campaign_external_cid_fix_v1: PSTN buyer legs must present a
            -- Hopwhistle/FracTEL DID as caller ID. Forwarding the original callers ANI
            -- can be rejected or silently time out even while local ringback continues.
            local outbound_cid = session:getVariable("destination_number") or ""
            outbound_cid = string.gsub(tostring(outbound_cid), "%D", "")
            if string.len(outbound_cid) == 10 then
                outbound_cid = "1" .. outbound_cid
            end
            if string.len(outbound_cid) ~= 11 or string.sub(outbound_cid, 1, 1) ~= "1" then
                outbound_cid = os.getenv("FRACTEL_DEFAULT_CALLER_ID") or "12294222208"
                outbound_cid = string.gsub(tostring(outbound_cid), "%D", "")
                if string.len(outbound_cid) == 10 then
                    outbound_cid = "1" .. outbound_cid
                end
            end
            log("INFO", "External buyer leg using verified FracTEL caller ID " .. outbound_cid .. "; original caller=" .. tostring(caller_number))
            local bridge_vars = string.format(
                "{sip_cid_type=pid,sip_from_user=%s,origination_caller_id_number=%s,origination_caller_id_name=Hopwhistle,effective_caller_id_number=%s,effective_caller_id_name=Hopwhistle}",
                outbound_cid, outbound_cid, outbound_cid
            )
            -- Single external destination: retry the same number across the
            -- whole carrier gateway chain (mirrors the outbound dialplan's
            -- fractel1..6 failover) before moving to the next routing step.
            local bridge_body
            if #bridge_components == 1 then
                local gw_dest = string.match(bridge_components[1], "^sofia/gateway/[^/]+/(.+)$")
                local templated = gw_dest and carrier_legs_for(gw_dest) or nil
                if templated then
                    -- Preferred: the API's rendered waterfall, which carries
                    -- each carrier's own number format.
                    bridge_body = templated
                elseif gw_dest and #external_gateways > 1 then
                    local alts = {}
                    for _, gw in ipairs(external_gateways) do
                        table.insert(alts, "sofia/gateway/" .. gw .. "/" .. gw_dest)
                    end
                    bridge_body = table.concat(alts, "|")
                else
                    bridge_body = bridge_components[1]
                end
            else
                bridge_body = table.concat(bridge_components, ",")
            end
            local bridge_string = bridge_vars .. bridge_body
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
                log("INFO", "Call answered on step " .. tostring(i) .. ", exiting failover loop")
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
local billsec = session:getVariable("billsec") or "0"
local duration_val = session:getVariable("duration") or tostring(end_epoch - start_epoch)
local answered_epoch = session:getVariable("answered_time") or ""

log("INFO", "Call ended: " .. caller_number .. " → " .. destination .. 
    " | duration=" .. duration_val .. "s | billsec=" .. billsec .. 
    " | cause=" .. hangup_cause)

-- Build CDR payload
local answered_at_iso = ""
if answered_epoch and answered_epoch ~= "" and answered_epoch ~= "0" then
  -- answered_time is in microseconds
  local answered_sec = tonumber(answered_epoch)
  if answered_sec and answered_sec > 1000000000000 then
    answered_sec = math.floor(answered_sec / 1000000)
  end
  if answered_sec then
    answered_at_iso = os.date("!%Y-%m-%dT%H:%M:%SZ", answered_sec)
  end
end

local cdr_json = string.format(
  '{"callId":"%s","routeId":"%s","tenantId":"%s","callerNumber":"%s","did":"%s","destination":"%s","buyerId":"%s","targetId":"%s","campaignId":"%s","duration":%s,"connectedDuration":%s,"hangupCause":"%s","startedAt":"%s","answeredAt":"%s","endedAt":"%s","recordingPath":"%s","recordingDuration":%s}',
  call_uuid,
  route_id or "",
  tenant_id or "",
  caller_number,
  did_normalized,
  destination,
  buyer_id or "",
  target_id or "",
  campaign_id or "",
  duration_val,
  billsec,
  hangup_cause,
  os.date("!%Y-%m-%dT%H:%M:%SZ", start_epoch),
  answered_at_iso,
  os.date("!%Y-%m-%dT%H:%M:%SZ", end_epoch),
  recording_path,
  billsec
)

-- POST CDR to API
local cdr_url = API_URL .. "/api/v1/freeswitch/cdr"
local cdr_cmd = string.format(
  "%s content-type application/json timeout 10 post '%s'",
  cdr_url,
  cdr_json
)

log("INFO", "Posting CDR to: " .. cdr_url)
local cdr_response = api:execute("curl", cdr_cmd) or ""
log("INFO", "CDR response: " .. cdr_response)

  -- Parse the call ID from response for recording upload
  local db_call_id = json_value(cdr_response, "callId")

  -- Note: Recording upload is handled automatically by the API service 
  -- after receiving the CDR webhook, via shared volume access.
  log("INFO", "Recording upload will be handled by API for call ID: " .. (db_call_id or "nil"))


log("INFO", "Inbound call processing complete for UUID: " .. call_uuid)
