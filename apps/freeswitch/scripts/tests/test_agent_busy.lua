--[[
  test_agent_busy.lua — unit tests for the agent-busy gate in inbound_route.lua

  Loads the real ##AGENT_BUSY_BEGIN##/##AGENT_BUSY_END## block out of the
  shipped script (no copy of the logic lives here, so it cannot drift) and
  exercises it against captured `show channels as delim |` output.

  Run:  fs_cli -x "lua test_agent_busy.lua"
]]

-- Defaults to the installed script; pass a path to test a candidate first:
--   fs_cli -x "lua test_agent_busy.lua /usr/share/freeswitch/scripts/candidate.lua"
local SCRIPT = (argv and argv[1]) or "/usr/share/freeswitch/scripts/inbound_route.lua"

local out_lines = {}
local function emit(s)
  table.insert(out_lines, s)
end

-- ── Load the block under test ───────────────────────────────────────────────
local fh = io.open(SCRIPT, "r")
if not fh then
  emit("FAIL: cannot open " .. SCRIPT)
  if stream then stream:write(table.concat(out_lines, "\n") .. "\n") end
  return
end
local source = fh:read("*a")
fh:close()

local block = string.match(source, "%-%- ##AGENT_BUSY_BEGIN##(.-)%-%- ##AGENT_BUSY_END##")
if not block then
  emit("FAIL: AGENT_BUSY markers not found in " .. SCRIPT)
  if stream then stream:write(table.concat(out_lines, "\n") .. "\n") end
  return
end

-- Stub `api` so the block sees whatever channel table (and whatever
-- global_getvar settings) a test wants.
local stub_output = ""
local stub_globals = {}
local prelude = [[
local api = { execute = function(self, cmd, arg)
  if cmd == "global_getvar" then return STUB_GLOBAL_FN(arg) end
  return STUB_OUTPUT_FN()
end }
]]
local epilogue = [[
return {
  live_channel_rows = live_channel_rows,
  agent_channel_count = agent_channel_count,
  AGENT_BUSY_CHECK = AGENT_BUSY_CHECK,
  AGENT_MAX_CONCURRENT = AGENT_MAX_CONCURRENT,
}
]]

local chunk_src = prelude .. block .. epilogue
local loader = load or loadstring
local chunk, err = loader(chunk_src, "agent_busy_block")
if not chunk then
  emit("FAIL: block does not compile: " .. tostring(err))
  if stream then stream:write(table.concat(out_lines, "\n") .. "\n") end
  return
end

-- Expose the stub hooks to the chunk's environment.
STUB_OUTPUT_FN = function() return stub_output end
STUB_GLOBAL_FN = function(name) return stub_globals[name] or "" end

-- The block reads its settings at load time, so rebuild it per settings case.
local function build(globals)
  stub_globals = globals or {}
  return chunk()
end

local M = build({})

-- ── Captured fixtures ───────────────────────────────────────────────────────
local HEADER = "uuid|direction|created|created_epoch|name|state|cid_name|cid_num|ip_addr|dest|application|application_data|dialplan|context|read_codec|read_rate|read_bit_rate|write_codec|write_rate|write_bit_rate|secure|hostname|presence_id|presence_data|accountcode|callstate|callee_name|callee_num|callee_direction|call_uuid|sent_callee_name|sent_callee_num|initial_cid_name|initial_cid_num|initial_ip_addr|initial_dest|initial_dialplan|initial_context"

-- Real output captured from production while ext 1016 was on a call.
-- Note the A-leg's application_data embeds BOTH agents' contacts *and* the "|"
-- delimiter — the classic false-positive trap.
local LIVE_1016_BUSY = HEADER .. "\n" ..
"180e69b7-35c6-423e-b3b8-e392833809aa|inbound|2026-07-31 17:49:52|1785520192|sofia/external/4233398241@149.28.118.163|CS_EXECUTE|14233398241|4233398241|14.1.29.150|2294222208|bridge|{sip_cid_type=pid,sip_from_user=12294222208}sofia/internal/sip:ndo3q0td@ar9qgtd8pqfa.invalid;transport=ws,sofia/internal/sip:772imqpe@u2b3hhe1hq5v.invalid;transport=ws|XML|public|PCMU|8000|64000|PCMU|8000|64000||9994a435bee8||||ACTIVE|Outbound Call|772imqpe|SEND|180e69b7-35c6-423e-b3b8-e392833809aa\n" ..
"f8000fa2-be88-40a5-ae8d-085266e6841e|outbound|2026-07-31 17:49:52|1785520192|sofia/internal/772imqpe@u2b3hhe1hq5v.invalid|CS_EXCHANGE_MEDIA|Hopwhistle|12294222208|14.1.29.150|772imqpe|||XML|public|PCMU|8000|64000|PCMU|8000|64000|srtp:dtls|9994a435bee8||||ACTIVE|Outbound Call|772imqpe|SEND|180e69b7-35c6-423e-b3b8-e392833809aa\n" ..
"\n2 total.\n"

local CONTACT_1016 = "sofia/internal/sip:772imqpe@u2b3hhe1hq5v.invalid;transport=ws;fs_nat=yes;fs_path=sip%3A772imqpe%40108.177.136.58%3A14711%3Btransport%3Dwss"
local CONTACT_1014 = "sofia/internal/sip:ndo3q0td@ar9qgtd8pqfa.invalid;transport=ws;fs_nat=yes;fs_path=sip%3Ando3q0td%4045.38.18.234%3A54943%3Btransport%3Dwss"

