local start_time = os.time()
session:answer()
session:execute("sleep", "500")

local callee = session:getVariable("destination_number")
local call_id = session:getVariable("uuid")

-- Play & Record
session:execute("playback", "/opt/hopwhistle/alex.wav")
session:execute("record", "/opt/hopwhistle/temp_res.wav 5")

-- Drop Data for AI Brain
local data = '{"number":"' .. callee .. '", "call_id":"' .. call_id .. '", "timestamp":"' .. os.date("!%Y-%m-%dT%H:%M:%SZ") .. '"}'
local f = io.open("/opt/hopwhistle/need_check.json", "w")
f:write(data)
f:close()

-- Wait for AI Result
local result = "NEGATIVE"
for i=1, 20 do
    session:sleep(500)
    local rf = io.open("/opt/hopwhistle/result.txt", "r")
    if rf then
        result = rf:read("*a")
        rf:close()
        os.execute("rm /opt/hopwhistle/result.txt")
        break
    end
end

-- Finalizing Duration before Bridge or Hangup
local end_time = os.time()
local duration = os.difftime(end_time, start_time)
-- Store duration in a temp file for the AI listener to grab
local df = io.open("/opt/hopwhistle/duration.txt", "w")
df:write(tostring(duration))
df:close()

if string.find(result, "HUMAN_POSITIVE") then
    session:execute("bridge", "{origination_caller_id_number=14847258288}sofia/internal/14847258288@sip.telnyx.com")
else
    session:hangup()
end
