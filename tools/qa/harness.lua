-- Load via mGBA: Tools > Scripting > File > Load script.
-- Polls qa/command.txt; each command block starts with "#<sequence>" and results go to qa/status.txt.
local QA_DIR = "/Users/kijtisakp/Documents/dev/owner/pokeemerald-th/tools/qa/"
local COMMAND_FILE = QA_DIR .. "command.txt"
local STATUS_FILE = QA_DIR .. "status.txt"
local POLL_FRAMES = 15

local KEYS = {
  A = C.GBA_KEY.A, B = C.GBA_KEY.B, SELECT = C.GBA_KEY.SELECT, START = C.GBA_KEY.START,
  RIGHT = C.GBA_KEY.RIGHT, LEFT = C.GBA_KEY.LEFT, UP = C.GBA_KEY.UP, DOWN = C.GBA_KEY.DOWN,
  R = C.GBA_KEY.R, L = C.GBA_KEY.L,
}

local lastSequence = nil
local queue = {}
local waitFrames = 0
local heldMask = 0
local frame = 0

local function writeStatus(text)
  local file = io.open(STATUS_FILE, "w")
  if file then
    file:write(text)
    file:close()
  end
end

local function readCommands()
  local file = io.open(COMMAND_FILE, "r")
  if not file then return end
  local content = file:read("*a")
  file:close()
  local sequence = content:match("^#(%S+)")
  if not sequence or sequence == lastSequence then return end
  lastSequence = sequence
  queue = {}
  for line in content:gmatch("[^\n]+") do
    if not line:match("^#") then table.insert(queue, line) end
  end
  table.insert(queue, "done " .. sequence)
end

local function keyMask(names)
  local mask = 0
  for name in names:gmatch("[^+]+") do
    local key = KEYS[name:upper()]
    if key then mask = mask | (1 << key) end
  end
  return mask
end

local function runCommand(line)
  local verb, rest = line:match("^(%S+)%s*(.*)$")
  if verb == "press" then
    local names, frames = rest:match("^(%S+)%s*(%d*)$")
    heldMask = keyMask(names)
    waitFrames = tonumber(frames) or 6
    emu:setKeys(heldMask)
    table.insert(queue, 1, "release")
  elseif verb == "release" then
    heldMask = 0
    emu:setKeys(0)
    waitFrames = 4
  elseif verb == "wait" then
    waitFrames = tonumber(rest) or 1
  elseif verb == "shot" then
    emu:screenshot(rest)
  elseif verb == "save" then
    emu:saveStateSlot(tonumber(rest))
  elseif verb == "load" then
    emu:loadStateSlot(tonumber(rest))
  elseif verb == "dump" then
    local address, length, path = rest:match("^(%S+)%s+(%d+)%s+(%S+)$")
    local file = io.open(path, "wb")
    if file then
      local base = tonumber(address)
      for offset = 0, tonumber(length) - 1 do
        file:write(string.char(emu:read8(base + offset)))
      end
      file:close()
    end
  elseif verb == "reset" then
    emu:reset()
    waitFrames = 30
  elseif verb == "done" then
    writeStatus("done " .. rest .. "\n")
  end
end

callbacks:add("frame", function()
  frame = frame + 1
  if heldMask ~= 0 then emu:setKeys(heldMask) end
  if waitFrames > 0 then
    waitFrames = waitFrames - 1
    return
  end
  if #queue > 0 then
    runCommand(table.remove(queue, 1))
  elseif frame % POLL_FRAMES == 0 then
    readCommands()
  end
end)

writeStatus("ready\n")
console:log("QA harness ready")
