-- Excerpt of apps/freeswitch/scripts/inbound_route.lua, Step 4 (bridge + post-bridge), one failover step.
local function log(level, msg) freeswitch.consoleLog(level, "[RIG-INBOUND] " .. msg .. "\n") end
local rescue_enabled = true
local hangup_after_bridge_value = rescue_enabled and "false" or "true"
local AGENT_LEG_DIED = { RECOVERY_ON_TIMER_EXPIRE = true, MEDIA_TIMEOUT = true, NETWORK_OUT_OF_ORDER = true, NETWORK_ERROR = true }
session:execute("ring_ready")
session:setVariable("hangup_after_bridge", hangup_after_bridge_value)
session:setVariable("continue_on_fail", "true")
session:execute("record_session", "/tmp/in_" .. session:get_uuid() .. ".wav")
local bridge_string = "sofia/external/agentin@ph:5080"
session:execute("bridge", bridge_string)
--GUARD--
if rescue_enabled and session:answered() and session:ready() then
    local bcause = session:getVariable("bridge_hangup_cause") or session:getVariable("last_bridge_hangup_cause") or ""
    if AGENT_LEG_DIED[bcause] then
        log("WARNING", "agent leg died, re-ringing")
        session:execute("bridge", bridge_string)
    end
end
if session:answered() then
    log("INFO", "answered, releasing caller")
    if rescue_enabled and session:ready() then
        session:hangup("NORMAL_CLEARING")
    end
end
log("INFO", "Step 5: CDR posted, hangup_cause=" .. (session:getVariable("hangup_cause") or ""))
