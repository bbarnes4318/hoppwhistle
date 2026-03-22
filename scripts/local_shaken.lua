-- local_shaken.lua
-- Validates caller ID against BulkVS DID pool and forces correct outbound CID.
-- BulkVS handles STIR/SHAKEN signing on their end — we do NOT add an Identity
-- header because BulkVS adds their own, and duplicates cause 400 rejection.

local DEFAULT_DID = "12816989460"

-- BulkVS DID pool — ONLY these numbers are valid for outbound caller ID
local DID_POOL = {
    ["12816989460"] = true, ["12816989461"] = true,
    ["14063165877"] = true, ["14402992856"] = true,
    ["14402992860"] = true, ["16102819660"] = true,
    ["16102819662"] = true, ["17038313168"] = true,
    ["17042283589"] = true, ["17042286088"] = true,
    ["18036135410"] = true, ["18036135412"] = true,
    ["19124185540"] = true, ["19124185542"] = true,
    ["19542083921"] = true, ["19542083922"] = true,
}

local function fix_caller_id()
    if not session then return end

    local caller = session:getVariable("effective_caller_id_number")
                or session:getVariable("caller_id_number")
    if not caller then return end

    -- Strip to digits and normalize to 11-digit format
    caller = caller:gsub("[^%d]", "")
    if #caller == 10 then caller = "1" .. caller end

    -- Validate caller is in our DID pool — if not, use default
    if not DID_POOL[caller] then
        freeswitch.consoleLog("WARNING",
            "[CID] caller " .. caller .. " not in DID pool, using " .. DEFAULT_DID .. "\n")
        caller = DEFAULT_DID
    end

    -- Force all outbound caller ID fields
    session:setVariable("effective_caller_id_number", caller)
    session:setVariable("effective_caller_id_name", "PVN LLC")
    session:setVariable("outbound_caller_id_number", caller)
    session:setVariable("outbound_caller_id_name", "PVN LLC")
    session:setVariable("sip_from_user", caller)
    session:setVariable("sip_contact_user", caller)

    -- Export to B-leg so bridge inherits them
    session:execute("export", "nolocal:effective_caller_id_number=" .. caller)
    session:execute("export", "nolocal:outbound_caller_id_number=" .. caller)
    session:execute("export", "nolocal:sip_from_user=" .. caller)

    freeswitch.consoleLog("INFO", "[CID] Set outbound CID=" .. caller .. "\n")
end

local ok, err = pcall(fix_caller_id)
if not ok then
    freeswitch.consoleLog("ERR", "[CID] Error: " .. tostring(err) .. "\n")
end
