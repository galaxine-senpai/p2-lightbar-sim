-- Minimal Garry's Mod / Photon2 compatibility shim.
-- Provides just enough of the GLua standard library extensions and Photon2
-- authoring API surface for library component/vehicle files to execute
-- top-to-bottom and produce their declarative data tables. This does NOT
-- attempt to reproduce runtime engine behavior (rendering, networking) --
-- only the pure-data authoring layer.

CLIENT = true
SERVER = false
SHARED = true

-- ===== type helpers =====
function istable(v) return type(v) == "table" end
function isnumber(v) return type(v) == "number" end
function isstring(v) return type(v) == "string" end
function isbool(v) return type(v) == "boolean" end
function isfunction(v) return type(v) == "function" end
function isvector(v) return istable(v) and v.__isvector == true end
function isangle(v) return istable(v) and v.__isangle == true end
function IsColor(v) return istable(v) and v.__iscolor == true end

-- ===== string extensions =====
function string.Replace(str, find, replace)
	local out, i = {}, 1
	local fl = #find
	if fl == 0 then return str end
	while true do
		local s = string.find(str, find, i, true)
		if not s then
			out[#out+1] = string.sub(str, i)
			break
		end
		out[#out+1] = string.sub(str, i, s - 1)
		out[#out+1] = replace
		i = s + fl
	end
	return table.concat(out)
end

function string.Trim(str)
	return (string.gsub(str, "^%s*(.-)%s*$", "%1"))
end

function string.Split(str, sep)
	local out = {}
	if sep == "" then
		for c in str:gmatch(".") do out[#out+1] = c end
		return out
	end
	local i = 1
	while true do
		local s, e = string.find(str, sep, i, true)
		if not s then
			out[#out+1] = string.sub(str, i)
			break
		end
		out[#out+1] = string.sub(str, i, s - 1)
		i = e + 1
	end
	return out
end

function string.StartsWith(str, prefix)
	return string.sub(str, 1, #prefix) == prefix
end

function string.StripExtension(str)
	return (string.gsub(str, "%.[^%.]+$", ""))
end

-- ===== table extensions =====
function table.Copy(t, lookup)
	if t == nil then return nil end
	lookup = lookup or {}
	if lookup[t] then return lookup[t] end
	local copy = {}
	lookup[t] = copy
	for k, v in pairs(t) do
		-- Keys are used as-is (GMod's real table.Copy never clones keys,
		-- only values); only recurse into table VALUES.
		if istable(v) then
			copy[k] = table.Copy(v, lookup)
		else
			copy[k] = v
		end
	end
	return setmetatable(copy, getmetatable(t))
end

function table.Merge(dest, source)
	for k, v in pairs(source) do
		if istable(v) and istable(dest[k]) then
			table.Merge(dest[k], v)
		else
			dest[k] = v
		end
	end
	return dest
end

function table.Count(t)
	local n = 0
	for _ in pairs(t) do n = n + 1 end
	return n
end

function table.IsEmpty(t)
	return next(t) == nil
end

function table.Add(dest, source)
	for _, v in ipairs(source) do dest[#dest+1] = v end
	return dest
end

-- ===== math extensions =====
math.Clamp = math.Clamp or function(v, lo, hi)
	if v < lo then return lo end
	if v > hi then return hi end
	return v
end

-- ===== Vector / Angle / Color =====
local VectorMeta = {}
VectorMeta.__index = VectorMeta
VectorMeta.__isvector_meta = true
function VectorMeta:__tostring() return "Vector(" .. self.x .. ", " .. self.y .. ", " .. self.z .. ")" end
function VectorMeta.__mul(a, b)
	if isnumber(b) then return Vector(a.x * b, a.y * b, a.z * b) end
	if isnumber(a) then return Vector(b.x * a, b.y * a, b.z * a) end
	return Vector(a.x * b.x, a.y * b.y, a.z * b.z)
end
function VectorMeta.__add(a, b) return Vector(a.x + b.x, a.y + b.y, a.z + b.z) end
function VectorMeta.__unm(a) return Vector(-a.x, -a.y, -a.z) end

function Vector(x, y, z)
	x = x or 0
	return setmetatable({ x = x, y = y or x, z = z or x, __isvector = true }, VectorMeta)
end

local AngleMeta = {}
AngleMeta.__index = AngleMeta
function AngleMeta:__tostring() return "Angle(" .. self.p .. ", " .. self.y .. ", " .. self.r .. ")" end

function Angle(p, y, r)
	return setmetatable({ p = p or 0, y = y or 0, r = r or 0, __isangle = true }, AngleMeta)
end

local ColorMeta = {}
ColorMeta.__index = ColorMeta
function Color(r, g, b, a)
	return setmetatable({ r = r or 255, g = g or 255, b = b or 255, a = a or 255, __iscolor = true }, ColorMeta)
end

-- ===== PhotonColor =====
-- Faithful re-implementation of lua/photon-v2/meta/color.lua's chainable
-- blend-color builder (verified against source): Negative() sets an
-- inversion flag; Blend() stores the "from" color; Scale() stores a
-- multiplier; GetBlendColor() resolves the final {From=, To=} RGB pair
-- (both inverted/scaled identically), which is what a state's color fields
-- actually store.
local PhotonColorMeta = {}
PhotonColorMeta.__index = PhotonColorMeta

function PhotonColor(r, g, b)
	return setmetatable({ r = r or 255, g = g or 255, b = b or 255, __isphotoncolor = true }, PhotonColorMeta)
end

function PhotonColorMeta:Negative(isNegative)
	self.Inverted = isNegative
	return self
end

function PhotonColorMeta:Blend(color)
	self.BlendColor = color
	return self
end

function PhotonColorMeta:Scale(multiplier)
	self.Multiplier = multiplier
	return self
end

local function applyMul(c, m)
	if not m then return c end
	return { r = c.r * m, g = c.g * m, b = c.b * m }
end

local function applyInv(c, inv)
	if not inv then return c end
	return { r = 255 - c.r, g = 255 - c.g, b = 255 - c.b }
end

function PhotonColorMeta:GetBlendColor()
	local to = { r = self.r, g = self.g, b = self.b }
	local from = self.BlendColor and { r = self.BlendColor.r, g = self.BlendColor.g, b = self.BlendColor.b } or to
	to = applyMul(applyInv(to, self.Inverted), self.Multiplier)
	from = applyMul(applyInv(from, self.Inverted), self.Multiplier)
	return { From = from, To = to, __isblendcolor = true }
end

-- ===== PhotonMaterial =====
PhotonMaterial = {}
function PhotonMaterial.GenerateLightQuad(path)
	return { MaterialName = string.StripExtension(path), Name = string.StripExtension(path), __ismaterial = true }
end
function PhotonMaterial.GenerateWithTemplate(name)
	return { MaterialName = name, Name = name, __ismaterial = true }
end
function PhotonMaterial.New(data)
	data.__ismaterial = true
	return data
end

-- ===== Photon2 authoring API =====
Photon2 = Photon2 or {}

function Photon2.ReloadComponentFile() return false end
function Photon2.ReloadVehicleFile() return false end

-- Populated by the host (JS) before executing a component/vehicle chunk;
-- LibraryComponent()/LibraryVehicle() must return a table the host can read
-- back after the chunk finishes (component files never explicitly `return`
-- their table -- they mutate it in place).
--
-- A handful of files define MULTIPLE components in one file: they call
-- LibraryComponent(), fill it in, Photon2.RegisterComponent() it, then call
-- LibraryComponent() again for the next sibling (which often inherits from
-- the first via COMPONENT.Base). Each call must return a genuinely FRESH
-- table (so later sections don't corrupt earlier ones' already-set fields).
-- __CAPTURE.Component keeps the FIRST table seen (for the majority of files,
-- which define one component and never call RegisterComponent);
-- __CAPTURE.Components is the ordered list of everything RegisterComponent
-- was handed, so the host can surface every variant.
__CAPTURE = __CAPTURE or {}
__CAPTURE.Components = __CAPTURE.Components or {}

function Photon2.LibraryComponent()
	local t = {}
	if not __CAPTURE.Component then __CAPTURE.Component = t end
	return t
end

function Photon2.LibraryVehicle()
	__CAPTURE.Vehicle = __CAPTURE.Vehicle or {}
	return __CAPTURE.Vehicle
end

function Photon2.RegisterComponent(t)
	if not __CAPTURE.Component then __CAPTURE.Component = t end
	__CAPTURE.Components[#__CAPTURE.Components + 1] = t
end
function Photon2.RegisterVehicle(t) __CAPTURE.Vehicle = t end
function Photon2.RegisterSiren(t) __CAPTURE.Siren = t end
function Photon2.RegisterSchema(t) __CAPTURE.Schema = t end
function Photon2.RegisterCommand(t) end
function Photon2.RegisterInputConfiguration(t) end
function Photon2.RegisterLicensePlate(t) end

function SetClipboardText(t) end

-- Misc GMod globals occasionally referenced (rarely at load time, but a
-- handful of components do call these while computing static data).
function SysTime() return 0 end
local MaterialMeta = {}
MaterialMeta.__index = MaterialMeta
function MaterialMeta:SetInt() return self end
function MaterialMeta:SetFloat() return self end
function MaterialMeta:SetString() return self end
function MaterialMeta:SetTexture() return self end
function MaterialMeta:SetVector() return self end
function MaterialMeta:GetName() return self.Name end
function Material(path)
	return setmetatable({ __ismaterial = true, Name = path }, MaterialMeta)
end
function RealTime() return 0 end
function CurTime() return 0 end
hook = {
	Add = function() end,
	Remove = function() end,
	Call = function() return nil end,
	GetTable = function() return {} end,
}
util = util or {}
util.PixelVisible = util.PixelVisible or function() return 1 end
cvars = cvars or { AddChangeCallback = function() end }
timer = timer or { Simple = function() end, Create = function() end }

Photon2.ComponentBuilder = Photon2.ComponentBuilder or {}
Photon2.SegmentBuilder = Photon2.SegmentBuilder or {}

Photon2.Util = Photon2.Util or {}
function Photon2.Util.UniqueCopy(t)
	return table.Copy(t)
end

-- Ported verbatim from lua/photon-v2/sh_component_builder.lua (a
-- self-contained frame-table generator for federal Signal SignalMaster-style
-- arrow-stick components; pure data, no GMod API calls beyond SequenceBuilder).
function Photon2.SegmentBuilder.SignalMaster(_1, _2, _3, _4, _5, _6, _7, _8)
	local sequence = Photon2.SequenceBuilder.New
	return {
		Frames = {
			[1] = { { _8, "A" } },
			[2] = { { _8, "A" }, { _7, "A" } },
			[3] = { { _8, "A" }, { _7, "A" }, { _6, "A" } },
			[4] = { { _8, "A" }, { _7, "A" }, { _6, "A" }, { _5, "A" } },
			[5] = { { _8, "A" }, { _7, "A" }, { _6, "A" }, { _5, "A" }, { _4, "A" } },
			[6] = { { _8, "A" }, { _7, "A" }, { _6, "A" }, { _5, "A" }, { _4, "A" }, { _3, "A" } },
			[7] = { { _8, "A" }, { _7, "A" }, { _6, "A" }, { _5, "A" }, { _4, "A" }, { _3, "A" }, { _2, "A" } },
			[8] = { { _8, "A" }, { _7, "A" }, { _6, "A" }, { _5, "A" }, { _4, "A" }, { _3, "A" }, { _2, "A" }, { _1, "A" } },
			[9] = { { _1, "A" } },
			[10] = { { _1, "A" }, { _2, "A" } },
			[11] = { { _1, "A" }, { _2, "A" }, { _3, "A" } },
			[12] = { { _1, "A" }, { _2, "A" }, { _3, "A" }, { _4, "A" } },
			[13] = { { _1, "A" }, { _2, "A" }, { _3, "A" }, { _4, "A" }, { _5, "A" } },
			[14] = { { _1, "A" }, { _2, "A" }, { _3, "A" }, { _4, "A" }, { _5, "A" }, { _6, "A" } },
			[15] = { { _1, "A" }, { _2, "A" }, { _3, "A" }, { _4, "A" }, { _5, "A" }, { _6, "A" }, { _7, "A" } },
			[16] = { { _1, "A" }, { _2, "A" }, { _3, "A" }, { _4, "A" }, { _5, "A" }, { _6, "A" }, { _7, "A" }, { _8, "A" } },
			[17] = { { _4, "A" }, { _5, "A" } },
			[18] = { { _3, "A" }, { _4, "A" }, { _5, "A" }, { _6, "A" } },
			[19] = { { _2, "A" }, { _3, "A" }, { _4, "A" }, { _5, "A" }, { _6, "A" }, { _7, "A" } },
			[20] = { { _1, "A" }, { _2, "A" }, { _3, "A" }, { _4, "A" }, { _5, "A" }, { _6, "A" }, { _7, "A" }, { _8, "A" } }
		},
		Sequences = {
			["LEFT"] = sequence():Add( 1, 2, 3, 4, 5, 6, 7, 8 ):Stretch( 4 ):Hold( 8 ):Add( 0 ):Hold( 4 ),
			["RIGHT"] = sequence():Add( 9, 10, 11, 12, 13, 14, 15, 16 ):Stretch( 4 ):Hold( 8 ):Add( 0 ):Hold( 4 ),
			["CENOUT"] = sequence():Add( 17, 18, 19, 20 ):Stretch( 8 ):Hold( 8 ):Add( 0 ):Hold( 4 )
		}
	}
end
