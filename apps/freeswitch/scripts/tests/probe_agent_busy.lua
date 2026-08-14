--[[
  probe_agent_busy.lua — read-only production probe.

  Loads the agent-busy block out of a candidate/installed inbound_route.lua,
  wires it to the REAL FreeSWITCH API, and reports what the gate would decide
  right now for each extension passed on the command line.

  Run: fs_cli -x "lua probe_agent_busy.lua <script-path> 1000 1005 1014 1016"
]]

local SCRIPT = (argv and argv[1]) or "/usr/share/freeswitch/scripts/inbound_route.lua"

local out = {}
local function emit(s) table.insert(out, s) end
local function finish()
  local report = table.concat(out, "\n") .. "\n"
  if stream then stream:write(report) else freeswitch.consoleLog("INFO", "\n" .. report) end
end

local fh = io.open(SCRIPT, "r")
if not fh then emit("cannot open " .. SCRIPT); finish(); return end
local source = fh:read("*a")
fh:close()

local block = string.match(source, "%-%- ##AGENT_BUSY_BEGIN##(.-)%-%- ##AGENT_BUSY_END##")
if not block then emit("markers not found in " .. SCRIPT); finish(); return end

local loader = load or loadstring
local chunk, err = loader(
  "local api = REAL_API\n" .. block ..
  "\nreturn { live_channel_rows = live_channel_rows, agent_channel_count = agent_channel_count, AGENT_MAX_CONCURRENT = AGENT_MAX_CONCURRENT }",
  "agent_busy_block")
if not chunk then emit("block failed to compile: " .. tostring(err)); finish(); return end

REAL_API = freeswitch.API()
local M = chunk()

local api = freeswitch.API()
local rows = M.live_channel_rows()
emit(string.format("live channels parsed: %d   (limit %d call(s) per agent)", #rows, M.AGENT_MAX_CONCURRENT))
for _, f in ipairs(rows) do
  emit(string.format("  %-38s dir=%-8s cid=%-14s name=%s", f[1] or "?", f[2] or "?", f[8] or "?", f[5] or "?"))
end

local exts = {}
for i = 2, 12 do
  if argv and argv[i] then table.insert(exts, argv[i]) end
end
if #exts == 0 then exts = { "1000", "1005", "1014", "1016" } end

emit("")
for _, ext in ipairs(exts) do
  local contact = ""
  for _, dom in ipairs({ "hopwhistle.com", "aivoice.hopwhistle.com", "localhost" }) do
    local res = api:execute("sofia_contact", "internal/" .. ext .. "@" .. dom) or ""
    if res ~= "" and not string.match(res, "^error") then contact = res break end
  end
  local n = M.agent_channel_count(ext, (contact ~= "" and contact or nil), rows, "probe-not-a-real-uuid")
  emit(string.format("  ext %-6s registered=%-5s livecalls=%d  -> %s",
    ext, tostring(contact ~= ""), n,
    (n >= M.AGENT_MAX_CONCURRENT) and "BUSY (would NOT ring)" or "free (would ring)"))
end

finish()