-- Agent dialling out from their softphone (a-leg named after the extension).
local AGENT_OUTBOUND = HEADER .. "\n" ..
"aaaa1111-0000-0000-0000-000000000001|inbound|2026-07-31 18:02:00|1785520920|sofia/internal/1016@hopwhistle.com|CS_EXECUTE|Hopwhistle|1016|24.192.38.87|18005551212|bridge|sofia/gateway/fractel1/18005551212|XML|default\n" ..
"\n1 total.\n"

-- A PSTN caller whose caller ID merely *contains* the extension digits.
local LOOKALIKE_CID = HEADER .. "\n" ..
"bbbb2222-0000-0000-0000-000000000002|inbound|2026-07-31 18:03:00|1785520980|sofia/external/13015551016@1.2.3.4|CS_EXECUTE|13015551016|13015551016|1.2.3.4|2294222208|bridge|x|XML|public\n" ..
"\n1 total.\n"

-- The agent's previous call is tearing down — they are free for the next one.
local TEARDOWN = HEADER .. "\n" ..
"cccc3333-0000-0000-0000-000000000003|outbound|2026-07-31 18:04:00|1785521040|sofia/internal/772imqpe@u2b3hhe1hq5v.invalid|CS_HANGUP|Hopwhistle|12294222208|14.1.29.150|772imqpe|||XML|public\n" ..
"\n1 total.\n"

-- A softphone with a call on hold is still occupied.
local ON_HOLD = HEADER .. "\n" ..
"dddd4444-0000-0000-0000-000000000004|outbound|2026-07-31 18:05:00|1785521100|sofia/internal/772imqpe@u2b3hhe1hq5v.invalid|CS_CONSUME_MEDIA|Hopwhistle|12294222208|14.1.29.150|772imqpe|||XML|public\n" ..
"\n1 total.\n"

local EMPTY = HEADER .. "\n\n0 total.\n"

-- ── Assertions ──────────────────────────────────────────────────────────────
local pass, fail = 0, 0
local function check(name, got, want)
  if got == want then
    pass = pass + 1
    emit(string.format("  ok   %-58s (%s)", name, tostring(got)))
  else
    fail = fail + 1
    emit(string.format("  FAIL %-58s got=%s want=%s", name, tostring(got), tostring(want)))
  end
end

local function count(output, ext, contact, self_uuid)
  stub_output = output
  return M.agent_channel_count(ext, contact, M.live_channel_rows(), self_uuid)
end

emit("agent-busy gate")
check("defaults: check enabled", M.AGENT_BUSY_CHECK, true)
check("defaults: limit is 1 call", M.AGENT_MAX_CONCURRENT, 1)

check("busy agent counted from its contact b-leg",
  count(LIVE_1016_BUSY, "1016", CONTACT_1016, "new-call-uuid"), 1)
check("idle agent in same ring group stays free",
  count(LIVE_1016_BUSY, "1014", CONTACT_1014, "new-call-uuid"), 0)
check("contacts inside application_data are not counted",
  count(LIVE_1016_BUSY, "1014", nil, "new-call-uuid"), 0)
check("empty channel table",
  count(EMPTY, "1016", CONTACT_1016, "new-call-uuid"), 0)
check("agent's own outbound call marks them busy",
  count(AGENT_OUTBOUND, "1016", nil, "new-call-uuid"), 1)
check("outbound call does not mark a different agent busy",
  count(AGENT_OUTBOUND, "1014", CONTACT_1014, "new-call-uuid"), 0)
check("PSTN caller ID containing extension digits is ignored",
  count(LOOKALIKE_CID, "1016", CONTACT_1016, "new-call-uuid"), 0)
check("our own A-leg never marks the destination busy",
  count(LIVE_1016_BUSY, "1016", CONTACT_1016, "f8000fa2-be88-40a5-ae8d-085266e6841e"), 0)
check("a call in teardown does not hold the agent busy",
  count(TEARDOWN, "1016", CONTACT_1016, "new-call-uuid"), 0)
check("a held / non-media call still counts as busy",
  count(ON_HOLD, "1016", CONTACT_1016, "new-call-uuid"), 1)
check("fail-open when the channel table cannot be read",
  count("-ERR no reply", "1016", CONTACT_1016, "new-call-uuid"), 0)
check("fail-open on empty api output",
  count("", "1016", CONTACT_1016, "new-call-uuid"), 0)

-- Runtime overrides via `fs_cli -x "global_setvar ..."`.
local off = build({ agent_busy_check = "false" })
check("global_setvar agent_busy_check=false disables the gate", off.AGENT_BUSY_CHECK, false)
local raised = build({ agent_max_concurrent_calls = "2" })
check("global_setvar agent_max_concurrent_calls=2 raises the limit", raised.AGENT_MAX_CONCURRENT, 2)
local floored = build({ agent_max_concurrent_calls = "0" })
check("a limit below 1 is clamped to 1", floored.AGENT_MAX_CONCURRENT, 1)
local garbage = build({ agent_max_concurrent_calls = "banana" })
check("an unparseable limit falls back to 1", garbage.AGENT_MAX_CONCURRENT, 1)
M = build({})

emit(string.format("%d passed, %d failed", pass, fail))

local report = table.concat(out_lines, "\n") .. "\n"
if stream then
  stream:write(report)
else
  freeswitch.consoleLog("INFO", "\n" .. report)
end
