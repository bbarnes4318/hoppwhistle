--[[
  local_shaken.lua — Local STIR/SHAKEN A-attestation signing + CID validation
  PVN LLC carrier-level signing with ES256 using our own private key.

  This script:
    1. Validates outbound caller ID against the BulkVS DID pool
    2. Forces a valid CID on all outbound channel variables
    3. Builds an RFC 8225 PASSporT token (header.payload.signature)
    4. Sets the Identity header on the session for the B-leg INVITE

  Runs BEFORE bridge in vapi_outbound context.
  On any failure: logs error, call proceeds unsigned (never drops a call).
]]

-- === CONFIGURATION ===
local PRIVATE_KEY = "/etc/freeswitch/stir-shaken/private.key"
local CERT_URL    = "https://hopwhistle.com/.well-known/stir-shaken/252L-20250710.crt"
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

-- === HELPERS ===

local function generate_uuid()
    local t = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
    return string.upper(string.gsub(t, "[xy]", function(c)
        local v = (c == "x") and math.random(0, 15) or math.random(8, 11)
        return string.format("%x", v)
    end))
end

-- Normalize to 11-digit US format (1 + 10 digits)
local function normalize_11(num)
    if not num then return nil end
    num = num:gsub("[^%d]", "")
    if #num == 10 then num = "1" .. num end
    if #num == 11 and num:sub(1, 1) == "1" then return num end
    return nil
end

-- === MAIN ===

local function sign_and_set_cid(session)
    if not session then return end

    -- ── CID VALIDATION ──────────────────────────────────────────────
    local caller = session:getVariable("effective_caller_id_number")
                or session:getVariable("caller_id_number")
    if not caller or caller == "" then caller = DEFAULT_DID end

    caller = caller:gsub("[^%d]", "")
    if #caller == 10 then caller = "1" .. caller end

    if not DID_POOL[caller] then
        freeswitch.consoleLog("WARNING",
            "[SHAKEN] CID " .. caller .. " not in DID pool, forcing " .. DEFAULT_DID .. "\n")
        caller = DEFAULT_DID
    end

    -- Force all outbound caller ID fields to the validated DID
    session:setVariable("effective_caller_id_number", caller)
    session:setVariable("effective_caller_id_name", "PVN LLC")
    session:setVariable("outbound_caller_id_number", caller)
    session:setVariable("outbound_caller_id_name", "PVN LLC")
    session:setVariable("sip_from_user", caller)
    session:setVariable("sip_contact_user", caller)

    -- Export CID to B-leg so bridge inherits them
    session:execute("export", "nolocal:effective_caller_id_number=" .. caller)
    session:execute("export", "nolocal:outbound_caller_id_number=" .. caller)
    session:execute("export", "nolocal:sip_from_user=" .. caller)

    freeswitch.consoleLog("INFO", "[SHAKEN] CID validated: " .. caller .. "\n")

    -- ── STIR/SHAKEN SIGNING ─────────────────────────────────────────

    -- Check that the private key exists before attempting to sign
    local key_check = io.open(PRIVATE_KEY, "r")
    if not key_check then
        freeswitch.consoleLog("ERR",
            "[SHAKEN] Private key not found at " .. PRIVATE_KEY .. " — call proceeds unsigned\n")
        return
    end
    key_check:close()

    local dest_raw = session:getVariable("destination_number") or ""
    local dest = normalize_11(dest_raw)
    local orig = normalize_11(caller)

    if not dest or not orig then
        freeswitch.consoleLog("ERR",
            "[SHAKEN] Cannot normalize TNs: dest=" .. dest_raw .. " orig=" .. caller .. " — unsigned\n")
        return
    end

    local iat    = os.time()
    local origid = generate_uuid()

    -- Build PASSporT header and payload as compact JSON
    local header  = '{"alg":"ES256","ppt":"shaken","typ":"passport","x5u":"' .. CERT_URL .. '"}'
    local payload = '{"attest":"A","dest":{"tn":["+' .. dest .. '"]},"iat":' .. iat
                 .. ',"orig":{"tn":"+' .. orig .. '"},"origid":"' .. origid .. '"}'

    freeswitch.consoleLog("INFO",
        "[SHAKEN] Signing: +" .. orig .. " -> +" .. dest .. " origid=" .. origid .. "\n")

    -- Single shell pipeline: base64url encode header + payload, then ES256 sign
    -- Uses /usr/bin/openssl for all crypto operations in one io.popen() call
    local cmd = string.format(
        [[sh -c 'H=$(printf "%%s" %q | /usr/bin/openssl base64 -A | tr "+/" "-_" | tr -d "="); ]]
     .. [[P=$(printf "%%s" %q | /usr/bin/openssl base64 -A | tr "+/" "-_" | tr -d "="); ]]
     .. [[SIG=$(printf "%%s" "${H}.${P}" | /usr/bin/openssl dgst -sha256 -sign %s -binary ]]
     .. [[| /usr/bin/openssl base64 -A | tr "+/" "-_" | tr -d "="); ]]
     .. [[echo "${H}.${P}.${SIG}"' 2>/dev/null]],
        header, payload, PRIVATE_KEY
    )

    local p = io.popen(cmd)
    if not p then
        freeswitch.consoleLog("ERR", "[SHAKEN] Failed to execute openssl pipeline — unsigned\n")
        return
    end
    local token = p:read("*a")
    p:close()

    if not token or #token < 20 then
        freeswitch.consoleLog("ERR",
            "[SHAKEN] Signing produced empty/short token (" .. tostring(token) .. ") — unsigned\n")
        return
    end

    -- Trim whitespace
    token = token:gsub("^%s+", ""):gsub("%s+$", "")

    -- Build full Identity header value per RFC 8225
    local identity = token .. ";info=<" .. CERT_URL .. ">;alg=ES256;ppt=shaken"

    -- Set Identity header on session — bridge command includes sip_h_ vars in B-leg INVITE
    session:setVariable("sip_h_Identity", identity)

    freeswitch.consoleLog("INFO",
        "[SHAKEN] Identity header SET (" .. #identity .. " chars) — call is signed\n")
end

-- Seed RNG for UUID generation
math.randomseed(os.time() + (tonumber(tostring({}):sub(8)) or 0))

-- Execute with pcall — production safety: never drop a call due to signing failure
local ok, err = pcall(sign_and_set_cid, session)
if not ok then
    freeswitch.consoleLog("ERR",
        "[SHAKEN] Lua error (call proceeds unsigned): " .. tostring(err) .. "\n")
end
