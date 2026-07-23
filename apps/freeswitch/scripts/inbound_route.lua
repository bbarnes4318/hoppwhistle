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
local external_gateways_csv = json_value(response_body, "externalGateways") or "fractel1,fractel2,fractel3"
local external_gateways = {}
for gw in string.gmatch(external_gateways_csv, "[^,%s]+") do
    table.insert(external_gateways, gw)
end
if #external_gateways == 0 then
    external_gateways = { "fractel1" }
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
session:setVariable("hangup_after_bridge", "true")
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
session:setVariable("hangup_after_bridge", "true")

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

                    if contact ~= "" then
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
            local cid = caller_number
            if cid == nil or cid == "" or not string.match(tostring(cid), "%d%d%d%d%d%d%d") then
                cid = session:getVariable("destination_number") or "4233398241"
                cid = string.gsub(tostring(cid), "^%+", "")
                log("INFO", "[INBOUND-ROUTE] anonymous/restricted caller ID; using DID " .. cid .. " for buyer leg")
            end
            local bridge_vars = string.format(
                "{origination_caller_id_number=%s,origination_caller_id_name=%s,effective_caller_id_number=%s,effective_caller_id_name=%s}",
                cid, cid, cid, cid
            )
            -- Single external destination: retry the same number across the
            -- whole carrier gateway chain (mirrors the outbound dialplan's
            -- fractel1..6 failover) before moving to the next routing step.
            local bridge_body
            if #bridge_components == 1 then
                local gw_dest = string.match(bridge_components[1], "^sofia/gateway/[^/]+/(.+)$")
                if gw_dest and #external_gateways > 1 then
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
            
            if session:answered() then
                log("INFO", "Call answered on step " .. tostring(i) .. ", exiting failover loop")
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
