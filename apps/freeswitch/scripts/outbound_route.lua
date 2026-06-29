--[[
  outbound_route.lua — FreeSWITCH Outbound Route Lookup and Local/PSTN Bridging
  
  Intercepts outbound calls to check if the destination is a local user's phone number.
  If so, routes locally to their WebRTC extension. Otherwise, falls back to PSTN gateways.
]]

local API_URL = os.getenv("API_URL") or "http://127.0.0.1:3001"

local function log(level, msg)
  freeswitch.consoleLog(level, "[OUTBOUND-ROUTE] " .. msg .. "\n")
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

local destination_number = session:getVariable("destination_number") or ""
local caller_id_number = session:getVariable("caller_id_number") or ""
local domain = session:getVariable("domain_name") or "localhost"
if domain == "" then domain = "localhost" end

log("INFO", "Outbound routing lookup for " .. destination_number .. " (domain: " .. domain .. ")")

-- Normalize dialed number to +1XXXXXXXXXX for lookup
local clean_dest = string.gsub(destination_number, "%D", "")
if string.len(clean_dest) == 10 then
  clean_dest = "1" .. clean_dest
end
local did_normalized = "+" .. clean_dest
local raw_10digit = string.sub(clean_dest, -10)

-- Check if dialed number matches a local user/DID
local api = freeswitch.API()
local lookup_url = API_URL .. "/api/v1/freeswitch/lookup?did=" .. did_normalized
log("INFO", "Checking if destination is local: " .. lookup_url)

local response_body = api:execute("curl", lookup_url .. " timeout 5 get") or ""
log("INFO", "Lookup response: " .. response_body)

local matched_destination = json_value(response_body, "destination")

-- If matched_destination is a short 4-digit extension (e.g. 1000)
local is_internal = false
if matched_destination and string.match(matched_destination, "^%d%d%d%d$") then
  is_internal = true
end

if is_internal then
  log("INFO", "Resolved destination to local extension: " .. matched_destination)
  
  -- Pre-resolve the contact to check if registered
  local contact = api:execute("sofia_contact", "internal/" .. matched_destination .. "@" .. domain) or ""
  if contact ~= "" and not string.match(contact, "^error") then
    log("INFO", "Local extension " .. matched_destination .. " is registered: " .. contact)
    
    -- Bridge directly to local registered extension
    local bridge_vars = string.format(
      "{origination_caller_id_number=%s,origination_caller_id_name=%s,effective_caller_id_number=%s,effective_caller_id_name=%s}",
      caller_id_number, caller_id_number, caller_id_number, caller_id_number
    )
    local bridge_string = bridge_vars .. contact
    log("INFO", "Bridging locally: " .. bridge_string)
    session:execute("bridge", bridge_string)
    return
  else
    log("WARNING", "Local extension " .. matched_destination .. " is NOT registered/online")
    session:execute("playback", "ivr/ivr-user_busy.wav")
    session:hangup("USER_BUSY")
    return
  end
end

-- Fallback to PSTN outbound dialing via gateways
log("INFO", "Routing to PSTN gateways for raw 10-digit number: " .. raw_10digit)
local bridge_string = "sofia/gateway/signalwire/1" .. raw_10digit .. "|sofia/gateway/telnyx/1" .. raw_10digit .. "|sofia/gateway/bulkvs/1" .. raw_10digit
session:execute("bridge", bridge_string)
