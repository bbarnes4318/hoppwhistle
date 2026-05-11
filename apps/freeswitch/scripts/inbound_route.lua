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
local UPLOAD_SCRIPT = "/usr/local/freeswitch/scripts/upload-recording.sh"

-- ── Helpers ─────────────────────────────────────────────────────────────────
local function log(level, msg)
  freeswitch.consoleLog(level, "[INBOUND-ROUTE] " .. msg .. "\n")
end

-- Simple JSON value extractor (avoids cjson dependency)
local function json_value(json_str, key)
  local pattern = '"' .. key .. '"%s*:%s*"([^"]*)"'
  local val = string.match(json_str, pattern)
  if val then return val end
  -- Try boolean/number values
  pattern = '"' .. key .. '"%s*:%s*(%w+)'
  return string.match(json_str, pattern)
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
local api = freeswitch.API()
local lookup_url = API_URL .. "/api/v1/freeswitch/lookup?did=" .. did_normalized
if caller_normalized ~= "unknown" then
  lookup_url = lookup_url .. "&caller=" .. caller_normalized
end
log("INFO", "Looking up route: " .. lookup_url)

local curl_cmd = "curl -s -m 5 '" .. lookup_url .. "'"
local response = api:execute("system", curl_cmd)

-- Try using curl via Lua
local handle = io.popen(curl_cmd, "r")
local response_body = ""
if handle then
  response_body = handle:read("*a") or ""
  handle:close()
end

log("INFO", "Lookup response: " .. response_body)

-- Parse response
local destination     = json_value(response_body, "destination")
local route_id        = json_value(response_body, "routeId")
local tenant_id       = json_value(response_body, "tenantId")
local buyer_id        = json_value(response_body, "buyerId")
local campaign_id     = json_value(response_body, "campaignId")
local recording_flag  = json_value(response_body, "recordingEnabled")

-- ── TCPA Litigator Check ──────────────────────────────────────────────────
local reject_flag = json_value(response_body, "reject")
if reject_flag == "true" then
  local reject_reason = json_value(response_body, "reason") or "BLOCKED"
  log("WARNING", "TCPA BLOCK: caller " .. caller_number .. " on DID " .. did_normalized .. " — reason: " .. reject_reason)
  session:hangup("CALL_REJECTED")
  return
end

if not destination or destination == "" then
  log("WARNING", "No route found for DID: " .. did_normalized .. " — rejecting call")
  session:execute("playback", "ivr/ivr-invalid_number.wav")
  session:hangup("NO_ROUTE_DESTINATION")
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

-- Store metadata in channel variables for CDR
session:setVariable("x_route_id", route_id or "")
session:setVariable("x_tenant_id", tenant_id or "")
session:setVariable("x_buyer_id", buyer_id or "")
session:setVariable("x_campaign_id", campaign_id or "")
session:setVariable("x_did", did_normalized)
session:setVariable("x_destination", destination)

-- ── Step 3: Start recording ─────────────────────────────────────────────────
local recording_enabled = (recording_flag ~= "false")
local recording_path = ""

if recording_enabled then
  -- Ensure recording directory exists
  os.execute("mkdir -p " .. RECORDING_DIR)

  local date_path = os.date("%Y/%m/%d")
  os.execute("mkdir -p " .. RECORDING_DIR .. "/" .. date_path)

  recording_path = RECORDING_DIR .. "/" .. date_path .. "/" .. call_uuid .. ".wav"
  session:setVariable("x_recording_path", recording_path)
  
  log("INFO", "Recording to: " .. recording_path)
  session:execute("record_session", recording_path)
end

-- ── Step 4: Bridge to buyer ─────────────────────────────────────────────────
-- Strip + from destination for gateway dialing
local dest_stripped = string.gsub(destination, "^%+", "")
local bridge_string = "sofia/gateway/bulkvs/" .. dest_stripped

log("INFO", "Bridging to: " .. bridge_string)

local start_epoch = os.time()
session:setVariable("x_started_at", os.date("!%Y-%m-%dT%H:%M:%SZ", start_epoch))

session:execute("bridge", bridge_string)

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
  '{"callId":"%s","routeId":"%s","tenantId":"%s","callerNumber":"%s","did":"%s","destination":"%s","buyerId":"%s","campaignId":"%s","duration":%s,"connectedDuration":%s,"hangupCause":"%s","startedAt":"%s","answeredAt":"%s","endedAt":"%s","recordingPath":"%s","recordingDuration":%s}',
  call_uuid,
  route_id or "",
  tenant_id or "",
  caller_number,
  did_normalized,
  destination,
  buyer_id or "",
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
  "curl -s -m 10 -X POST '%s' -H 'Content-Type: application/json' -d '%s'",
  cdr_url,
  cdr_json
)

log("INFO", "Posting CDR to: " .. cdr_url)
local cdr_handle = io.popen(cdr_cmd, "r")
if cdr_handle then
  local cdr_response = cdr_handle:read("*a") or ""
  cdr_handle:close()
  log("INFO", "CDR response: " .. cdr_response)

  -- Parse the call ID from response for recording upload
  local db_call_id = json_value(cdr_response, "callId")

  -- ── Step 6: Upload recording to S3 ────────────────────────────────────
  if recording_enabled and recording_path ~= "" and db_call_id then
    local upload_cmd = string.format(
      "%s '%s' '%s' &",
      UPLOAD_SCRIPT,
      recording_path,
      db_call_id
    )
    log("INFO", "Kicking off recording upload: " .. upload_cmd)
    os.execute(upload_cmd)
  end
end

log("INFO", "Inbound call processing complete for UUID: " .. call_uuid)
