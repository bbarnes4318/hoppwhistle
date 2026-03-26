-- test_call.lua — Trigger a test outbound call through BulkVS with local STIR/SHAKEN signing
-- This simulates the exact flow that vapi_outbound.xml creates

local dest = "15513326220"
local caller = "12816989460"

freeswitch.consoleLog("INFO", "[TEST] Originating test call to " .. dest .. "\n")

local new_session = freeswitch.Session(
    "{origination_caller_id_number=" .. caller ..
    ",origination_caller_id_name=PVN LLC" ..
    ",effective_caller_id_number=" .. caller ..
    ",effective_caller_id_name=PVN LLC" ..
    ",outbound_caller_id_number=" .. caller ..
    ",outbound_caller_id_name=PVN LLC" ..
    ",sip_from_user=" .. caller ..
    ",sip_contact_user=" .. caller ..
    ",absolute_codec_string=PCMU,PCMA" ..
    ",originate_timeout=15" ..
    ",hangup_after_bridge=true" ..
    "}sofia/gateway/bulkvs/" .. dest
)

if new_session and new_session:ready() then
    freeswitch.consoleLog("INFO", "[TEST] Session created, running local_shaken.lua\n")

    -- Run the signing script on this session
    new_session:execute("lua", "local_shaken.lua")

    -- Log what happened
    local identity = new_session:getVariable("sip_h_Identity") or "NOT SET"
    freeswitch.consoleLog("INFO", "[TEST] Identity header: " .. identity:sub(1, 80) .. "...\n")

    -- Let it ring for a few seconds then hangup
    new_session:sleep(5000)
    new_session:hangup("NORMAL_CLEARING")
    freeswitch.consoleLog("INFO", "[TEST] Call completed\n")
else
    freeswitch.consoleLog("ERR", "[TEST] Failed to create session\n")
end
