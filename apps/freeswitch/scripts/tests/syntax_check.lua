local path = (argv and argv[1]) or "/usr/share/freeswitch/scripts/inbound_route.lua"
local f, e = loadfile(path)
local msg
if f then
  msg = "SYNTAX OK: " .. path
else
  msg = "SYNTAX ERROR in " .. path .. ": " .. tostring(e)
end
if stream then stream:write(msg .. "\n") else freeswitch.consoleLog("INFO", msg .. "\n") end
