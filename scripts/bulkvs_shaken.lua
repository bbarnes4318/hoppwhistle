--[[
  bulkvs_shaken.lua — BulkVS STIR/SHAKEN STI-AS Signing Hook
  Uses system curl (injected into container) for HTTP POST.
  Runs before bridge in vapi_outbound context.
  On failure: logs error, call proceeds unsigned (never drops).
]]

local API_ID  = "1ec857c693e7890f223a74a8a902fb48"
local API_KEY = "807aad51f99255c416e18e07beae64b7"
local API_URL = "https://stir.bulkvs.com/stir/v1/signing?id=" .. API_ID .. "&key=" .. API_KEY

local function generate_uuid()
    local t = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
    return string.gsub(t, "[xy]", function(c)
        local v = (c == "x") and math.random(0, 15) or math.random(8, 11)
        return string.format("%x", v)
    end)
end

local function to_e164(num)
    if not num then return nil end
    num = string.gsub(num, "[^%d]", "")
    if #num == 10 then num = "1" .. num end
    if #num == 11 and string.sub(num, 1, 1) == "1" then return "+" .. num end
    return nil
end

local function sign_call(session)
    local dest_raw = session:getVariable("destination_number") or ""
    local cid_raw  = session:getVariable("effective_caller_id_number")
                  or session:getVariable("outbound_caller_id_number")
                  or session:getVariable("caller_id_number") or ""

    local dest_e164 = to_e164(dest_raw)
    local orig_e164 = to_e164(cid_raw)

    if not dest_e164 or not orig_e164 then
        freeswitch.consoleLog("WARNING", "[SHAKEN] Invalid numbers: dest=" .. dest_raw .. " orig=" .. cid_raw .. "\n")
        return
    end

    local iat    = os.time()
    local origid = generate_uuid()

    local payload = string.format(
        '{"signingRequest":{"attest":"A","dest":{"tn":["%s"]},"orig":{"tn":"%s"},"iat":%d,"origid":"%s"}}',
        dest_e164, orig_e164, iat, origid
    )

    freeswitch.consoleLog("INFO", "[SHAKEN] Signing: " .. orig_e164 .. " -> " .. dest_e164 .. "\n")

    -- System curl: -s silent, -m 2 timeout, -X POST
    local cmd = string.format(
        "curl -s -m 2 -X POST '%s' -H 'Content-Type: application/json' -d '%s'",
        API_URL, payload
    )

    local handle = io.popen(cmd)
    if not handle then
        freeswitch.consoleLog("ERR", "[SHAKEN] Failed to execute curl\n")
        return
    end
    local body = handle:read("*a")
    handle:close()

    if not body or body == "" then
        freeswitch.consoleLog("ERR", "[SHAKEN] Empty response from BulkVS API\n")
        return
    end

    freeswitch.consoleLog("INFO", "[SHAKEN] Response (" .. #body .. " bytes): " .. string.sub(body, 1, 150) .. "\n")

    -- Parse identity from response
    local identity = nil
    if string.sub(body, 1, 1) == "{" then
        identity = string.match(body, '"identity"%s*:%s*"([^"]+)"')
        if not identity then
            identity = string.match(body, '"token"%s*:%s*"([^"]+)"')
        end
        if not identity then
            freeswitch.consoleLog("ERR", "[SHAKEN] Cannot parse: " .. string.sub(body, 1, 300) .. "\n")
            return
        end
    else
        -- Plain text response — use entire body as Identity header
        identity = string.gsub(body, "^%s+", "")
        identity = string.gsub(identity, "%s+$", "")
    end

    if identity and #identity > 10 then
        session:setVariable("sip_h_Identity", identity)
        freeswitch.consoleLog("INFO", "[SHAKEN] Identity header SET (" .. #identity .. " chars)\n")
    else
        freeswitch.consoleLog("ERR", "[SHAKEN] Token too short or invalid\n")
    end
end

math.randomseed(os.time() + (tonumber(tostring({}):sub(8)) or 0))

local ok, err = pcall(sign_call, session)
if not ok then
    freeswitch.consoleLog("ERR", "[SHAKEN] Lua error (call proceeds unsigned): " .. tostring(err) .. "\n")
end
