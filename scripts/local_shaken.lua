-- local_shaken.lua (optimized - single shell command)
-- Local STIR/SHAKEN signing using PVN LLC carrier keys (ES256/P-256)
-- Optimized: single io.popen call with shell pipeline

local PRIVATE_KEY = "/etc/freeswitch/stir-shaken/private.key"
local CERT_URL = "https://hopwhistle.com/.well-known/stir-shaken/252L-20250710.crt"

local function sign_call()
    if not session then return end

    local caller = session:getVariable("effective_caller_id_number") or session:getVariable("caller_id_number")
    local dest = session:getVariable("destination_number")
    if not caller or not dest then return end

    -- Format E.164
    caller = caller:gsub("[^%d]", "")
    if #caller == 10 then caller = "1" .. caller end
    caller = "+" .. caller

    dest = dest:gsub("[^%d]", "")
    if #dest == 10 then dest = "1" .. dest end
    dest = "+" .. dest

    local iat = os.time()

    -- Read UUID
    local uf = io.open("/proc/sys/kernel/random/uuid", "r")
    local origid = uf and uf:read("*l"):upper() or "00000000-0000-0000-0000-000000000000"
    if uf then uf:close() end

    freeswitch.consoleLog("INFO", "[SHAKEN] Signing: " .. caller .. " -> " .. dest .. "\n")

    -- Build header and payload JSON
    local header = '{"alg":"ES256","ppt":"shaken","typ":"passport","x5u":"' .. CERT_URL .. '"}'
    local payload = '{"attest":"A","dest":{"tn":["' .. dest .. '"]},"iat":' .. iat .. ',"orig":{"tn":"' .. caller .. '"},"origid":"' .. origid .. '"}'

    -- Single shell command: base64url encode header, payload, sign, base64url encode sig, output all
    local cmd = string.format(
        [[sh -c 'H=$(printf "%%s" %q | /usr/bin/openssl base64 -A | tr "+/" "-_" | tr -d "="); P=$(printf "%%s" %q | /usr/bin/openssl base64 -A | tr "+/" "-_" | tr -d "="); SIG=$(printf "%%s" "${H}.${P}" | /usr/bin/openssl dgst -sha256 -sign %s -binary | /usr/bin/openssl base64 -A | tr "+/" "-_" | tr -d "="); echo "${H}.${P}.${SIG}"' 2>/dev/null]],
        header, payload, PRIVATE_KEY
    )

    local p = io.popen(cmd)
    local result = p:read("*a")
    p:close()

    if not result or result == "" or not result:find("%..*%.") then
        freeswitch.consoleLog("ERR", "[SHAKEN] Signing failed\n")
        return
    end

    result = result:gsub("%s+$", "")  -- trim trailing whitespace

    -- Build Identity header
    local identity = result .. ";info=<" .. CERT_URL .. ">;alg=ES256;ppt=shaken"

    -- Export Identity ONLY to B-leg using nolocal (prevents A-leg duplication)
    -- Do NOT use setVariable("sip_h_Identity") — that copies to both legs
    session:execute("export", "nolocal:sip_h_Identity=" .. identity)
    freeswitch.consoleLog("INFO", "[SHAKEN] SUCCESS signed (" .. #identity .. " bytes)\n")
end

local ok, err = pcall(sign_call)
if not ok then
    freeswitch.consoleLog("ERR", "[SHAKEN] Error: " .. tostring(err) .. "\n")
end
